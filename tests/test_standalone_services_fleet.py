"""Contract-fake integration: Fleet authority, durable schedules, and DSH delivery."""

from __future__ import annotations

import asyncio
import copy
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))
from dashboard.standalone_services import StandaloneServices
from dashboard.standalone_domains.fleet import origin
from dashboard.standalone_domains.schedules import next_time

API = "/api/plugins/workbench"
NOW = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)


class ContractFleet:
    """The fake preserves Fleet-owned state across service restarts and timeouts."""

    def __init__(self):
        self.tasks, self.requests, self.deliveries = {}, {}, []
        self.calls, self.acks, self.messages = [], [], []
        self.dispatches = []
        self.fail_after_create = False
        self.fail_ack = False

    async def __call__(self, method, path, body=None, params=None):
        self.calls.append((method, path, copy.deepcopy(body), copy.deepcopy(params)))
        if path == "/tasks" and method == "POST":
            assert set(body["origin"]) == {
                "user_id",
                "profile_id",
                "project_id",
                "session_id",
                "runtime",
            }
            assert isinstance(body["depends_on"], list) and body["request_id"]
            assert (
                body["deliverable"]
                and body["acceptance"]
                and body["report_required"] is False
            )
            key = (json.dumps(body["origin"], sort_keys=True), body["request_id"])
            if key not in self.requests:
                tid = f"task{len(self.tasks) + 1}"
                self.tasks[tid] = {
                    **copy.deepcopy(body),
                    "id": tid,
                    "status": "triage",
                    "attempt_id": "attempt1",
                    "epoch": 1,
                }
                self.requests[key] = tid
            row = self.tasks[self.requests[key]]
            if self.fail_after_create:
                self.fail_after_create = False
                raise HTTPException(504, "Response lost after durable Fleet creation")
            return {"task": copy.deepcopy(row)}
        if path.startswith("/tasks/") and path.endswith("/dispatch"):
            tid = path.split("/")[2]
            if self.tasks[tid]["status"] != "triage":
                raise HTTPException(409, "Already dispatched")
            self.dispatches.append(tid)
            self.tasks[tid]["status"] = "ready"
            return {"task": copy.deepcopy(self.tasks[tid])}
        if path == "/tasks" and method == "GET":
            return {"tasks": copy.deepcopy(list(self.tasks.values()))}
        if path.startswith("/tasks/") and path.endswith("/messages"):
            tid = path.split("/")[2]
            assert body["origin"] == self.tasks[tid]["origin"]
            if not any(m["message_id"] == body["message_id"] for m in self.messages):
                self.messages.append(copy.deepcopy(body))
            return {
                "accepted": True,
                "task_id": tid,
                "attempt_id": self.tasks[tid]["attempt_id"],
                "epoch": self.tasks[tid]["epoch"],
            }
        if path.startswith("/tasks/") and path.endswith("/collaboration"):
            tid = path.split("/")[2]
            return {
                "task_id": tid,
                "origin": copy.deepcopy(self.tasks[tid].get("origin")),
                "messages": copy.deepcopy(self.messages),
            }
        if path.startswith("/tasks/") and method == "GET":
            tid = path.split("/")[2]
            if tid not in self.tasks:
                raise HTTPException(404, "Task not found")
            row = self.tasks[tid]
            return {
                "task": {
                    k: copy.deepcopy(v)
                    for k, v in row.items()
                    if k not in ("attempt_id", "epoch")
                },
                "attempts": [
                    {
                        "id": row.get("attempt_id"),
                        "lease_epoch": row.get("epoch"),
                        "status": "running",
                    }
                ],
            }
        if path == "/deliveries":
            required = {"user_id", "profile_id", "project_id", "session_id", "runtime"}
            assert set(params) == required | {"limit"}
            return {
                "deliveries": [
                    {k: copy.deepcopy(v) for k, v in d.items() if k != "origin"}
                    for d in self.deliveries
                    if d["id"] not in self.acks
                    and all(d["origin"][k] == params[k] for k in required)
                ][: params["limit"]]
            }
        if path.startswith("/deliveries/") and path.endswith("/ack"):
            did = path.split("/")[2]
            if self.fail_ack:
                raise HTTPException(504, "ACK response unavailable")
            self.acks.append(did)
            return {"acknowledged": True}
        raise HTTPException(501, "Unsupported contract fake action")


