"""Origin-enforced Fleet v2 calls and persist-before-ACK DSH delivery drain."""

from __future__ import annotations

import asyncio
import json
import os
import re
from urllib.parse import urlsplit

import httpx
from fastapi import Request, HTTPException

from .core import body, bounded_text, digest, fail, identifier, invoke, resolve, scope
from .files import binary


class FleetHTTP:
    """Lazy server-only transport. A host token_provider can implement its token-file policy.

    No credential files are opened here. Environment values are read only on an actual
    Fleet operation, never at import, router construction, or during local tests.
    """

    def __init__(self, url=None, token_provider=None, review_token_provider=None):
        self.url, self.token_provider = url, token_provider
        self.review_token_provider = review_token_provider

    @staticmethod
    def error_code(response):
        # Forward only a bounded machine code, never upstream text/credentials.
        try:
            code = response.json().get("error", {}).get("code", "")
        except (ValueError, AttributeError):
            return ""
        return (
            ": " + code
            if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,80}", code)
            else ""
        )

    async def __call__(self, method, path, body=None, params=None):
        url = self.url or os.environ.get("FLEET_URL", "")
        parsed = urlsplit(url)
        if (
            parsed.scheme not in ("https", "http")
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in ("", "/", "/api/v2", "/api/v2/")
        ):
            fail(503, "Fleet endpoint is unconfigured or invalid")
        if (
            parsed.scheme == "http"
            and parsed.hostname not in ("localhost", "127.0.0.1", "::1")
            and os.environ.get("HERMES_WORKBENCH_FLEET_ALLOW_HTTP") != "1"
        ):
            fail(503, "Fleet requires HTTPS")
        review = method == "POST" and path.rsplit("/", 1)[-1] in (
            "approve",
            "request_changes",
            "note",
            "decide",
        )
        provider = self.review_token_provider if review else self.token_provider
        token = (
            await invoke(provider)
            if provider
            else os.environ.get("FLEET_REVIEW_TOKEN" if review else "FLEET_TOKEN", "")
        )
        if not token:
            fail(503, "Fleet backend credential is unconfigured")
        base = url.rstrip("/")
        if not base.endswith("/api/v2"):
            base += "/api/v2"
        try:
            async with httpx.AsyncClient(
                timeout=10, follow_redirects=False, trust_env=False
            ) as client:
                headers = {"Authorization": "Bearer " + token}
                if isinstance(body, dict) and "revision" in body:
                    headers["If-Match"] = str(body["revision"])
                response = await client.request(
                    method, base + path, json=body, params=params, headers=headers
                )
            if response.status_code >= 300:
                fail(
                    response.status_code
                    if response.status_code
                    in (400, 401, 403, 404, 409, 410, 422, 501, 503)
                    else 502,
                    "Fleet rejected the request" + self.error_code(response),
                )
            if path.startswith("/artifacts/") and path.endswith("/download"):
                if len(response.content) > 32 * 1024 * 1024:
                    fail(502, "Fleet artifact too large")
                return {
                    "content": response.content,
                    "content_type": response.headers.get(
                        "content-type", "application/octet-stream"
                    ),
                }
            if len(response.content) > 4 * 1024 * 1024:
                fail(502, "Fleet response too large")
            return response.json() if response.content else {}
        except httpx.TimeoutException:
            fail(504, "Fleet request timed out")
        except (httpx.HTTPError, ValueError):
            fail(502, "Fleet unavailable or invalid response")


def origin(c, session_id):
    return {k: c[k] for k in ("user_id", "profile_id", "project_id")} | {
        "session_id": session_id,
        "runtime": "dsh",
    }


def owned(c, value):
    o = value.get("origin") if isinstance(value, dict) else None
    if (
        not isinstance(o, dict)
        or o.get("runtime") != "dsh"
        or not isinstance(o.get("session_id"), str)
        or not o["session_id"]
        or any(o.get(k) != c[k] for k in ("user_id", "profile_id", "project_id"))
    ):
        fail(403, "Fleet origin is missing or outside authenticated scope")
    return o


