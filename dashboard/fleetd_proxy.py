"""Same-origin, authenticated, task console API for fleetd v1."""
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request, Query
from urllib.parse import urlencode
from starlette.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fleetd_client import FleetClient
from fleet_proxy import _id

router = APIRouter(prefix="/fleetd")
STATUS = {"ready": "ready", "queued": "ready", "running": "running",
          "claimed": "running", "retrying": "running", "blocked": "blocked",
          "review": "review", "done": "done", "failed": "triage",
          "cancelled": "triage", "archived": "archived", "scheduled": "scheduled"}


def _json_object(value):
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    try:
        parsed = json.loads(value)
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _timestamp(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _attempt_duration_ms(attempt):
    evidence = _json_object(attempt.get("evidence_json"))
    for value in (attempt.get("duration_ms"), evidence.get("duration_ms")):
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            return float(value)
    started, ended = _timestamp(attempt.get("started_at")), _timestamp(attempt.get("ended_at"))
    if started is not None and ended is not None:
        return max(0.0, (ended - started) * 1000)
    return None


def _attempt_model(attempt):
    evidence = _json_object(attempt.get("evidence_json"))
    for value in (attempt.get("final_model"), evidence.get("final_model"), attempt.get("model_used")):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _attempt_metadata(attempt):
    evidence = _json_object(attempt.get("evidence_json"))
    result = {key: attempt[key] for key in ("id", "status", "worker_id", "started_at", "ended_at",
                                             "conversation_id", "error", "reason", "model_used", "machine", "capability")
              if key in attempt}
    for target, source in (("final_model", "final_model"), ("runner", "runner"),
                           ("reasoning_effort", "reasoning_effort")):
        value = attempt.get(source, evidence.get(source))
        if isinstance(value, str) and value.strip():
            result[target] = value.strip()
    duration = _attempt_duration_ms(attempt)
    if duration is not None:
        result["duration_ms"] = duration
    return result


def _local_thread_metadata(conversation_id):
    """Read only model/effort hints from local Codex state databases."""
    if not isinstance(conversation_id, str) or not conversation_id or len(conversation_id) > 200:
        return None
    homes = []
    for raw in (os.getenv("FLEET_CODEX_HOME"), os.getenv("CODEX_HOME")):
        if raw:
            homes.append(Path(raw))
    homes.append(Path.home() / ".codex")
    homes.append(Path("/opt/data/.fleet-codex"))
    seen = set()
    for home in homes:
        try:
            resolved = str(home.expanduser().resolve())
        except (OSError, RuntimeError):
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        for database in sorted(Path(resolved).glob("state_*.sqlite")):
            try:
                connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=0.25)
                try:
                    row = connection.execute(
                        "SELECT model, reasoning_effort FROM threads WHERE id=? LIMIT 1",
                        (conversation_id,),
                    ).fetchone()
                finally:
                    connection.close()
            except (OSError, sqlite3.Error, ValueError):
                continue
            if row:
                return {"model": str(row[0] or "").strip(), "reasoning_effort": str(row[1] or "").strip()}
    return None


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
    status = STATUS.get(raw, "triage") if isinstance(raw, str) else "triage"
    result = {k: row[k] for k in ("id", "title", "risk", "machine", "assignee", "repo",
              "created_at", "updated_at", "source_session_id", "source_profile", "source_session_kind",
              "conversation_id", "conversation_profile", "conversation_kind", "blocked_reason", "error",
              "capability", "model_used", "reasoning_effort", "duration_seconds", "completed_at",
              "source_local", "conversation_local") if k in row}
    result.update(status=status, fleet_status=raw, revision=0,
                  priority="P" + str(row.get("priority", "")),
                  attempt_count=row.get("attempts", 0), server_lifecycle=True, read_only=True,
                  review_actions=raw == "review", lifecycle_actions=True,
                  verify_mode="human" if status == "review" else "auto", acceptance=[])
    if raw == "done":
        result["completed_at"] = row.get("completed_at") or row.get("updated_at")
    return result


@router.get("/config")
def config():
    demo = os.getenv("HERMES_WORKBENCH_FLEET_MODE") == "mock"
    return reply({"mode": "mock" if demo else "live", "extended_workflow": demo})


@router.get("/tasks/search")
def search(q: str = Query("", max_length=256), cursor: str = Query("", max_length=4096),
           archived: bool = False):
    if "\x00" in q:
        raise HTTPException(422, "Invalid search query")
    params = {"q": q, "include_archived": "1", "limit": 100}
    if cursor:
        params["cursor"] = cursor
    if archived:
        params["status"] = "archived"
    data = FleetClient().get("tasks?" + urlencode(params))
    # Old fleetd silently ignores q; never present that as a successful search.
    if not isinstance(data.get("has_more"), bool):
        raise HTTPException(501, "Fleet search API unavailable; upgrade fleetd to T-204d30db")
    rows, cursor = data.get("tasks"), data.get("next_cursor", "")
    if (not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows)
            or not isinstance(cursor, str) or bool(cursor) != data["has_more"]):
        raise HTTPException(502, "Invalid Fleet search page")
    return reply({"tasks": [task(r) for r in rows], "next_cursor": cursor, "has_more": data["has_more"]})


