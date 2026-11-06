"""Descriptor-relative workspace operations and a disposable, authenticated PTY."""

from __future__ import annotations

import asyncio
import codecs
import errno
import fcntl
import json
import mimetypes
import os
import re
import signal
import shutil
import stat
import struct
import subprocess
import termios
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import Response

from .core import MAX_TEXT, MAX_UPLOAD, bounded_text, body, digest, fail, resolve

_LOCK = threading.RLock()
_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
}
_SECRET = re.compile(
    r"(?:^|[._-])(?:auth|credentials?|secrets?|tokens?|api[-_]?keys?|private[-_]?keys?)(?:[._-]|$)",
    re.I,
)
_DENY = {
    ".git",
    ".ssh",
    ".gnupg",
    ".dsh",
    ".codex",
    ".hermes",
    ".netrc",
    ".npmrc",
    ".pypirc",
    "id_rsa",
    "id_ed25519",
    "known_hosts",
    "config.yaml",
}


def parts(raw: str, empty=False):
    if not isinstance(raw, str) or "\\" in raw or "\x00" in raw or len(raw) > 2048:
        fail(422, "Invalid relative path")
    if raw == "" and empty:
        return []
    values = raw.split("/")
    if (
        not raw
        or raw.startswith("/")
        or any(p in ("", ".", "..") for p in values)
        or len(values) > 32
    ):
        fail(403, "Path must be workspace relative")
    for p in values:
        lower = p.lower()
        if (
            lower in _DENY
            or lower == ".env"
            or (
                lower.startswith(".env.")
                and lower not in (".env.example", ".env.sample")
            )
            or _SECRET.search(lower)
            or lower.endswith((".pem", ".key", ".p12", ".pfx"))
        ):
            fail(403, "Sensitive path denied")
    return values


