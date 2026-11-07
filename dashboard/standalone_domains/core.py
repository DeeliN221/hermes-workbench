"""Trusted context, bounded input, and transactional isolated persistence."""

from __future__ import annotations

import hashlib
import inspect
import json
import re
import sqlite3
import threading
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any

from fastapi import HTTPException

MAX_TEXT = 2 * 1024 * 1024
MAX_UPLOAD = 20 * 1024 * 1024
ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def fail(status: int, message: str):
    raise HTTPException(status, message)


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value):
        fail(422, "Invalid identifier")
    return value


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


async def invoke(call, *args, **kwargs):
    result = call(*args, **kwargs)
    return await result if inspect.isawaitable(result) else result


def validate_context(value: Any) -> dict:
    if not isinstance(value, dict) or any(
        not isinstance(value.get(k), str) or not value[k].strip()
        for k in ("user_id", "profile_id", "project_id")
    ):
        fail(401, "Authenticated context required")
    try:
        root = Path(value["workspace"]).resolve(strict=True)
    except (KeyError, TypeError, OSError, RuntimeError):
        fail(403, "Resolved workspace unavailable")
    if not root.is_dir():
        fail(403, "Resolved workspace unavailable")
    return {**value, "workspace": str(root)}


def check_hints(context: dict, values) -> None:
    for key, trusted in [
        ("user_id", "user_id"),
        ("profile", "profile_id"),
        ("profile_id", "profile_id"),
        ("project", "project_id"),
        ("project_id", "project_id"),
        ("workspace", "workspace"),
    ]:
        if (
            key in values
            and values[key] is not None
            and str(values[key]) != context[trusted]
        ):
            fail(403, "Requested scope does not match authenticated context")


async def resolve(resolver, request):
    context = validate_context(await invoke(resolver, request))
    check_hints(context, request.query_params)
    return context


async def body(request, context, allowed: set[str] | None = None):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_TEXT + 8192:
            fail(413, "Request too large")
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        fail(422, "JSON object required")
    if not isinstance(value, dict):
        fail(422, "JSON object required")
    check_hints(context, value)
    scope_keys = {
        "user_id",
        "profile",
        "profile_id",
        "project",
        "project_id",
        "workspace",
    }
    if allowed is not None and set(value) - allowed - scope_keys:
        fail(
            422,
            "Unsupported fields: "
            + ", ".join(sorted(set(value) - allowed - scope_keys)),
        )
    return {k: v for k, v in value.items() if k not in scope_keys}


@asynccontextmanager
async def upload_form(request, max_files=100, max_fields=110):
    """Bound the wire stream before Starlette can spool an unbounded file to disk."""
    from starlette.formparsers import MultiPartException, MultiPartParser

    limit = MAX_UPLOAD + 256 * 1024
    length = request.headers.get("content-length")
    if length:
        try:
            size = int(length)
        except ValueError:
            fail(422, "Invalid Content-Length")
        if size < 0:
            fail(422, "Invalid Content-Length")
        if size > limit:
            fail(413, "Multipart upload too large")
    exceeded = False

    async def stream():
        nonlocal exceeded
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > limit:
                exceeded = True
                # Starlette closes partial temporary files on this exception.
                raise MultiPartException("Multipart upload too large")
            yield chunk

    parser = MultiPartParser(
        request.headers,
        stream(),
        max_files=max_files,
        max_fields=max_fields,
        max_part_size=65536,
    )
    try:
        form = await parser.parse()
    except MultiPartException:
        fail(
            413 if exceeded else 422,
            "Multipart upload too large" if exceeded else "Invalid multipart upload",
        )
    try:
        yield form
    finally:
        await form.close()


def bounded_text(value, maximum=MAX_TEXT):
    if not isinstance(value, str):
        fail(422, "Text required")
    if len(value.encode("utf-8")) > maximum:
        fail(413, "Text too large")
    return value


def scope(context, profile=False):
    return digest(
        json.dumps(
            [
                context[k]
                for k in (
                    ("user_id", "profile_id")
                    if profile
                    else ("user_id", "profile_id", "project_id")
                )
            ],
            ensure_ascii=False,
        ).encode()
    )


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.root / "services.sqlite3"
        if self.path.is_symlink():
            fail(403, "Unsafe storage database")
        self.lock = threading.RLock()
        with self.transaction() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS records (scope TEXT, domain TEXT, id TEXT, data TEXT NOT NULL, "
                "PRIMARY KEY(scope, domain, id))"
            )
        self.path.chmod(0o600)

    @contextmanager
    def transaction(self):
        with self.lock:
            db = sqlite3.connect(self.path, timeout=5)
            try:
                db.execute("BEGIN IMMEDIATE")
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise
            finally:
                db.close()

    def get(self, owner, domain, key, default=None, db=None):
        if db is None:
            with self.transaction() as conn:
                return self.get(owner, domain, key, default, conn)
        row = db.execute(
            "SELECT data FROM records WHERE scope=? AND domain=? AND id=?",
            (owner, domain, key),
        ).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, owner, domain, key, value, db=None):
        if db is None:
            with self.transaction() as conn:
                return self.put(owner, domain, key, value, conn)
        db.execute(
            "INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(scope,domain,id) DO UPDATE SET data=excluded.data",
            (owner, domain, key, json.dumps(value, ensure_ascii=False)),
        )
        return value

    def delete(self, owner, domain, key, db=None):
        if db is None:
            with self.transaction() as conn:
                return self.delete(owner, domain, key, conn)
        db.execute(
            "DELETE FROM records WHERE scope=? AND domain=? AND id=?",
            (owner, domain, key),
        )

    def list(self, owner, domain):
        with self.transaction() as db:
            return [
                json.loads(r[0])
                for r in db.execute(
                    "SELECT data FROM records WHERE scope=? AND domain=? ORDER BY id",
                    (owner, domain),
                )
            ]

    def directory(self, context, domain, profile=False):
        # Every component is server generated; the final root must remain isolated.
        target = self.root / scope(context, profile) / domain
        for part in (target.parent, target):
            if part.is_symlink():
                fail(403, "Unsafe storage directory")
            part.mkdir(mode=0o700, exist_ok=True)
        return target