def public_task(task):
    keys = {
        "id",
        "title",
        "kind",
        "deliverable",
        "report_required",
        "status",
        "revision",
        "created_at",
        "updated_at",
        "completed_at",
        "status_changed_at",
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
        "blocked_reason",
        "error",
        "origin",
        "depends_on",
        "attempt_id",
        "epoch",
    }
    row = {k: task[k] for k in keys if k in task}
    row.setdefault("acceptance", [])
    row.setdefault("risk", "R1")
    row.setdefault("priority", "P2")
    if isinstance(row["priority"], int):
        row["priority"] = "P" + str(row["priority"])
    if isinstance(row["acceptance"], str):
        row["acceptance"] = [
            {
                "label": line,
                "checked": row.get("status") in ("review", "done", "archived"),
            }
            for line in row["acceptance"].splitlines()
            if line.strip()
        ]
    if isinstance(row.get("spec_json"), str):
        row["spec_json"] = {"summary": row["spec_json"]}
    row["server_lifecycle"] = True
    return row


def public_artifact(value, task_id):
    if not isinstance(value, dict) or value.get("task_id") != task_id:
        fail(502, "Artifact task mismatch")
    aid = identifier(value.get("id"))
    return {
        k: value[k]
        for k in ("id", "task_id", "kind", "name", "sha", "size", "content_type")
        if k in value
    } | {
        "download_url": f"/api/plugins/workbench/fleet/artifacts/{aid}/download?task_id={task_id}"
    }


def task_defaults(c, prompt):
    """Task-specific deliverables without overriding Fleet's global model policy."""
    summary = " ".join(prompt.split())[:240]
    readonly = bool(
        re.search(
            r"\b(read.only|no.file.change|summarize|explain|inspect|list|check)\b|只读|不修改",
            prompt,
            re.I,
        )
    )
    if not re.search(
        r"no.file.change|read.only|只读|不修改", prompt, re.I
    ) and re.search(
        r"\b(implement|edit|fix|add|remove|refactor|write|update|create|modify)\b|修改|实现|修复",
        prompt,
        re.I,
    ):
        readonly = False
    risky = bool(
        re.search(
            r"\b(production|migration|deploy|credentials|delete database)\b|生产|迁移|部署",
            prompt,
            re.I,
        )
    )
    report = bool(
        re.search(
            r"\b(write|create|produce|generate)\s+(a\s+)?(standalone\s+)?report\b|生成报告|撰写报告",
            prompt,
            re.I,
        )
    )
    policy = c.get("fleet", {})
    if not isinstance(policy, dict):
        fail(503, "Invalid server Fleet routing policy")
    kind = policy.get("kind", "code")
    risk = policy.get("risk", "R3" if risky else "R0" if readonly else "R1")
    payload = {
        "kind": kind,
        "risk": risk,
        "deliverable": (
            "Requested report"
            if report
            else "Requested result and verification evidence"
        )
        + ": "
        + summary,
        "acceptance": "Fulfill the requested scope: "
        + summary
        + "\nProvide concrete verification evidence; disclose incomplete work and avoid unrelated changes.",
        "report_required": report,
        "workspace": c["workspace"],
        "machine": policy.get(
            "machine",
            c.get("fleet_machine", c.get("machine", c.get("device_id", "auto"))),
        ),
    }
    repo = c.get("repo") or c.get("repository")
    if isinstance(repo, str) and repo:
        payload["repo"] = repo
    if policy.get("capability"):
        payload["capability"] = policy["capability"]
    return payload


def normalize_task(value):
    if not isinstance(value, dict) or not isinstance(value.get("task", value), dict):
        fail(502, "Invalid Fleet task response")
    task = dict(value.get("task", value))
    # Real v2 keeps lease identity on the latest attempts[0], not task.
    attempts = value.get("attempts")
    if isinstance(attempts, list):
        if attempts and isinstance(attempts[0], dict):
            task["attempt_id"] = attempts[0].get("id")
            task["epoch"] = attempts[0].get("lease_epoch")
        else:
            task["attempt_id"], task["epoch"] = None, None
    return task


