"""Profile-local memory, skill editing, and explicitly declarative MCP config."""

from __future__ import annotations

import io
import json
import stat
import uuid
import zipfile
from urllib.parse import urlsplit

from fastapi import Request

from .core import (
    MAX_UPLOAD,
    body,
    bounded_text,
    check_hints,
    fail,
    identifier,
    resolve,
    scope,
    upload_form,
)
from .files import Tree, binary, parts

MEMORY_NAMES = {"MEMORY.md", "USER.md", "SOUL.md", "AGENTS.md"}


def validate_mcp(value):
    if (
        not isinstance(value, dict)
        or set(value) != {"mcpServers"}
        or not isinstance(value["mcpServers"], dict)
    ):
        fail(
            422,
            "MCP config requires only an mcpServers object; plugin manifests are unsupported",
        )
    if len(value["mcpServers"]) > 32:
        fail(422, "Too many MCP servers")
    for name, config in value["mcpServers"].items():
        identifier(name)
        if not isinstance(config, dict):
            fail(422, "MCP server must be an object")
        if set(config) - {
            "command",
            "args",
            "env",
            "url",
            "headers",
            "transport",
            "enabled",
        }:
            fail(422, "Unsupported MCP server fields")
        transport = config.get("transport", "stdio" if "command" in config else "http")
        if transport not in ("stdio", "http"):
            fail(422, "Unsupported MCP transport")
        if "enabled" in config and not isinstance(config["enabled"], bool):
            fail(422, "enabled must be boolean")
        if transport == "stdio":
            if "url" in config or "headers" in config:
                fail(422, "stdio cannot have HTTP fields")
            if (
                not isinstance(config.get("command"), str)
                or not config["command"].strip()
            ):
                fail(422, "MCP command required")
            if not isinstance(config.get("args", []), list) or any(
                not isinstance(a, str) for a in config.get("args", [])
            ):
                fail(422, "MCP args must be strings")
        else:
            if any(k in config for k in ("command", "args", "env")):
                fail(422, "HTTP MCP cannot have stdio fields")
            try:
                url = urlsplit(config.get("url", ""))
            except ValueError:
                fail(422, "Invalid MCP URL")
            if (
                url.scheme not in ("http", "https")
                or not url.hostname
                or url.username
                or url.password
                or url.fragment
                or url.query
            ):
                fail(
                    422, "MCP HTTP URL required; credentials belong in backend headers"
                )
        for field in ("env", "headers"):
            if field in config and (
                not isinstance(config[field], dict)
                or any(
                    not isinstance(k, str)
                    or not isinstance(v, str)
                    or "\n" in k
                    or "\r" in k
                    or (field == "headers" and ("\n" in v or "\r" in v))
                    for k, v in config[field].items()
                )
            ):
                fail(422, f"MCP {field} must contain string pairs")
    bounded_text(json.dumps(value), 128 * 1024)
    return value


def redact_mcp(value):
    result = json.loads(json.dumps(value))
    for config in result.get("mcpServers", {}).values():
        for field in ("env", "headers"):
            if field in config:
                config[field] = {k: "[REDACTED]" for k in config[field]}
    return result


class Config:
    def __init__(self, services):
        self.services, self.store = services, services.store

    def tree(self, c):
        return Tree(self.store.directory(c, "skills", profile=True))

    def skill(self, c, skill):
        identifier(skill)
        return Tree(self.store.directory(c, "skills", profile=True) / skill)

    def memory(self, c):
        return self.store.get(
            scope(c, True),
            "config",
            "memory",
            {"files": {name: "" for name in sorted(MEMORY_NAMES)}, "version": 0},
        )

    def selected(self, c):
        return self.store.get(
            scope(c, True),
            "config",
            "selection",
            {"skills": [], "memory": sorted(MEMORY_NAMES), "mcp": []},
        )

    def build(self, c):
        selected = self.selected(c)
        memory = self.memory(c)
        skills = []
        for skill in selected["skills"]:
            tree = self.skill(c, skill)
            entry = tree.text("SKILL.md")
            skills.append(
                {
                    "name": skill,
                    "root": str(tree.root),
                    "content": entry["content"],
                    "version": entry["version"],
                }
            )
        mcp = self.store.get(scope(c, True), "config", "mcp", {"mcpServers": {}})
        servers = {}
        for name in selected["mcp"]:
            if name not in mcp["mcpServers"]:
                fail(409, "Selected MCP server no longer exists")
            if mcp["mcpServers"][name].get("enabled", True):
                servers[name] = mcp["mcpServers"][name]
        return {
            "memory": {k: memory["files"][k] for k in selected["memory"]},
            "skills": skills,
            "mcpServers": servers,
            "workspace": c["workspace"],
        }