@router.get("/tasks")
def tasks():
    rows = FleetClient().collection("tasks", limit=100)
    return reply({"tasks": [task(r) for r in rows], "possibly_truncated": len(rows) >= 100})


@router.get("/tasks/archived")
def archived_tasks():
    rows = FleetClient().collection("tasks", status="archived", include_archived="1", limit=100)
    return reply({"tasks": [task(r) for r in rows]})


@router.get("/decisions")
def decisions():
    rows = FleetClient().collection("decisions", status="open")
    return reply({"decisions": [decision(r) for r in rows if r.get("status") == "open"]})


@router.get("/workers")
def workers():
    rows = FleetClient().collection("workers")
    return reply({"workers": [{k: r[k] for k in ("id", "machine", "status", "last_heartbeat") if k in r} for r in rows]})


@router.post("/tasks/sync")
async def sync_tasks(request: Request):
    from fleet_proxy import _body
    from task_sync import card_sync
    body = await _body(request)

    def collect():
        client = FleetClient()
        rows = client.collection("tasks", include_archived="1", limit=100)
        opened = {r.get("task_id"): decision(r) for r in client.collection("decisions", status="open") if r.get("status") == "open"}
        cards = [{**task(r), "decision": opened.get(r["id"])} for r in rows]
        return card_sync(cards, body.get("lane", "all"), body.get("cursor", ""))

    return reply(await run_in_threadpool(collect))