class Fleet:
    def __init__(self, services, transport=None):
        self.services, self.store = services, services.store
        self.transport = transport or FleetHTTP()
        self._drains = {}
        self._creates = {}

    async def call(self, method, path, data=None, params=None):
        return await invoke(self.transport, method, path, data, params)

    async def task(self, c, task_id):
        value = await self.call("GET", "/tasks/" + identifier(task_id))
        task = normalize_task(value)
        owned(c, task)
        return task

    async def create(self, c, data):
        allowed = {
            "title",
            "prompt",
            "session_id",
            "request_id",
            "depends_on",
            "execution",
            "skills",
        }
        if set(data) - allowed:
            fail(422, "Unsupported Fleet task fields")
        sid = data.get("session_id")
        await self.services.require_session(c, sid)
        request_id = identifier(data.get("request_id"))
        prompt = bounded_text(data.get("prompt", data.get("title")), 128 * 1024)
        if not prompt.strip():
            fail(422, "Task prompt required")
        deps = data.get("depends_on", [])
        if (
            not isinstance(deps, list)
            or len(deps) > 100
            or any(not isinstance(v, str) for v in deps)
            or len(set(deps)) != len(deps)
        ):
            fail(422, "Unique dependency list required")
        for dep in deps:
            await self.task(c, dep)
        if data.get("skills"):
            fail(422, "Fleet task skill overrides require a supported Fleet capability")
        execution = data.get("execution", "background")
        if execution == "foreground" and deps:
            fail(422, "Foreground inputs cannot own Fleet dependencies")
        if execution == "foreground":
            return await self.services.runtime_call(
                "send_message",
                c,
                sid,
                {
                    "text": prompt,
                    "request_id": request_id,
                    "context": self.services.config.build(c),
                },
                required=True,
            )
        if execution != "background":
            fail(422, "execution must be foreground or background")
        payload = {
            **task_defaults(c, prompt),
            "title": bounded_text(data.get("title") or prompt[:120], 500),
            "prompt": prompt,
            "origin": origin(c, sid),
            "depends_on": deps,
            "request_id": request_id,
        }
        fingerprint = digest(json.dumps(payload, sort_keys=True).encode())
        lock = self._creates.setdefault((scope(c), sid, request_id), asyncio.Lock())
        # Request identity includes the original session, like Fleet's five-field origin.
        receipt_id = digest((sid + ":" + request_id).encode())
        async with lock:
            with self.store.transaction() as db:
                previous = self.store.get(
                    scope(c), "fleet_requests", receipt_id, None, db
                )
                if previous and previous["fingerprint"] != fingerprint:
                    fail(409, "Task request id reused with different input")
                if not previous:
                    previous = {"fingerprint": fingerprint}
                    self.store.put(scope(c), "fleet_requests", receipt_id, previous, db)
            if previous.get("task_id"):
                task = await self.task(c, previous["task_id"])
            else:
                result = await self.call("POST", "/tasks", payload)
                task = normalize_task(result)
                if owned(c, task) != origin(c, sid):
                    fail(403, "Created task origin mismatch")
                identifier(task.get("id"))
                previous["task_id"] = task["id"]
                self.store.put(scope(c), "fleet_requests", receipt_id, previous)
            # Persisted receipts reconcile response loss and never redispatch a live or
            # terminal task. Fleet's transition is the cross-process concurrency fence.
            if task.get("status") == "triage":
                try:
                    result = await self.call(
                        "POST",
                        f"/tasks/{task['id']}/dispatch",
                        {"origin": origin(c, sid)},
                    )
                    task = normalize_task(result)
                except HTTPException as exc:
                    if exc.status_code not in (409, 502, 504):
                        raise
                    task = await self.task(c, task["id"])
                    if task.get("status") == "triage":
                        raise
            if owned(c, task) != origin(c, sid):
                fail(403, "Dispatched task origin mismatch")
            if task.get("status") == "triage":
                fail(502, "Fleet task was not dispatched")
            self.store.put(scope(c), "fleet_tasks", task["id"], task)
            return {"task": public_task(task)}

    async def list_tasks(self, c):
        filtered, cursor = [], ""
        for _ in range(20):
            value = await self.call(
                "GET",
                "/tasks",
                params={
                    **{k: c[k] for k in ("user_id", "profile_id", "project_id")},
                    "runtime": "dsh",
                    "limit": 1000,
                    "include_archived": "true",
                    "cursor": cursor,
                },
            )
            rows = value.get("tasks", []) if isinstance(value, dict) else value
            if not isinstance(rows, list):
                fail(502, "Invalid Fleet task list")
            for task in rows:
                try:
                    owned(c, task)
                except HTTPException:
                    continue
                filtered.append(public_task(task))
            if not isinstance(value, dict) or not value.get("has_more"):
                return filtered
            next_cursor = value.get("next_cursor")
            if (
                not isinstance(next_cursor, str)
                or not next_cursor
                or next_cursor == cursor
            ):
                fail(502, "Invalid Fleet task pagination")
            cursor = next_cursor
        fail(
            503,
            "Scoped Fleet listing exceeds safe scan limit; upstream scope filtering is required",
        )

    async def detail(self, c, task_id):
        value = await self.call("GET", "/tasks/" + identifier(task_id))
        task = normalize_task(value)
        owned(c, task)
        attempt_keys = {
            "id",
            "status",
            "worker_id",
            "machine",
            "capability",
            "runner",
            "model_used",
            "final_model",
            "reasoning_effort",
            "conversation_id",
            "started_at",
            "ended_at",
            "duration_ms",
            "lease_epoch",
        }
        attempts = [
            {k: a[k] for k in attempt_keys if k in a}
            for a in value.get("attempts", [])
            if isinstance(a, dict)
        ]
        return {
            "task": public_task(task),
            "attempts": attempts,
            "artifacts": [
                public_artifact(a, task_id) for a in value.get("artifacts", [])
            ],
            "open_decision": value.get("open_decision", value.get("decision")),
            "links": value.get("links", []),
        }

    async def worker_messages(self, c, task_id, attempt_id, epoch):
        task = await self.task(c, task_id)
        if (
            task.get("attempt_id", task.get("current_attempt_id")) != attempt_id
            or task.get("epoch") != epoch
        ):
            fail(409, "Stale Fleet attempt")
        return await self.call(
            "GET",
            f"/tasks/{identifier(task_id)}/messages",
            params={"attempt_id": identifier(attempt_id), "epoch": epoch},
        )

    async def ack_worker_message(self, c, task_id, message_id, attempt_id, epoch):
        await self.worker_messages(c, task_id, attempt_id, epoch)
        return await self.call(
            "POST",
            f"/tasks/{identifier(task_id)}/messages/{identifier(message_id)}/ack",
            {"attempt_id": attempt_id, "epoch": epoch},
        )

    async def followup(self, c, task_id, message_id, text):
        task = await self.task(c, task_id)
        return await self.call(
            "POST",
            f"/tasks/{identifier(task_id)}/messages",
            {
                "origin": task["origin"],
                "message_id": identifier(message_id),
                "text": bounded_text(text, 128 * 1024),
            },
        )

    async def drain(self, c, session_id, limit=100):
        """persist_delivery(c, session_id, delivery, idempotency_key) must atomically dedupe
        in the DSH history store and return {'persisted': True}. Accepted receipts do
        not satisfy this contract. Fleet remains authoritative for attempt validity.
        """
        await self.services.require_session(c, session_id)
        if type(limit) is not int or not 1 <= limit <= 100:
            fail(422, "Invalid delivery limit")
        key = (scope(c), session_id)
        lock = self._drains.setdefault(key, asyncio.Lock())
        async with lock:
            expected = origin(c, session_id)
            count, skipped, seen = 0, 0, set()
            # Bound one cycle, but continue after ACK so limit=1 stale rows cannot
            # starve a later valid result. The host runs further cycles as necessary.
            for _ in range(100):
                result = await self.call(
                    "GET", "/deliveries", params={**expected, "limit": limit}
                )
                rows = (
                    result.get("deliveries", []) if isinstance(result, dict) else result
                )
                if not isinstance(rows, list):
                    fail(502, "Invalid Fleet deliveries")
                if not rows:
                    break
                progressed = False
                for raw in rows:
                    if not isinstance(raw, dict):
                        fail(502, "Invalid Fleet delivery")
                    did = identifier(raw.get("id"))
                    if did in seen:
                        continue
                    seen.add(did)
                    task_id = identifier(raw.get("task_id"))
                    task = await self.task(c, task_id)
                    collaboration = await self.call(
                        "GET", f"/tasks/{task_id}/collaboration"
                    )
                    if (
                        owned(c, task) != expected
                        or owned(c, collaboration) != expected
                    ):
                        fail(403, "Delivery task origin differs from requested session")
                    if "origin" in raw and raw["origin"] != expected:
                        fail(403, "Delivery origin differs from requested session")
                    delivery = {**raw, "origin": expected}
                    attempt, epoch = raw.get("attempt_id"), raw.get("epoch")
                    current_id, current_epoch = (
                        task.get("attempt_id"),
                        task.get("epoch"),
                    )
                    if not attempt or type(epoch) is not int or epoch < 1:
                        fail(502, "Delivery requires an attempt and positive epoch")
                    if current_id is None or current_epoch is None:
                        fail(502, "Fleet task lacks latest attempt identity")
                    if attempt != current_id or epoch != current_epoch:
                        # ACK only discards the obsolete outbox row; it does not
                        # mutate either the old or new task attempt or DSH history.
                        await self.call(
                            "POST", f"/deliveries/{did}/ack", {"origin": expected}
                        )
                        skipped += 1
                        progressed = True
                        continue
                    fingerprint = digest(json.dumps(delivery, sort_keys=True).encode())
                    receipt = self.store.get(scope(c), "deliveries", did)
                    if receipt and (
                        receipt["task_id"] != task_id
                        or receipt["attempt_id"] != attempt
                        or receipt["epoch"] != epoch
                        or receipt.get("fingerprint") != fingerprint
                    ):
                        fail(409, "Delivery identity changed")
                    if not receipt:
                        persisted = await self.services.runtime_call(
                            "persist_delivery",
                            c,
                            session_id,
                            delivery,
                            f"fleet-delivery:{did}",
                            required=True,
                        )
                        if (
                            not isinstance(persisted, dict)
                            or persisted.get("persisted") is not True
                        ):
                            fail(
                                502,
                                "DSH delivery was not durably persisted; Fleet ACK withheld",
                            )
                        self.store.put(
                            scope(c),
                            "deliveries",
                            did,
                            {
                                "id": did,
                                "task_id": task_id,
                                "attempt_id": attempt,
                                "epoch": epoch,
                                "session_id": session_id,
                                "fingerprint": fingerprint,
                            },
                        )
                    for run in self.store.list(scope(c), "schedule_runs"):
                        if run.get("task_id") == task_id:
                            run["delivery_ids"] = sorted(
                                set(run.get("delivery_ids", [])) | {did}
                            )
                            self.store.put(scope(c), "schedule_runs", run["id"], run)
                    await self.call(
                        "POST", f"/deliveries/{did}/ack", {"origin": expected}
                    )
                    count += 1
                    progressed = True
                if not progressed:
                    break
            return {"delivered": count, "stale": skipped}


