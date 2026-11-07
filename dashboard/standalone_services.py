"""Isolated Workbench services. See standalone_domains/README.md for host contracts.

No import starts a process, reads credentials, discovers histories, or contacts a
runtime. Router construction touches only the explicitly supplied storage_root.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter

try:  # Both repository-package and dashboard-on-sys.path hosts are supported.
    from .standalone_domains.core import (
        Store,
        digest,
        bounded_text,
        fail,
        identifier,
        invoke,
        scope,
        validate_context,
    )
    from .standalone_domains.files import Tree, mount_files
    from .standalone_domains.attachments import Attachments, mount_attachments
    from .standalone_domains.config import Config, mount_config
    from .standalone_domains.archive import Archives, mount_archive, mount_archive_extra
    from .standalone_domains.fleet import Fleet, mount_fleet, origin
    from .standalone_domains.schedules import Schedules, mount_schedule_extra
except ImportError:  # pragma: no cover - script-style host
    from standalone_domains.core import (
        Store,
        digest,
        bounded_text,
        fail,
        identifier,
        invoke,
        scope,
        validate_context,
    )
    from standalone_domains.files import Tree, mount_files
    from standalone_domains.attachments import Attachments, mount_attachments
    from standalone_domains.config import Config, mount_config
    from standalone_domains.archive import Archives, mount_archive, mount_archive_extra
    from standalone_domains.fleet import Fleet, mount_fleet, origin
    from standalone_domains.schedules import Schedules, mount_schedule_extra


class StandaloneServices:
    """A host-owned instance shared by both routers and lifecycle callbacks.

    runtime may be an object or dictionary of callbacks; see README for signatures.
    fleet_request is a server-injected transport, never a browser-supplied endpoint.
    """

    def __init__(
        self,
        resolve_context,
        storage_root,
        runtime=None,
        *,
        fleet_request=None,
        clock=None,
    ):
        self.resolver, self.runtime = resolve_context, runtime
        self.store = Store(storage_root)
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.config = Config(self)
        self.attachments = Attachments(self)
        self.archives = Archives(self)
        self.fleet = Fleet(self, fleet_request or self.callback("fleet_request"))
        self.schedules = Schedules(self)
        self._background_task = None

    def callback(self, name):
        return (
            self.runtime.get(name)
            if isinstance(self.runtime, dict)
            else getattr(self.runtime, name, None)
        )

    async def runtime_call(self, name, *args, required=False):
        callback = self.callback(name)
        if not callable(callback):
            if required:
                fail(503, f"Runtime adapter does not support {name}")
            return None
        return await invoke(callback, *args)

    def runtime_supports(self, capability):
        capabilities = (
            self.runtime.get("capabilities", {})
            if isinstance(self.runtime, dict)
            else getattr(self.runtime, "capabilities", {})
        )
        if isinstance(capabilities, dict) and capability in capabilities:
            return capabilities[capability] is True
        if capability == "durable_scheduled_input":
            return callable(self.callback("scheduled_input"))
        return False

    def bind_session(self, context, ref):
        """Host-only: call after DSH durably creates a session. No HTTP binding route."""
        c = validate_context(context)
        if (
            not isinstance(ref, dict)
            or ref.get("runtime") != "dsh"
            or any(ref.get(k) != c[k] for k in ("profile_id", "project_id"))
        ):
            fail(403, "Runtime session reference does not match context")
        identifier(ref.get("id"))
        self.remember_context(c)
        self.store.put(scope(c), "sessions", ref["id"], ref)
        return ref

    async def require_session(self, context, session_id):
        identifier(session_id)
        if callable(self.callback("get_session")):
            ref = await self.runtime_call(
                "get_session", context, session_id, required=True
            )
            if ref is None:
                fail(404, "Session not found")
            if not isinstance(ref, dict) or ref.get("id") != session_id:
                fail(403, "Runtime session reference mismatch")
            return self.bind_session(context, ref)
        ref = self.store.get(scope(context), "sessions", session_id)
        if ref is None:
            fail(404, "Session not found; host must bind its DSH session")
        return ref

    def remember_context(self, context):
        c = validate_context(context)
        identity = {k: c[k] for k in ("user_id", "profile_id", "project_id")}
        # Persist identities and a root fingerprint only. Restart must obtain the
        # current authorized path/routing from a trusted host context loader.
        self.store.put(
            "registry",
            "contexts",
            scope(c),
            {**identity, "workspace_hash": digest(c["workspace"].encode())},
        )

    async def submit_background(self, context, message, request_id, session_id):
        c = validate_context(context)
        if not isinstance(message, str):
            fail(
                422,
                "Background input must be text; attachment references are not supported",
            )
        bounded_text(message, 128 * 1024)
        await self.require_session(c, session_id)
        task = (
            await self.fleet.create(
                c,
                {"prompt": message, "request_id": request_id, "session_id": session_id},
            )
        )["task"]
        return {
            "task_id": task["id"],
            "status": task["status"],
            "origin": origin(c, session_id),
        }

    def enumerate_work(self):
        """Host lifecycle discovery with no restored raw paths or credentials."""
        return self.store.list("registry", "contexts")

    async def poll_once(self, context_loader, *, now=None, limit=100):
        if not callable(context_loader):
            fail(503, "Authorized lifecycle context loader required")
        result = {"schedules": [], "deliveries": [], "errors": []}
        for saved in self.enumerate_work():
            identity = {k: saved[k] for k in ("user_id", "profile_id", "project_id")}
            try:
                c = validate_context(await invoke(context_loader, identity))
                if (
                    any(c[k] != identity[k] for k in identity)
                    or digest(c["workspace"].encode()) != saved["workspace_hash"]
                ):
                    fail(403, "Lifecycle scope or workspace changed")
                try:
                    result["schedules"].extend(
                        {k: v for k, v in run.items() if k != "runtime_context"}
                        for run in await self.run_due(c, now)
                    )
                except Exception:
                    result["errors"].append(
                        {**identity, "operation": "schedule_submission"}
                    )
                for ref in self.store.list(scope(c), "sessions"):
                    try:
                        result["deliveries"].append(
                            {
                                "session_id": ref["id"],
                                **await self.drain_deliveries(c, ref["id"], limit),
                            }
                        )
                    except Exception:
                        result["errors"].append(
                            {
                                **identity,
                                "session_id": ref["id"],
                                "operation": "delivery",
                            }
                        )
            except Exception:
                result["errors"].append(
                    {**identity, "operation": "context_authorization"}
                )
        return result

    def start_background(self, context_loader, *, interval=5):
        if not callable(context_loader) or not 1 <= interval <= 60:
            fail(422, "Context loader and 1–60 second interval required")
        if self._background_task and not self._background_task.done():
            return self._background_task

        async def loop():
            while True:
                await self.poll_once(context_loader)
                await asyncio.sleep(interval)

        self._background_task = asyncio.create_task(
            loop(), name="standalone-service-poll"
        )
        return self._background_task

    async def stop_background(self):
        if self._background_task:
            self._background_task.cancel()
            await asyncio.gather(self._background_task, return_exceptions=True)
            self._background_task = None

    def workspace_tree(self, context):
        return Tree(context["workspace"], forbidden=(self.store.root,))

    def build_runtime_context(self, context):
        return self.config.build(validate_context(context))

    async def create_session_from_archive(
        self, context, archive_id, indexes, request_id
    ):
        c = validate_context(context)
        selected = self.archives.select_context(c, archive_id, indexes)
        ref = await self.runtime_call(
            "create_session",
            c,
            {
                "request_id": identifier(request_id),
                "context": {**self.config.build(c), "archive_context": selected},
            },
            required=True,
        )
        return self.bind_session(c, ref)

    async def drain_deliveries(self, context, session_id, limit=100):
        return await self.fleet.drain(validate_context(context), session_id, limit)

    async def run_due(self, context, now=None):
        return await self.schedules.run_due(context, now)

    def router(self):
        router = APIRouter()
        for mount in (
            mount_files,
            mount_attachments,
            mount_config,
            mount_archive,
            mount_fleet,
        ):
            mount(router, self)
        router.services = self
        return router

    def extra_router(self, *, archives=True, schedules=True, config_aliases=True):
        """Mount at application root. Disable archives when the host combines live lists."""
        router = APIRouter()
        if archives:
            mount_archive_extra(router, self)
        if schedules:
            mount_schedule_extra(router, self)
        if config_aliases:
            config_router = APIRouter()
            mount_config(config_router, self)
            for route in config_router.routes:
                router.add_api_route(
                    "/api" + route.path, route.endpoint, methods=list(route.methods)
                )
        router.services = self
        return router


def create_services_router(resolve_context, storage_root, runtime=None):
    """Mount the result at /api/plugins/workbench. Access its .services for callbacks."""
    return StandaloneServices(resolve_context, storage_root, runtime).router()


def create_extra_router(
    resolve_context=None,
    storage_root=None,
    runtime=None,
    *,
    services=None,
    archives=True,
    schedules=True,
    config_aliases=True,
):
    """Mount at root, sharing services=plugin_router.services; never mount twice."""
    instance = services or StandaloneServices(resolve_context, storage_root, runtime)
    return instance.extra_router(
        archives=archives, schedules=schedules, config_aliases=config_aliases
    )


def build_runtime_context(context, storage_root):
    """Backend-only helper; the result may contain MCP credentials, never return it over HTTP."""
    return StandaloneServices(None, storage_root).build_runtime_context(context)