@router.get("/tasks/{task_id}")
def detail(task_id: str):
    client = FleetClient()
    data = client.get("tasks/" + _id(task_id))
    if not isinstance(data.get("task"), dict):
        raise HTTPException(502, "Invalid Fleet task detail; retry")
    row = task(data["task"])
    summary = data["task"].get("spec_json", "")
    trailing = ""
    if isinstance(summary, str):
        try:
            spec = json.loads(summary)
        except ValueError:
            spec = None
            try:
                parsed, end = json.JSONDecoder().raw_decode(summary.lstrip())
                if isinstance(parsed, dict):
                    spec = dict(parsed)
                    extra = summary.lstrip()[end:].strip()
                    if extra:
                        trailing = extra
            except ValueError:
                pass
    else:
        spec = summary
    if isinstance(spec, dict):
        row["spec_json"] = dict(spec)
        if trailing:
            prompt = row["spec_json"].get("prompt")
            row["spec_json"]["prompt"] = f"{prompt}\n\n{trailing}" if isinstance(prompt, str) and prompt else trailing
            row["spec_json"]["raw"] = summary
        if not isinstance(row["spec_json"].get("summary"), str):
            row["spec_json"]["summary"] = ""
        if not isinstance(row["spec_json"].get("prompt"), str):
            row["spec_json"]["prompt"] = ""
    else:
        text = summary if isinstance(summary, str) else ""
        row["spec_json"] = {"summary": "", "prompt": text, "raw": text}
    acceptance = data["task"].get("acceptance", "")
    if isinstance(acceptance, str):
        row["acceptance"] = [{"label": s, "checked": row["status"] == "done"} for s in acceptance.splitlines() if s.strip()]
    attempts = data.get("attempts") or []
    if not isinstance(attempts, list):
        attempts = []
    attempts = [a for a in attempts if isinstance(a, dict)]
    ordered = sorted(attempts, key=lambda a: _timestamp(a.get("started_at")) or 0, reverse=True)
    model = next((_attempt_model(a) for a in ordered if _attempt_model(a)), None)
    if model:
        row["model_used"] = model
    latest = ordered[0] if ordered else {}
    latest_evidence = _json_object(latest.get("evidence_json"))
    if isinstance(latest_evidence.get("runner"), str) and latest_evidence["runner"].strip():
        row["capability"] = latest_evidence["runner"].strip()
    for value in (latest.get("reasoning_effort"), latest_evidence.get("reasoning_effort"), row.get("reasoning_effort")):
        if isinstance(value, str) and value.strip():
            row["reasoning_effort"] = value.strip()
            break
    # Missing/truncated attempt history is not a trustworthy total.
    if attempts and len(attempts) < 50:
        durations = [_attempt_duration_ms(a) for a in attempts]
        if all(value is not None for value in durations):
            row["duration_seconds"] = sum(float(value) for value in durations) / 1000
    # v1's list attempts counter counts retries, so detail records are authoritative.
    row["attempt_count"] = len(attempts)
    if not row.get("conversation_id"):
        row["conversation_id"] = next((a["conversation_id"] for a in ordered if a.get("conversation_id")), None)
    thread = _local_thread_metadata(row.get("conversation_id"))
    if thread:
        row["conversation_local"] = True
        row["conversation_kind"] = "codex"
        if thread.get("model") and not row.get("model_used"):
            row["model_used"] = thread["model"]
        if thread.get("reasoning_effort") and not row.get("reasoning_effort"):
            row["reasoning_effort"] = thread["reasoning_effort"]
    elif row.get("conversation_id"):
        row["conversation_local"] = False
    if not row.get("reasoning_effort") and isinstance(spec, dict):
        effort = spec.get("reasoning_effort") or spec.get("model_reasoning_effort")
        if isinstance(effort, str) and effort.strip():
            row["reasoning_effort"] = effort.strip()
    # Expose stale execution explicitly without writing to the live Fleet service.
    row["stale"] = row["status"] == "running" and not (
        row.get("assignee") and _timestamp(latest.get("started_at")) is not None and not latest.get("ended_at"))
    if row["status"] in ("blocked", "triage") and not row.get("blocked_reason"):
        row["blocked_reason"] = next((a.get("error") or a.get("reason") for a in attempts if a.get("error") or a.get("reason")), None)

    if row["status"] in ("blocked", "triage") and not row.get("blocked_reason"):
        for event in data.get("events", []):
            if event.get("type") not in ("task.blocked", "task.failed"):
                continue
            try:
                payload = json.loads(event.get("payload", "{}"))
            except (ValueError, TypeError):
                continue
            if isinstance(payload, dict):
                reason = payload.get("detail") or payload.get("reason")
                if isinstance(reason, str) and reason:
                    row["blocked_reason"] = reason
                    break
    decisions = ([data["decision"]] if isinstance(data.get("decision"), dict) else []) if "decision" in data else client.collection("decisions", status="open")
    choices = [decision(d) for d in decisions
               if d.get("status") == "open" and d.get("task_id") == task_id]
    row["decision"] = choices[0] if choices else None
    normalized_attempts = [_attempt_metadata(a) for a in ordered]
    if normalized_attempts and not normalized_attempts[0].get("machine") and latest.get("worker_id"):
        try:
            workers = client.collection("workers")
        except HTTPException:
            workers = []
        worker = next((w for w in workers if w.get("id") == latest["worker_id"]), {})
        if worker.get("machine"):
            normalized_attempts[0]["machine"] = worker["machine"]

    row["attempts"] = normalized_attempts
    return reply({"task": row, "open_decision": row["decision"], "artifacts": [],
                  "review_notes": [{"text": e["payload"], "at": e.get("at", "")} for e in data.get("events", [])
                                   if e.get("type") == "task.note" and isinstance(e.get("payload"), str)],
                  "attempts": normalized_attempts})


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
    if action not in ("approve", "request_changes", "note", "archive", "retry", "decide"):
        raise HTTPException(404, "Unknown review action")
    body = await write_body(request)
    fields = {"decision_id", "option_id"} if action == "decide" else {"text"} if action in ("note", "request_changes") else set()
    if set(body) != fields:
        raise HTTPException(422, "Invalid review fields")
    if "text" in fields and (not isinstance(body["text"], str) or not body["text"].strip() or len(body["text"]) > 8000):
        raise HTTPException(422, "Feedback must contain 1 to 8000 characters")
    if action in ("archive", "retry", "decide"):
        if action == "decide" and any(not isinstance(body[k], str) or len(body[k]) > 256 for k in fields):
            raise HTTPException(422, "Invalid decision fields")
        return await run_in_threadpool(perform_lifecycle, task_id, action, body)
    return await run_in_threadpool(perform_review, task_id, action, body)


def perform_lifecycle(task_id, action, body):
    client = FleetClient()
    data = client.get("tasks/" + task_id)
    status = data.get("task", {}).get("status")
    if status != ("done" if action == "archive" else "blocked"):
        raise HTTPException(409, "Task state changed; refresh and retry")
    choices = [decision(d) for d in client.collection("decisions", status="open")
               if d.get("status") == "open" and d.get("task_id") == task_id]
    payload = {}
    if action == "retry" and choices:
        raise HTTPException(409, "Resolve the open decision first")
    if action == "decide":
        choice = next((o for d in choices if d["id"] == body["decision_id"]
                       for o in d["options"] if o["id"] == body["option_id"]), None)
        if choice is None:
            raise HTTPException(409, "Decision changed; refresh and retry")
        payload = {"choice": choice["label"], "note": ""}
    client.post(f"tasks/{task_id}/{action}", payload)
    return reply({"ok": True})
