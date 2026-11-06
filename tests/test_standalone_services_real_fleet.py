"""Opt-in real isolated Fleet daemon acceptance; no AI process or model request.

Set WORKBENCH_TEST_FLEET_URL and WORKBENCH_TEST_FLEET_TOKEN_FILE explicitly.
Only the authorized isolated loopback endpoint is accepted. Credential bytes
remain exclusively inside the HTTP Authorization provider and are never logged.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parents[1]))
from dashboard.standalone_services import StandaloneServices
from dashboard.standalone_domains.fleet import FleetHTTP, origin


@pytest.mark.skipif(
    not os.environ.get("WORKBENCH_TEST_FLEET_URL"),
    reason="Opt-in isolated real Fleet daemon",
)
def test_real_daemon_dispatch_restart_attempt_shapes_and_stale_outbox_advancement(
    tmp_path,
):
    endpoint = os.environ["WORKBENCH_TEST_FLEET_URL"]
    assert endpoint == "http://127.0.0.1:18891", (
        "Only the explicitly authorized isolated endpoint is permitted"
    )
    token_file = Path(os.environ["WORKBENCH_TEST_FLEET_TOKEN_FILE"])
    assert (
        token_file.name == "daemon-token" and token_file.stat().st_mode & 0o777 == 0o600
    )

    def credential():
        return token_file.read_text().strip()

    transport = FleetHTTP(
        endpoint, token_provider=credential, review_token_provider=credential
    )
    probe = "services-probe-" + uuid.uuid4().hex
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    context = {
        "user_id": probe,
        "profile_id": probe,
        "project_id": probe,
        "workspace": str(workspace),
        "fleet": {
            "machine": probe,
            "capability": "shell",
            "risk": "R0",
            "kind": "code",
        },
    }
    history = {}
    history_db = tmp_path / "durable-receiver.sqlite3"
    with sqlite3.connect(history_db) as db:
        db.execute(
            "CREATE TABLE history (key TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL)"
        )

    async def persist(c, sid, delivery, key):
        # An independent durable receiver demonstrates the host callback boundary.
        # Return persisted only after commit, never on runtime acceptance alone.
        with sqlite3.connect(history_db) as db:
            db.execute(
                "INSERT OR IGNORE INTO history VALUES (?,?,?)",
                (key, sid, json.dumps(delivery)),
            )
        history.setdefault(key, (sid, delivery))
        return {"persisted": True}

    runtime = {"persist_delivery": persist}
    services = StandaloneServices(
        lambda _: context, tmp_path / "storage", runtime, fleet_request=transport
    )
    services.bind_session(
        context,
        {"id": probe, "runtime": "dsh", "profile_id": probe, "project_id": probe},
    )
    dispatches, task_ids = [], []

    async def observed(method, path, body=None, params=None):
        value = await transport(method, path, body, params)
        if method == "POST" and path == "/tasks":
            task_ids.append(value["task"]["id"])
        if path.endswith("/dispatch"):
            dispatches.append(path)
            if len(dispatches) == 1:
                raise HTTPException(504, "Simulated lost dispatch receipt")
        return value

    services.fleet.transport = observed

    async def scenario():
        tid = None
        try:
            await transport(
                "POST",
                "/workers",
                {"id": probe, "machine": probe, "caps": ["shell"], "status": "online"},
            )
            receipt = await services.submit_background(
                context, "printf 'isolated-services-probe\\n'", probe, probe
            )
            tid = receipt["task_id"]
            assert receipt["status"] == "ready" and receipt["origin"] == origin(
                context, probe
            )
            assert (
                await services.submit_background(
                    context, "printf 'isolated-services-probe\\n'", probe, probe
                )
            )["task_id"] == tid
            restarted = StandaloneServices(
                None, tmp_path / "storage", runtime, fleet_request=observed
            )
            assert (
                await restarted.submit_background(
                    context, "printf 'isolated-services-probe\\n'", probe, probe
                )
            )["task_id"] == tid
            assert len(dispatches) == 1 and len(set(task_ids)) == 1
            with pytest.raises(HTTPException) as conflict:
                await restarted.submit_background(
                    context, "different content", probe, probe
                )
            assert conflict.value.status_code == 409
            task = (await transport("GET", f"/tasks/{tid}"))["task"]
            assert (
                task["deliverable"]
                and task["acceptance"]
                and task["report_required"] is False
            )
            assert (
                task["workspace"] == context["workspace"] and task["machine"] == probe
            )
            claim = {"worker_id": probe, "machine": probe, "caps": ["shell"]}
            first = (await transport("POST", f"/tasks/{tid}/claim", claim))["attempt"]
            assert first["lease_epoch"] > 0
            await transport(
                "POST",
                f"/tasks/{tid}/fail",
                {
                    "attempt_id": first["id"],
                    "epoch": first["lease_epoch"],
                    "reason": "Deterministic isolated adapter probe; no files changed",
                    "retryable": False,
                },
            )
            await transport("POST", f"/tasks/{tid}/retry", {})
            second = (await transport("POST", f"/tasks/{tid}/claim", claim))["attempt"]
            await transport(
                "POST",
                f"/tasks/{tid}/fail",
                {
                    "attempt_id": second["id"],
                    "epoch": second["lease_epoch"],
                    "reason": "Current deterministic adapter result; no files changed",
                    "retryable": False,
                },
            )
            details = await transport("GET", f"/tasks/{tid}")
            assert (
                "current_attempt" not in details["task"]
                and details["attempts"][0]["id"] == second["id"]
            )
            pending = (
                await transport(
                    "GET",
                    "/deliveries",
                    params={**origin(context, probe), "limit": 100},
                )
            )["deliveries"]
            assert pending and all("origin" not in row for row in pending)
            assert any(d["attempt_id"] == first["id"] for d in pending)
            result = await restarted.drain_deliveries(context, probe, limit=1)
            assert result["stale"] >= 1 and result["delivered"] >= 1
            assert history and all(
                d["attempt_id"] == second["id"] for _, d in history.values()
            )
            with sqlite3.connect(history_db) as db:
                records = db.execute(
                    "SELECT session_id,payload FROM history"
                ).fetchall()
            assert len(records) == len(history) and all(
                sid == probe for sid, _ in records
            )
            assert all(
                json.loads(payload)["attempt_id"] == second["id"]
                for _, payload in records
            )
            assert not (
                await transport(
                    "GET", "/deliveries", params={**origin(context, probe), "limit": 1}
                )
            )["deliveries"]
            assert (await restarted.drain_deliveries(context, probe, limit=1)) == {
                "delivered": 0,
                "stale": 0,
            }
        finally:
            for owned_id in set(task_ids + ([tid] if tid else [])):
                # Only probe-owned tasks can be cleaned up; never list or mutate other work.
                task = (await transport("GET", f"/tasks/{owned_id}"))["task"]
                if (
                    task.get("origin") == origin(context, probe)
                    and task["status"] != "archived"
                ):
                    await transport("POST", f"/tasks/{owned_id}/cancel", {})
            await transport(
                "POST",
                "/workers",
                {"id": probe, "machine": probe, "caps": ["shell"], "status": "offline"},
            )

    asyncio.run(scenario())