def mount_fleet(router, services):
    fleet = services.fleet

    async def ctx(request):
        return await resolve(services.resolver, request)

    async def config(request: Request):
        await ctx(request)
        configured = not isinstance(fleet.transport, FleetHTTP) or bool(
            fleet.transport.url or os.environ.get("FLEET_URL")
        )
        return {
            "mode": "live" if configured else "unconfigured",
            "extended_workflow": False,
            "runtime": "dsh",
            "authority": "fleet",
        }

    async def tasks(request: Request):
        c = await ctx(request)
        if request.method == "POST":
            return await fleet.create(
                c,
                await body(
                    request,
                    c,
                    {
                        "title",
                        "prompt",
                        "session_id",
                        "request_id",
                        "depends_on",
                        "execution",
                        "skills",
                    },
                ),
            )
        rows = await fleet.list_tasks(c)
        status = request.query_params.get("status")
        return {"tasks": [r for r in rows if not status or r.get("status") == status]}

    async def task(request: Request, task_id: str):
        return await fleet.detail(await ctx(request), task_id)

    async def search(
        request: Request, q: str = "", archived: bool = False, cursor: str = ""
    ):
        c = await ctx(request)
        bounded_text(q, 1000)
        if cursor and (not cursor.isdigit() or len(cursor) > 8):
            fail(422, "Invalid search cursor")
        rows = [
            r
            for r in await fleet.list_tasks(c)
            if (not archived or r.get("status") == "archived")
            and (
                not q
                or any(
                    q.casefold() in str(r.get(k, "")).casefold()
                    for k in ("id", "title", "repo")
                )
            )
        ]
        start = int(cursor or 0)
        more = start + 100 < len(rows)
        return {
            "tasks": rows[start : start + 100],
            "has_more": more,
            "next_cursor": str(start + 100) if more else "",
        }

    async def sync(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"lane", "cursor"})
        if b.get("lane", "all") not in ("all", "fast", "slow"):
            fail(422, "Invalid refresh lane")
        # A scoped full snapshot is a valid CardDelta and requires no second cursor authority.
        return {
            "tasks": await fleet.list_tasks(c),
            "removed": [],
            "cursors": {},
            "full": True,
        }

    async def archived(request: Request):
        return {
            "tasks": [
                r
                for r in await fleet.list_tasks(await ctx(request))
                if r.get("status") == "archived"
            ]
        }

    async def patch(request: Request, task_id: str):
        c = await ctx(request)
        task = await fleet.task(c, task_id)
        b = await body(
            request,
            c,
            {
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
            },
        )
        for route_field in ("repo", "machine", "capability"):
            if route_field in b and b[route_field] != task.get(route_field):
                fail(403, "Repository and device routing are server-derived")
        if isinstance(b.get("spec_json"), dict):
            b["spec_json"] = json.dumps(b["spec_json"])
        revision = b.get("revision")
        if type(revision) is not int or request.headers.get("If-Match", "").strip(
            '"'
        ) != str(revision):
            fail(422, "Matching revision and If-Match required")
        await fleet.call(
            "PATCH", f"/tasks/{identifier(task_id)}", {**b, "origin": task["origin"]}
        )
        return await fleet.detail(c, task_id)

    async def artifact(request: Request, artifact_id: str, task_id: str):
        c = await ctx(request)
        detail = await fleet.detail(c, task_id)
        metadata = next(
            (a for a in detail["artifacts"] if a["id"] == artifact_id), None
        )
        if metadata is None:
            fail(404, "Task artifact not found")
        result = await fleet.call(
            "GET",
            f"/artifacts/{identifier(artifact_id)}/download",
            params={"task_id": task_id},
        )
        if not isinstance(result, dict) or not isinstance(result.get("content"), bytes):
            fail(502, "Invalid Fleet artifact")
        return binary(
            result["content"],
            metadata.get("name", artifact_id),
            True,
            result.get("content_type"),
        )

    async def collaboration(request: Request, task_id: str):
        c = await ctx(request)
        await fleet.task(c, task_id)
        value = await fleet.call("GET", f"/tasks/{identifier(task_id)}/collaboration")
        if not isinstance(value, dict):
            fail(502, "Invalid collaboration response")
        return {
            k: value[k]
            for k in (
                "task_id",
                "messages",
                "dependencies",
                "attempt_id",
                "epoch",
                "origin",
            )
            if k in value
        }

    async def followup(request: Request, task_id: str):
        c = await ctx(request)
        b = await body(request, c, {"message_id", "text"})
        return await fleet.followup(c, task_id, b.get("message_id"), b.get("text"))

    async def action(request: Request, task_id: str, action: str):
        c = await ctx(request)
        task = await fleet.task(c, task_id)
        if action not in (
            "cancel",
            "retry",
            "archive",
            "approve",
            "request_changes",
            "note",
            "decide",
        ):
            fail(422, "Unsupported Fleet action")
        b = await body(
            request, c, {"text", "revision", "decision_id", "option_id", "request_id"}
        )
        return await fleet.call(
            "POST",
            f"/tasks/{identifier(task_id)}/{action}",
            {**b, "origin": task["origin"]},
        )

    for prefix in ("/fleet", "/fleetd"):
        router.add_api_route(prefix + "/config", config, methods=["GET"])
        router.add_api_route(prefix + "/tasks", tasks, methods=["GET", "POST"])
        router.add_api_route(prefix + "/tasks/search", search, methods=["GET"])
        router.add_api_route(prefix + "/tasks/sync", sync, methods=["POST"])
        router.add_api_route(prefix + "/tasks/archived", archived, methods=["GET"])
        router.add_api_route(prefix + "/tasks/{task_id}", task, methods=["GET"])
        router.add_api_route(prefix + "/tasks/{task_id}", patch, methods=["PATCH"])
        router.add_api_route(
            prefix + "/artifacts/{artifact_id}/download", artifact, methods=["GET"]
        )
        router.add_api_route(
            prefix + "/tasks/{task_id}/collaboration", collaboration, methods=["GET"]
        )
        router.add_api_route(
            prefix + "/tasks/{task_id}/messages", followup, methods=["POST"]
        )
        router.add_api_route(
            prefix + "/tasks/{task_id}/{action}", action, methods=["POST"]
        )

    @router.post("/tasks/background")
    async def background(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"message", "request_id", "session_id"})
        query_sid = request.query_params.get("session_id")
        if query_sid is not None and query_sid != b.get("session_id"):
            fail(403, "Session query/body mismatch")
        return await services.submit_background(
            c, b.get("message"), b.get("request_id"), b.get("session_id")
        )

    @router.post("/fleet/deliveries/drain")
    async def drain(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"session_id", "limit"})
        return await fleet.drain(c, b.get("session_id"), b.get("limit", 100))
