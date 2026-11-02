"""Same-origin, authenticated, read-only task console API for fleetd v1."""
import json
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from fleetd_client import FleetClient
from fleet_proxy import _id

router = APIRouter(prefix="/fleetd")
STATUS = {"ready": "ready", "queued": "ready", "running": "running",
          "claimed": "running", "retrying": "running", "blocked": "review",
          "review": "review", "done": "done", "failed": "archived",
          "cancelled": "archived", "archived": "archived", "scheduled": "ready"}


def reply(value):
    return JSONResponse(value, headers={"Cache-Control": "no-store"})


def decision(row):
    options = row.get("options_json", row.get("options", []))
    if isinstance(options, str):
        try:
            options = json.loads(options)
        except ValueError:
            options = []
    if not isinstance(options, list):
        options = []
    return {"id": str(row["id"]), "task_id": row.get("task_id"),
            "question": row.get("question", ""), "options": [
                {"id": str(i), "label": opt, "impact": ""} if isinstance(opt, str)
                else {"id": str(opt.get("id", i)), "label": opt.get("label", ""),
                      "impact": opt.get("impact", ""), "recommended": bool(opt.get("recommended"))}
                for i, opt in enumerate(options) if isinstance(opt, (str, dict))]}


def task(row):
    raw = row.get("status", "")
    # Future or malformed statuses remain visible for human inspection instead
    # of breaking the entire feed. Preserve the original value in Fleet details.
    status = STATUS.get(raw, "review") if isinstance(raw, str) else "review"
    result = {k: row[k] for k in ("id", "title", "risk", "machine", "assignee", "repo",
              "created_at", "updated_at") if k in row}
    result.update(status=status, fleet_status=raw, revision=0,
                  priority="P" + str(row.get("priority", "")),
                  attempt_count=row.get("attempts", 0), server_lifecycle=True, read_only=True,
                  verify_mode="human" if status == "review" else "auto", acceptance=[])
    if raw == "done":
        result["completed_at"] = row.get("completed_at") or row.get("updated_at")
    return result


@router.get("/config")
def config():
    demo = os.getenv("HERMES_WORKBENCH_FLEET_MODE") == "mock"
    return reply({"mode": "mock" if demo else "live", "extended_workflow": demo})


@router.get("/tasks")
def tasks():
    client = FleetClient()
    # v1 currently caps the list at 100. Ask for its maximum and follow cursors
    # when provided. Expose the possible truncation instead of claiming a total.
    rows = client.collection("tasks", limit=100)
    return reply({"tasks": [task(r) for r in rows], "possibly_truncated": len(rows) >= 100})


@router.get("/decisions")
def decisions():
    rows = FleetClient().collection("decisions", status="open")
    return reply({"decisions": [decision(r) for r in rows if r.get("status") == "open"]})


@router.get("/workers")
def workers():
    rows = FleetClient().collection("workers")
    return reply({"workers": [{k: r[k] for k in ("id", "machine", "status", "last_heartbeat") if k in r} for r in rows]})


@router.get("/tasks/{task_id}")
def detail(task_id: str):
    client = FleetClient()
    data = client.get("tasks/" + _id(task_id))
    if not isinstance(data.get("task"), dict):
        raise HTTPException(502, "Invalid Fleet task detail; retry")
    row = task(data["task"])
    summary = data["task"].get("spec_json", "")
    row["spec_json"] = {"summary": summary if isinstance(summary, str) else summary.get("summary", "")}
    acceptance = data["task"].get("acceptance", "")
    if isinstance(acceptance, str):
        row["acceptance"] = [{"label": s, "checked": row["status"] == "done"} for s in acceptance.splitlines() if s.strip()]
    attempts = data.get("attempts") or []
    # v1's list attempts counter counts retries, so detail records are authoritative.
    row["attempt_count"] = len(attempts)
    choices = [decision(d) for d in client.collection("decisions", status="open")
               if d.get("status") == "open" and d.get("task_id") == task_id]
    row["decision"] = choices[0] if choices else None
    return reply({"task": row, "open_decision": row["decision"], "artifacts": [],
                  "attempts": [{k: a[k] for k in ("id", "status", "worker_id", "started_at", "ended_at") if k in a} for a in attempts]})
