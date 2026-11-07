"""Connect the shared Codex app-server bridge to Hermes projection.

This module is loaded only when a Codex endpoint is configured. It does not alter
Hermes core files, take ownership of the Codex daemon, or create user profiles.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from pathlib import Path
from typing import Any

from codex_bridge import CodexBridge

logger = logging.getLogger(__name__)


class IntegratedCodexBridge(CodexBridge):
    """Own an optional durable Hermes review consumer alongside Codex connections."""

    def configure_reviews(self, root: str | None) -> None:
        """Capture explicit worker configuration without starting background work."""
        self.review_root = Path(root).resolve() if root else None
        self.review_enabled = os.environ.get('HERMES_WORKBENCH_REVIEW_ENABLED') == '1'
        self.review_interval = float(os.environ.get('HERMES_WORKBENCH_REVIEW_INTERVAL', '30'))
        self.review_timeout = float(os.environ.get('HERMES_WORKBENCH_REVIEW_TIMEOUT', '300'))
        self.review_task = None
        self.review_stop = asyncio.Event()
        if self.review_enabled and (not self.review_root or not os.environ.get('HERMES_SOURCE')):
            raise ValueError('Review worker requires HERMES_WORKBENCH_HERMES_HOME and HERMES_SOURCE')
        if self.review_interval <= 0 or self.review_timeout <= 0:
            raise ValueError('Review worker timing must be positive')

    async def start_integrations(self) -> None:
        """Start the explicitly enabled outbox consumer after ASGI startup."""
        if self.review_enabled:
            self.review_task = asyncio.create_task(self._review_loop())
        from supervisor_inbox import SupervisorInbox
        from supervisor_fleet import FleetSupervisor
        from supervisor_native import NativeSupervisor
        self.supervisor_stop = asyncio.Event()
        self.supervisor_inbox = SupervisorInbox(self)
        self.supervisor_native = NativeSupervisor(self, self.supervisor_inbox)
        self.supervisor_fleet = FleetSupervisor(self, self.supervisor_inbox)
        actions = [("native", self.supervisor_native.poll), ("inbox", self.supervisor_inbox.drain)]
        if os.environ.get('FLEET_TOKEN') or Path(os.environ.get('FLEET_TOKEN_FILE', '/opt/data/.fleet-token')).is_file():
            actions.append(("fleet", self.supervisor_fleet.poll))
        self.supervisor_tasks = [asyncio.create_task(self._supervisor_loop(name, action)) for name, action in actions]

    async def _supervisor_loop(self, name, action) -> None:
        """Keep collecting and delivering results even with no browser or chat turn."""
        while not self.supervisor_stop.is_set():
            try:
                await action()
            except Exception as exc:
                logger.warning("Supervisor callback %s failed: %s", name, type(exc).__name__)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.supervisor_stop.wait(), timeout=5)

    def _with_supervisor_receipts(self, user, profile, session_id, result):
        inbox = getattr(self, 'supervisor_inbox', None)
        if inbox is None:
            return result
        turns = list(result.get('turns') or [])
        known = {turn.get('id') for turn in turns}
        receipts = [turn for turn in inbox.receipts((user, profile, session_id)) if turn['id'] not in known]
        return {**result, 'turns': turns + receipts} if receipts else result

    async def history(self, user, profile, session_id, after, limit, **kwargs):
        result = await super().history(user, profile, session_id, after, limit, **kwargs)
        return self._with_supervisor_receipts(user, profile, session_id, result)

    async def history_preview(self, user, profile, session_id, limit=20, **kwargs):
        result = await super().history_preview(user, profile, session_id, limit, **kwargs)
        return self._with_supervisor_receipts(user, profile, session_id, result)

    async def _review_loop(self) -> None:
        """Retry durable pending reviews without requiring another user message."""
        from codex_hermes import run_review_worker
        while not self.review_stop.is_set():
            root = self.review_root
            homes = [root, *(root / 'profiles').glob('*')]
            for home in homes:
                if self.review_stop.is_set():
                    break
                if not (home / 'state.db').is_file():
                    continue
                try:
                    home.resolve().relative_to(root)
                    result = await asyncio.to_thread(
                        run_review_worker, home, enabled=True,
                        hermes_source=os.environ['HERMES_SOURCE'], timeout_seconds=self.review_timeout,
                    )
                    if result['status'] not in {'empty', 'completed'}:
                        logger.warning('Hermes review status=%s profile=%s', result['status'], home.name)
                except Exception as exc:
                    logger.warning('Hermes review failed: %s', type(exc).__name__)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.review_stop.wait(), timeout=self.review_interval)

    async def _notification(self, user: str, profile: str, epoch: str | dict[str, Any], message: dict[str, Any] | None = None) -> None:
        """Reattach the CLI once the first user item makes an empty thread resumable."""
        await super()._notification(user, profile, epoch, message)
        if message is None:
            message = epoch if isinstance(epoch, dict) else {}
        params = message.get('params', {})
        item = params.get('item', {})
        if message.get('method') != 'item/completed' or item.get('type') != 'userMessage':
            return
        session = self.store.session_by_thread(user, profile, str(params.get('threadId', '')))
        if session is None or self.on_session_created is None:
            return

        async def attach() -> None:
            """Retry a viewer which exited before Codex persisted its initial user turn."""
            try:
                await self.on_session_created(session)
            except Exception as exc:
                logger.warning('Codex CLI attachment failed: %s', type(exc).__name__)

        task = asyncio.create_task(attach())
        self._observer_tasks.add(task)
        task.add_done_callback(self._observer_tasks.discard)

    async def close(self) -> None:
        """Finish an owned review subprocess before releasing its session database."""
        if hasattr(self, 'supervisor_stop'):
            self.supervisor_stop.set()
            for task in self.supervisor_tasks:
                task.cancel()
            await asyncio.gather(*self.supervisor_tasks, return_exceptions=True)
        self.review_stop.set()
        if self.review_task is not None:
            await self.review_task
        await super().close()


def build_bridge() -> CodexBridge:
    """Build the app-server bridge and optional Hermes history projection."""
    projection_root = os.environ.get('HERMES_WORKBENCH_HERMES_HOME')

    async def created(session: dict[str, Any]) -> None:
        """Keep the creation hook explicit without starting a second CLI viewer."""
        return None

    async def completed(session: dict[str, Any]) -> None:
        """Project completed history into the selected Hermes profile's durable store."""
        if str(session.get('session_scope') or 'personal') == 'repository':
            logger.info('Skipping Hermes projection for repository session=%s node=%s', session.get('session_id'), session.get('execution_node_id') or 'local')
            return
        if not projection_root:
            return
        from codex_hermes import import_completed

        root = Path(projection_root).resolve(strict=True)
        profile = session['profile']
        home = root if profile == 'default' else root / 'profiles' / profile
        home = home.resolve(strict=True)
        home.relative_to(root)
        connection = await service._connection(session['user_id'], profile)
        turns: list[dict[str, Any]] = []
        cursor = None
        while True:
            page = await connection.request('thread/turns/list', {
                'threadId': session['thread_id'], 'itemsView': 'full',
                'sortDirection': 'asc', 'limit': 100, 'cursor': cursor,
            })
            turns.extend(page.get('data', []))
            cursor = page.get('nextCursor')
            if not cursor:
                break
        # Hermes details/search also consume this mirror. Keep private native
        # echoes out of its durable transcript; Codex retains the full context.
        visible = await asyncio.to_thread(service.store.public_messages,
                                         session['user_id'], profile, session['session_id'],
                                         {'id': session['thread_id'], 'turns': turns})
        result = await asyncio.to_thread(import_completed, home, session['session_id'],
                                         session['workspace_path'], visible)
        if result.get('status') == 'dependency_unavailable':
            raise RuntimeError('Hermes projection dependencies unavailable')
        else:
            logger.info('Hermes projection status=%s profile=%s', result.get('status'), profile)

    service = IntegratedCodexBridge(on_session_created=created, on_completed=completed)
    service.configure_reviews(projection_root)
    return service
