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

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

router = APIRouter(prefix="/fleet")
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
    if not _ID.fullmatch(value):
        raise HTTPException(422, "Invalid Fleet identifier")
    return value


def _config():
    base = os.getenv("HERMES_WORKBENCH_FLEET_URL", "").rstrip("/")
    token = os.getenv("HERMES_WORKBENCH_FLEET_TOKEN", "")
    mode = os.getenv("HERMES_WORKBENCH_FLEET_MODE", "live")
    parsed = urlsplit(base)
    if not base or not token:
        return None
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


def _upstream(method, path, body=None, revision=None, binary=False):
    config = _config()
    if not config:
        raise HTTPException(503, "Task service is not connected")
    base, token, _ = config
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
        base + "/api/v1/" + path, data=data, headers=headers, method=method
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
            if error.code in (400, 401, 403, 404, 409, 413, 422, 429)
            else 502
        )
        raise HTTPException(
            status,
            "Task changed elsewhere; reload and retry"
            if status == 409
            else "Fleet request failed",
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
    }
    row = {k: task[k] for k in keys if k in task}
    row.setdefault("acceptance", [])
    row["verify_mode"] = _mode(task)
    row["decision"] = _decision(task.get("decision") or task.get("open_decision"))
    return row


def _decision(value):
    if not isinstance(value, dict):
        return None
    return {
        **{k: value[k] for k in ("id", "question") if k in value},
        "options": [
            {k: o[k] for k in ("id", "label", "impact", "recommended") if k in o}
            for o in value.get("options", [])
            if isinstance(o, dict)
        ],
    }


def _artifact(value, task_id):
    return {
        **{
            k: value.get(k)
            for k in ("id", "task_id", "kind", "name", "sha", "size", "content_type")
        },
        "task_id": task_id,
        "download_url": f"/api/plugins/workbench/fleet/artifacts/{_id(value['id'])}/download?task_id={task_id}",
    }


def _detail(task_id):
    value = _upstream("GET", "tasks/" + _id(task_id))
    task = _task(value["task"])
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
            "mode": "unconfigured"
            if not config
            else "mock"
            if config[2] == "mock"
            else "live",
            "extended_workflow": bool(config and config[2] == "mock"),
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

    # The v2 list contract need not contain open decisions; detail is authoritative.
    def project(row):
        if row.get("status") in ("done", "archived"):
            return _task(row)
        return _detail(row["id"])["task"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = list(pool.map(project, rows))
    return _reply({"tasks": tasks})


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
    await run_in_threadpool(_upstream, "PATCH", "tasks/" + _id(task_id), body, revision)
    return _reply(await run_in_threadpool(_detail, task_id))


@router.post("/tasks")
async def fleet_create(request: Request):
    config = _config()
    if not config or config[2] != "mock":
        raise HTTPException(501, "Fleet task creation contract is not available")
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
    if action not in ("dispatch", "archive", "restore", "decide", "transition"):
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
        if not config or config[2] != "mock":
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
        body = {k: body[k] for k in ("decision_id", "option_id", "revision")}
    else:
        target = {"dispatch": "ready", "archive": "archived", "restore": "triage"}.get(
            action, body.get("status")
        )
        _validate_transition(task, target)
        body = {
            "revision": revision,
            **({"status": target} if action == "transition" else {}),
        }
    _upstream("POST", f"tasks/{_id(task_id)}/{action}", body, revision)
    return _reply(_detail(task_id))


@router.get("/artifacts/{artifact_id}/download")
def fleet_download(artifact_id: str, task_id: str):
    _id(artifact_id)
    # Fetch through the same credential scope, then verify task membership. Never
    # open a ref/path or follow an upstream-provided download_url/redirect.
    detail = _detail(task_id)
    artifact = next((a for a in detail["artifacts"] if a["id"] == artifact_id), None)
    if not artifact:
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