class Tree:
    """Reject symlinks in every component, including during open/rename operations."""

    def __init__(self, root, forbidden=()):
        self.root = Path(root)
        self.forbidden = tuple(Path(p).resolve() for p in forbidden)

    def allowed(self, raw):
        target = self.root.joinpath(*parts(raw, empty=True))
        for forbidden in self.forbidden:
            if target == forbidden or forbidden in target.parents:
                fail(403, "Internal service storage is not a workspace file")

    @contextmanager
    def parent(self, raw, empty=False):
        values = parts(raw, empty)
        self.allowed(raw)
        try:
            fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except FileNotFoundError:
            fail(404, "Root not found")
        except OSError:
            fail(403, "Unsafe root")
        try:
            for component in values[:-1]:
                new = os.open(
                    component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
                )
                os.close(fd)
                fd = new
            yield fd, values[-1] if values else "."
        except FileNotFoundError:
            fail(404, "File not found")
        except (NotADirectoryError, IsADirectoryError):
            fail(422, "Unexpected file type")
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.EACCES, errno.EPERM):
                fail(403, "Unsafe or inaccessible path")
            raise
        finally:
            os.close(fd)

    def read(self, raw, limit=MAX_TEXT):
        with self.parent(raw) as (parent, name):
            fd = os.open(
                name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent
            )
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode):
                    fail(422, "Regular file required")
                if info.st_size > limit:
                    fail(413, "File too large")
                with os.fdopen(fd, "rb", closefd=False) as stream:
                    data = stream.read(limit + 1)
                if len(data) > limit:
                    fail(413, "File too large")
                return data
            finally:
                os.close(fd)

    def text(self, raw):
        data = self.read(raw)
        try:
            content = data.decode("utf-8")
        except UnicodeError:
            fail(415, "UTF-8 text file required")
        if "\x00" in content:
            fail(415, "Binary file cannot be edited")
        return {
            "content": content,
            "version": digest(data),
            "size": len(data),
            "path": raw,
        }

    def write(self, raw, data, version=None, create=False):
        if len(data) > MAX_UPLOAD:
            fail(413, "File too large")
        with _LOCK, self.parent(raw) as (parent, name):
            # Advisory parent lock also serializes service processes on the same host.
            fcntl.flock(parent, fcntl.LOCK_EX)
            try:
                try:
                    current = self.read(raw, MAX_UPLOAD)
                except HTTPException as exc:
                    if exc.status_code != 404:
                        raise
                    current = None
                if create and current is not None:
                    fail(409, "File already exists")
                if not create and (
                    version is None or current is None or version != digest(current)
                ):
                    fail(409, "File changed; reload before saving")
                temporary = ".wb-" + uuid.uuid4().hex
                fd = os.open(
                    temporary,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=parent,
                )
                try:
                    with os.fdopen(fd, "wb") as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.rename(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
                    os.fsync(parent)
                finally:
                    try:
                        os.unlink(temporary, dir_fd=parent)
                    except FileNotFoundError:
                        pass
            finally:
                fcntl.flock(parent, fcntl.LOCK_UN)
        return {"path": raw, "size": len(data), "version": digest(data)}

    def mkdir(self, raw):
        with self.parent(raw) as (parent, name):
            try:
                os.mkdir(name, 0o700, dir_fd=parent)
            except FileExistsError:
                fail(409, "Directory already exists")
        return {"path": raw}

    def listing(self, raw=""):
        with self.parent(raw, empty=True) as (parent, name):
            fd = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
            )
            try:
                rows = []
                names = os.listdir(fd)
                if len(names) > 10000:
                    fail(413, "Directory has too many entries")
                for child in sorted(names):
                    path = f"{raw}/{child}" if raw else child
                    try:
                        parts(path)
                        self.allowed(path)
                    except HTTPException:
                        continue
                    info = os.stat(child, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISLNK(info.st_mode) or not (
                        stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)
                    ):
                        continue
                    rows.append(
                        {
                            "name": child,
                            "path": path,
                            "type": "directory"
                            if stat.S_ISDIR(info.st_mode)
                            else "file",
                            "size": info.st_size,
                            "modified_at": info.st_mtime,
                        }
                    )
                return {"path": raw, "entries": rows, "files": rows}
            finally:
                os.close(fd)

    def all_files(self, raw=""):
        result = []

        def visit(path):
            for item in self.listing(path)["entries"]:
                if item["type"] == "directory":
                    visit(item["path"])
                else:
                    result.append(item["path"])
                    if len(result) > 1000:
                        fail(413, "Too many files")

        visit(raw)
        return result

    def remove(self, raw):
        with self.parent(raw) as (parent, name):
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                fail(403, "Symlink denied")
            if stat.S_ISDIR(info.st_mode):
                # Do not follow links, including nodes hidden from the editor.
                fd = os.open(
                    name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
                )
                try:
                    children = os.listdir(fd)
                finally:
                    os.close(fd)
                for child in children:
                    self.remove(raw + "/" + child)
                os.rmdir(name, dir_fd=parent)
            else:
                os.unlink(name, dir_fd=parent)
        return {"deleted": raw}

    def copy(self, source, destination):
        parts(source)
        parts(destination)
        if destination == source or destination.startswith(source + "/"):
            fail(422, "Cannot copy a node into itself")
        with self.parent(source) as (parent, name):
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                fail(403, "Symlink denied")
        if not stat.S_ISDIR(info.st_mode):
            return self.write(destination, self.read(source, MAX_UPLOAD), create=True)
        # Validate and bound the complete copy before creating destination nodes.
        payload, total = {}, 0
        for path in self.all_files(source):
            data = self.read(path, MAX_UPLOAD)
            total += len(data)
            if total > MAX_UPLOAD:
                fail(413, "Directory copy too large")
            payload[path[len(source) + 1 :]] = data
        self.mkdir(destination)
        dirs = set()
        try:
            for path, data in payload.items():
                for i in range(1, len(path.split("/"))):
                    directory = destination + "/" + "/".join(path.split("/")[:i])
                    if directory not in dirs:
                        self.mkdir(directory)
                        dirs.add(directory)
                self.write(destination + "/" + path, data, create=True)
        except BaseException:
            self.remove(destination)
            raise
        return {"path": destination}

    def move(self, source, destination):
        parts(source)
        parts(destination)
        if destination.startswith(source + "/"):
            fail(422, "Cannot move a directory into itself")
        with (
            _LOCK,
            self.parent(source) as (src, name),
            self.parent(destination) as (dst, target),
        ):
            info = os.stat(name, dir_fd=src, follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                fail(403, "Symlink denied")
            try:
                os.stat(target, dir_fd=dst, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                fail(409, "Destination exists")
            os.rename(name, target, src_dir_fd=src, dst_dir_fd=dst)
        return {"path": destination}


def binary(data, name, download=False, mime=None):
    headers = dict(_HEADERS)
    if download:
        from urllib.parse import quote

        headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(
            Path(name).name
        )
    return Response(
        data,
        media_type=mime or mimetypes.guess_type(name)[0] or "application/octet-stream",
        headers=headers,
    )


def raster(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def developer_tools():
    """Expose installed developer binaries without inheriting user shell startup."""
    paths, roots = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"], []
    for tool in ("git", "node", "python3", "python"):
        executable = shutil.which(tool)
        if not executable:
            continue
        path = Path(executable)
        actual = path.resolve()
        paths.extend((str(path.parent), str(actual.parent)))
        roots.extend((str(path.parent), str(actual.parent)))
        # Standard runtime installations contain shared libraries alongside bin.
        # Do not allow a whole home directory merely because a shim lives there.
        if "/Cellar/" in str(actual):
            prefix, remainder = str(actual).split("/Cellar/", 1)
            package = remainder.split("/")[:2]
            roots.append(prefix + "/Cellar/" + "/".join(package))
        elif actual.parent.name == "bin" and actual.parent.parent.name not in (
            "usr",
            "local",
            ".local",
        ):
            roots.append(str(actual.parent.parent))
    roots.extend(
        (
            "/Library/Developer/CommandLineTools",
            "/Applications/Xcode.app/Contents/Developer",
        )
    )
    return list(dict.fromkeys(paths)), list(dict.fromkeys(roots))


def sandbox_shell(workspace, home, storage_root):
    """macOS seatbelt restricts even shell commands to this context's filesystem.

    The PTY is not a container. Fail closed on platforms without this sandbox;
    a host can supply a shell_command callback backed by its own OS sandbox.
    """
    import sys

    if sys.platform != "darwin" or not Path("/usr/bin/sandbox-exec").is_file():
        fail(503, "Shell requires a host filesystem sandbox on this platform")
    literal = json.dumps
    workspace, home, storage_root = (
        Path(p).resolve() for p in (workspace, home, storage_root)
    )
    system = [
        "/System",
        "/bin",
        "/sbin",
        "/usr/bin",
        "/usr/lib",
        "/usr/libexec",
        "/usr/share",
    ]
    _, tool_roots = developer_tools()
    readable = system + tool_roots + [str(workspace), str(home), "/dev"]
    writable = [str(workspace), str(home), "/dev"]

    def subpaths(paths):
        return " ".join("(subpath " + literal(path) + ")" for path in paths)

    # Directory ancestry is needed by dyld; regular file contents outside the
    # allowlist remain denied. Limit the filter to vnodes to preserve PTY/IPC fds.
    ancestors = {
        str(parent)
        for target in (
            workspace,
            home,
            Path("/usr/bin"),
            *(Path(p) for p in tool_roots),
        )
        for parent in target.parents
    }
    directory_paths = (
        subpaths(readable)
        + " "
        + " ".join("(literal " + literal(p) + ")" for p in ancestors)
    )
    profile = [
        "(version 1)",
        "(allow default)",
        "(deny network*)",
        "(deny file-read-data (require-all (vnode-type REGULAR-FILE) (require-not (require-any "
        + subpaths(readable)
        + "))))",
        "(deny file-read-data (require-all (vnode-type DIRECTORY) (require-not (require-any "
        + directory_paths
        + "))))",
        "(deny file-write* (require-not (require-any " + subpaths(writable) + ")))",
        "(deny file-read-data file-write* (require-all (subpath "
        + literal(str(storage_root))
        + ") (require-not (subpath "
        + literal(str(home))
        + "))))",
    ]
    relative_prefix = "^" + re.escape(str(workspace)) + r"/([^/]+/)*"
    for relative_pattern in [
        r"(\.env($|[./])|\.(ssh|gnupg|dsh|codex|hermes)(/|$)|secrets(/|$))",
        r"[^/]*(auth|credential|secret|token|api[_-]?key|private[_-]?key)[^/]*($|/)",
        r"(id_rsa|id_ed25519|\.netrc|\.npmrc|\.pypirc|config\.yaml)$",
        r"[^/]*\.(pem|key|p12|pfx)$",
    ]:
        # Seatbelt regex matching is case-sensitive. Expand ASCII letters while
        # keeping the trusted absolute prefix exact and matching relative nodes.
        folded = "".join(
            "[" + ch.lower() + ch.upper() + "]" if ch.isalpha() else ch
            for ch in relative_pattern
        )
        profile.append(
            "(deny file-read* file-write* (require-all (subpath "
            + literal(str(workspace))
            + ") (regex "
            + literal(relative_prefix + folded)
            + ")))"
        )
    return ["/usr/bin/sandbox-exec", "-p", "".join(profile), "/bin/sh", "-i"]


def descendant_pids(parent_pid):
    """Snapshot only numeric process relationships, never process arguments/env."""
    try:
        result = subprocess.run(
            ["/bin/ps", "-axo", "pid=,ppid="],
            capture_output=True,
            timeout=1,
            check=True,
            env={"PATH": "/usr/bin:/bin"},
        )
        pairs = [
            tuple(map(int, line.split()))
            for line in result.stdout.splitlines()
            if line.strip()
        ]
    except (OSError, ValueError, subprocess.SubprocessError):
        return set()
    children = set()
    frontier = {parent_pid}
    while frontier:
        frontier = {
            pid for pid, parent in pairs if parent in frontier and pid not in children
        }
        children.update(frontier)
    return children


def mount_files(router, services):
    async def ctx(request):
        return await resolve(services.resolver, request)

    @router.get("/workspace")
    async def workspace(request: Request):
        c = await ctx(request)
        return {
            "workspace": {
                "id": c["project_id"],
                "name": Path(c["workspace"]).name,
                "path": c["workspace"],
                "profile": c["profile_id"],
                "session_id": request.query_params.get("session", ""),
            }
        }

    @router.get("/files")
    async def files(request: Request, path: str = ""):
        c = await ctx(request)
        return services.workspace_tree(c).listing(path)

    @router.get("/file")
    async def file(request: Request, path: str):
        c = await ctx(request)
        return services.workspace_tree(c).text(path)

    @router.put("/file")
    async def save(request: Request, path: str):
        c = await ctx(request)
        b = await body(request, c, {"content", "version", "mode"})
        if b.get("mode", "replace") not in ("create", "replace"):
            fail(422, "Invalid mode")
        return services.workspace_tree(c).write(
            path,
            bounded_text(b.get("content")).encode(),
            b.get("version"),
            b.get("mode") == "create",
        )

    @router.get("/asset")
    async def asset(request: Request, path: str):
        c = await ctx(request)
        data = services.workspace_tree(c).read(path, MAX_UPLOAD)
        mime = raster(data)
        if mime is None:
            fail(415, "Only raster image previews are supported")
        return binary(data, path, mime=mime)

    @router.websocket("/shell")
    async def shell(ws: WebSocket):
        try:
            c = await ctx(ws)
        except HTTPException as exc:
            await ws.close(code=4401 if exc.status_code == 401 else 4403)
            return
        home = services.store.directory(c, "shell-home")
        try:
            if callable(services.callback("shell_command")):
                command = await services.runtime_call(
                    "shell_command", c, str(home), required=True
                )
            else:
                command = sandbox_shell(c["workspace"], home, services.store.root)
        except HTTPException:
            await ws.close(code=4503, reason="Filesystem sandbox unavailable")
            return
        await ws.accept()
        master, slave = os.openpty()
        # No inherited credentials, login scripts, or real shell history.
        env = {
            "PATH": ":".join(developer_tools()[0]),
            "TERM": "xterm-256color",
            "HOME": str(home),
            "TMPDIR": str(home),
            "PWD": c["workspace"],
            "LANG": "en_US.UTF-8",
            "HISTFILE": "/dev/null",
        }

        def child_setup():
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

        process = None
        tasks = []
        try:
            process = subprocess.Popen(
                command,
                cwd=c["workspace"],
                env=env,
                stdin=slave,
                stdout=slave,
                stderr=slave,
                close_fds=True,
                preexec_fn=child_setup,
            )
            os.close(slave)
            slave = -1
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
            os.set_blocking(master, False)

            async def output():
                decoder = codecs.getincrementaldecoder("utf-8")("replace")
                while True:
                    try:
                        chunk = os.read(master, 65536)
                        if not chunk:
                            return
                        await ws.send_text(decoder.decode(chunk))
                    except BlockingIOError:
                        if process.poll() is not None:
                            return
                        await asyncio.sleep(0.02)
                    except OSError:
                        return

            async def input_():
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    text = message.get("text")
                    data = message.get("bytes") or (text or "").encode()
                    if len(data) > 65536:
                        await ws.close(1009)
                        return
                    resize = None
                    if text and text.startswith("\x1b[RESIZE:") and text.endswith("]"):
                        resize = text[9:-1].split(";")
                    elif text and text.startswith("{"):
                        try:
                            obj = json.loads(text)
                        except ValueError:
                            obj = None
                        if isinstance(obj, dict) and obj.get("type") == "cancel":
                            os.killpg(process.pid, signal.SIGINT)
                            continue
                        if isinstance(obj, dict) and obj.get("type") == "resize":
                            resize = [obj.get("cols"), obj.get("rows")]
                    if resize is not None:
                        try:
                            cols, rows = [int(v) for v in resize]
                            if not (20 <= cols <= 500 and 5 <= rows <= 200):
                                raise ValueError()
                        except (ValueError, TypeError):
                            await ws.close(1008, "Invalid terminal size")
                            return
                        fcntl.ioctl(
                            master,
                            termios.TIOCSWINSZ,
                            struct.pack("HHHH", rows, cols, 0, 0),
                        )
                        continue
                    remaining = memoryview(data)
                    while remaining:
                        try:
                            remaining = remaining[os.write(master, remaining) :]
                        except BlockingIOError:
                            await asyncio.sleep(0.01)

            tasks = [asyncio.create_task(output()), asyncio.create_task(input_())]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            # Shield teardown from ASGI disconnect cancellation so no child survives.
            import anyio

            with anyio.CancelScope(shield=True):
                for task in tasks:
                    task.cancel()
                children = (
                    await asyncio.to_thread(descendant_pids, process.pid)
                    if process
                    else set()
                )
                if slave >= 0:
                    os.close(slave)
                os.close(master)
                if process:
                    # Kill tracked descendants even if the shell exits before them.
                    # Every PID came from this shell's ancestry, never a user process
                    # selected by name, executable, port, or a broad process pattern.
                    for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGKILL):
                        for pid in children:
                            try:
                                os.kill(pid, sig)
                            except ProcessLookupError:
                                pass
                        try:
                            os.killpg(process.pid, sig)
                        except ProcessLookupError:
                            pass
                        except PermissionError:
                            if process.poll() is None:
                                process.send_signal(sig)
                        if process.poll() is None:
                            try:
                                await asyncio.to_thread(process.wait, timeout=0.1)
                            except subprocess.TimeoutExpired:
                                pass
                        if sig != signal.SIGKILL:
                            await asyncio.sleep(0.02)
                    await asyncio.to_thread(process.wait)
                await asyncio.gather(*tasks, return_exceptions=True)
                try:
                    await ws.close()
                except (RuntimeError, WebSocketDisconnect):
                    pass
