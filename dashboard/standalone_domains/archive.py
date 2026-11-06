"""Explicit read-only transcript imports, never native/runtime resumptions."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import Request

from .core import MAX_UPLOAD, body, bounded_text, digest, fail, resolve, scope
from .files import Tree


class Archives:
    def __init__(self, services):
        self.services, self.store = services, services.store

    def get(self, c, archive_id):
        row = self.store.get(scope(c), "archives", archive_id)
        if row is None:
            fail(404, "Session not found")
        return row

    def summary(self, row):
        return {
            k: v
            for k, v in row.items()
            if k not in ("records", "messages", "original_document")
        }

    def list(self, c, q="", exclude_sources=""):
        excluded = exclude_sources.split(",")
        rows = [
            self.summary(r)
            for r in self.store.list(scope(c), "archives")
            if r["source"] not in excluded
            and (not q or q.casefold() in json.dumps(r, ensure_ascii=False).casefold())
        ]
        return sorted(
            rows, key=lambda r: (str(r.get("imported_at", "")), r["id"]), reverse=True
        )

    def import_path(self, c, path, source, title=""):
        if source not in ("hermes", "codex"):
            fail(422, "Source must be hermes or codex")
        raw_path = Path(path)
        root = Path(c["workspace"])
        relative = path
        if raw_path.is_absolute():
            candidates = [root, *(Path(p).resolve() for p in c.get("import_roots", []))]
            for candidate in candidates:
                try:
                    relative = str(raw_path.relative_to(candidate))
                    root = candidate
                    break
                except ValueError:
                    continue
            else:
                fail(403, "Import path is outside allowed roots")
        data = Tree(root, forbidden=(self.store.root,)).read(relative, MAX_UPLOAD)
        try:
            text = data.decode("utf-8")
            try:
                original = json.loads(text)
            except ValueError:
                original = [
                    json.loads(line) for line in text.splitlines() if line.strip()
                ]
        except (ValueError, UnicodeError):
            fail(422, "Transcript must be UTF-8 JSON or JSONL")
        records = (
            original.get(
                "messages",
                [original] if original.get("type") or original.get("role") else None,
            )
            if isinstance(original, dict)
            else original
        )
        if (
            not isinstance(records, list)
            or not records
            or len(records) > 50000
            or any(not isinstance(r, dict) for r in records)
        ):
            fail(422, "Transcript requires nonempty message records")
        messages = []
        for index, record in enumerate(records):
            payload = record.get("payload", record)
            if not isinstance(payload, dict):
                continue
            role = payload.get("role")
            if role not in ("user", "assistant", "system", "tool", "developer"):
                continue
            content = payload.get("content", payload.get("text", ""))
            messages.append(
                {
                    **payload,
                    "id": str(payload.get("id", f"record-{index}")),
                    "role": role,
                    "content": content,
                    "timestamp": record.get("timestamp", payload.get("timestamp")),
                    "record_index": index,
                    "original_record": record,
                }
            )
        if not messages:
            fail(422, "No supported transcript messages found")
        source_hash = digest(data)
        aid = "archive_" + digest((source + ":" + source_hash).encode())[:40]
        from datetime import datetime, timezone

        row = {
            "id": aid,
            "session_id": aid,
            "source": source,
            "runtime": "archive",
            "read_only": True,
            "resumable": False,
            "title": bounded_text(title, 500) or f"{source} archive",
            "source_hash": source_hash,
            "source_id": str(original.get("id", original.get("session_id", "")))
            if isinstance(original, dict)
            else "",
            "created_at": original.get("created_at")
            if isinstance(original, dict)
            else records[0].get("timestamp"),
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "records": records,
            "messages": messages,
            "original_document": original,
            "message_count": len(messages),
        }
        with self.store.transaction() as db:
            existing = self.store.get(scope(c), "archives", aid, None, db)
            if existing:
                return self.summary(existing)
            self.store.put(scope(c), "archives", aid, row, db)
        return self.summary(row)

    def select_context(self, c, archive_id, indexes):
        row = self.get(c, archive_id)
        if (
            not isinstance(indexes, list)
            or not indexes
            or len(indexes) > 100
            or any(type(i) is not int for i in indexes)
            or len(set(indexes)) != len(indexes)
        ):
            fail(422, "Choose 1 to 100 unique message indexes")
        if any(i < 0 or i >= len(row["messages"]) for i in indexes):
            fail(422, "Message index out of range")
        selected = [
            {"role": m["role"], "content": m["content"], "source_message_id": m["id"]}
            for i, m in enumerate(row["messages"])
            if i in indexes
        ]
        bounded_text(json.dumps(selected), 256 * 1024)
        return {
            "type": "archive_context",
            "archive_id": archive_id,
            "source": row["source"],
            "source_hash": row["source_hash"],
            "messages": selected,
            "resumable": False,
        }


def mount_archive(router, services):
    archives = services.archives

    @router.post("/archives/import")
    async def import_(request: Request):
        c = await resolve(services.resolver, request)
        b = await body(request, c, {"path", "source", "title"})
        if not isinstance(b.get("path"), str):
            fail(422, "Explicit local path required")
        return {
            "session": archives.import_path(
                c, b["path"], b.get("source"), b.get("title", "")
            )
        }

    @router.post("/archives/{archive_id}/new-session")
    async def new_session(request: Request, archive_id: str):
        c = await resolve(services.resolver, request)
        b = await body(request, c, {"indexes", "request_id"})
        return {
            "session": await services.create_session_from_archive(
                c, archive_id, b.get("indexes"), b.get("request_id")
            )
        }

    @router.get("/archives")
    async def list_(request: Request, q: str = ""):
        c = await resolve(services.resolver, request)
        return {"sessions": archives.list(c, q)}

    @router.post("/archives/{archive_id}/context")
    async def select(request: Request, archive_id: str):
        c = await resolve(services.resolver, request)
        b = await body(request, c, {"indexes"})
        return {"context": archives.select_context(c, archive_id, b.get("indexes"))}


def mount_archive_extra(router, services):
    archives = services.archives

    async def c(request):
        return await resolve(services.resolver, request)

    @router.get("/api/profiles/sessions")
    async def list_(
        request: Request, limit: int = 100, offset: int = 0, exclude_sources: str = ""
    ):
        if not 1 <= limit <= 500 or offset < 0:
            fail(422, "Invalid pagination")
        rows = archives.list(await c(request), exclude_sources=exclude_sources)
        return {"sessions": rows[offset : offset + limit], "total": len(rows)}

    @router.get("/api/sessions/search")
    async def search(
        request: Request, q: str = "", limit: int = 100, exclude_sources: str = ""
    ):
        if not 1 <= limit <= 500:
            fail(422, "Invalid limit")
        rows = archives.list(await c(request), bounded_text(q, 1000), exclude_sources)
        return {"results": rows[:limit], "total": len(rows)}

    @router.get("/api/sessions/{archive_id}/messages")
    async def messages(
        request: Request,
        archive_id: str,
        limit: int = 500,
        offset: int = 0,
        order: str = "",
    ):
        if not 1 <= limit <= 500 or offset < 0 or order not in ("", "latest"):
            fail(422, "Invalid pagination")
        row = archives.get(await c(request), archive_id)
        values = row["messages"]
        page = (
            values[max(0, len(values) - offset - limit) : len(values) - offset]
            if order == "latest"
            else values[offset : offset + limit]
        )
        return {
            "session_id": archive_id,
            "messages": page,
            "pagination": {"returned": len(page), "total": len(values)},
        }

    @router.get("/api/sessions/{archive_id}/export")
    async def export(request: Request, archive_id: str):
        return archives.get(await c(request), archive_id)

    @router.get("/api/sessions/{archive_id}/latest-descendant")
    async def descendant(request: Request, archive_id: str):
        archives.get(await c(request), archive_id)
        return {"session_id": archive_id, "path": [archive_id]}

    @router.get("/api/sessions/{archive_id}")
    async def detail(request: Request, archive_id: str):
        return archives.summary(archives.get(await c(request), archive_id))
