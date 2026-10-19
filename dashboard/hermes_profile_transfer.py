"""Copy one completed Codex projection between Hermes profile stores.

Profile stores are separate SQLite databases and their schemas can differ by
deployment age.  The copier therefore uses the intersection of columns in
each table and lets the target database rebuild its own FTS indexes through
its existing triggers.
"""
from __future__ import annotations

import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any


def profile_home(profile: str) -> Path:
    raw_root = os.environ.get("HERMES_WORKBENCH_HERMES_HOME", "").strip()
    if not raw_root:
        raise RuntimeError("HERMES_WORKBENCH_HERMES_HOME is not configured")
    root = Path(raw_root).expanduser()
    return root if profile == "default" else root / "profiles" / profile


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]


def _copy_rows(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    table: str,
    where: str,
    params: tuple[Any, ...],
    *,
    ignore: bool = False,
    exclude: set[str] | None = None,
) -> int:
    source_columns = _columns(source, table)
    target_columns = _columns(target, table)
    columns = [c for c in source_columns if c in target_columns and c not in (exclude or set())]
    if not columns:
        return 0
    rows = source.execute(f"SELECT {','.join(columns)} FROM {table} WHERE {where}", params).fetchall()
    if not rows:
        return 0
    marks = ",".join("?" for _ in columns)
    verb = "INSERT OR IGNORE" if ignore else "INSERT"
    target.executemany(f"{verb} INTO {table} ({','.join(columns)}) VALUES ({marks})", rows)
    return len(rows)


def hide_projection(profile: str, session_id: str) -> None:
    path = profile_home(profile) / "state.db"
    if not path.is_file():
        return
    conn = sqlite3.connect(path, timeout=30)
    try:
        columns = _columns(conn, "sessions")
        updates = [column for column in ("hidden", "archived") if column in columns]
        if updates:
            conn.execute(f"UPDATE sessions SET {','.join(f'{column}=1' for column in updates)} WHERE id=?", (session_id,))
            conn.commit()
    finally:
        conn.close()


