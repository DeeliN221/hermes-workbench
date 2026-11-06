"""Opaque, session-scoped attachments with bounded multipart and DSH references."""

from __future__ import annotations

import json
import base64
import uuid
from pathlib import Path
from urllib.parse import urlencode

from fastapi import Request

from .core import MAX_UPLOAD, check_hints, fail, identifier, resolve, scope, upload_form
from .files import Tree, binary, parts, raster
from .images import image_media, MAX_IMAGE, MAX_IMAGE_TOTAL, MAX_IMAGES


class Attachments:
    def __init__(self, services):
        self.services = services
        self.store = services.store

    def records(self, context, session_id):
        return [
            r
            for r in self.store.list(scope(context), "attachments")
            if r["session_id"] == session_id
        ]

    def record(self, context, session_id, attachment_id):
        identifier(attachment_id)
        row = self.store.get(scope(context), "attachments", attachment_id)
        if not row or row["session_id"] != session_id:
            fail(404, "Attachment not found")
        return row

    def card(self, context, row):
        card = {
            k: row[k]
            for k in ("id", "name", "size", "mimeType", "kind", "fileCount")
            if k in row
        }
        if row["mimeType"].startswith("image/"):
            card["src"] = (
                "/api/plugins/workbench/attachments/"
                + row["id"]
                + "/preview?"
                + urlencode(
                    {"profile": context["profile_id"], "session_id": row["session_id"]}
                )
            )
        return card

    async def resolve_inputs(self, context, session_id, attachment_ids):
        await self.services.require_session(context, session_id)
        if (
            not isinstance(attachment_ids, list)
            or len(attachment_ids) > 100
            or any(not isinstance(v, str) for v in attachment_ids)
            or len(set(attachment_ids)) != len(attachment_ids)
        ):
            fail(422, "Unique attachment id list required (maximum 100)")
        root = self.store.directory(context, "attachments")
        result = []
        image_count, image_total = 0, 0
        for aid in attachment_ids:
            row = self.record(context, session_id, aid)
            tree = Tree(root / row["id"])
            if row["kind"] == "folder":
                for path in row["paths"]:
                    tree.read(path, MAX_UPLOAD)
                result.append(
                    {
                        "type": "file",
                        "id": aid,
                        "path": str(root / aid),
                        "name": row["name"],
                        "kind": "folder",
                    }
                )
            else:
                data = tree.read("content", MAX_UPLOAD)
                mime = raster(data)
                is_image = (
                    mime is not None
                    or row["mimeType"].startswith("image/")
                    or Path(row["name"]).suffix.lower()
                    in (
                        ".png",
                        ".jpg",
                        ".jpeg",
                        ".gif",
                        ".webp",
                        ".svg",
                        ".avif",
                        ".bmp",
                    )
                )
                if is_image:
                    image_count += 1
                    image_total += len(data)
                    if (
                        image_count > MAX_IMAGES
                        or len(data) > MAX_IMAGE
                        or image_total > MAX_IMAGE_TOTAL
                    ):
                        fail(
                            413,
                            "Images are limited to four, 8 MiB each and 16 MiB total",
                        )
                    mime = image_media(data)
                    result.append(
                        {
                            "type": "image",
                            "media_type": mime,
                            "data": base64.b64encode(data).decode("ascii"),
                            "name": row["name"],
                        }
                    )
                else:
                    result.append(
                        {
                            "type": "file",
                            "id": aid,
                            "path": str(root / aid / "content"),
                            "mimeType": row["mimeType"],
                            "name": row["name"],
                            "size": len(data),
                        }
                    )
        return result


