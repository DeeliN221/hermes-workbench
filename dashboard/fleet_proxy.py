"""Fleet v2 boundary. Credentials and upstream URLs never cross into the browser."""

from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from starlette.concurrency import run_in_threadpool
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request as URLRequest, HTTPRedirectHandler, build_opener

from fastapi import APIRouter, HTTPException, Request, Depends
from contextvars import ContextVar, copy_context
from fastapi.responses import JSONResponse, Response

_demo_request = ContextVar("fleet_demo_request", default=False)


async def demo_mode(request: Request):
    marker = _demo_request.set(request.query_params.get("demo") == "1")
    try:
        yield
    finally:
        _demo_request.reset(marker)


router = APIRouter(prefix="/fleet", dependencies=[Depends(demo_mode)])
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_STATUSES = {
    "triage",
    "ready",
    "running",
    "review",
    "blocked",
    "done",
    "archived",
    "scheduled",
}
_PATCH_FIELDS = {
    "title",
    "spec_json",
    "acceptance",
    "priority",
    "risk",
    "capability",
    "machine",
    "repo",
    "verify_mode",
    "revision",
}
_MAX_JSON = 4 * 1024 * 1024
_MAX_ARTIFACT = 32 * 1024 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise HTTPException(422, "Invalid Fleet identifier")
    return value


def _config():
    base = os.getenv("FLEET_URL", "").rstrip("/")
    token = os.getenv("FLEET_TOKEN", "")
    mode = "mock" if _demo_request.get() else os.getenv("HERMES_WORKBENCH_FLEET_MODE", "live")
    if mode != "live":
        # Explicit localhost fixture transport for browser regression tests only.
        base = os.getenv("HERMES_WORKBENCH_FLEET_DEMO_URL", "").rstrip("/")
        token = "mock-fleet-token"
        if not base:
            return None

    if not base or not token:
        raise HTTPException(503, "Legacy Fleet v2 is unconfigured; use the fleetd v1 console")
    try:
        parsed = urlsplit(base)
    except ValueError:
        raise HTTPException(503, "Invalid server Fleet configuration") from None
    if mode != "live" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise HTTPException(503, "Demo transport must be localhost")
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise HTTPException(503, "Invalid server Fleet configuration")
    # Plain HTTP is permitted only for explicit local/mock or private installations.
    if (
        parsed.scheme == "http"
        and parsed.hostname not in ("localhost", "127.0.0.1", "::1")
        and os.getenv("HERMES_WORKBENCH_FLEET_ALLOW_HTTP") != "1"
    ):
        raise HTTPException(503, "Fleet requires HTTPS")
    return base, token, mode


def _live():
    config = _config()
    return bool(config and config[2] == "live")


def _upstream(method, path, body=None, revision=None, binary=False, review=False):
    config = _config()
    if not config:
        from fleet_demo import request

        return request(method, path, body, revision, binary)
    base, token, _ = config
    if review:
        token = os.getenv("FLEET_REVIEW_TOKEN", "")
        if not token:
            raise HTTPException(
                403,
                "Ask the administrator to configure FLEET_REVIEW_TOKEN, then retry review",
            )
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/octet-stream" if binary else "application/json",
    }
    if revision is not None:
        headers["If-Match"] = str(revision)
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    request = URLRequest(
        base + "/api/v2/" + path, data=data, headers=headers, method=method
    )
    try:
        with build_opener(_NoRedirect()).open(request, timeout=10) as response:
            limit = _MAX_ARTIFACT if binary else _MAX_JSON
            raw = response.read(limit + 1)
            if len(raw) > limit:
                raise HTTPException(
                    413,
                    "Fleet response exceeds the download limit"
                    if binary
                    else "Fleet response too large",
                )
            if binary:
                return raw
            if not raw:
                return {}
            result = json.loads(raw)
            return result
    except HTTPError as error:
        # Never forward upstream bodies/locations: they can contain credentials or paths.
        status = (
            error.code
            if error.code in (400, 401, 403, 404, 409, 410, 413, 422, 429)
            else 502
        )
        raise HTTPException(
            status,
            {
                409: "Task changed elsewhere; reload and retry",
                403: "Permission denied; ask the administrator to check review credentials or artifact access",
                404: "Task or artifact no longer exists; refresh the task list",
                410: "Decision expired; refresh and ask the worker for a new decision",
            }.get(status, "Fleet request failed; refresh and retry"),
        ) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise HTTPException(502, "Task service is unavailable") from None


