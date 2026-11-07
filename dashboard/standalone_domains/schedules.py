"""Durable schedule metadata and deterministic submissions to Fleet or durable DSH.

This module never executes tasks or owns attempts, dependencies, or task retries.
The host calls run_due with a freshly authorized context. Each occurrence has a
stable request id persisted before submission, so a restart can safely resubmit.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Request

from .core import body, bounded_text, fail, identifier, resolve, scope, validate_context

UTC = timezone.utc


def aware(value):
    if not isinstance(value, datetime) or value.tzinfo is None:
        fail(422, "Timezone-aware datetime required")
    return value.astimezone(UTC)


def cron_field(raw, minimum, maximum):
    values = set()
    for item in raw.split(","):
        pieces = item.split("/")
        if len(pieces) > 2:
            fail(422, "Invalid cron step")
        try:
            step = int(pieces[1]) if len(pieces) == 2 else 1
            if step < 1 or step > maximum + 1:
                raise ValueError()
            base = pieces[0]
            if base == "*":
                lo, hi = minimum, maximum
            elif "-" in base:
                lo, hi = (int(v) for v in base.split("-"))
            else:
                lo = hi = int(base)
            if lo < minimum or hi > maximum or lo > hi:
                raise ValueError()
        except (ValueError, TypeError):
            fail(422, "Invalid cron field")
        values.update(range(lo, hi + 1, step))
    return values


def parse_schedule(expression, timezone_name):
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, TypeError, ValueError):
        fail(422, "Unknown timezone")
    if not isinstance(expression, str) or not expression.strip():
        fail(422, "Schedule required")
    expression = expression.strip()
    interval = re.fullmatch(r"(?:@every\s+|every\s+)(\d+)\s*([smhd])", expression)
    if interval:
        seconds = (
            int(interval[1]) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[interval[2]]
        )
        if not 10 <= seconds <= 366 * 86400:
            fail(422, "Interval must be 10 seconds to 366 days")
        return {"kind": "interval", "seconds": seconds, "zone": zone}
    fields = expression.split()
    if len(fields) == 5:
        parsed = [
            cron_field(raw, lo, hi)
            for raw, lo, hi in zip(fields, [0, 0, 1, 1, 0], [59, 23, 31, 12, 7])
        ]
        parsed[4] = {v % 7 for v in parsed[4]}
        return {"kind": "cron", "fields": parsed, "raw": fields, "zone": zone}
    try:
        at = datetime.fromisoformat(expression.replace("Z", "+00:00"))
        if at.tzinfo is None:
            fail(422, "One-shot schedule requires an explicit UTC offset")
    except ValueError:
        fail(422, "Use five-field cron, @every 5m, or an ISO timestamp with offset")
    return {"kind": "once", "at": aware(at), "zone": zone}


def next_time(expression, zone, after):
    after = aware(after)
    parsed = parse_schedule(expression, zone)
    if parsed["kind"] == "interval":
        return after + timedelta(seconds=parsed["seconds"])
    if parsed["kind"] == "once":
        return parsed["at"] if parsed["at"] > after else None
    minute, hour, day, month, weekday = parsed["fields"]
    raw = parsed["raw"]
    candidate = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    # Iterating UTC avoids nonexistent local times and handles both DST folds.
    stop = candidate + timedelta(days=366 * 5)
    while candidate < stop:
        local = candidate.astimezone(parsed["zone"])
        dom, dow = local.day in day, (local.weekday() + 1) % 7 in weekday
        date_matches = (dom or dow) if raw[2] != "*" and raw[4] != "*" else dom and dow
        if (
            local.month in month
            and date_matches
            and local.hour in hour
            and local.minute in minute
        ):
            return candidate
        candidate += timedelta(minutes=1)
    fail(422, "Cron has no occurrence within five years")


FIELDS = {
    "name",
    "prompt",
    "schedule",
    "timezone",
    "missed_run_policy",
    "enabled",
    "request_id",
    "session_id",
    "execution",
    "deliver",
    "failure_deliver",
    "skills",
    "model",
    "provider",
    "base_url",
    "script",
    "no_agent",
    "context_from",
    "enabled_toolsets",
    "workdir",
    "continuity",
    "repeat",
    "attach_to_session",
    "monitor_script",
    "monitor_url",
    "reasoning_effort",
}


def public_run(run):
    return {k: v for k, v in run.items() if k != "runtime_context"}


class Schedules:
    def __init__(self, services):
        self.services, self.store = services, services.store
        self._locks = {}

    def now(self):
        return aware(self.services.clock())

    def get(self, c, job_id):
        row = self.store.get(scope(c), "schedules", identifier(job_id))
        if row is None:
            fail(404, "Scheduled job not found")
        return row

    def validate(self, c, values):
        if set(values) - FIELDS:
            fail(422, "Unsupported schedule fields")
        for field in (
            "model",
            "provider",
            "base_url",
            "script",
            "context_from",
            "enabled_toolsets",
            "continuity",
            "monitor_script",
            "monitor_url",
            "reasoning_effort",
            "no_agent",
        ):
            if values.get(field):
                fail(422, f"{field} is not supported by the isolated schedule adapter")
        if values.get("failure_deliver"):
            fail(
                422,
                "Failure delivery overrides are unsupported; submission failures remain in the execution journal",
            )
        for field in ("deliver",):
            if values.get(field) not in (None, "", "local", ["local"]):
                fail(422, f"{field} supports local DSH delivery only")
        if values.get("skills"):
            fail(
                422,
                "Schedule skill overrides are unsupported; use the selected profile context",
            )
        if values.get("workdir") not in (None, "", c["workspace"]):
            fail(403, "Schedule workdir must match the resolved workspace")
        if values.get("missed_run_policy", "skip") not in ("skip", "latest"):
            fail(422, "missed_run_policy must be skip or latest")
        if values.get("execution", "background") not in ("foreground", "background"):
            fail(422, "Invalid execution selection")
        repeat = values.get("repeat")
        if repeat is not None and (
            type(repeat) is not int or not 1 <= repeat <= 100000
        ):
            fail(422, "repeat must be a positive integer")
        if "enabled" in values and not isinstance(values["enabled"], bool):
            fail(422, "enabled must be boolean")
        if "attach_to_session" in values and not isinstance(
            values["attach_to_session"], bool
        ):
            fail(422, "attach_to_session must be boolean")
        bounded_text(values.get("prompt"), 128 * 1024)
        if not values["prompt"].strip():
            fail(422, "Schedule prompt required")
        bounded_text(values.get("name", ""), 500)
        parse_schedule(values.get("schedule"), values.get("timezone", "UTC"))

    async def create(self, c, values):
        self.validate(c, values)
        if values.get("execution", "background") == "foreground" and (
            not self.services.runtime_supports("durable_scheduled_input")
            or not callable(self.services.callback("scheduled_input"))
        ):
            fail(503, "Runtime does not advertise durable_scheduled_input")
        request_id = identifier(values.get("request_id") or uuid.uuid4().hex)
        fingerprint = hashlib.sha256(
            json.dumps(values, sort_keys=True).encode()
        ).hexdigest()
        jid = "schedule_" + hashlib.sha256(request_id.encode()).hexdigest()[:32]
        existing = self.store.get(scope(c), "schedules", jid)
        if existing:
            if existing["fingerprint"] != fingerprint:
                fail(409, "Schedule request id reused with different input")
            return existing
        now = self.now()
        due = next_time(values["schedule"], values.get("timezone", "UTC"), now)
        if due is None:
            fail(422, "One-shot schedule must be in the future")
        sid = values.get("session_id")
        if values.get("attach_to_session") and not sid:
            fail(422, "attach_to_session requires an explicit session_id")
        if sid:
            await self.services.require_session(c, sid)
        else:
            ref = await self.services.runtime_call(
                "create_session",
                c,
                {
                    "request_id": "schedule-session-" + jid,
                    "context": self.services.config.build(c),
                },
                required=True,
            )
            sid = self.services.bind_session(c, ref)["id"]
        row = {
            **values,
            "id": jid,
            "request_id": request_id,
            "fingerprint": fingerprint,
            "session_id": sid,
            "schedule": values["schedule"],
            "timezone": values.get("timezone", "UTC"),
            "missed_run_policy": values.get("missed_run_policy", "skip"),
            "enabled": values.get("enabled", True),
            "execution": values.get("execution", "background"),
            "deliver": "local",
            "next_run_at": due.isoformat(),
            "created_at": now.isoformat(),
            "runs": 0,
            "workspace": c["workspace"],
        }
        with self.store.transaction() as db:
            old = self.store.get(scope(c), "schedules", jid, None, db)
            if old:
                if old["fingerprint"] != fingerprint:
                    fail(409, "Schedule request id reused")
                return old
            return self.store.put(scope(c), "schedules", jid, row, db)

    async def update(self, c, job_id, updates):
        if "request_id" in updates or "session_id" in updates:
            fail(422, "Schedule identity and target session are immutable")
        row = self.get(c, job_id)
        merged = {k: v for k, v in row.items() if k in FIELDS} | updates
        self.validate(c, merged)
        if merged.get("execution", "background") == "foreground" and (
            not self.services.runtime_supports("durable_scheduled_input")
            or not callable(self.services.callback("scheduled_input"))
        ):
            fail(503, "Runtime does not advertise durable_scheduled_input")
        if "schedule" in updates or "timezone" in updates:
            due = next_time(
                merged["schedule"], merged.get("timezone", "UTC"), self.now()
            )
            if due is None:
                fail(422, "Schedule has no future occurrence")
            row["next_run_at"] = due.isoformat()
        row.update(updates)
        return self.store.put(scope(c), "schedules", job_id, row)

    def history(self, c, job_id):
        self.get(c, job_id)
        return sorted(
            [
                r
                for r in self.store.list(scope(c), "schedule_runs")
                if r["job_id"] == job_id
            ],
            key=lambda r: r["scheduled_at"],
            reverse=True,
        )

    async def trigger(self, c, job_id, request_id):
        row = self.get(c, job_id)
        return await self.submit(c, row, "manual-" + identifier(request_id), self.now())

    async def submit(self, c, row, occurrence, now):
        key = (
            "run_"
            + hashlib.sha256((row["id"] + ":" + occurrence).encode()).hexdigest()[:40]
        )
        lock = self._locks.setdefault((scope(c), key), asyncio.Lock())
        async with lock:
            run = self.store.get(scope(c), "schedule_runs", key)
            if run and run["status"] == "accepted":
                return run
            if c["workspace"] != row["workspace"]:
                fail(
                    403, "Schedule workspace changed; explicit reconfiguration required"
                )
            # Store immutable occurrence input before the network boundary.
            if not run:
                run = {
                    "id": key,
                    "job_id": row["id"],
                    "scheduled_at": now.isoformat(),
                    "request_id": key,
                    "status": "pending",
                    "session_id": row["session_id"],
                    "execution": row["execution"],
                    "prompt": row["prompt"],
                    "name": row.get("name", ""),
                    "workspace": row["workspace"],
                    "occurrence": occurrence,
                    **(
                        {"runtime_context": self.services.config.build(c)}
                        if row["execution"] == "foreground"
                        else {}
                    ),
                }
                self.store.put(scope(c), "schedule_runs", key, run)
            try:
                if run["execution"] == "background":
                    result = await self.services.fleet.create(
                        c,
                        {
                            "title": run["name"] or run["prompt"][:120],
                            "prompt": run["prompt"],
                            "session_id": run["session_id"],
                            "request_id": key,
                        },
                    )
                    run["task_id"] = result.get("task", result)["id"]
                else:
                    result = await self.services.runtime_call(
                        "scheduled_input",
                        c,
                        run["session_id"],
                        {
                            "text": run["prompt"],
                            "request_id": key,
                            "context": run["runtime_context"],
                        },
                        required=True,
                    )
                    if (
                        not isinstance(result, dict)
                        or result.get("request_id") != key
                        or result.get("status") not in ("accepted", "completed")
                    ):
                        fail(502, "Runtime did not durably accept scheduled input")
                    run["runtime_receipt"] = {
                        k: result[k]
                        for k in ("request_id", "status", "message_id")
                        if k in result
                    }
                run["status"] = "accepted"
                run["accepted_at"] = now.isoformat()
                run.pop("error", None)
            except Exception:
                run["error"] = (
                    "Submission not confirmed; next tick uses the same request id"
                )
                self.store.put(scope(c), "schedule_runs", key, run)
                raise
            with self.store.transaction() as db:
                old = self.store.get(scope(c), "schedule_runs", key, None, db)
                self.store.put(scope(c), "schedule_runs", key, run, db)
                current = self.store.get(scope(c), "schedules", row["id"], None, db)
                if current and (not old or old["status"] != "accepted"):
                    current["runs"] += 1
                    if (
                        current.get("repeat") is not None
                        and current["runs"] >= current["repeat"]
                    ):
                        current["enabled"] = False
                    self.store.put(scope(c), "schedules", row["id"], current, db)
            return run

    async def run_due(self, context, now=None):
        """One bounded tick. Host supplies a fresh server-authorized context each time."""
        c = validate_context(context)
        now = aware(now) if now else self.now()
        results = []
        # Pending submissions survive restarts; resubmit their original immutable input.
        for run in self.store.list(scope(c), "schedule_runs"):
            if run["status"] == "pending":
                row = self.get(c, run["job_id"])
                if row["enabled"]:
                    # Use original run key directly, rather than invent a new attempt.
                    results.append(await self._resume(c, row, run, now))
        for row in self.store.list(scope(c), "schedules"):
            if not row["enabled"] or not row.get("next_run_at"):
                continue
            due = datetime.fromisoformat(row["next_run_at"])
            if due > now:
                continue
            parsed = parse_schedule(row["schedule"], row["timezone"])
            next_due = (
                due
                + timedelta(
                    seconds=(int((now - due).total_seconds()) // parsed["seconds"] + 1)
                    * parsed["seconds"]
                )
                if parsed["kind"] == "interval"
                else next_time(row["schedule"], row["timezone"], now)
            )
            # skip drops occurrences more than one minute old; latest coalesces all
            # missed occurrences into exactly one submission with the original due id.
            should_submit = row[
                "missed_run_policy"
            ] == "latest" or now - due < timedelta(minutes=1)
            if should_submit:
                results.append(await self.submit(c, row, due.isoformat(), due))
            current = self.get(c, row["id"])
            current["next_run_at"] = next_due.isoformat() if next_due else None
            if next_due is None:
                current["enabled"] = False
            self.store.put(scope(c), "schedules", row["id"], current)
        return results

    async def _resume(self, c, row, run, now):
        # Occurrences store their stable hash; submit accepts an explicit internal key
        # through a lookup of the durable timestamp/manual identifier.
        occurrence = run.get("occurrence")
        if occurrence is None:
            fail(409, "Pending occurrence has no identity")
        return await self.submit(c, row, occurrence, now)


def mount_schedule_extra(router, services):
    schedules = services.schedules

    async def ctx(request):
        return await resolve(services.resolver, request)

    async def list_(request: Request):
        return {"jobs": schedules.store.list(scope(await ctx(request)), "schedules")}

    async def create(request: Request):
        c = await ctx(request)
        b = await body(request, c, FIELDS)
        if "request_id" not in b and request.headers.get("Idempotency-Key"):
            b["request_id"] = request.headers["Idempotency-Key"]
        return {"job": await schedules.create(c, b)}

    async def edit(request: Request, job_id: str):
        c = await ctx(request)
        if request.method == "DELETE":
            row = schedules.get(c, job_id)
            pending = [
                r for r in schedules.history(c, job_id) if r["status"] == "pending"
            ]
            if pending:
                fail(
                    409,
                    "A submission is unconfirmed; pause and reconcile it before deleting",
                )
            schedules.store.delete(scope(c), "schedules", job_id)
            return {"deleted": row["id"]}
        b = await body(request, c, {"updates"})
        if not isinstance(b.get("updates"), dict):
            fail(422, "updates object required")
        return {"job": await schedules.update(c, job_id, b["updates"])}

    async def action(request: Request, job_id: str, action: str):
        c = await ctx(request)
        row = schedules.get(c, job_id)
        if action == "trigger":
            request_id = request.headers.get("Idempotency-Key") or uuid.uuid4().hex
            run = await schedules.trigger(c, job_id, request_id)
            return {"job": schedules.get(c, job_id), "execution": public_run(run)}
        if action not in ("pause", "resume"):
            fail(422, "Unsupported schedule action")
        row["enabled"] = action == "resume"
        if action == "resume" and not row.get("next_run_at"):
            fail(409, "Completed one-shot schedule requires a new schedule")
        return {"job": schedules.store.put(scope(c), "schedules", job_id, row)}

    async def runs(request: Request, job_id: str, limit: int = 100):
        if not 1 <= limit <= 500:
            fail(422, "Invalid limit")
        return {
            "runs": [
                public_run(r)
                for r in schedules.history(await ctx(request), job_id)[:limit]
            ]
        }

    for prefix in ("/api/cron", "/api/plugins/workbench-cron"):
        router.add_api_route(prefix + "/jobs", list_, methods=["GET"])
        router.add_api_route(prefix + "/jobs", create, methods=["POST"])
        router.add_api_route(prefix + "/jobs/{job_id}", edit, methods=["PUT", "DELETE"])
        router.add_api_route(prefix + "/jobs/{job_id}/runs", runs, methods=["GET"])
        router.add_api_route(
            prefix + "/jobs/{job_id}/{action}", action, methods=["POST"]
        )

    @router.get("/api/plugins/workbench-cron/executions")
    async def executions(request: Request, job_id: str, limit: int = 100):
        if not 1 <= limit <= 500:
            fail(422, "Invalid limit")
        return {
            "executions": [
                public_run(r)
                for r in schedules.history(await ctx(request), job_id)[:limit]
            ]
        }