def transfer_projection(source_profile: str, target_profile: str, session_id: str, *, hide_source: bool = True) -> dict[str, int]:
    """Copy a completed session projection and verify target row counts.

    The source remains available until every target row has been written.  It
    is marked hidden only after verification, so a failed copy cannot make the
    conversation disappear from both profiles.
    """
    if source_profile == target_profile:
        return {"sessions": 0, "messages": 0}
    source_path = profile_home(source_profile) / "state.db"
    target_path = profile_home(target_profile) / "state.db"
    if not source_path.is_file():
        return {"sessions": 0, "messages": 0}
    if not target_path.is_file():
        raise RuntimeError(f"target Hermes profile database is missing: {target_path}")
    source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True, timeout=30)
    target = sqlite3.connect(target_path, timeout=30)
    source.row_factory = sqlite3.Row
    target.row_factory = sqlite3.Row
    try:
        session = source.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if session is None:
            return {"sessions": 0, "messages": 0}
        existing_target = target.execute("SELECT 1 FROM sessions WHERE id=?", (session_id,)).fetchone()
        if existing_target:
            source_messages = source.execute("SELECT count(*) FROM messages WHERE session_id=?", (session_id,)).fetchone()[0]
            target_messages = target.execute("SELECT count(*) FROM messages WHERE session_id=?", (session_id,)).fetchone()[0]
            if source_messages != target_messages:
                raise RuntimeError("target Hermes profile already contains a conflicting session")
            if hide_source:
                hide_projection(source_profile, session_id)
            return {"sessions": 1, "messages": target_messages}
        target.execute("BEGIN")
        if "system_prompt_hash" in session.keys() and session["system_prompt_hash"] and "system_prompts" in _tables(source) and "system_prompts" in _tables(target):
            _copy_rows(source, target, "system_prompts", "hash=?", (session["system_prompt_hash"],), ignore=True)
        parent_id = session["parent_session_id"] if "parent_session_id" in session.keys() else None
        copied = {
            "sessions": _copy_rows(source, target, "sessions", "id=?", (session_id,)),
            "messages": _copy_rows(source, target, "messages", "session_id=? ORDER BY id", (session_id,), exclude={"id"}),
            "session_model_usage": _copy_rows(source, target, "session_model_usage", "session_id=?", (session_id,)),
            "codex_hermes_imports": _copy_rows(source, target, "codex_hermes_imports", "hermes_session_id=?", (session_id,), ignore=True),
        }
        if "profile_name" in _columns(target, "sessions"):
            target.execute("UPDATE sessions SET profile_name=? WHERE id=?", (target_profile, session_id))
        if parent_id and target.execute("SELECT 1 FROM sessions WHERE id=?", (parent_id,)).fetchone() is None:
            target.execute("UPDATE sessions SET parent_session_id=NULL WHERE id=?", (session_id,))
        # Review records have independent primary keys.  Generate new IDs and
        # reconnect learning todos to their copied outbox rows.
        outbox_ids: dict[str, str] = {}
        if "codex_hermes_review_outbox" in _tables(source) and "codex_hermes_review_outbox" in _tables(target):
            for row in source.execute("SELECT * FROM codex_hermes_review_outbox WHERE hermes_session_id=?", (session_id,)).fetchall():
                old_id = str(row["id"])
                new_id = str(uuid.uuid4())
                outbox_ids[old_id] = new_id
                cols = [c for c in _columns(source, "codex_hermes_review_outbox") if c in _columns(target, "codex_hermes_review_outbox") and c not in {"id"}]
                values = [row[c] for c in cols]
                cols.append("id"); values.append(new_id)
                marks = ",".join("?" for _ in cols)
                target.execute(f"INSERT INTO codex_hermes_review_outbox ({','.join(cols)}) VALUES ({marks})", values)
        if "codex_hermes_learning_todos" in _tables(source) and "codex_hermes_learning_todos" in _tables(target):
            for row in source.execute("SELECT * FROM codex_hermes_learning_todos WHERE hermes_session_id=?", (session_id,)).fetchall():
                cols = [c for c in _columns(source, "codex_hermes_learning_todos") if c in _columns(target, "codex_hermes_learning_todos") and c not in {"id", "outbox_id"}]
                values = [row[c] for c in cols]
                if "id" in _columns(target, "codex_hermes_learning_todos"):
                    cols.append("id"); values.append(str(uuid.uuid4()))
                if "outbox_id" in _columns(target, "codex_hermes_learning_todos"):
                    cols.append("outbox_id"); values.append(outbox_ids.get(str(row["outbox_id"]), str(row["outbox_id"])))
                marks = ",".join("?" for _ in cols)
                target.execute(f"INSERT OR IGNORE INTO codex_hermes_learning_todos ({','.join(cols)}) VALUES ({marks})", values)
        if "async_delegations" in _tables(source) and "async_delegations" in _tables(target):
            for row in source.execute("SELECT * FROM async_delegations WHERE origin_session=? OR origin_session_id=?", (session_id, session_id)).fetchall():
                cols = [c for c in _columns(source, "async_delegations") if c in _columns(target, "async_delegations") and c != "delegation_id"]
                values = [row[c] for c in cols]
                if "delegation_id" in _columns(target, "async_delegations"):
                    cols.append("delegation_id"); values.append(str(uuid.uuid4()))
                marks = ",".join("?" for _ in cols)
                target.execute(f"INSERT OR IGNORE INTO async_delegations ({','.join(cols)}) VALUES ({marks})", values)
        target.commit()
        actual = {
            "sessions": target.execute("SELECT count(*) FROM sessions WHERE id=?", (session_id,)).fetchone()[0],
            "messages": target.execute("SELECT count(*) FROM messages WHERE session_id=?", (session_id,)).fetchone()[0],
        }
        if actual["sessions"] != 1 or actual["messages"] != copied["messages"]:
            raise RuntimeError("target Hermes projection verification failed")
        # Hide only after the target is complete.  This is a separate source
        # transaction because the source connection is intentionally read-only.
        if hide_source:
            hide_projection(source_profile, session_id)
        return actual
    except Exception:
        target.rollback()
        raise
    finally:
        source.close()
        target.close()


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {str(row[0]) for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