class DurableRuntime:
    capabilities = {"durable_scheduled_input": True}

    def __init__(self):
        self.history, self.scheduled, self.foreground, self.created = {}, {}, [], {}

    async def create_session(self, c, payload):
        rid = payload["request_id"]
        if rid not in self.created:
            self.created[rid] = {
                "id": "created" + str(len(self.created)),
                "runtime": "dsh",
                "profile_id": c["profile_id"],
                "project_id": c["project_id"],
            }
        return self.created[rid]

    async def persist_delivery(self, c, sid, delivery, key):
        self.history.setdefault(key, (sid, copy.deepcopy(delivery)))
        return {"persisted": True}

    async def scheduled_input(self, c, sid, payload):
        self.scheduled.setdefault(payload["request_id"], (sid, copy.deepcopy(payload)))
        return {"request_id": payload["request_id"], "status": "accepted"}

    async def send_message(self, c, sid, payload):
        self.foreground.append((sid, payload))
        return {"request_id": payload["request_id"], "status": "accepted"}


@pytest.fixture
def env(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    c = {
        "user_id": "alice",
        "profile_id": "profile",
        "project_id": "project",
        "workspace": str(workspace),
    }

    def resolver(request):
        return {
            **c,
            "user_id": request.headers.get("x-user", c["user_id"]),
            "project_id": request.headers.get("x-project", c["project_id"]),
        }

    fleet = ContractFleet()
    runtime = DurableRuntime()

    def new_services():
        s = StandaloneServices(
            resolver,
            tmp_path / "state",
            runtime,
            fleet_request=fleet,
            clock=lambda: NOW,
        )
        s.bind_session(
            c,
            {
                "id": "original",
                "runtime": "dsh",
                "profile_id": c["profile_id"],
                "project_id": c["project_id"],
            },
        )
        return s

    s = new_services()
    app = FastAPI()
    app.include_router(s.router(), prefix=API)
    app.include_router(s.extra_router())
    with TestClient(app) as client:
        yield s, client, c, fleet, runtime, new_services


def create_task(client, **overrides):
    payload = {
        "title": "A real task",
        "prompt": "Do useful work",
        "session_id": "original",
        "request_id": "request1",
        **overrides,
    }
    response = client.post(API + "/fleet/tasks", json=payload)
    assert response.status_code == 200, response.text
    return response.json()["task"]


def test_scoped_task_create_dependency_followup_and_foreground(env):
    s, client, c, fleet, runtime, _ = env
    task = create_task(client)
    assert task["origin"] == origin(c, "original")
    assert create_task(client)["id"] == task["id"] and len(fleet.tasks) == 1
    dependent = create_task(client, request_id="dependent", depends_on=[task["id"]])
    assert fleet.tasks[dependent["id"]]["depends_on"] == [task["id"]]
    response = client.post(
        API + f"/fleet/tasks/{task['id']}/messages",
        json={"message_id": "followup1", "text": "More detail"},
    )
    assert response.status_code == 200 and response.json()["attempt_id"] == "attempt1"
    assert fleet.messages[0]["origin"]["session_id"] == "original"
    assert (
        client.get(API + f"/fleet/tasks/{task['id']}/collaboration").status_code == 200
    )
    assert (
        client.get(
            API + f"/fleet/tasks/{task['id']}", headers={"x-user": "bob"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            API + f"/fleet/tasks/{task['id']}/retry",
            headers={"x-project": "other"},
            json={},
        ).status_code
        == 403
    )
    assert (
        client.post(
            API + "/fleet/tasks",
            headers={"x-user": "bob"},
            json={
                "title": "Bad",
                "prompt": "bad",
                "session_id": "original",
                "request_id": "bad",
                "depends_on": [task["id"]],
            },
        ).status_code
        == 404
    )
    response = client.post(
        API + "/fleet/tasks",
        json={
            "prompt": "Foreground input",
            "session_id": "original",
            "request_id": "foreground1",
            "execution": "foreground",
        },
    )
    assert response.json()["status"] == "accepted" and len(runtime.foreground) == 1
    assert len(fleet.tasks) == 2


def test_legacy_missing_origin_and_other_profile_never_exposed(env):
    _, client, c, fleet, _, _ = env
    create_task(client)
    fleet.tasks["legacy"] = {"id": "legacy", "title": "AGY work", "status": "running"}
    fleet.tasks["other"] = {
        "id": "other",
        "origin": {**origin(c, "original"), "profile_id": "other"},
    }
    rows = client.get(API + "/fleet/tasks").json()["tasks"]
    assert [r["id"] for r in rows] == ["task1"]
    assert client.get(API + "/fleet/tasks/legacy").status_code == 403
    assert (
        client.post(
            API + "/fleet/tasks/other/messages", json={"message_id": "m", "text": "x"}
        ).status_code
        == 403
    )
    assert not fleet.messages


def add_delivery(fleet, c, task_id="task1", did="delivery1", **overrides):
    value = {
        "id": did,
        "task_id": task_id,
        "attempt_id": "attempt1",
        "epoch": 1,
        "origin": origin(c, "original"),
        "text": "Durable result",
        **overrides,
    }
    fleet.deliveries.append(value)
    return value


def test_delivery_persist_then_ack_original_session_and_restart_dedupe(env):
    s, client, c, fleet, runtime, restart = env
    task = create_task(client)
    add_delivery(fleet, c, task["id"])
    fleet.fail_ack = True
    response = client.post(
        API + "/fleet/deliveries/drain", json={"session_id": "original"}
    )
    assert response.status_code == 504 and not fleet.acks
    assert runtime.history["fleet-delivery:delivery1"][0] == "original"
    assert len(runtime.history) == 1
    fleet.fail_ack = False
    result = asyncio.run(restart().drain_deliveries(c, "original"))
    assert (
        result["delivered"] == 1
        and fleet.acks == ["delivery1"]
        and len(runtime.history) == 1
    )
    assert asyncio.run(s.drain_deliveries(c, "original")) == {
        "delivered": 0,
        "stale": 0,
    }


def test_accepted_receipt_is_not_persistence_and_stale_attempt_is_not_delivered(env):
    s, client, c, fleet, runtime, _ = env
    create_task(client)
    add_delivery(fleet, c)

    async def not_persisted(*args):
        return {"status": "accepted"}

    runtime.persist_delivery = not_persisted
    assert (
        client.post(
            API + "/fleet/deliveries/drain", json={"session_id": "original"}
        ).status_code
        == 502
    )
    assert not fleet.acks and not runtime.history
    fleet.tasks["task1"]["attempt_id"] = "attempt2"
    fleet.tasks["task1"]["epoch"] = 2
    assert asyncio.run(s.drain_deliveries(c, "original")) == {
        "delivered": 0,
        "stale": 1,
    }
    assert fleet.acks == ["delivery1"] and not runtime.history


def test_delivery_cross_session_or_origin_rejected_even_if_fleet_filter_breaks(env):
    s, _, c, fleet, _, _ = env
    asyncio.run(
        s.fleet.create(
            c, {"prompt": "task", "session_id": "original", "request_id": "task"}
        )
    )
    wrong = {
        "id": "d",
        "task_id": "task1",
        "attempt_id": "attempt1",
        "epoch": 1,
        "origin": origin(c, "other"),
    }
    transport = fleet.__call__

    async def faulty(method, path, body=None, params=None):
        if path == "/deliveries":
            return {"deliveries": [wrong]}
        return await transport(method, path, body, params)

    s.fleet.transport = faulty
    with pytest.raises(HTTPException) as exc:
        asyncio.run(s.drain_deliveries(c, "original"))
    assert exc.value.status_code == 403 and not fleet.acks


def create_job(client, **overrides):
    data = {
        "name": "Isolated schedule",
        "prompt": "Scheduled useful work",
        "schedule": "@every 5m",
        "session_id": "original",
        "request_id": "schedule-create",
        "timezone": "UTC",
        **overrides,
    }
    response = client.post("/api/cron/jobs", json=data)
    assert response.status_code == 200, response.text
    return response.json()["job"]


def test_schedule_restart_persistence_request_id_trigger_pause_and_history(env):
    s, client, c, fleet, _, restart = env
    job = create_job(client)
    assert create_job(client)["id"] == job["id"]
    assert (
        client.post(
            "/api/cron/jobs",
            json={
                **{
                    k: job[k]
                    for k in (
                        "name",
                        "prompt",
                        "schedule",
                        "session_id",
                        "request_id",
                        "timezone",
                    )
                },
                "prompt": "different",
            },
        ).status_code
        == 409
    )
    assert asyncio.run(restart().run_due(c, NOW + timedelta(minutes=5)))
    assert len(fleet.tasks) == 1
    assert asyncio.run(restart().run_due(c, NOW + timedelta(minutes=5))) == []
    runs = client.get(f"/api/cron/jobs/{job['id']}/runs").json()["runs"]
    assert runs[0]["status"] == "accepted" and runs[0]["task_id"] == "task1"
    assert (
        client.post(f"/api/cron/jobs/{job['id']}/pause").json()["job"]["enabled"]
        is False
    )
    assert asyncio.run(s.run_due(c, NOW + timedelta(minutes=10))) == []
    assert (
        client.post(f"/api/cron/jobs/{job['id']}/resume").json()["job"]["enabled"]
        is True
    )
    for _ in range(2):
        response = client.post(
            f"/api/cron/jobs/{job['id']}/trigger",
            headers={"Idempotency-Key": "manual1"},
        )
        assert response.status_code == 200, response.text
    assert len(fleet.tasks) == 2
    assert (
        len(
            client.get(
                "/api/plugins/workbench-cron/executions", params={"job_id": job["id"]}
            ).json()["executions"]
        )
        == 2
    )
    assert client.get("/api/cron/jobs", headers={"x-user": "bob"}).json()["jobs"] == []
    assert (
        client.post(
            f"/api/cron/jobs/{job['id']}/pause", headers={"x-user": "bob"}
        ).status_code
        == 404
    )


def test_schedule_network_loss_after_fleet_creation_reuses_occurrence_on_restart(env):
    s, client, c, fleet, _, restart = env
    job = create_job(client)
    fleet.fail_after_create = True
    with pytest.raises(HTTPException) as exc:
        asyncio.run(s.run_due(c, NOW + timedelta(minutes=5)))
    assert exc.value.status_code == 504 and len(fleet.tasks) == 1
    pending = s.schedules.history(c, job["id"])[0]
    assert pending["status"] == "pending"
    asyncio.run(restart().run_due(c, NOW + timedelta(minutes=6)))
    assert len(fleet.tasks) == 1
    accepted = s.schedules.history(c, job["id"])[0]
    assert accepted["id"] == pending["id"] and accepted["status"] == "accepted"
    assert s.schedules.get(c, job["id"])["runs"] == 1


def test_schedule_missed_run_policy_repeat_and_edit(env):
    s, client, c, fleet, _, _ = env
    skip = create_job(client)
    latest = create_job(
        client, request_id="latest", missed_run_policy="latest", repeat=1
    )
    asyncio.run(s.run_due(c, NOW + timedelta(hours=2)))
    assert len(fleet.tasks) == 1
    assert s.schedules.get(c, latest["id"])["enabled"] is False
    assert (
        s.schedules.get(c, skip["id"])["next_run_at"]
        == (NOW + timedelta(hours=2, minutes=5)).isoformat()
    )
    response = client.put(
        f"/api/cron/jobs/{skip['id']}",
        json={"updates": {"schedule": "0 12 * * *", "timezone": "Asia/Tokyo"}},
    )
    assert (
        response.status_code == 200
        and response.json()["job"]["next_run_at"] == "2026-01-01T03:00:00+00:00"
    )


@pytest.mark.parametrize(
    "option",
    [
        {"no_agent": True},
        {"script": "echo bad"},
        {"skills": ["x"]},
        {"deliver": "remote"},
        {"model": "override"},
        {"monitor_url": "https://example.test"},
        {"enabled_toolsets": ["shell"]},
        {"context_from": ["self"]},
        {"continuity": True},
        {"reasoning_effort": "high"},
        {"provider": "override"},
        {"failure_deliver": "remote"},
        {"repeat": -1},
        {"timezone": "Not/AZone"},
        {"missed_run_policy": "catchup"},
    ],
)
def test_unsupported_schedule_options_are_rejected_without_metadata(env, option):
    _, client, _, fleet, _, _ = env
    response = client.post(
        "/api/cron/jobs",
        json={
            "prompt": "x",
            "schedule": "@every 5m",
            "session_id": "original",
            **option,
        },
    )
    assert response.status_code == 422, response.text
    assert client.get("/api/cron/jobs").json()["jobs"] == [] and not fleet.tasks


def test_foreground_scheduled_runtime_actual_callback_and_session_creation(env):
    s, client, c, fleet, runtime, restart = env
    job = create_job(client, execution="foreground", session_id=None)
    assert job["session_id"].startswith("created")
    asyncio.run(s.run_due(c, NOW + timedelta(minutes=5)))
    assert len(runtime.scheduled) == 1 and not fleet.tasks
    run = s.schedules.history(c, job["id"])[0]
    assert (
        run["runtime_receipt"]["status"] == "accepted" and run["status"] == "accepted"
    )
    assert asyncio.run(restart().run_due(c, NOW + timedelta(minutes=5))) == []


def test_foreground_schedule_requires_durable_capability(env):
    s, client, _, _, runtime, _ = env
    runtime.capabilities = {"durable_scheduled_input": False}
    response = client.post(
        "/api/cron/jobs",
        json={
            "prompt": "x",
            "schedule": "@every 5m",
            "session_id": "original",
            "execution": "foreground",
        },
    )
    assert response.status_code == 503


def test_timezone_dst_cron_and_one_shot_semantics():
    assert next_time("0 9 * * *", "Asia/Tokyo", NOW) == datetime(
        2026, 1, 2, 0, 0, tzinfo=timezone.utc
    )
    before_gap = datetime(2026, 3, 8, 6, 59, tzinfo=timezone.utc)
    assert next_time("30 2 * * *", "America/New_York", before_gap) == datetime(
        2026, 3, 9, 6, 30, tzinfo=timezone.utc
    )
    first_fold = datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc)
    assert next_time("30 1 * * *", "America/New_York", first_fold) == datetime(
        2026, 11, 1, 6, 30, tzinfo=timezone.utc
    )
    assert next_time("2026-01-01T00:01:00Z", "UTC", NOW) == NOW + timedelta(minutes=1)
    assert next_time("2026-01-01T00:00:00Z", "UTC", NOW) is None
    with pytest.raises(HTTPException):
        next_time("2026-01-01T00:01:00", "UTC", NOW)
    with pytest.raises(HTTPException):
        next_time("*/0 * * * *", "UTC", NOW)


def test_task_sync_search_projection_and_invalid_foreground_dependencies(env):
    _, client, c, fleet, _, _ = env
    task = create_task(client)
    fleet.tasks[task["id"]]["backend_token"] = "synthetic-backend-value"
    fleet.tasks[task["id"]]["worker_env"] = {"EXAMPLE": "synthetic-backend-value"}
    result = client.post(
        API + "/fleetd/tasks/sync", json={"lane": "fast", "cursor": ""}
    )
    assert result.status_code == 200 and result.json()["full"] is True
    assert (
        result.json()["tasks"][0]["id"] == task["id"]
        and "synthetic-backend-value" not in result.text
    )
    assert (
        client.get(API + "/fleetd/tasks/search?q=real").json()["tasks"][0]["id"]
        == task["id"]
    )
    assert client.get(API + "/fleetd/tasks/search?q=missing").json()["tasks"] == []
    assert client.get(API + "/fleetd/tasks/search?cursor=bad").status_code == 422
    assert (
        client.post(
            API + "/fleet/tasks",
            json={
                "prompt": "x",
                "session_id": "original",
                "request_id": "foreground-dep",
                "execution": "foreground",
                "depends_on": [task["id"]],
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            API + "/fleet/tasks",
            json={"prompt": "x", "session_id": "original", "request_id": "request1"},
        ).status_code
        == 409
    )


def test_worker_followup_attempt_contract_and_stale_ack(env):
    s, client, c, fleet, _, _ = env
    task = create_task(client)
    calls = []
    base = fleet.__call__

    async def worker_transport(method, path, body=None, params=None):
        if path.endswith("/messages") and method == "GET":
            calls.append(("get", params))
            return {"messages": [{"message_id": "m", "text": "Follow up"}]}
        if path.endswith("/messages/m/ack"):
            calls.append(("ack", body))
            return {"acknowledged": True}
        return await base(method, path, body, params)

    s.fleet.transport = worker_transport
    assert (
        asyncio.run(s.fleet.worker_messages(c, task["id"], "attempt1", 1))["messages"][
            0
        ]["message_id"]
        == "m"
    )
    assert asyncio.run(s.fleet.ack_worker_message(c, task["id"], "m", "attempt1", 1))[
        "acknowledged"
    ]
    assert calls[-1] == ("ack", {"attempt_id": "attempt1", "epoch": 1})
    fleet.tasks[task["id"]]["epoch"] = 2
    with pytest.raises(HTTPException) as exc:
        asyncio.run(s.fleet.ack_worker_message(c, task["id"], "m", "attempt1", 1))
    assert exc.value.status_code == 409
    assert len([x for x in calls if x[0] == "ack"]) == 1


def test_schedule_delivery_ids_and_private_runtime_context_not_exposed(env):
    s, client, c, fleet, runtime, _ = env
    job = create_job(client)
    asyncio.run(s.run_due(c, NOW + timedelta(minutes=5)))
    add_delivery(fleet, c)
    asyncio.run(s.drain_deliveries(c, "original"))
    assert s.schedules.history(c, job["id"])[0]["delivery_ids"] == ["delivery1"]
    assert (
        client.put(
            API + "/mcp",
            json={
                "mcpServers": {
                    "configured": {
                        "command": "example",
                        "env": {"EXAMPLE": "synthetic-private-value"},
                    }
                }
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            API + "/runtime-context",
            json={"memory": [], "skills": [], "mcp": ["configured"]},
        ).status_code
        == 200
    )
    foreground = create_job(client, request_id="fg-private", execution="foreground")
    asyncio.run(s.run_due(c, NOW + timedelta(minutes=5)))
    result = client.get(f"/api/cron/jobs/{foreground['id']}/runs")
    assert result.json()["runs"] and "synthetic-private-value" not in result.text
    assert "runtime_context" not in result.text
    assert "synthetic-private-value" in json.dumps(list(runtime.scheduled.values()))


def test_explicit_archive_selection_creates_a_new_dsh_session(env):
    s, client, c, _, runtime, _ = env
    path = Path(c["workspace"]) / "selected.json"
    path.write_text(
        json.dumps(
            {
                "id": "legacy",
                "messages": [
                    {"role": "user", "content": "selected context"},
                    {"role": "assistant", "content": "unselected content"},
                ],
            }
        )
    )
    aid = client.post(
        API + "/archives/import", json={"path": "selected.json", "source": "hermes"}
    ).json()["session"]["id"]
    captured = []
    create = runtime.create_session

    async def capture(c, payload):
        captured.append(payload)
        return await create(c, payload)

    runtime.create_session = capture
    response = client.post(
        API + f"/archives/{aid}/new-session",
        json={"indexes": [0], "request_id": "archive-selection1"},
    )
    assert response.status_code == 200, response.text
    assert (
        response.json()["session"]["runtime"] == "dsh"
        and response.json()["session"]["id"] != aid
    )
    assert (
        captured[0]["context"]["archive_context"]["messages"][0]["content"]
        == "selected context"
    )
    assert "unselected content" not in json.dumps(captured)
    assert s.archives.get(c, aid)["resumable"] is False


def test_invalid_delivery_limit_fails_cleanly(env):
    _, client, _, _, _, _ = env
    for value in ("ten", -1, None, True):
        response = client.post(
            API + "/fleet/deliveries/drain",
            json={"session_id": "original", "limit": value},
        )
        assert response.status_code == 422


def test_fleet_http_uses_server_injected_credentials_and_separate_review_contract(
    monkeypatch,
):
    import httpx
    from dashboard.standalone_domains.fleet import FleetHTTP

    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"accepted": True})

    client_class = httpx.AsyncClient

    def mock_client(**kwargs):
        return client_class(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", mock_client)
    transport = FleetHTTP(
        "http://127.0.0.1",
        token_provider=lambda: "synthetic-task-credential",
        review_token_provider=lambda: "synthetic-review-credential",
    )
    asyncio.run(transport("POST", "/tasks", {"request_id": "r"}))
    asyncio.run(transport("POST", "/tasks/t/approve", {"revision": 3}))
    assert requests[0].url.path == "/api/v2/tasks"
    assert requests[0].headers["authorization"] == "Bearer synthetic-task-credential"
    assert requests[1].headers["authorization"] == "Bearer synthetic-review-credential"
    assert requests[1].headers["if-match"] == "3"


def test_background_app_hook_dispatches_once_and_rejects_attachments_and_scope(env):
    s, client, c, fleet, _, restart = env
    payload = {
        "message": "Implement the requested parser and verify its behavior",
        "request_id": "app-submit",
        "session_id": "original",
    }
    response = client.post(
        API + "/tasks/background?profile_id=profile&session_id=original", json=payload
    )
    assert response.status_code == 200
    receipt = response.json()
    assert receipt == {
        "task_id": "task1",
        "status": "ready",
        "origin": origin(c, "original"),
    }
    assert (
        asyncio.run(
            restart().submit_background(c, payload["message"], "app-submit", "original")
        )
        == receipt
    )
    assert fleet.dispatches == ["task1"]
    task = fleet.tasks["task1"]
    assert (
        task["acceptance"]
        and "parser" in task["deliverable"]
        and task["workspace"] == c["workspace"]
    )
    assert (
        task["kind"] == "code"
        and task["risk"] == "R1"
        and task["report_required"] is False
    )
    assert "model" not in task and "reasoning_effort" not in task
    for invalid in (
        {**payload, "attachmentIds": ["opaque"]},
        {**payload, "message": {"text": "x", "images": ["x"]}},
    ):
        assert client.post(API + "/tasks/background", json=invalid).status_code == 422
    assert (
        client.post(
            API + "/tasks/background?session_id=other", json=payload
        ).status_code
        == 403
    )
    assert (
        client.post(
            API + "/tasks/background", json={**payload, "workspace": "/arbitrary"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            API + "/tasks/background", json={**payload, "repo": "/arbitrary"}
        ).status_code
        == 422
    )


def test_originless_stale_delivery_acks_then_limit_one_advances(env):
    s, client, c, fleet, runtime, _ = env
    create_task(client)
    add_delivery(fleet, c, did="obsolete", attempt_id="old", epoch=0)
    add_delivery(fleet, c, did="current")
    # Actual epochs are positive; use an older fenced epoch on the stale result.
    fleet.tasks["task1"]["epoch"] = 2
    fleet.deliveries[0]["epoch"] = 1
    fleet.deliveries[1]["epoch"] = 2
    result = asyncio.run(s.drain_deliveries(c, "original", limit=1))
    assert result == {"delivered": 1, "stale": 1}
    assert fleet.acks == ["obsolete", "current"]
    assert list(runtime.history) == ["fleet-delivery:current"]


def test_lifecycle_restart_resolves_authorized_context_and_runs_without_browser(env):
    s, client, c, fleet, runtime, restart = env
    create_job(client)
    saved = s.enumerate_work()
    assert (
        saved
        and "workspace" not in saved[0]
        and c["workspace"] not in json.dumps(saved)
    )
    calls = []

    async def loader(identity):
        calls.append(identity)
        return c

    restarted = restart()
    result = asyncio.run(restarted.poll_once(loader, now=NOW + timedelta(minutes=5)))
    assert not result["errors"] and len(fleet.tasks) == 1
    assert calls == [{k: c[k] for k in ("user_id", "profile_id", "project_id")}]
    add_delivery(fleet, c)
    result = asyncio.run(restart().poll_once(loader, now=NOW + timedelta(minutes=5)))
    assert result["deliveries"][0]["delivered"] == 1 and runtime.history

    async def wrong_scope(identity):
        return {**c, "user_id": "other"}

    result = asyncio.run(restarted.poll_once(wrong_scope))
    assert result["errors"][0]["operation"] == "context_authorization"
    other = Path(c["workspace"]).parent / "other"
    other.mkdir()
    result = asyncio.run(restarted.poll_once(lambda _: {**c, "workspace": str(other)}))
    assert result["errors"][0]["operation"] == "context_authorization"

    async def lifecycle():
        ready = asyncio.Event()

        async def loader_once(identity):
            ready.set()
            return c

        task = restarted.start_background(loader_once, interval=1)
        assert restarted.start_background(loader_once, interval=1) is task
        await asyncio.wait_for(ready.wait(), timeout=1)
        await restarted.stop_background()
        assert task.done() and restarted._background_task is None

    asyncio.run(lifecycle())


def test_upstream_400_preserves_safe_error_code(monkeypatch):
    import httpx
    from dashboard.standalone_domains.fleet import FleetHTTP

    client_class = httpx.AsyncClient

    def handle(request):
        return httpx.Response(
            400,
            json={
                "error": {
                    "code": "deliverable_required",
                    "message": "private upstream details",
                }
            },
        )

    def mock_client(**kwargs):
        return client_class(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", mock_client)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            FleetHTTP("http://127.0.0.1", token_provider=lambda: "synthetic")(
                "POST", "/tasks", {}
            )
        )
    assert exc.value.status_code == 400 and "deliverable_required" in exc.value.detail
    assert "private upstream details" not in exc.value.detail


def test_host_callback_dict_supports_foreground_schedule_without_extra_flags(env):
    s, client, c, _, runtime, _ = env
    s.runtime = {"scheduled_input": runtime.scheduled_input}
    job = create_job(client, execution="foreground")
    asyncio.run(s.run_due(c, NOW + timedelta(minutes=5)))
    assert (
        runtime.scheduled
        and s.schedules.history(c, job["id"])[0]["status"] == "accepted"
    )
