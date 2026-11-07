"""Durable, identity-scoped task notifications for an idle supervisor thread."""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import defaultdict
from typing import Any

from fastapi import HTTPException


class SupervisorInbox:
    """Persist before sending, and never replay a request with unknown acceptance."""

    def __init__(self, bridge: Any) -> None:
        self.bridge = bridge
        self.store = bridge.store
        with self.store.lock:
            self.store.connection.executescript("""
                CREATE TABLE IF NOT EXISTS supervisor_inbox (
                    delivery_key TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL, profile TEXT NOT NULL,
                    session_id TEXT NOT NULL, text TEXT NOT NULL,
                    client_request_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    turn_id TEXT NOT NULL DEFAULT '',
                    last_error TEXT NOT NULL DEFAULT '',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_check_at REAL NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS supervisor_inbox_pending
                    ON supervisor_inbox(status, next_check_at, created_at);
                CREATE TABLE IF NOT EXISTS supervisor_receipts (
                    delivery_key TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    profile TEXT NOT NULL, session_id TEXT NOT NULL, turn_json TEXT NOT NULL
                );
            """)
            self.store.connection.commit()

    def get(self, key: str) -> dict[str, Any] | None:
        with self.store.lock:
            row = self.store.connection.execute(
                "SELECT * FROM supervisor_inbox WHERE delivery_key=?", (key,)
            ).fetchone()
        return dict(row) if row else None

    def enqueue(self, key: str, identity: tuple[str, str, str], text: str) -> dict[str, Any]:
        """Bind a source event permanently to one existing conversation and body."""
        if not isinstance(key, str) or not key or len(key) > 4000:
            raise ValueError("A bounded delivery key is required")
        if len(identity) != 3 or any(not isinstance(v, str) or not v or len(v) > 200 for v in identity):
            raise ValueError("A complete supervisor identity is required")
        if not isinstance(text, str) or not text.strip() or len(text) > 200000:
            raise ValueError("A bounded notification body is required")
        with self.store.lock:
            existing = self.get(key)
            if existing:
                if tuple(existing[k] for k in ("user_id", "profile", "session_id")) != tuple(identity) or existing["text"] != text:
                    raise HTTPException(409, "Supervisor delivery key already belongs to another notification")
                return existing
            if self.store.session(*identity) is None:
                raise HTTPException(404, "Supervisor session not found")
            request_id = "supervisor-" + hashlib.sha256(key.encode()).hexdigest()
            now = time.time()
            self.store.connection.execute(
                """INSERT INTO supervisor_inbox
                    (delivery_key,user_id,profile,session_id,text,client_request_id,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?)""",
                (key, *identity, text, request_id, now, now),
            )
            self.store.connection.commit()
            return self.get(key) or {}

    def receipts(self, identity) -> list[dict[str, Any]]:
        """Return explicitly labelled local system messages for history projection."""
        with self.store.lock:
            rows = self.store.connection.execute(
                'SELECT turn_json FROM supervisor_receipts WHERE user_id=? AND profile=? AND session_id=? ORDER BY rowid DESC LIMIT 100', identity
            ).fetchall()
        return [json.loads(row[0]) for row in reversed(rows)]

    def _receipt(self, row, reason):
        identity = tuple(row[k] for k in ('user_id', 'profile', 'session_id'))
        session = self.store.session(*identity)
        if not session or session.get('deleted'):
            return
        turn_id = 'system-' + row['client_request_id']
        summary = row['text'][:1600]
        # Worker evidence is useful here; the model's callback instructions are
        # implementation detail and must not become the user's error message.
        try:
            details = json.loads(row['text'].split('\n', 1)[1])
            if isinstance(details, dict):
                summary = '\n'.join(str(details[k]) for k in ('title', 'task_id', 'status', 'result', 'reason')
                                    if details.get(k))[:1600]
        except (IndexError, TypeError, ValueError):
            pass
        text = ('Automatic task notification (system): ' + reason +
                '\nThe supervisor has not verified or summarized this result. Saved task information:\n' + summary)
        item = {'id': turn_id + '-message', 'type': 'agentMessage', 'source': 'workbench-system',
                'phase': 'final', 'text': text, 'status': 'completed'}
        turn = {'id': turn_id, 'status': 'completed', 'source': 'workbench-system',
                'completedAt': time.time(), 'itemsView': 'full', 'items': [item]}
        with self.store.lock:
            self.store.connection.execute('INSERT OR IGNORE INTO supervisor_receipts VALUES(?,?,?,?,?)',
                (row['delivery_key'], *identity, json.dumps(turn)))
            self.store.connection.commit()
            saved = self.store.connection.execute('SELECT turn_json FROM supervisor_receipts WHERE delivery_key=?',
                (row['delivery_key'],)).fetchone()
        turn = json.loads(saved[0])
        params = {'threadId': session['thread_id'], 'turnId': turn_id, 'item': turn['items'][0]}
        entries = [(*identity, method, {'method': method, 'params': value}) for method, value in (
            ('history/item', params),
            ('history/turn', {'threadId': session['thread_id'], 'turn': {**turn, 'items': []}}),
            ('item/completed', params),
        )]
        before = self.store.event_highwater(*identity)
        events = self.store.append_events(entries)
        if events[-1]['seq'] <= before:
            return
        # Persist first; no runtime turn is fabricated or session status changed.
        for queue in tuple(self.bridge._subscribers.get(identity, ())):
            try:
                queue.put_nowait(events[-1])
            except asyncio.QueueFull:
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({'seq': events[-1]['seq'], 'type': 'resync_required'})

    def _terminal(self, identity, turn_id):
        with self.store.lock:
            records = self.store.connection.execute('''SELECT payload FROM codex_events
                WHERE user_id=? AND profile=? AND session_id=?
                AND method IN ('turn/completed','history/turn','history/turn-status')
                AND json_extract(payload,'$.params.turn.id')=? ORDER BY seq DESC LIMIT 1''',
                (*identity, turn_id)).fetchone()
            if not records:
                return None
            turn = json.loads(records[0])['params']['turn']
            if turn.get('status') not in {'completed', 'failed', 'interrupted'}:
                return None
            items = list(turn.get('items') or [])
            rows = self.store.connection.execute('''SELECT payload FROM codex_events
                WHERE user_id=? AND profile=? AND session_id=?
                AND method IN ('item/completed','history/item') AND json_extract(payload,'$.params.turnId')=?''',
                (*identity, turn_id)).fetchall()
            items.extend(json.loads(row[0]).get('params', {}).get('item', {}) for row in rows)
        visible = any(item.get('type') == 'agentMessage' and isinstance(item.get('text'), str)
                      and item['text'].strip() and item.get('phase') != 'commentary' for item in items if isinstance(item, dict))
        return 'delivered' if turn.get('status') == 'completed' and visible else 'failed'

    async def _accepted(self, identity, row, previous):
        turn_id = str(previous.get('turn_id') or '')
        terminal = self._terminal(identity, turn_id) if turn_id else None
        if terminal is None:
            try:
                await self.bridge.history(*identity, 0, 100)
            except Exception:
                pass
            terminal = self._terminal(identity, turn_id) if turn_id else None
        latest = self.store.request(*identity, row['client_request_id'])
        if latest and (latest.get('status') != 'accepted' or str(latest.get('turn_id') or '') != turn_id):
            # A bounded bridge overload retry may have replaced the failed
            # attempt while history was reconciled. Follow its current receipt.
            return self._update(row['delivery_key'], 'unknown' if latest.get('status') != 'accepted' else 'accepted',
                                turn_id=str(latest.get('turn_id') or ''))
        if terminal == 'failed':
            self._receipt(row, 'The supervisor could not finish its summary.')
            return self._update(row['delivery_key'], 'failed', turn_id=turn_id, error='Supervisor turn did not produce a completed answer')
        return self._update(row['delivery_key'], terminal or 'accepted', turn_id=turn_id)

    def _update(self, key: str, status: str, *, error: str = "", turn_id: str = "", delay: float = 0, attempted: bool = False) -> str:
        now = time.time()
        with self.store.lock:
            self.store.connection.execute(
                """UPDATE supervisor_inbox SET status=?,last_error=?,turn_id=?,
                    next_check_at=?,updated_at=?,attempts=attempts+? WHERE delivery_key=?""",
                (status, error, turn_id, now + delay, now, int(attempted), key),
            )
            self.store.connection.commit()
        return status

    async def drain(self, limit: int = 100) -> dict[str, int]:
        """Deliver each conversation in order; a busy conversation cannot block others."""
        if not isinstance(limit, int) or not 1 <= limit <= 1000:
            raise ValueError("Drain limit must be between 1 and 1000")
        with self.store.lock:
            rows = [dict(row) for row in self.store.connection.execute(
                """WITH heads AS (
                        SELECT *,ROW_NUMBER() OVER (
                            PARTITION BY user_id,profile,session_id ORDER BY created_at,delivery_key
                        ) AS position FROM supervisor_inbox WHERE status NOT IN ('delivered','failed')
                    ) SELECT * FROM heads WHERE position=1 AND next_check_at<=?
                    ORDER BY updated_at,created_at,delivery_key LIMIT ?""", (time.time(), limit)
            )]
        grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            grouped[tuple(row[k] for k in ("user_id", "profile", "session_id"))].append(row)

        async def session_rows(identity, pending):
            outcomes = []
            for row in pending:
                outcome = await self._deliver(identity, row)
                outcomes.append(outcome)
                if outcome != "accepted":
                    break
            return outcomes

        results = await asyncio.gather(*(session_rows(identity, pending) for identity, pending in grouped.items()))
        counts: dict[str, int] = {}
        for result in results:
            for status in result:
                counts[status] = counts.get(status, 0) + 1
        return counts

    async def _deliver(self, identity, row) -> str:
        key, request_id = row["delivery_key"], row["client_request_id"]
        # Reconcile an uncertain send from authoritative history, never by
        # assuming that a timeout or an empty response means it was rejected.
        previous = self.store.request(*identity, request_id)
        session = self.store.session(*identity)
        if previous and previous['status'] == 'accepted':
            return await self._accepted(identity, row, previous)
        if previous and previous["status"] in {"pending", "unknown"} and session and not session.get("deleted"):
            try:
                await self.bridge.history(*identity, 0, 100)
            except Exception:
                pass
        lock = self.bridge._session_locks.setdefault(identity, asyncio.Lock())
        if lock.locked():
            self._update(key, row["status"], error=row["last_error"])
            return "busy"
        async with lock:
            current = self.get(key)
            if current and current["status"] in {"delivered", "failed"}:
                return current['status']
            previous = self.store.request(*identity, request_id)
            if previous:
                status = previous["status"]
                if status == "accepted":
                    return self._update(key, "accepted", turn_id=str(previous.get("turn_id") or ""))
                # The bridge may reconcile or perform its bounded overload
                # retry independently. Keep watching its durable request id.
                if status == 'failed':
                    self._receipt(row, 'The supervisor could not accept the notification.')
                elif time.time() - row['created_at'] >= 30:
                    self._receipt(row, 'Delivery to the supervisor is unconfirmed; it will not be sent twice.')
                return self._update(key, "failed" if status == "failed" else "unknown",
                                    error="Upstream rejected the notification" if status == "failed" else "Acceptance has not been confirmed",
                                    delay=30)
            session = self.store.session(*identity)
            if session is None or session.get("deleted"):
                return self._update(key, "unavailable", error="Original supervisor session is unavailable", delay=30)
            if str(session.get("thread_id", "")).startswith("pending:"):
                return self._update(key, "unavailable", error="Original supervisor thread is not initialized", delay=30)
            if (session.get("status") not in {"idle", "completed", "failed", "error", "interrupted"}
                    or self.store.has_active_submission(*identity)
                    or self.store.has_active_approval(*identity)):
                self._update(key, row["status"], error=row["last_error"])
                return "busy"
            try:
                result = await self.bridge._submit_once(*identity, {
                    "clientRequestId": request_id, "text": "Automatic task update.",
                    "_supervisorContext": row["text"],
                })
            except Exception as exc:
                # A failure before the bridge recorded a request can retry.
                # Once the bridge has a request, its acceptance is authoritative.
                previous = self.store.request(*identity, request_id)
                status = "unknown" if previous else "pending"
                return self._update(key, status, error=type(exc).__name__, delay=30, attempted=True)
            status = str(result.get("status") or "unknown")
            if status == "accepted":
                return self._update(key, "accepted", turn_id=str(result.get("turn_id") or ""), attempted=True)
            if status == 'failed':
                self._receipt(row, 'The supervisor could not accept the notification.')
            return self._update(key, "failed" if status == "failed" else "unknown",
                                error="Upstream rejected the notification" if status == "failed" else "Acceptance has not been confirmed",
                                delay=30, attempted=True)