def _mode(task):
    return task.get("verify_mode") or (
        "auto" if task.get("risk") in ("R0", "R1") else "human"
    )


def _task(task):
    """Project only product fields; execution records and secrets stay server-side."""
    keys = {
        "id",
        "title",
        "status",
        "revision",
        "created_at",
        "updated_at",
        "status_changed_at",
        "completed_at",
        "repo",
        "machine",
        "risk",
        "priority",
        "verify_mode",
        "verified_by",
        "acceptance",
        "spec_json",
        "needs_human",
        "assignee",
        "capability",
        "model_used",
        "reasoning_effort",
        "duration_seconds",
        "attempt_count",
        "source_session_id",
        "source_profile",
        "source_session_kind",
        "conversation_id",
        "conversation_profile",
        "conversation_kind",
        "conversation_local",
        "source_local",
        "blocked_reason",
        "error",
    }
    row = {k: task[k] for k in keys if k in task}
    row.setdefault("acceptance", [])
    if isinstance(row.get("spec_json"), str):
        row["spec_json"] = {"summary": row["spec_json"], "prompt": row["spec_json"], "raw": row["spec_json"]}
    if isinstance(row["acceptance"], str):
        row["acceptance"] = [
            {
                "label": line,
                "checked": task.get("status") in ("review", "done", "archived"),
            }
            for line in row["acceptance"].splitlines()
            if line.strip()
        ]
    if isinstance(row.get("priority"), int):
        row["priority"] = "P" + str(row["priority"])
    row["server_lifecycle"] = _live()
    row["verify_mode"] = _mode(task)
    row["decision"] = _decision(task.get("decision") or task.get("open_decision"))
    return row


def _attempts(value):
    if not isinstance(value, list):
        return []
    keys = {"id", "status", "worker_id", "machine", "capability", "runner", "model_used",
            "final_model", "reasoning_effort", "conversation_id", "started_at", "ended_at",
            "duration_ms", "evidence_json"}
    return [{k: row[k] for k in keys if k in row} for row in value if isinstance(row, dict)]


def _decision(value):
    if not isinstance(value, dict):
        return None
    return {
        **{k: str(value[k]) for k in ("id", "question") if k in value},
        "options": [
            {
                "id": str(i),
                **{k: o[k] for k in ("id", "label", "impact", "recommended") if k in o},
            }
            for i, o in enumerate(value.get("options", []))
            if isinstance(o, dict)
        ],
    }


def _artifact(value, task_id):
    external = value.get("ref", "")
    parsed = urlsplit(external)
    external = (
        external
        if parsed.scheme in ("http", "https")
        and parsed.hostname
        and not parsed.username
        and not parsed.password
        else None
    )
    return {
        "external_url": external,
        **{
            k: value.get(k)
            for k in ("id", "task_id", "kind", "name", "sha", "size", "content_type")
        },
        "task_id": task_id,
        "id": str(value["id"]),
        "download_url": f"/api/plugins/workbench/fleet/artifacts/{_id(str(value['id']))}/download?task_id={task_id}",
    }


def _detail(task_id):
    value = _upstream("GET", "tasks/" + _id(task_id))
    task = _task(value["task"])
    if value.get("attempts"):
        task["attempts"] = _attempts(value.get("attempts"))
    task["decision"] = _decision(
        value.get("open_decision") or value.get("decision") or task.get("decision")
    )
    return {
        "task": task,
        "artifacts": [
            _artifact(a, task_id)
            for a in value.get("artifacts", [])
            if a.get("task_id") == task_id
        ],
        "open_decision": task["decision"],
        "attempts": task.get("attempts", []),
        "links": [
            {k: link[k] for k in ("label", "url") if k in link}
            for link in value.get("links", [])
        ],
    }


def _reply(value):
    return JSONResponse(value, headers={"Cache-Control": "no-store"})


@router.get("/config")
def fleet_config():
    config = _config()
    return _reply(
        {
            "mode": "live" if config and config[2] == "live" else "mock",
            "extended_workflow": not bool(config and config[2] == "live"),
        }
    )


