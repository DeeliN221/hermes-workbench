"""Authenticated Fleet projection, revisions, and artifact capability boundaries."""

import copy
import sys
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import fleet_proxy as fleet
from sidecar_app import TrustedProxyGate

TASK = {
    "id": "task-1",
    "title": "Task",
    "status": "triage",
    "revision": 2,
    "risk": "R1",
    "repo": "sample/repo",
    "machine": "dev-box",
    "spec_json": {"summary": "Brief"},
    "acceptance": [{"label": "Checks pass", "checked": True}],
    "created_at": "2026-10-31T00:00:00Z",
    "token": "do-not-expose",
}
HEADERS = {
    "x-hermes-proxy-secret": "test-secret",
    "remote-user": "alice",
    "If-Match": "2",
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("HERMES_DASHBOARD_TRUSTED_PROXY_SECRET", "test-secret")
    monkeypatch.setenv("HERMES_WORKBENCH_ALLOWED_USERS", "alice")
    monkeypatch.setenv("FLEET_URL", "https://fleet.example")
    monkeypatch.setenv("FLEET_TOKEN", "server-only-token")
    monkeypatch.setenv("HERMES_WORKBENCH_FLEET_MODE", "live")
    app = FastAPI()
    app.include_router(fleet.router, prefix="/api/plugins/workbench")
    app.add_middleware(TrustedProxyGate)
    return TestClient(app)


@pytest.fixture
def upstream(monkeypatch):
    task = copy.deepcopy(TASK)
    calls = []
    artifacts = [
        {
            "id": "artifact-1",
            "task_id": "task-1",
            "kind": "report",
            "name": "../../report\r\n.txt",
            "size": 5,
            "content_type": "text/plain",
            "ref": "/etc/passwd",
            "download_url": "https://evil.example",
        }
    ]

    def fake(method, path, body=None, revision=None, binary=False):
        calls.append((method, path, body, revision, binary))
        if binary:
            return b"report"
        if path.startswith("tasks?") or path == "tasks":
            return {"tasks": [task], "task": task}
        return {
            "task": task,
            "artifacts": artifacts,
            "events": [{"secret": "raw event"}],
            "attempts": [{"secret": "raw log"}],
            "open_decision": task.get("decision"),
        }

    monkeypatch.setattr(fleet, "_upstream", fake)
    return task, calls, artifacts


BASE = "/api/plugins/workbench/fleet"


def test_gate_and_projection(client, upstream):
    assert client.get(BASE + "/tasks").status_code == 401
    config = client.get(BASE + "/config", headers=HEADERS).json()
    assert config == {"mode": "live", "extended_workflow": False}
    response = client.get(BASE + "/tasks/task-1", headers=HEADERS)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    text = response.text
    for secret in [
        "server-only-token",
        "do-not-expose",
        "/etc/passwd",
        "evil.example",
        "raw log",
        "raw event",
    ]:
        assert secret not in text
    assert response.json()["task"]["verify_mode"] == "auto"


def test_revision_and_patch_allowlist(client, upstream):
    url = BASE + "/tasks/task-1"
    assert (
        client.patch(
            url, headers=HEADERS, json={"revision": 1, "title": "x"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            url, headers=HEADERS, json={"revision": 2, "status": "done"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            url, headers=HEADERS, json={"revision": 2, "title": "New"}
        ).status_code
        == 200
    )
    assert (
        "PATCH",
        "tasks/task-1",
        {"revision": 2, "title": "New"},
        2,
        False,
    ) in upstream[1]
    assert (
        client.post(
            url + "/dispatch",
            headers={**HEADERS, "If-Match": "1"},
            json={"revision": 1},
        ).status_code
        == 409
    )
    assert (
        client.post(
            url + "/dispatch", headers=HEADERS, json={"revision": 2}
        ).status_code
        == 200
    )


def test_live_extension_rejected_and_illegal_moves(client, upstream, monkeypatch):
    url = BASE + "/tasks/task-1"
    assert (
        client.post(BASE + "/tasks", headers=HEADERS, json={"title": "New"}).status_code
        == 200
    )
    assert (
        client.post(
            url + "/transition", headers=HEADERS, json={"revision": 2, "status": "done"}
        ).status_code
        == 501
    )
    monkeypatch.setenv("HERMES_WORKBENCH_FLEET_MODE", "mock")
    assert (
        client.post(
            url + "/transition", headers=HEADERS, json={"revision": 2, "status": "done"}
        ).status_code
        == 422
    )
    upstream[0]["repo"] = ""
    assert (
        client.post(
            url + "/dispatch", headers=HEADERS, json={"revision": 2}
        ).status_code
        == 422
    )


def test_decision_choices_and_automatic_verification(client, upstream):
    task = upstream[0]
    task["decision"] = {
        "id": "d",
        "question": "Choose?",
        "options": [
            {"id": "a", "label": "A", "impact": "Slow", "recommended": True},
            {"id": "b", "label": "B", "impact": "Fast"},
        ],
    }
    url = BASE + "/tasks/task-1/decide"
    assert (
        client.post(
            url,
            headers=HEADERS,
            json={"revision": 2, "decision_id": "d", "option_id": "x"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            url,
            headers=HEADERS,
            json={"revision": 2, "decision_id": "d", "option_id": "a"},
        ).status_code
        == 200
    )
    task.pop("decision")
    task["status"] = "running"
    with pytest.raises(Exception):
        fleet._validate_transition(task, "review")
    fleet._validate_transition(task, "done")
    task["risk"] = "R2"
    with pytest.raises(Exception):
        fleet._validate_transition(task, "done")
    fleet._validate_transition(task, "review")


def test_artifact_membership_safe_download_and_errors(client, upstream):
    url = BASE + "/artifacts/artifact-1/download?task_id=task-1"
    response = client.get(url, headers=HEADERS)
    assert response.status_code == 200 and response.content == b"report"
    assert response.headers["content-type"] == "application/octet-stream"
    assert "\r" not in response.headers["content-disposition"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert ("GET", "artifacts/artifact-1/download", None, None, True) in upstream[1]
    upstream[2][0]["task_id"] = "other-task"
    assert client.get(url, headers=HEADERS).status_code == 404
    assert (
        client.get(
            BASE + "/artifacts/artifact-1/download?task_id=..%2Fsecret", headers=HEADERS
        ).status_code
        == 422
    )


def test_config_requires_secure_origin(client, monkeypatch):
    monkeypatch.setenv("FLEET_URL", "https://token@fleet.example")
    assert client.get(BASE + "/config", headers=HEADERS).status_code == 503
    monkeypatch.delenv("FLEET_TOKEN")
    assert client.get(BASE + "/config", headers=HEADERS).json()["mode"] == "mock"


def test_v2_transport_credentials_errors_and_projection(client, monkeypatch):
    from urllib.error import HTTPError
    import json

    seen = []

    class Reply:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, limit):
            return b"{}"

    class Opener:
        def open(self, request, timeout):
            seen.append(request)
            return Reply()

    monkeypatch.setattr(fleet, "build_opener", lambda *args: Opener())
    monkeypatch.setenv("FLEET_REVIEW_TOKEN", "human-only")
    fleet._upstream("PATCH", "tasks/task-1", {"revision": 2}, 2)
    assert seen[-1].full_url == "https://fleet.example/api/v2/tasks/task-1"
    assert seen[-1].get_header("Authorization") == "Bearer server-only-token"
    assert json.loads(seen[-1].data) == {"revision": 2}
    fleet._upstream("POST", "tasks/task-1/approve", {}, review=True)
    assert seen[-1].get_header("Authorization") == "Bearer human-only"
    monkeypatch.delenv("FLEET_REVIEW_TOKEN")
    with pytest.raises(fleet.HTTPException) as error:
        fleet._upstream("POST", "tasks/task-1/approve", {}, review=True)
    assert error.value.status_code == 403
    for status in (403, 404, 409, 410):

        class Failed:
            def open(self, request, timeout):
                raise HTTPError(
                    request.full_url, status, "secret upstream body", {}, None
                )

        monkeypatch.setattr(fleet, "build_opener", lambda *args: Failed())
        with pytest.raises(fleet.HTTPException) as error:
            fleet._upstream("GET", "tasks/task-1")
        assert error.value.status_code == status
        assert "secret" not in error.value.detail
    task = fleet._task(
        {
            **TASK,
            "spec_json": "Plain brief",
            "acceptance": "One\nTwo",
            "priority": 5,
            "status": "review",
        }
    )
    assert task["spec_json"] == {"summary": "Plain brief"}
    assert task["acceptance"] == [
        {"label": "One", "checked": True},
        {"label": "Two", "checked": True},
    ]
    assert task["priority"] == "P5"
    assert (
        fleet._decision({"options": [{"label": "A"}, {"label": "B"}]})["options"][1][
            "id"
        ]
        == "1"
    )


def test_demo_defaults_never_contact_live(client, monkeypatch):
    monkeypatch.delenv("HERMES_WORKBENCH_FLEET_MODE")

    def forbidden(*args):
        raise AssertionError("Must not contact upstream")

    monkeypatch.setattr(fleet, "build_opener", forbidden)
    assert client.get(BASE + "/config", headers=HEADERS).json() == {
        "mode": "mock",
        "extended_workflow": True,
    }
    task = client.post(
        BASE + "/tasks", headers=HEADERS, json={"title": "Local demo"}
    ).json()["task"]
    assert task["status"] == "triage"
    assert client.get(BASE + "/tasks/" + task["id"], headers=HEADERS).status_code == 200
    monkeypatch.setenv("HERMES_WORKBENCH_FLEET_MODE", "live")
    monkeypatch.delenv("FLEET_TOKEN")
    assert client.get(BASE + "/config", headers=HEADERS).json()["mode"] == "mock"


def test_live_payloads_and_review_routing(client, upstream, monkeypatch):
    task, calls, _ = upstream
    response = client.patch(
        BASE + "/tasks/task-1",
        headers=HEADERS,
        json={
            "revision": 2,
            "spec_json": {"summary": "Brief"},
            "acceptance": [{"label": "Pass", "checked": False}],
            "priority": "P2",
        },
    )
    assert response.status_code == 200
    assert calls[0][2] == {
        "revision": 2,
        "spec_json": "Brief",
        "acceptance": "Pass",
        "priority": 2,
    }
    task["status"] = "review"
    original = fleet._upstream
    review_calls = []

    def transport(method, path, body=None, revision=None, binary=False, review=False):
        review_calls.append((path, review))
        return original(method, path, body, revision, binary)

    monkeypatch.setattr(fleet, "_upstream", transport)
    for action in ("approve", "request_changes"):
        assert (
            client.post(
                BASE + "/tasks/task-1/" + action, headers=HEADERS, json={"revision": 2}
            ).status_code
            == 200
        )
        assert ("tasks/task-1/" + action, True) in review_calls
    task["status"] = "running"
    assert (
        client.post(
            BASE + "/tasks/task-1/approve", headers=HEADERS, json={"revision": 2}
        ).status_code
        == 409
    )
