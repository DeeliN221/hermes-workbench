"""Same-origin, authenticated, task console API for fleetd v1."""
import json
import os
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
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
                  review_actions=raw == "review",
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
                  "review_notes": [{"text": e["payload"], "at": e.get("at", "")} for e in data.get("events", [])
                                   if e.get("type") == "task.note" and isinstance(e.get("payload"), str)],
                  "attempts": [{k: a[k] for k in ("id", "status", "worker_id", "started_at", "ended_at") if k in a} for a in attempts]})


async def write_body(request: Request):
    # TrustedProxyGate remains mandatory. Reject CSRF even for authenticated users.
    if not getattr(request.state, "workbench_authenticated", False):
        raise HTTPException(401, "Unauthorized")
    origin = request.headers.get("origin", "")
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    # Caddy replaces forwarded host/proto before adding the trusted proxy secret.
    host = request.headers.get("x-forwarded-host", request.headers.get("host", ""))
    expected = scheme + "://" + host
    if origin != expected or request.headers.get("sec-fetch-site") not in (None, "same-origin"):
        raise HTTPException(403, "Same-origin request required")
    if request.url.query:
        raise HTTPException(400, "Query parameters are not allowed")
    if request.headers.get("content-type", "").split(";")[0] != "application/json":
        raise HTTPException(415, "JSON body required")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 32768:
            raise HTTPException(413, "Review feedback is too large")
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeError):
        raise HTTPException(400, "Invalid JSON body") from None
    if not isinstance(body, dict):
        raise HTTPException(422, "JSON object required")
    return body


def perform_review(task_id, action, body):
    client = FleetClient()
    client.require_review()  # Fail before writing a note if review is unconfigured.
    data = client.get("tasks/" + task_id)
    if data.get("task", {}).get("status") != "review":
        raise HTTPException(409, "Task is no longer awaiting review; refresh and retry")
    if action in ("note", "request_changes"):
        # A retry after a failed transition should not repeat the same saved note.
        notes = []
        for event in data.get("events", []):  # fleetd returns newest first
            if event.get("type") in ("task.completed", "task.request_changes", "task.approve"):
                break
            if event.get("type") == "task.note":
                notes.append(event)
        if not any(e.get("payload") == body["text"] for e in notes):
            client.post(f"tasks/{task_id}/note", {"text": body["text"]})
    if action != "note":
        try:
            client.post(f"tasks/{task_id}/{action}", {}, review=True)
        except HTTPException as error:
            if action == "request_changes":
                raise HTTPException(error.status_code,
                    "Feedback saved, but returning the task failed. " + str(error.detail)) from None
            raise
    # Never relay arbitrary upstream fields, tokens or error bodies.
    return reply({"ok": True})


@router.post("/tasks/{task_id}/{action}")
async def review_action(task_id: str, action: str, request: Request):
    _id(task_id)
    if action not in ("approve", "request_changes", "note"):
        raise HTTPException(404, "Unknown review action")
    body = await write_body(request)
    fields = set() if action == "approve" else {"text"}
    if set(body) != fields:
        raise HTTPException(422, "Invalid review fields")
    if fields and (not isinstance(body["text"], str) or not body["text"].strip() or len(body["text"]) > 8000):
        raise HTTPException(422, "Feedback must contain 1 to 8000 characters")
    return await run_in_threadpool(perform_review, task_id, action, body)