@router.get("/tasks")
def fleet_tasks(status: str | None = None):
    if status and status not in _STATUSES:
        raise HTTPException(422, "Invalid status")
    value = _upstream(
        "GET", "tasks" + ("?" + urlencode({"status": status}) if status else "")
    )
    rows = value if isinstance(value, list) else value.get("tasks", [])
    if not status and _live():
        rows += _upstream("GET", "tasks?status=archived").get("tasks", [])

    # The v2 list contract need not contain open decisions; detail is authoritative.
    def project(row):
        if row.get("status") in ("done", "archived"):
            return _task(row)
        return _detail(row["id"])["task"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(copy_context().run, project, row) for row in rows]
        tasks = [future.result() for future in futures]
    return _reply({"tasks": tasks})


@router.get("/tasks/search")
def fleet_search(q: str = "", archived: bool = False, cursor: str = ""):
    if "\x00" in q:
        raise HTTPException(422, "Invalid search query")
    value = _upstream("GET", "tasks")
    rows = value if isinstance(value, list) else value.get("tasks", [])
    needle = q.strip().lower()
    matches = [row for row in rows if isinstance(row, dict)
               and (not archived or row.get("status") == "archived")
               and (not needle or any(needle in str(row.get(key, "")).lower()
                                      for key in ("title", "id", "repo")))]
    start = int(cursor) if cursor.isdigit() else 0
    page = matches[start:start + 100]
    return _reply({"tasks": [_task(row) for row in page], "next_cursor": str(start + 100) if len(matches) > start + 100 else "",
                   "has_more": len(matches) > start + 100})


@router.post("/tasks/sync")
async def fleet_sync(request: Request):
    from task_sync import card_sync, card_summary
    body = await _body(request)

    def collect():
        value = _upstream("GET", "tasks")
        rows = value if isinstance(value, list) else value.get("tasks", [])
        return card_sync([card_summary(_task(row), row.get("attempts")) for row in rows], body.get("lane", "all"), body.get("cursor", ""))

    return _reply(await run_in_threadpool(collect))


@router.get("/tasks/{task_id}")
def fleet_detail(task_id: str):
    return _reply(_detail(task_id))


async def _body(request):
    raw = await request.body()
    if len(raw) > 128 * 1024:
        raise HTTPException(413, "Task update too large")
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(422, "Expected a JSON object") from None
    if not isinstance(body, dict):
        raise HTTPException(422, "Expected a JSON object")
    return body


def _revision(request, body):
    value = body.get("revision")
    header = request.headers.get("If-Match", "").strip('"')
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < 0
        or header != str(value)
    ):
        raise HTTPException(422, "Matching revision and If-Match are required")
    return value


@router.patch("/tasks/{task_id}")
async def fleet_patch(task_id: str, request: Request):
    body = await _body(request)
    revision = _revision(request, body)
    if set(body) - _PATCH_FIELDS or body.get("verify_mode") not in (
        None,
        "auto",
        "human",
    ):
        raise HTTPException(422, "Unsupported task field")
    # Upstream owns field validation and optimistic concurrency.
    if _live():
        if isinstance(body.get("spec_json"), dict):
            body["spec_json"] = body["spec_json"].get("summary", "")
        if isinstance(body.get("acceptance"), list):
            if any(
                not isinstance(c, dict) or not isinstance(c.get("label"), str)
                for c in body["acceptance"]
            ):
                raise HTTPException(422, "Each acceptance criterion needs a text label")
            body["acceptance"] = "\n".join(c["label"] for c in body["acceptance"])
        if isinstance(body.get("priority"), str):
            try:
                body["priority"] = int(body["priority"].removeprefix("P"))
            except ValueError:
                raise HTTPException(422, "Priority must be a number") from None
    await run_in_threadpool(_upstream, "PATCH", "tasks/" + _id(task_id), body, revision)
    return _reply(await run_in_threadpool(_detail, task_id))


@router.post("/tasks")
async def fleet_create(request: Request):
    body = await _body(request)
    if (
        set(body) != {"title"}
        or not isinstance(body["title"], str)
        or not 1 <= len(body["title"].strip()) <= 200
    ):
        raise HTTPException(422, "A task title is required")
    value = await run_in_threadpool(_upstream, "POST", "tasks", body)
    return _reply(await run_in_threadpool(_detail, value["task"]["id"]))