def mount_config(router, services):
    config = services.config

    async def ctx(request):
        return await resolve(services.resolver, request)

    @router.get("/memory")
    async def memory(request: Request):
        return config.memory(await ctx(request))

    @router.put("/memory")
    async def save_memory(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"files", "version"})
        files = b.get("files")
        if not isinstance(files, dict) or not files or set(files) - MEMORY_NAMES:
            fail(422, "Unsupported memory file")
        for content in files.values():
            bounded_text(content, 128 * 1024)
        with config.store.transaction() as db:
            old = config.store.get(
                scope(c, True),
                "config",
                "memory",
                {"files": {name: "" for name in sorted(MEMORY_NAMES)}, "version": 0},
                db,
            )
            if b.get("version") != old["version"]:
                fail(409, "Memory changed; reload before saving")
            return config.store.put(
                scope(c, True),
                "config",
                "memory",
                {"files": {**old["files"], **files}, "version": old["version"] + 1},
                db,
            )

    @router.get("/mcp")
    async def mcp(request: Request):
        c = await ctx(request)
        value = config.store.get(scope(c, True), "config", "mcp", {"mcpServers": {}})
        return {"config": redact_mcp(value), "status": "configured", "executed": False}

    @router.put("/mcp")
    async def save_mcp(request: Request):
        c = await ctx(request)
        value = validate_mcp(await body(request, c, {"mcpServers"}))
        # Redacted values are never persisted as replacement secrets.
        if "[REDACTED]" in json.dumps(value):
            fail(
                422,
                "Submit backend credentials explicitly; redacted placeholders cannot be saved",
            )
        config.store.put(scope(c, True), "config", "mcp", value)
        return {"config": redact_mcp(value), "status": "configured", "executed": False}

    @router.get("/runtime-context")
    async def selected(request: Request):
        return config.selected(await ctx(request))

    @router.put("/runtime-context")
    async def select(request: Request):
        c = await ctx(request)
        value = await body(request, c, {"memory", "skills", "mcp"})
        if set(value) != {"memory", "skills", "mcp"}:
            fail(422, "memory, skills, and mcp selections required")
        for key, names in value.items():
            if (
                not isinstance(names, list)
                or len(names) > 64
                or any(not isinstance(n, str) for n in names)
                or len(set(names)) != len(names)
            ):
                fail(422, "Unique selection lists required")
        if set(value["memory"]) - MEMORY_NAMES:
            fail(422, "Unsupported memory selection")
        for name in value["skills"]:
            config.skill(c, name).text("SKILL.md")
        mcp_config = config.store.get(
            scope(c, True), "config", "mcp", {"mcpServers": {}}
        )
        if set(value["mcp"]) - set(mcp_config["mcpServers"]):
            fail(422, "Unknown MCP server")
        return config.store.put(scope(c, True), "config", "selection", value)

    @router.get("/skills/files")
    async def skills(request: Request, skill: str = "", path: str = ""):
        c = await ctx(request)
        if skill:
            return config.skill(c, skill).listing(path)
        selected = config.selected(c)["skills"]
        rows = []
        for entry in config.tree(c).listing()["entries"]:
            if entry["type"] != "directory":
                continue
            name = entry["name"]
            rows.append(
                {
                    "name": name,
                    "source": "standalone",
                    "enabled": name in selected,
                    "file_count": len(config.skill(c, name).all_files()),
                }
            )
        return {"skills": rows}

    @router.get("/skills/files/tree")
    async def skill_tree(request: Request, skill: str, path: str = ""):
        return config.skill(await ctx(request), skill).listing(path)

    @router.get("/skills/files/file")
    @router.get("/skills/files/content")
    async def skill_file(request: Request, skill: str, path: str = "SKILL.md"):
        return config.skill(await ctx(request), skill).text(path)

    @router.get("/skills/files/preview")
    @router.get("/skills/files/download")
    async def preview(request: Request, skill: str, path: str):
        tree = config.skill(await ctx(request), skill)
        return binary(
            tree.read(path, MAX_UPLOAD), path, request.url.path.endswith("/download")
        )

    @router.put("/skills/files/text")
    async def skill_text(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"skill", "path", "content", "version", "mode"})
        if b.get("mode") not in ("create", "replace"):
            fail(422, "Explicit create or replace mode required")
        return config.skill(c, b.get("skill")).write(
            b.get("path"),
            bounded_text(b.get("content")).encode(),
            b.get("version"),
            b["mode"] == "create",
        )

    @router.post("/skills/files/mkdir")
    async def mkdir(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"skill", "path", "mode"})
        if b.get("mode", "create") != "create":
            fail(422, "Only create mode supported")
        identifier(b.get("skill"))
        return (
            config.skill(c, b["skill"]).mkdir(b["path"])
            if b.get("path")
            else config.tree(c).mkdir(b["skill"])
        )

    @router.post("/skills/files/skill")
    @router.delete("/skills/files/skill")
    @router.post("/skills/files/skill/move")
    async def skill_mutation(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"skill", "name", "content", "destination", "mode"})
        name = identifier(b.get("skill", b.get("name")))
        tree = config.tree(c)
        if request.method == "DELETE":
            return tree.remove(name)
        if request.url.path.endswith("/move"):
            return tree.move(name, identifier(b.get("destination")))
        if b.get("mode", "create") != "create":
            fail(422, "Only create mode supported")
        if "content" in b:
            bounded_text(b["content"])
        tree.mkdir(name)
        if "content" in b:
            config.skill(c, name).write("SKILL.md", b["content"].encode(), create=True)
        return {"name": name}

    @router.delete("/skills/files/node")
    async def delete(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"skill", "path"})
        return config.skill(c, b.get("skill")).remove(b.get("path"))

    @router.post("/skills/files/move")
    @router.post("/skills/files/rename")
    @router.post("/skills/files/copy")
    async def move(request: Request):
        c = await ctx(request)
        b = await body(request, c, {"skill", "source", "destination", "mode"})
        if b.get("mode", "create") != "create":
            fail(422, "Only create mode supported")
        tree = config.skill(c, b.get("skill"))
        if request.url.path.endswith("/copy"):
            return tree.copy(b.get("source"), b.get("destination"))
        return tree.move(b.get("source"), b.get("destination"))

    @router.post("/skills/files/upload")
    @router.post("/skills/files/archive")
    async def upload(request: Request):
        c = await ctx(request)
        async with upload_form(request, max_files=1, max_fields=10) as form:
            check_hints(c, form)
            name = identifier(form.get("skill"))
            mode = form.get("mode", "create")
            if mode not in ("create", "replace"):
                fail(422, "Invalid mode")
            file = form.get("file") or form.get("archive")
            if not hasattr(file, "read"):
                fail(422, "Upload required")
            data = await file.read(MAX_UPLOAD + 1)
            if len(data) > MAX_UPLOAD:
                fail(413, "Upload too large")
            if not request.url.path.endswith("/archive"):
                return config.skill(c, name).write(
                    form.get("path"), data, form.get("version"), mode == "create"
                )
            try:
                archive = zipfile.ZipFile(io.BytesIO(data))
                infos = archive.infolist()
                if len(infos) > 1000 or sum(i.file_size for i in infos) > MAX_UPLOAD:
                    fail(413, "Expanded archive too large")
                names = set()
                payload = {}
                for info in infos:
                    path = info.filename.rstrip("/")
                    parts(path)
                    if path in names:
                        fail(422, "Duplicate archive path")
                    names.add(path)
                    if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                        fail(422, "Archive links/encryption unsupported")
                    if not info.is_dir():
                        payload[path] = archive.read(info)
                if "SKILL.md" not in payload:
                    fail(422, "Archive must contain root SKILL.md")
            except (zipfile.BadZipFile, RuntimeError, OSError, ValueError):
                fail(422, "Invalid ZIP archive")
            staging = "stage_" + uuid.uuid4().hex
            root = config.tree(c)
            root.mkdir(staging)
            target = config.skill(c, staging)
            try:
                dirs = set()
                for path, contents in payload.items():
                    for i in range(1, len(path.split("/"))):
                        directory = "/".join(path.split("/")[:i])
                        if directory not in dirs:
                            target.mkdir(directory)
                            dirs.add(directory)
                    target.write(path, contents, create=True)
                # Existing roots are exchanged under the process lock; recovery backup is retained on failure.
                from .files import _LOCK

                with _LOCK:
                    exists = any(e["name"] == name for e in root.listing()["entries"])
                    if exists and mode == "create":
                        fail(409, "Skill already exists")
                    backup = "backup_" + uuid.uuid4().hex
                    if exists:
                        root.move(name, backup)
                    try:
                        root.move(staging, name)
                    except BaseException:
                        if exists:
                            root.move(backup, name)
                        raise
                    if exists:
                        root.remove(backup)
            finally:
                if (target.root).exists():
                    root.remove(staging)
            return {"name": name, "file_count": len(payload)}

    @router.get("/skills/files/archive")
    async def archive(request: Request, skill: str):
        tree = config.skill(await ctx(request), skill)
        stream = io.BytesIO()
        total = 0
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as output:
            for path in tree.all_files():
                data = tree.read(path, MAX_UPLOAD)
                total += len(data)
                if total > MAX_UPLOAD:
                    fail(413, "Archive too large")
                output.writestr(path, data)
        return binary(stream.getvalue(), skill + ".zip", True, "application/zip")
