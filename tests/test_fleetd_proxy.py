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


@pytest.mark.parametrize("status,expected", list(proxy.STATUS.items()))
def test_real_shape_mapping(status, expected):
    row = {**FIXTURE["task"]["task"], "status": status}
    result = proxy.task(row)
    assert result["status"] == expected
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