def _validate_transition(task, to):
    graph = {
        "triage": ["ready"],
        "ready": ["triage", "running"],
        "running": ["blocked", "review", "done"],
        "blocked": ["running"],
        "review": ["running", "done"],
        "done": ["archived"],
        "archived": ["triage"],
        "scheduled": ["ready"],
    }
    if to not in graph.get(task["status"], []):
        raise HTTPException(422, "This status transition is not allowed")
    if task.get("decision"):
        raise HTTPException(422, "Resolve the decision first")
    if to == "ready" and (
        not task.get("spec_json", {}).get("summary", "").strip()
        or not task.get("acceptance")
        or any(not c.get("label", "").strip() for c in task.get("acceptance", []))
        or not task.get("repo")
        or not task.get("machine")
    ):
        raise HTTPException(422, "Complete the draft before dispatch")
    if to == "review" and _mode(task) != "human":
        raise HTTPException(422, "Automatic verification goes directly to Delivered")
    if to == "done" and _mode(task) == "human" and task["status"] != "review":
        raise HTTPException(422, "Human verification must pass through review")
    if to == "done" and (
        not task.get("acceptance")
        or any(not c.get("checked") for c in task["acceptance"])
    ):
        raise HTTPException(422, "The acceptance checklist is incomplete")


@router.post("/tasks/{task_id}/{action}")
async def fleet_action(task_id: str, action: str, request: Request):
    if action not in (
        "dispatch",
        "archive",
        "restore",
        "decide",
        "transition",
        "approve",
        "request_changes",
    ):
        raise HTTPException(404, "Unknown task action")
    body = await _body(request)
    return await run_in_threadpool(_perform_action, task_id, action, request, body)


def _perform_action(task_id, action, request, body):
    revision = _revision(request, body)
    detail = _detail(task_id)
    task = detail["task"]
    if task["revision"] != revision:
        raise HTTPException(409, "Task changed elsewhere; reload and retry")
    if action == "transition":
        config = _config()
        if config and config[2] == "live":
            raise HTTPException(
                501, "Fleet manual transition contract is not available"
            )
    if action == "decide":
        decision = detail["open_decision"]
        options = decision.get("options", []) if decision else []
        if (
            not decision
            or not 2 <= len(options) <= 4
            or sum(bool(o.get("recommended")) for o in options) != 1
            or any(not o.get("label") or not o.get("impact") for o in options)
            or len({o.get("id") for o in options}) != len(options)
            or body.get("decision_id") != decision.get("id")
            or body.get("option_id") not in [o.get("id") for o in options]
        ):
            raise HTTPException(422, "Choose one of the current decision options")
        body = (
            {
                "choice": next(
                    o["label"] for o in options if o["id"] == body["option_id"]
                )
            }
            if _live()
            else {k: body[k] for k in ("decision_id", "option_id", "revision")}
        )
    elif action in ("approve", "request_changes"):
        if task["status"] != "review":
            raise HTTPException(409, "Task is no longer awaiting review; refresh")
        body = {}
    else:
        target = {"dispatch": "ready", "archive": "archived", "restore": "triage"}.get(
            action, body.get("status")
        )
        if not _live() or action == "dispatch":
            _validate_transition(task, target)
        body = {
            "revision": revision,
            **({"status": target} if action == "transition" else {}),
        }
    if action in ("approve", "request_changes"):
        _upstream("POST", f"tasks/{_id(task_id)}/{action}", body, revision, review=True)
    else:
        _upstream("POST", f"tasks/{_id(task_id)}/{action}", body, revision)
    return _reply(_detail(task_id))


@router.get("/artifacts/{artifact_id}/download")
def fleet_download(artifact_id: str, task_id: str):
    _id(artifact_id)
    # Fetch through the same credential scope, then verify task membership. Never
    # open a ref/path or follow an upstream-provided download_url/redirect.
    detail = _detail(task_id)
    artifact = next((a for a in detail["artifacts"] if a["id"] == artifact_id), None)
    if not artifact or artifact.get("external_url"):
        raise HTTPException(404, "Artifact not found for this task")
    raw = _upstream("GET", f"artifacts/{artifact_id}/download", binary=True)
    from urllib.parse import quote

    name = re.sub(r"[\x00-\x1f\x7f/\\]", "_", artifact.get("name") or "artifact")[:180]
    return Response(
        raw,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''"
            + quote(name, safe=""),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