def mount_attachments(router, services):
    api = services.attachments

    async def context(request):
        c = await resolve(services.resolver, request)
        sid = request.query_params.get("session_id", "")
        await services.require_session(c, sid)
        return c, sid

    async def upload(request: Request):
        c, sid = await context(request)
        folder = request.url.path.endswith("/folder")
        async with upload_form(request) as form:
            check_hints(c, form)
            uploads = form.getlist("files") if folder else [form.get("file")]
            if (
                not uploads
                or len(uploads) > 100
                or any(not hasattr(f, "read") for f in uploads)
            ):
                fail(422, "Upload file required")
            if len(api.records(c, sid)) >= 100:
                fail(413, "Session attachment limit exceeded")
            name = str(
                form.get("name")
                or form.get("folder_name")
                or uploads[0].filename
                or "attachment"
            )
            # The display name can never become a storage path.
            name = Path(name.replace("\\", "/")).name[:200]
            if not name:
                fail(422, "Attachment name required")
            paths = []
            if folder:
                try:
                    paths = json.loads(str(form.get("paths", "[]")))
                except ValueError:
                    fail(422, "Folder paths must be a JSON list")
                if (
                    not isinstance(paths, list)
                    or len(paths) != len(uploads)
                    or any(not isinstance(v, str) for v in paths)
                    or len(set(paths)) != len(paths)
                ):
                    fail(422, "Unique path required for every folder file")
                for path in paths:
                    parts(path)
            aid = uuid.uuid4().hex
            root = api.store.directory(c, "attachments")
            tree = Tree(root)
            tree.mkdir(aid)
            target = Tree(root / aid)
            total, mime = 0, "application/octet-stream"
            try:
                directories = set()
                for index, upload_file in enumerate(uploads):
                    data = await upload_file.read(MAX_UPLOAD + 1)
                    total += len(data)
                    if total > MAX_UPLOAD:
                        fail(413, "Attachment exceeds 20 MiB")
                    path = paths[index] if folder else "content"
                    for i in range(1, len(path.split("/"))):
                        directory = "/".join(path.split("/")[:i])
                        if directory not in directories:
                            target.mkdir(directory)
                            directories.add(directory)
                    target.write(path, data, create=True)
                    if not folder:
                        declared_image = str(upload_file.content_type or "").startswith(
                            "image/"
                        ) or Path(name).suffix.lower() in (
                            ".png",
                            ".jpg",
                            ".jpeg",
                            ".gif",
                            ".webp",
                            ".svg",
                            ".avif",
                            ".bmp",
                        )
                        if raster(data) or declared_image:
                            if len(data) > MAX_IMAGE:
                                fail(413, "Image exceeds 8 MiB")
                            mime = image_media(data)
                        else:
                            mime = "application/octet-stream"
                row = {
                    "id": aid,
                    "session_id": sid,
                    "name": name,
                    "size": total,
                    "mimeType": mime,
                    "kind": "folder" if folder else "file",
                    **({"paths": paths, "fileCount": len(paths)} if folder else {}),
                }
                api.store.put(scope(c), "attachments", aid, row)
            except BaseException:
                tree.remove(aid)
                raise
        return {"attachment": api.card(c, row)}

    async def listing(request: Request):
        c, sid = await context(request)
        return {"attachments": [api.card(c, r) for r in api.records(c, sid)]}

    async def download(aid: str, request: Request):
        c, sid = await context(request)
        row = api.record(c, sid, aid)
        if row["kind"] == "folder":
            fail(422, "Download folder files individually")
        data = Tree(api.store.directory(c, "attachments") / aid).read(
            "content", MAX_UPLOAD
        )
        preview = request.url.path.endswith("/preview")
        mime = raster(data) if preview else row["mimeType"]
        if preview and not mime:
            fail(415, "Not a raster image")
        return binary(data, row["name"], download=not preview, mime=mime)

    for prefix in ("/attachments", "/codex/attachments"):
        # Compatibility alias is storage only; it never imports or starts Codex.
        router.add_api_route(prefix, listing, methods=["GET"])
        router.add_api_route(prefix, upload, methods=["POST"])
        router.add_api_route(prefix + "/folder", upload, methods=["POST"])
        router.add_api_route(prefix + "/{aid}/preview", download, methods=["GET"])
        router.add_api_route(prefix + "/{aid}/download", download, methods=["GET"])
