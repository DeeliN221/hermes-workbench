"""v1 fixtures preserve the real API shape; content is sanitized for publication."""
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import fleetd_client as transport
import fleetd_proxy as proxy
from sidecar_app import TrustedProxyGate

FIXTURE = json.loads((Path(__file__).parent / "fixtures/fleetd-v1.json").read_text())
BASE = "/api/plugins/workbench/fleetd"
HEADERS = {"x-hermes-proxy-secret": "local-secret", "remote-user": "preview"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("FLEET_TOKEN", "private-fixture-token")
    monkeypatch.setenv("HERMES_DASHBOARD_TRUSTED_PROXY_SECRET", "local-secret")
    monkeypatch.setenv("HERMES_WORKBENCH_ALLOWED_USERS", "preview")
    monkeypatch.delenv("HERMES_WORKBENCH_FLEET_MODE", raising=False)
    app = FastAPI()
    app.include_router(proxy.router, prefix="/api/plugins/workbench")
    app.add_middleware(TrustedProxyGate)
    return TestClient(app)


# Independent contract: additions cannot silently disappear with the mapping.
V1_STATUSES = [
    ("ready", "ready"), ("queued", "ready"), ("running", "running"),
    ("claimed", "running"), ("retrying", "running"), ("blocked", "review"),
    ("review", "review"), ("done", "done"), ("failed", "archived"),
    ("cancelled", "archived"), ("archived", "archived"), ("scheduled", "ready"),
]


@pytest.mark.parametrize("status,expected", V1_STATUSES)
def test_real_shape_mapping(status, expected):
    row = {**FIXTURE["task"]["task"], "status": status}
    result = proxy.task(row)
    assert result["status"] == expected
    assert result["fleet_status"] == status
    assert result["verify_mode"] == ("human" if expected == "review" else "auto")
    assert result["read_only"]
    assert result["attempt_count"] == row["attempts"]
    assert "conversation_id" not in result


def test_gate_projection_decisions_workers_detail(client, monkeypatch):
    monkeypatch.setattr(transport.FleetClient, "get", lambda self, path: FIXTURE["task"] if path.startswith("tasks/") else FIXTURE[path.split("?")[0]])
    assert client.get(BASE + "/tasks").status_code == 401
    assert client.get(BASE + "/config", headers=HEADERS).json()["mode"] == "live"
    for route in ("tasks", "decisions", "workers", "tasks/T-example"):
        response = client.get(BASE + "/" + route, headers=HEADERS)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert "private-fixture-token" not in response.text
        assert "raw execution log" not in response.text
    detail = client.get(BASE + "/tasks/T-example", headers=HEADERS).json()
    assert detail["task"]["attempt_count"] == 1
    assert len(detail["open_decision"]["options"]) == 3
    assert detail["open_decision"]["options"][0]["label"] == "A Retry"
    assert client.post(BASE + "/tasks/T-example/decide", headers=HEADERS, json={}).status_code == 404


def test_empty_and_partial_failure(client, monkeypatch):
    monkeypatch.setattr(transport.FleetClient, "get", lambda self, path: {path.split("?")[0]: []})
    for key in ("tasks", "decisions", "workers"):
        assert client.get(BASE + "/" + key, headers=HEADERS).json()[key] == []
    def fail(self, path):
        if path.startswith("decisions"):
            raise HTTPException(504, "Fleet request timed out; retry")
        return {"tasks": FIXTURE["tasks"]["tasks"]}
    monkeypatch.setattr(transport.FleetClient, "get", fail)
    assert client.get(BASE + "/tasks", headers=HEADERS).status_code == 200
    assert client.get(BASE + "/decisions", headers=HEADERS).status_code == 504


@pytest.mark.parametrize("error,code", [(HTTPError("http://secret",401,"secret",{},None),401), (HTTPError("http://secret",500,"secret",{},None),502), (TimeoutError("secret"),504), (URLError(TimeoutError()),504), (URLError("secret"),502)])
def test_readable_transport_errors(client, monkeypatch, error, code):
    class Opener:
        def open(self, request, timeout):
            assert request.get_header("Authorization") == "Bearer private-fixture-token"
            raise error
    monkeypatch.setattr(transport, "build_opener", lambda *args: Opener())
    response = client.get(BASE + "/tasks", headers=HEADERS)
    assert response.status_code == code
    assert "secret" not in response.text and "private-fixture-token" not in response.text


def test_token_file_missing_and_scrubbing(client, monkeypatch, tmp_path):
    monkeypatch.delenv("FLEET_TOKEN")
    token = tmp_path / "token"
    monkeypatch.setenv("FLEET_TOKEN_FILE", str(token))
    assert client.get(BASE + "/tasks", headers=HEADERS).status_code == 503
    token.write_text("file-private-token\n")
    c = transport.FleetClient()
    assert c.base == transport.DEFAULT_URL
    assert c.redact({"title": "file-private-token", "nested": ["file-private-token"]}) == {"title": "[redacted]", "nested": ["[redacted]"]}


def test_pagination(client, monkeypatch):
    seen=[]
    def get(self,path):
        seen.append(path)
        return {"tasks": [{"id": str(len(seen))}], "next_cursor": "next" if len(seen)==1 else ""}
    monkeypatch.setattr(transport.FleetClient,"get",get)
    assert len(transport.FleetClient().collection("tasks",limit=100)) == 2
    assert "cursor=next" in seen[1]


@pytest.mark.parametrize("status,expected", V1_STATUSES + [
    ("future-status", "review"), (None, "review"), ([], "review"), ("", "review"),
])
def test_status_isolation_across_routes(client, monkeypatch, status, expected):
    row = {**FIXTURE["task"]["task"], "status": status}
    healthy = {**row, "id": "T-healthy", "status": "running"}
    def get(self, path):
        resource = path.split("?")[0]
        if resource.startswith("tasks/"):
            return {**FIXTURE["task"], "task": row}
        if resource == "tasks":
            return {"tasks": [row, healthy]}
        return FIXTURE[resource]
    monkeypatch.setattr(transport.FleetClient, "get", get)
    response = client.get(BASE + "/tasks", headers=HEADERS)
    assert response.status_code == 200
    rows = response.json()["tasks"]
    assert [r["status"] for r in rows] == [expected, "running"]
    assert rows[0]["fleet_status"] == status
    assert rows[0]["read_only"]
    assert rows[0]["verify_mode"] == ("human" if expected == "review" else "auto")
    response = client.get(BASE + "/tasks/T-example", headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["task"]["status"] == expected
    assert response.json()["task"]["fleet_status"] == status
    for resource in ("decisions", "workers"):
        response = client.get(BASE + "/" + resource, headers=HEADERS)
        assert response.status_code == 200
        assert len(response.json()[resource]) == 1

WRITE_HEADERS = {**HEADERS, "origin": "http://testserver"}


def test_review_sequence_and_retry(client, monkeypatch):
    monkeypatch.setenv("FLEET_REVIEW_TOKEN", "private-review-token")
    calls, events = [], []
    monkeypatch.setattr(transport.FleetClient, "get", lambda self, path: {"task": {"status": "review"}, "events": events})
    def post(self, path, body, **kwargs):
        calls.append((path, body, kwargs))
        if path.endswith("/note"):
            events.append({"type": "task.note", "payload": body["text"]})
        elif path.endswith("/request_changes") and len(calls) == 2:
            raise HTTPException(504, "Fleet request timed out; retry")
        return {"token": "private-review-token"}
    monkeypatch.setattr(transport.FleetClient, "post", post)
    url = BASE + "/tasks/T-test/request_changes"
    response = client.post(url, headers=WRITE_HEADERS, json={"text": "Fix contrast\nAdd keyboard support"})
    assert response.status_code == 504 and "Feedback saved" in response.text
    response = client.post(url, headers=WRITE_HEADERS, json={"text": "Fix contrast\nAdd keyboard support"})
    assert response.json() == {"ok": True}
    assert [c[0].split("/")[-1] for c in calls] == ["note", "request_changes", "request_changes"]
    assert calls[-1][2] == {"review": True}
    assert client.post(BASE + "/tasks/T-test/approve", headers=WRITE_HEADERS, json={}).json() == {"ok": True}


@pytest.mark.parametrize("action,body", [("approve", {}), ("request_changes", {"text": "Fix it"}), ("note", {"text": "Fix it"})])
def test_review_missing_token_and_state(client, monkeypatch, action, body):
    monkeypatch.delenv("FLEET_REVIEW_TOKEN", raising=False)
    url = BASE + "/tasks/T-test/" + action
    response = client.post(url, headers=WRITE_HEADERS, json=body)
    assert response.status_code == 503 and "FLEET_REVIEW_TOKEN" in response.text
    monkeypatch.setenv("FLEET_REVIEW_TOKEN", "private-fixture-token")
    assert client.post(url, headers=WRITE_HEADERS, json=body).status_code == 503
    monkeypatch.setenv("FLEET_REVIEW_TOKEN", "private-review-token")
    monkeypatch.setattr(transport.FleetClient, "get", lambda self, path: {"task": {"status": "blocked"}})
    assert client.post(url, headers=WRITE_HEADERS, json=body).status_code == 409


@pytest.mark.parametrize("headers,status", [({},401), ({"remote-user":"preview"},401),
    ({"x-hermes-proxy-secret":"local-secret"},401), (HEADERS,403),
    ({**WRITE_HEADERS,"origin":"https://evil.test"},403),
    ({**WRITE_HEADERS,"sec-fetch-site":"cross-site"},403)])
def test_review_auth_and_origin(client, headers, status):
    assert client.post(BASE + "/tasks/T-test/approve", headers=headers, json={}).status_code == status


@pytest.mark.parametrize("suffix,body,status", [("approve?token=forbidden",{},400),
    ("dispatch",{},404), ("approve",{"url":"http://evil.test"},422),
    ("request_changes",{},422), ("note",{"text":" "},422),
    ("note",{"text":"x"*8001},422), ("note",{"text":"x"*33000},413),
    ("note",{"text":12},422)])
def test_review_restricts_inputs(client, suffix, body, status):
    assert client.post(BASE + "/tasks/T-test/" + suffix, headers=WRITE_HEADERS, json=body).status_code == status
    assert client.put(BASE + "/tasks/T-test/approve", headers=WRITE_HEADERS, json={}).status_code == 405
    assert client.post(BASE + "/tasks/bad.id/approve", headers=WRITE_HEADERS, json={}).status_code == 422


def test_review_transport_and_redaction(client, monkeypatch):
    import io
    monkeypatch.setenv("FLEET_REVIEW_TOKEN", "private-review-token")
    class Opener:
        def open(self, request, timeout):
            assert request.full_url.endswith("/tasks/T-test/approve")
            assert request.get_header("Authorization") == "Bearer private-review-token"
            assert request.method == "POST"
            assert b"private-review-token" not in request.data
            return io.BytesIO(b'{"title":"private-fixture-token private-review-token"}')
    monkeypatch.setattr(transport, "build_opener", lambda *args: Opener())
    c = transport.FleetClient()
    assert c.post("tasks/T-test/approve", {}, review=True) == {"title": "[redacted] [redacted]"}
    assert c.redact(["private-review-token"]) == ["[redacted]"]


def test_forwarded_origin_and_note_projection(client, monkeypatch):
    monkeypatch.setenv('FLEET_REVIEW_TOKEN', 'private-review-token')
    monkeypatch.setattr(transport.FleetClient, 'get', lambda self, path: {
        'task': {**FIXTURE['task']['task'], 'status': 'review'},
        'events': [{'type': 'task.note', 'payload': 'First line\nSecond line', 'at': '2026-01-01'},
                   {'type': 'worker.log', 'payload': 'not a review note'}],
    })
    monkeypatch.setattr(transport.FleetClient, 'collection', lambda *args, **kwargs: [])
    monkeypatch.setattr(transport.FleetClient, 'post', lambda *args, **kwargs: {'ok': True})
    headers = {**HEADERS, 'origin': 'https://workbench.example',
               'x-forwarded-host': 'workbench.example', 'x-forwarded-proto': 'https'}
    assert client.post(BASE + '/tasks/T-test/approve', headers=headers, json={}).status_code == 200
    assert client.post(BASE + '/tasks/T-test/approve', headers={**headers, 'origin': 'https://evil.example'}, json={}).status_code == 403
    detail = client.get(BASE + '/tasks/T-test', headers=HEADERS).json()
    assert detail['review_notes'] == [{'text': 'First line\nSecond line', 'at': '2026-01-01'}]
    for status, _ in V1_STATUSES:
        assert proxy.task({'status': status})['review_actions'] == (status == 'review')
