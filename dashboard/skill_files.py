"""Profile-isolated Hermes skill directory management for Workbench.

This module discovers skill directories, browses file trees, and performs controlled
filesystem operations. ``sidecar_app.TrustedProxyGate`` handles authentication;
API routes are rooted at ``/skills/files``. All paths must remain under the selected
profile's ``skills/<skill>`` directory, including global paths, symlinks, and archive members.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import mimetypes
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import stat
import tempfile
from typing import Any, Iterable, NoReturn
import uuid
import zipfile

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel


router = APIRouter()


def create_router() -> APIRouter:
    """Return the stateless skill-file router for sidecar integration."""

    return router

# File contents are bounded so an accidental editor request cannot consume the
# sidecar process. Archive limits apply to both compressed input and expanded
# output and are deliberately independent of the profile's disk quota.
_MAX_PROFILE_LENGTH = 128
_MAX_SKILL_LENGTH = 256
_MAX_PATH_LENGTH = 1024
_MAX_TEXT_BYTES = 8 * 1024 * 1024
_MAX_UPLOAD_BYTES = 128 * 1024 * 1024
_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
_MAX_ARCHIVE_MEMBERS = 4096
_MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024
_MAX_TREE_ENTRIES = 10000
_MAX_NAME_LENGTH = 255
_MAX_PROFILE_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_RESERVED_PROFILE_NAMES = frozenset(
    {
        "hermes",
        "default",
        "test",
        "tmp",
        "root",
        "sudo",
    }
)
_MAX_SKILL_NAME = re.compile(r"^[^/\\\x00]+$")
_EXCLUDED_SKILL_DIRS = frozenset(
    {
        ".git",
        ".github",
        ".hub",
        ".archive",
        ".curator_backups",
        ".venv",
        "venv",
        "node_modules",
        "site-packages",
        "__pycache__",
        ".tox",
        ".nox",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
    }
)
_SKILL_SUPPORT_DIRS = frozenset({"references", "templates", "assets", "scripts"})
_INLINE_HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}
_TEXT_SUFFIXES = {
    ".cjs",
    ".css",
    ".csv",
    ".html",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}


class TextWriteRequest(BaseModel):
    """Describe an explicit create or replace operation for UTF-8 text."""

    profile: str = "default"
    skill: str
    path: str
    content: str
    mode: str = "replace"
    version: str | None = None


class DirectoryRequest(BaseModel):
    """Describe directory creation within a skill; an empty path creates its root."""

    profile: str = "default"
    skill: str
    path: str = ""
    mode: str = "create"


class MoveRequest(BaseModel):
    """Describe moving a file or directory within a skill."""

    profile: str = "default"
    skill: str
    source: str
    destination: str
    mode: str = "create"


class DeleteRequest(BaseModel):
    """Describe deleting a node within a skill."""

    profile: str = "default"
    skill: str
    path: str


class SkillRequest(BaseModel):
    """Describe creating, deleting, or moving a skill root."""

    profile: str = "default"
    skill: str
    mode: str = "create"
    content: str | None = None
    new_skill: str | None = None


def _http_error(status_code: int, detail: str) -> NoReturn:
    """Raise a stable Chinese error used by every filesystem operation."""

    raise HTTPException(status_code=status_code, detail=detail)


def _normalize_profile(profile: str | None) -> str:
    """Validate and canonicalize a profile identifier without touching disk."""

    value = (profile or "default").strip()
    if value.casefold() in {"", "current", "default"}:
        return "default"
    value = value.casefold()
    if len(value) > _MAX_PROFILE_LENGTH or not _MAX_PROFILE_NAME.fullmatch(value):
        _http_error(400, "Invalid profile name")
    if value in _RESERVED_PROFILE_NAMES:
        _http_error(400, "Profile name is unavailable")
    return value


def _configured_instance_root() -> Path:
    """Resolve the Hermes data root used by the sidecar without creating it."""

    configured = (
        os.environ.get("HERMES_WORKBENCH_HERMES_HOME", "").strip()
        or os.environ.get("HERMES_HOME", "").strip()
    )
    try:
        # The workbench workspace root can point at a Codex checkout.  Skills
        # belong to the Hermes home, so an unset environment may use only the
        # documented container mount and must never silently use cwd().
        root = Path(configured).expanduser() if configured else Path("/opt/data")
        if root.is_symlink():
            _http_error(403, "Hermes data directory must not be a symbolic link")
        resolved = root.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        _http_error(500, f"Hermes data directory is unavailable: {exc}")
    if not resolved.is_dir() or resolved.is_symlink():
        _http_error(500, "Hermes data path is not a safe directory")
    return resolved


def _workspace_root() -> Path:
    """Expose the selected Hermes root under the sidecar's familiar helper name."""

    return _configured_instance_root()


def _lstat(path: Path) -> os.stat_result:
    """Read metadata without following a final symlink and map OS errors."""

    try:
        return path.lstat()
    except FileNotFoundError:
        _http_error(404, "Target does not exist")
    except OSError as exc:
        _http_error(400, f"Cannot access target: {exc}")


def _assert_real_directory(path: Path, *, missing_ok: bool = False) -> Path:
    """Require a real directory, rejecting symlinks even when they point inside root."""

    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        if missing_ok:
            return path
        _http_error(404, "Directory does not exist")
    except OSError as exc:
        _http_error(400, f"Cannot access directory: {exc}")
    if stat.S_ISLNK(mode):
        _http_error(403, "Directory access through symbolic links is not allowed")
    if not stat.S_ISDIR(mode):
        _http_error(400, "Target is not a directory")
    return path


def _assert_no_symlink_components(root: Path, target: Path, *, allow_missing: bool) -> None:
    """Check every existing component between root and target with ``lstat``."""

    try:
        relative = target.relative_to(root)
    except ValueError:
        _http_error(403, "Path is outside the skill directory")
    current = root
    for part in relative.parts:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            if allow_missing:
                return
            _http_error(404, "Target does not exist")
        except OSError as exc:
            _http_error(400, f"Cannot access path: {exc}")
        if stat.S_ISLNK(mode):
            _http_error(403, "Skill file access through symbolic links is not allowed")


# Hermes treats a directory under ``profiles/`` as a profile only when it carries one of
# these identity markers (``hermes_constants.named_profile_is_live``). Runtime side effects
# (log rotation, caches) and half-deleted profile shells carry none of them, and the Hermes
# dashboard answers their session reads with 404 — so never advertise them as agents.
_PROFILE_IDENTITY_MARKERS = ("config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db")


def _profile_has_identity(home: Path) -> bool:
    """Mirror of Hermes' owner-side rule: does ``home`` identify itself as a profile?"""

    return any((home / marker).is_file() or (home / marker).is_symlink()
               for marker in _PROFILE_IDENTITY_MARKERS)


def _profile_home(profile: str | None) -> tuple[str, Path]:
    """Resolve one profile beneath the configured Hermes root, never by fallback."""

    normalized = _normalize_profile(profile)
    root = _workspace_root()
    if normalized == "default":
        return normalized, root
    profiles_root = root / "profiles"
    _assert_real_directory(profiles_root)
    candidate = profiles_root / normalized
    _assert_real_directory(candidate)
    try:
        resolved_profiles = profiles_root.resolve(strict=True)
        resolved_candidate = candidate.resolve(strict=True)
        resolved_candidate.relative_to(resolved_profiles)
    except (OSError, RuntimeError, ValueError):
        _http_error(403, "Profile directory is outside the allowed scope")
    return normalized, resolved_candidate


def _skills_root(profile: str | None, *, create: bool = False) -> tuple[str, Path]:
    """Resolve the selected profile's ``skills`` directory with optional creation."""

    normalized, home = _profile_home(profile)
    skills = home / "skills"
    try:
        mode = skills.lstat().st_mode
    except FileNotFoundError:
        if not create:
            return normalized, skills
        try:
            skills.mkdir(mode=0o700)
        except OSError as exc:
            _http_error(500, f"Cannot create skill directory: {exc}")
        mode = skills.lstat().st_mode
    except OSError as exc:
        _http_error(400, f"Cannot access skill directory: {exc}")
    if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
        _http_error(403, "Skill path is not a safe directory")
    return normalized, skills


def _relative_path(raw: str | None, *, allow_empty: bool = False) -> PurePosixPath:
    """Validate one user path as a relative POSIX path with no traversal."""

    value = "" if raw is None else str(raw).strip()
    if "\x00" in value or len(value) > _MAX_PATH_LENGTH:
        _http_error(400, "Invalid path format")
    if not value:
        if allow_empty:
            return PurePosixPath()
        _http_error(400, "Path cannot be empty")
    # Reject Windows separators and drives on every host; browser clients can
    # otherwise make the same request mean different things on Windows/POSIX.
    if "\\" in value or PureWindowsPath(value).is_absolute() or PureWindowsPath(value).drive:
        _http_error(400, "Path must be relative to the skill directory")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        _http_error(400, "Path must be relative to the skill directory")
    if any(len(part) > _MAX_NAME_LENGTH for part in path.parts):
        _http_error(400, "Path name is too long")
    return path


def _skill_identifier(raw: str | None) -> PurePosixPath:
    """Validate a skill directory identifier, which may include categories."""

    path = _relative_path(raw)
    for part in path.parts:
        if (
            len(part) > _MAX_SKILL_LENGTH
            or not _MAX_SKILL_NAME.fullmatch(part)
            or part in _EXCLUDED_SKILL_DIRS
        ):
            _http_error(400, "Invalid skill name")
    return path


def _skill_relative_path(raw: str | None, *, allow_empty: bool = False) -> PurePosixPath:
    """Validate one relative path used by a skill file operation."""

    return _relative_path(raw, allow_empty=allow_empty)


def _skill_path(root: Path, skill: str | None, *, allow_missing: bool = False) -> tuple[PurePosixPath, Path]:
    """Resolve one categorized skill directory directly beneath ``skills``."""

    identifier = _skill_identifier(skill)
    target = root.joinpath(*identifier.parts)
    _assert_no_symlink_components(root, target, allow_missing=allow_missing)
    if target.exists() and not target.is_dir():
        _http_error(400, "Skill target is not a directory")
    if not allow_missing and not target.is_dir():
        _http_error(404, "Skill not found")
    if target.is_symlink():
        _http_error(403, "Skill access through symbolic links is not allowed")
    return identifier, target


def _tree_walk(root: Path, *, include_root: bool = False) -> Iterable[tuple[Path, os.stat_result]]:
    """Yield safe files and directories below root in deterministic order."""

    count = 0
    if include_root:
        yield root, _lstat(root)
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            entries = sorted(os.scandir(current), key=lambda entry: entry.name, reverse=True)
        except OSError as exc:
            _http_error(400, f"Cannot read directory: {exc}")
        for entry in entries:
            path = Path(entry.path)
            try:
                mode = entry.stat(follow_symlinks=False).st_mode
            except OSError as exc:
                _http_error(400, f"Cannot read file: {exc}")
            if stat.S_ISLNK(mode):
                _http_error(403, "Skill directory contains a disallowed symbolic link")
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                continue
            count += 1
            if count > _MAX_TREE_ENTRIES:
                _http_error(413, "Skill directory has too many entries")
            yield path, entry.stat(follow_symlinks=False)
            if stat.S_ISDIR(mode):
                stack.append(path)


def _parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Use Hermes' native parser when available, with a small safe fallback."""

    content = content.removeprefix("\ufeff")
    try:
        from agent.skill_utils import parse_frontmatter

        parsed, body = parse_frontmatter(content)
        return (parsed if isinstance(parsed, dict) else {}), body
    except Exception:
        # The fallback intentionally handles only scalar ``key: value`` fields;
        # discovery must remain usable when the optional Hermes source is absent.
        if not content.startswith("---"):
            return {}, content
        marker = re.search(r"\n---\s*\n", content[3:])
        if marker is None:
            return {}, content
        header = content[3 : marker.start() + 3]
        body = content[marker.end() + 3 :]
        values: dict[str, Any] = {}
        for line in header.splitlines():
            key, separator, value = line.partition(":")
            if separator and key.strip():
                values[key.strip()] = value.strip().strip("'\"")
        return values, body


def _skill_directories(root: Path) -> list[Path]:
    """Discover skill roots using baseline exclusions while refusing symlinks."""

    if not root.is_dir():
        return []
    result: list[Path] = []
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            entries = sorted(os.scandir(current), key=lambda entry: entry.name, reverse=True)
        except OSError as exc:
            _http_error(400, f"Cannot scan skill directory: {exc}")
        has_skill = any(entry.name == "SKILL.md" and entry.is_file(follow_symlinks=False) for entry in entries)
        for entry in entries:
            name = entry.name
            if name in _EXCLUDED_SKILL_DIRS:
                continue
            try:
                mode = entry.stat(follow_symlinks=False).st_mode
            except OSError as exc:
                _http_error(400, f"Cannot read skill directory: {exc}")
            if stat.S_ISLNK(mode):
                # A few host-managed skills are exposed as top-level links
                # into a workspace.  They are not safe to edit through this
                # API, so omit them from discovery instead of making the
                # entire skills tab fail with 403.  Direct file/tree access
                # remains strict and rejects symlink components.
                continue
            if not stat.S_ISDIR(mode):
                continue
            if has_skill and name in _SKILL_SUPPORT_DIRS:
                continue
            stack.append(Path(entry.path))
        if has_skill:
            result.append(current)
    return sorted(result, key=lambda path: path.relative_to(root).as_posix())


def _skill_meta(root: Path, skill_dir: Path) -> dict[str, Any]:
    """Build one dashboard skill row from the canonical ``SKILL.md`` file."""

    relative = skill_dir.relative_to(root)
    skill_file = skill_dir / "SKILL.md"
    name = skill_dir.name
    description = ""
    try:
        content = skill_file.read_text(encoding="utf-8")
        frontmatter, body = _parse_frontmatter(content[:_MAX_TEXT_BYTES])
        front_name = frontmatter.get("name")
        if isinstance(front_name, str) and front_name.strip():
            name = front_name.strip()
        raw_description = frontmatter.get("description", "")
        description = str(raw_description or "").strip()
        if not description:
            description = next(
                (line.strip() for line in body.splitlines() if line.strip() and not line.lstrip().startswith("#")),
                "",
            )
    except (OSError, UnicodeError):
        # A malformed or binary SKILL.md remains manageable by path; it should
        # not hide sibling skills from the listing.
        pass
    return {
        "name": name,
        "description": description,
        "path": relative.as_posix(),
        "category": relative.parts[0] if len(relative.parts) > 1 else None,
        "entry": "SKILL.md",
    }


def _find_skill(root: Path, identifier: str) -> tuple[PurePosixPath, Path]:
    """Find a skill only within the selected profile, by path or directory name."""

    requested = _skill_identifier(identifier)
    direct = root.joinpath(*requested.parts)
    if direct.is_dir() and not direct.is_symlink() and (direct / "SKILL.md").is_file():
        _assert_no_symlink_components(root, direct, allow_missing=False)
        _assert_no_symlink_components(root, direct / "SKILL.md", allow_missing=False)
        return requested, direct
    if len(requested.parts) > 1:
        _http_error(404, "Skill not found")
    matches: list[tuple[PurePosixPath, Path]] = []
    for candidate in _skill_directories(root):
        relative = candidate.relative_to(root)
        if candidate.name == requested.name:
            matches.append((PurePosixPath(relative.as_posix()), candidate))
            continue
        try:
            content = (candidate / "SKILL.md").read_text(encoding="utf-8")
            frontmatter, _body = _parse_frontmatter(content[:_MAX_TEXT_BYTES])
        except (OSError, UnicodeError):
            continue
        if str(frontmatter.get("name", "")).strip() == requested.as_posix():
            matches.append((PurePosixPath(relative.as_posix()), candidate))
    if not matches:
        _http_error(404, "Skill not found")
    _assert_no_symlink_components(root, matches[0][1], allow_missing=False)
    return matches[0]


def _node_path(skill_dir: Path, raw_path: str | None, *, allow_missing: bool = False) -> tuple[PurePosixPath, Path]:
    """Resolve a path inside one skill after validating every component."""

    relative = _relative_path(raw_path)
    target = skill_dir.joinpath(*relative.parts)
    _assert_no_symlink_components(skill_dir, target, allow_missing=allow_missing)
    if not allow_missing and not target.exists():
        _http_error(404, "File or directory does not exist")
    if target.is_symlink():
        _http_error(403, "File access through symbolic links is not allowed")
    return relative, target


def _entry(root: Path, path: Path, stat_result: os.stat_result | None = None) -> dict[str, Any]:
    """Return a stable tree entry for one already validated file-system node."""

    info = stat_result or _lstat(path)
    relative = path.relative_to(root).as_posix()
    is_directory = stat.S_ISDIR(info.st_mode)
    return {
        "name": path.name,
        "path": relative,
        "kind": "directory" if is_directory else "file",
        "size": 0 if is_directory else info.st_size,
        "mtime_ns": info.st_mtime_ns,
        "is_text": False if is_directory else _looks_text(path),
        "version": None if is_directory else _file_version(path),
    }


def _looks_text(path: Path) -> bool:
    """Classify likely text without trusting a client supplied MIME type."""

    if path.suffix.casefold() in _TEXT_SUFFIXES:
        return True
    try:
        sample = path.read_bytes()[:8192]
    except OSError:
        return False
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def _file_version(path: Path) -> str:
    """Return the SHA-256 content version used by browser optimistic writes."""

    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    except OSError as exc:
        _http_error(400, f"Cannot read file version: {exc}")
    return digest.hexdigest()


def _list_skills_sync(profile: str) -> dict[str, Any]:
    """List only skills in one profile's native skills directory."""

    normalized, root = _skills_root(profile)
    if not root.is_dir():
        return {"profile": normalized, "skills": []}
    skills: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    for path in _skill_directories(root):
        item = _skill_meta(root, path)
        if item["name"] in seen_names:
            continue
        seen_names.add(item["name"])
        skills.append(item)
    return {"profile": normalized, "skills": skills}


def _tree_sync(profile: str, skill: str, path: str) -> dict[str, Any]:
    """List one skill directory or a child directory as safe tree entries."""

    normalized, root = _skills_root(profile)
    _skill_id, skill_dir = _find_skill(root, skill)
    relative, target = (
        (PurePosixPath(), skill_dir)
        if not path.strip()
        else _node_path(skill_dir, path)
    )
    if not target.is_dir():
        _http_error(400, "Tree path is not a directory")
    entries: list[dict[str, Any]] = []
    for child in sorted(target.iterdir(), key=lambda item: item.name):
        mode = _lstat(child).st_mode
        if stat.S_ISLNK(mode):
            _http_error(403, "Skill directory contains a disallowed symbolic link")
        if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            continue
        entries.append(_entry(skill_dir, child, _lstat(child)))
    return {
        "profile": normalized,
        "skill": _skill_id.as_posix(),
        "path": relative.as_posix(),
        "kind": "directory",
        "entries": entries,
    }


def _read_text_sync(profile: str, skill: str, path: str) -> dict[str, Any]:
    """Read one UTF-8 file and reject binary content at the text endpoint."""

    normalized, root = _skills_root(profile)
    skill_id, skill_dir = _find_skill(root, skill)
    relative, target = _node_path(skill_dir, path)
    if not target.is_file():
        _http_error(400, "Target is not a file")
    try:
        data = target.read_bytes()
    except OSError as exc:
        _http_error(400, f"Cannot read file: {exc}")
    if len(data) > _MAX_TEXT_BYTES:
        _http_error(413, "Text file is too large")
    if b"\x00" in data:
        _http_error(415, "Target is binary; use the preview or download API")
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        _http_error(415, "Target is binary; use the preview or download API")
    info = _lstat(target)
    return {
        "profile": normalized,
        "skill": skill_id.as_posix(),
        "path": relative.as_posix(),
        "name": target.name,
        "content": content,
        "size": len(data),
        "mtime_ns": info.st_mtime_ns,
        "encoding": "utf-8",
        "content_type": mimetypes.guess_type(target.name)[0] or "text/plain",
        "version": _file_version(target),
    }


def _file_target_sync(profile: str, skill: str, path: str) -> tuple[str, PurePosixPath, Path]:
    """Resolve a file for preview/download and return normalized response fields."""

    normalized, root = _skills_root(profile)
    skill_id, skill_dir = _find_skill(root, skill)
    relative, target = _node_path(skill_dir, path)
    if not target.is_file():
        _http_error(400, "Target is not a file")
    return normalized, PurePosixPath(f"{skill_id.as_posix()}/{relative.as_posix()}"), target


def _validate_mode(mode: str | None) -> str:
    """Validate an explicit create/replace operation mode."""

    normalized = (mode or "").strip().casefold()
    if normalized not in {"create", "replace"}:
        _http_error(400, "Mode must be create or replace")
    return normalized


def _profile_override(model: BaseModel, profile: str | None) -> BaseModel:
    """Apply a query-string profile when a browser sends profile outside JSON."""

    if profile is None:
        return model
    model_copy = getattr(model, "model_copy", None)
    if callable(model_copy):
        return model_copy(update={"profile": profile})
    return model.copy(update={"profile": profile})


def _selected_skill(skill: str | None, name: str | None) -> str:
    """Accept the canonical ``skill`` query and the UI's ``name`` alias."""

    value = (skill or name or "").strip()
    if not value:
        _http_error(400, "Skill name is required")
    return value


def _atomic_write_bytes(
    target: Path, data: bytes, mode: str, expected_version: str | None = None
) -> None:
    """Write bytes atomically while honoring explicit create/replace semantics."""

    if len(data) > _MAX_UPLOAD_BYTES:
        _http_error(413, "Uploaded file is too large")
    exists = target.exists()
    if mode == "create" and exists:
        _http_error(409, "Target already exists; use replace")
    if mode == "replace" and not exists:
        _http_error(404, "Replacement target does not exist")
    if expected_version is not None:
        if not exists:
            _http_error(409, "File no longer exists; cannot save against its version")
        if _file_version(target) != expected_version:
            _http_error(409, "File changed elsewhere; read it again before saving")
    if target.exists() and not target.is_file():
        _http_error(400, "Target is not a regular file")
    parent = target.parent
    temporary: Path | None = None
    try:
        fd, name = tempfile.mkstemp(prefix=f".{target.name}.", dir=str(parent))
        temporary = Path(name)
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        temporary = None
    except OSError as exc:
        _http_error(500, f"Could not save file: {exc}")
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def _write_text_sync(request: TextWriteRequest) -> dict[str, Any]:
    """Create or replace one UTF-8 file in a selected skill."""

    mode = _validate_mode(request.mode)
    if len(request.content.encode("utf-8")) > _MAX_TEXT_BYTES:
        _http_error(413, "Text content is too large")
    normalized, root = _skills_root(request.profile)
    skill_id, skill_dir = _find_skill(root, request.skill)
    relative = _skill_relative_path(request.path)
    target = skill_dir.joinpath(*relative.parts)
    _assert_no_symlink_components(skill_dir, target, allow_missing=True)
    if not target.parent.is_dir():
        _http_error(400, "Parent directory does not exist; create it first")
    _atomic_write_bytes(target, request.content.encode("utf-8"), mode, request.version)
    info = _lstat(target)
    return {
        "ok": True,
        "profile": normalized,
        "skill": skill_id.as_posix(),
        "path": relative.as_posix(),
        "mode": mode,
        "size": info.st_size,
        "mtime_ns": info.st_mtime_ns,
        "version": _file_version(target),
    }


def _upload_sync(
    profile: str,
    skill: str,
    path: str,
    mode: str,
    data: bytes,
    expected_version: str | None = None,
) -> dict[str, Any]:
    """Create or replace one uploaded binary or text file."""

    normalized, root = _skills_root(profile)
    skill_id, skill_dir = _find_skill(root, skill)
    relative = _skill_relative_path(path)
    target = skill_dir.joinpath(*relative.parts)
    _assert_no_symlink_components(skill_dir, target, allow_missing=True)
    if not target.parent.is_dir():
        _http_error(400, "Parent directory does not exist; create it first")
    operation = _validate_mode(mode)
    _atomic_write_bytes(target, data, operation, expected_version)
    info = _lstat(target)
    return {
        "ok": True,
        "profile": normalized,
        "skill": skill_id.as_posix(),
        "path": relative.as_posix(),
        "mode": operation,
        "size": info.st_size,
        "mtime_ns": info.st_mtime_ns,
        "version": _file_version(target),
    }


def _mkdir_sync(request: DirectoryRequest) -> dict[str, Any]:
    """Create a skill root or a nested directory without following links."""

    mode = _validate_mode(request.mode)
    normalized, root = _skills_root(request.profile, create=True)
    skill_id = _skill_identifier(request.skill)
    skill_dir = root.joinpath(*skill_id.parts)
    if request.path.strip():
        if not skill_dir.is_dir():
            _http_error(404, "Skill not found")
        relative = _skill_relative_path(request.path)
        target = skill_dir.joinpath(*relative.parts)
    else:
        relative = PurePosixPath()
        target = skill_dir
    _assert_no_symlink_components(root, target, allow_missing=True)
    if target.exists():
        if mode == "create":
            _http_error(409, "Directory already exists")
        _http_error(400, "Directory replacement is unsupported; move it or delete and recreate it")
    try:
        target.mkdir(mode=0o700, parents=True)
    except FileNotFoundError:
        _http_error(400, "Parent directory does not exist; create directories in order")
    except OSError as exc:
        _http_error(500, f"Could not create directory: {exc}")
    _assert_no_symlink_components(root, target, allow_missing=False)
    return {
        "ok": True,
        "profile": normalized,
        "skill": skill_id.as_posix(),
        "path": relative.as_posix(),
        "kind": "directory",
    }


def _move_sync(request: MoveRequest) -> dict[str, Any]:
    """Move or rename one safe node within its selected skill directory."""

    mode = _validate_mode(request.mode)
    normalized, root = _skills_root(request.profile)
    skill_id, skill_dir = _find_skill(root, request.skill)
    source_relative, source = _node_path(skill_dir, request.source)
    destination_relative = _skill_relative_path(request.destination)
    destination = skill_dir.joinpath(*destination_relative.parts)
    _assert_no_symlink_components(skill_dir, destination, allow_missing=True)
    if source == destination:
        _http_error(400, "Source and destination paths must differ")
    if source.is_dir():
        list(_tree_walk(source))
        try:
            destination.relative_to(source)
        except ValueError:
            pass
        else:
            _http_error(400, "A directory cannot be moved inside itself")
    if destination.exists():
        if mode != "replace":
            _http_error(409, "Target already exists; use replace")
        if destination.is_dir() and not source.is_dir():
            _http_error(400, "Cannot replace a directory with a file")
        try:
            if destination.is_dir():
                list(_tree_walk(destination))
                shutil.rmtree(destination)
            else:
                destination.unlink()
        except OSError as exc:
            _http_error(500, f"Could not clean the previous target: {exc}")
    if not destination.parent.is_dir():
        _http_error(400, "Destination parent directory does not exist")
    try:
        os.replace(source, destination)
    except OSError as exc:
        _http_error(500, f"Move failed: {exc}")
    return {
        "ok": True,
        "profile": normalized,
        "skill": skill_id.as_posix(),
        "source": source_relative.as_posix(),
        "destination": destination_relative.as_posix(),
        "mode": mode,
    }


def _delete_sync(request: DeleteRequest) -> dict[str, Any]:
    """Delete one file or nested directory while protecting the skill root."""

    normalized, root = _skills_root(request.profile)
    skill_id, skill_dir = _find_skill(root, request.skill)
    relative, target = _node_path(skill_dir, request.path)
    try:
        if target.is_dir():
            list(_tree_walk(target))
            shutil.rmtree(target)
        else:
            target.unlink()
    except OSError as exc:
        _http_error(500, f"Delete failed: {exc}")
    return {
        "ok": True,
        "profile": normalized,
        "skill": skill_id.as_posix(),
        "path": relative.as_posix(),
    }


def _create_skill_sync(request: SkillRequest) -> dict[str, Any]:
    """Create one skill directory, optionally with a UTF-8 ``SKILL.md``."""

    mode = _validate_mode(request.mode)
    if mode != "create":
        _http_error(400, "Creating a skill requires create mode")
    normalized, root = _skills_root(request.profile, create=True)
    skill_id = _skill_identifier(request.skill)
    target = root.joinpath(*skill_id.parts)
    _assert_no_symlink_components(root, target, allow_missing=True)
    if target.exists():
        _http_error(409, "Skill already exists")
    try:
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    except OSError as exc:
        _http_error(500, f"Could not create skill parent directory: {exc}")
    _assert_no_symlink_components(root, target, allow_missing=True)
    try:
        target.mkdir(mode=0o700)
    except OSError as exc:
        _http_error(500, f"Could not create skill: {exc}")
    _assert_no_symlink_components(root, target, allow_missing=False)
    if request.content is not None:
        if len(request.content.encode("utf-8")) > _MAX_TEXT_BYTES:
            shutil.rmtree(target, ignore_errors=True)
            _http_error(413, "Text content is too large")
        try:
            _atomic_write_bytes(target / "SKILL.md", request.content.encode("utf-8"), "create")
        except HTTPException:
            shutil.rmtree(target, ignore_errors=True)
            raise
    return {"ok": True, "profile": normalized, "skill": skill_id.as_posix(), "kind": "directory"}


def _delete_skill_sync(request: SkillRequest) -> dict[str, Any]:
    """Delete one complete skill directory after rejecting unsafe contents."""

    normalized, root = _skills_root(request.profile)
    skill_id, target = _find_skill(root, request.skill)
    # Validate the complete tree before deletion so a symlink cannot turn a
    # user-visible delete into an operation on an unrelated directory.
    list(_tree_walk(target))
    try:
        shutil.rmtree(target)
    except OSError as exc:
        _http_error(500, f"Could not delete skill: {exc}")
    return {"ok": True, "profile": normalized, "skill": skill_id.as_posix()}


def _move_skill_sync(request: SkillRequest) -> dict[str, Any]:
    """Rename one skill directory while keeping its complete relative tree."""

    mode = _validate_mode(request.mode)
    if not request.new_skill:
        _http_error(400, "New skill name is required")
    normalized, root = _skills_root(request.profile)
    source_id, source = _find_skill(root, request.skill)
    list(_tree_walk(source))
    destination_id = _skill_identifier(request.new_skill)
    destination = root.joinpath(*destination_id.parts)
    _assert_no_symlink_components(root, destination, allow_missing=True)
    try:
        destination.relative_to(source)
    except ValueError:
        pass
    else:
        _http_error(400, "A skill cannot be moved inside itself")
    if destination.exists():
        if mode != "replace":
            _http_error(409, "Destination skill exists; use replace")
        list(_tree_walk(destination))
        shutil.rmtree(destination)
    if not destination.parent.is_dir():
        _http_error(400, "Destination skill parent directory does not exist")
    try:
        os.replace(source, destination)
    except OSError as exc:
        _http_error(500, f"Could not move skill: {exc}")
    return {
        "ok": True,
        "profile": normalized,
        "source": source_id.as_posix(),
        "destination": destination_id.as_posix(),
    }


def _archive_bytes_sync(profile: str, skill: str) -> tuple[str, PurePosixPath, bytes]:
    """Export one skill directory to a zip archive with relative paths intact."""

    normalized, root = _skills_root(profile)
    skill_id, skill_dir = _find_skill(root, skill)
    members = list(_tree_walk(skill_dir))
    output = io.BytesIO()
    try:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, info in members:
                relative = path.relative_to(skill_dir).as_posix()
                if not relative:
                    continue
                if stat.S_ISDIR(info.st_mode):
                    archive.writestr(f"{relative.rstrip('/')}/", b"")
                elif stat.S_ISREG(info.st_mode):
                    archive.write(path, relative)
    except OSError as exc:
        _http_error(500, f"Could not export skill: {exc}")
    return normalized, skill_id, output.getvalue()


def _zip_member_name(info: zipfile.ZipInfo) -> PurePosixPath:
    """Validate one zip member against absolute paths, traversal, and symlinks."""

    raw = info.filename.replace("\\", "/")
    if "\x00" in raw or not raw or len(raw) > _MAX_PATH_LENGTH:
        _http_error(400, "Archive contains an invalid path")
    if PureWindowsPath(raw).is_absolute() or PureWindowsPath(raw).drive:
        _http_error(400, "Archive contains an absolute path")
    raw_parts = raw.rstrip("/").split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        _http_error(400, "Archive contains an invalid path")
    path = PurePosixPath(raw)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        _http_error(400, "Archive contains path traversal")
    mode = (info.external_attr >> 16) & 0o170000
    if stat.S_ISLNK(mode):
        _http_error(400, "Archive must not contain symbolic links")
    if any(len(part) > _MAX_NAME_LENGTH for part in path.parts):
        _http_error(400, "Archive file name is too long")
    return path


def _safe_extract_archive(archive_data: bytes, destination: Path) -> None:
    """Extract a bounded zip into a fresh directory after validating all members."""

    if len(archive_data) > _MAX_ARCHIVE_BYTES:
        _http_error(413, "Archive is too large")
    temporary: Path | None = None
    try:
        with zipfile.ZipFile(io.BytesIO(archive_data)) as archive:
            infos = archive.infolist()
            if len(infos) > _MAX_ARCHIVE_MEMBERS:
                _http_error(413, "Archive has too many files")
            members: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
            total = 0
            seen: set[str] = set()
            for info in infos:
                path = _zip_member_name(info)
                key = path.as_posix().rstrip("/")
                if key in seen:
                    _http_error(400, "Archive contains duplicate paths")
                seen.add(key)
                if info.file_size > _MAX_UPLOAD_BYTES:
                    _http_error(413, "A file in the archive is too large")
                total += info.file_size
                if total > _MAX_ARCHIVE_EXPANDED_BYTES:
                    _http_error(413, "Expanded archive is too large")
                members.append((info, path))
            parent = destination.parent
            _assert_no_symlink_components(parent.parent, parent, allow_missing=False)
            temporary = Path(tempfile.mkdtemp(prefix=".skill-files-extract-", dir=str(parent)))
            for info, relative in members:
                target = temporary.joinpath(*relative.parts)
                if info.is_dir() or info.filename.endswith(("/", "\\")):
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                _assert_no_symlink_components(temporary, target, allow_missing=True)
                data = archive.read(info)
                if len(data) > _MAX_UPLOAD_BYTES:
                    _http_error(413, "A file in the archive is too large")
                _atomic_write_bytes(target, data, "create")
            if destination.exists():
                # Existing targets are validated before replacement, including
                # nested links that could otherwise be traversed by rmtree.
                list(_tree_walk(destination))
                backup = destination.with_name(f".{destination.name}.old-{uuid.uuid4().hex}")
                os.replace(destination, backup)
                try:
                    os.replace(temporary, destination)
                    temporary = None
                finally:
                    shutil.rmtree(backup, ignore_errors=True)
            else:
                os.replace(temporary, destination)
                temporary = None
    except zipfile.BadZipFile:
        _http_error(400, "Uploaded content is not a valid ZIP archive")
    except (OSError, RuntimeError) as exc:
        _http_error(400, f"Could not import skill: {exc}")
    finally:
        if temporary is not None:
            shutil.rmtree(temporary, ignore_errors=True)


def _import_archive_sync(profile: str, skill: str, mode: str, data: bytes) -> dict[str, Any]:
    """Create or replace one complete skill directory from a safe zip archive."""

    operation = _validate_mode(mode)
    normalized, root = _skills_root(profile, create=True)
    skill_id = _skill_identifier(skill)
    destination = root.joinpath(*skill_id.parts)
    _assert_no_symlink_components(root, destination, allow_missing=True)
    exists = destination.exists()
    if operation == "create" and exists:
        _http_error(409, "Skill already exists; use replace")
    if operation == "replace" and not exists:
        _http_error(404, "Replacement skill does not exist")
    if not destination.parent.is_dir():
        if operation != "create":
            _http_error(400, "Skill parent directory does not exist")
        try:
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        except OSError as exc:
            _http_error(500, f"Could not create skill parent directory: {exc}")
        _assert_no_symlink_components(root, destination, allow_missing=True)
    _safe_extract_archive(data, destination)
    return {
        "ok": True,
        "profile": normalized,
        "skill": skill_id.as_posix(),
        "mode": operation,
    }


def _response_file(path: Path, *, download: bool) -> FileResponse:
    """Build a safe raw-file response for preview or download."""

    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = dict(_INLINE_HEADERS)
    safe_name = re.sub(r'[\x00-\x1f\x7f"]', "_", path.name)
    headers["Content-Disposition"] = (
        f'attachment; filename="{safe_name}"' if download else f'inline; filename="{safe_name}"'
    )
    return FileResponse(path, media_type=media_type, headers=headers)


@router.get("/skills/files")
async def list_skills(
    profile: str = Query(default="default"),
    skill: str | None = Query(default=None),
    name: str | None = Query(default=None),
    path: str = Query(default=""),
) -> dict[str, Any]:
    """List discoverable skills and their native descriptions for a profile."""

    selected = (skill or name or "").strip()
    if selected:
        return await asyncio.to_thread(_tree_sync, profile, selected, path)
    return await asyncio.to_thread(_list_skills_sync, profile)


@router.get("/skills/files/tree")
async def list_skill_tree(
    profile: str = Query(default="default"),
    skill: str | None = Query(default=None),
    name: str | None = Query(default=None),
    path: str = Query(default=""),
) -> dict[str, Any]:
    """List one safe level of the selected skill directory."""

    return await asyncio.to_thread(_tree_sync, profile, _selected_skill(skill, name), path)


@router.get("/skills/files/file")
async def read_skill_text(
    profile: str = Query(default="default"),
    skill: str | None = Query(default=None),
    name: str | None = Query(default=None),
    path: str = Query(...),
) -> dict[str, Any]:
    """Read a UTF-8 text file in the selected skill."""

    return await asyncio.to_thread(_read_text_sync, profile, _selected_skill(skill, name), path)


@router.get("/skills/files/content")
async def read_skill_content(
    profile: str = Query(default="default"),
    skill: str | None = Query(default=None),
    name: str | None = Query(default=None),
    path: str = Query(default="SKILL.md"),
) -> dict[str, Any]:
    """Read the skill entry file; ``name`` aliases the frontend list field."""

    selected = (skill or name or "").strip()
    if not selected:
        _http_error(400, "Skill name is required")
    return await asyncio.to_thread(_read_text_sync, profile, selected, path)


@router.get("/skills/files/preview")
async def preview_skill_file(
    profile: str = Query(default="default"),
    skill: str | None = Query(default=None),
    name: str | None = Query(default=None),
    path: str = Query(...),
) -> FileResponse:
    """Preview a text or binary skill file using an inline response."""

    normalized, _relative, target = await asyncio.to_thread(
        _file_target_sync, profile, _selected_skill(skill, name), path
    )
    _ = normalized
    return _response_file(target, download=False)


@router.get("/skills/files/download")
async def download_skill_file(
    profile: str = Query(default="default"),
    skill: str | None = Query(default=None),
    name: str | None = Query(default=None),
    path: str = Query(...),
) -> FileResponse:
    """Download a binary or text file from the selected skill."""

    normalized, _relative, target = await asyncio.to_thread(
        _file_target_sync, profile, _selected_skill(skill, name), path
    )
    _ = normalized
    return _response_file(target, download=True)


@router.put("/skills/files/text")
async def write_skill_text(
    request: TextWriteRequest, profile: str | None = Query(default=None)
) -> dict[str, Any]:
    """Explicitly create or replace a UTF-8 text file in the selected skill."""

    return await asyncio.to_thread(_write_text_sync, _profile_override(request, profile))


@router.post("/skills/files/upload")
async def upload_skill_file(
    file: UploadFile = File(...),
    profile: str = Form(default="default"),
    profile_query: str | None = Query(default=None, alias="profile"),
    skill: str = Form(...),
    path: str = Form(...),
    mode: str = Form(default="create"),
    version: str | None = Form(default=None),
) -> dict[str, Any]:
    """Upload one file; overwriting requires explicit ``mode=replace``."""

    data = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(data) > _MAX_UPLOAD_BYTES:
        _http_error(413, "Uploaded file is too large")
    return await asyncio.to_thread(
        _upload_sync, profile_query or profile, skill, path, mode, data, version
    )


@router.post("/skills/files/mkdir")
async def make_skill_directory(
    request: DirectoryRequest, profile: str | None = Query(default=None)
) -> dict[str, Any]:
    """Create a skill root or nested directories within a skill."""

    return await asyncio.to_thread(_mkdir_sync, _profile_override(request, profile))


@router.post("/skills/files/move")
async def move_skill_node(
    request: MoveRequest, profile: str | None = Query(default=None)
) -> dict[str, Any]:
    """Move or rename a file or directory within one skill."""

    return await asyncio.to_thread(_move_sync, _profile_override(request, profile))


@router.post("/skills/files/rename")
async def rename_skill_node(
    request: MoveRequest, profile: str | None = Query(default=None)
) -> dict[str, Any]:
    """Provide a rename alias with the same semantics as move."""

    return await asyncio.to_thread(_move_sync, _profile_override(request, profile))


@router.delete("/skills/files/node")
async def delete_skill_node(
    request: DeleteRequest = Body(...), profile: str | None = Query(default=None)
) -> dict[str, Any]:
    """Delete a skill file or directory; skill roots require the dedicated skill API."""

    return await asyncio.to_thread(_delete_sync, _profile_override(request, profile))


@router.post("/skills/files/skill")
async def create_skill(
    request: SkillRequest, profile: str | None = Query(default=None)
) -> dict[str, Any]:
    """Create a skill directory, optionally writing an explicitly supplied ``SKILL.md``."""

    return await asyncio.to_thread(_create_skill_sync, _profile_override(request, profile))


@router.delete("/skills/files/skill")
async def delete_skill(
    request: SkillRequest = Body(...), profile: str | None = Query(default=None)
) -> dict[str, Any]:
    """Delete an entire skill directory."""

    return await asyncio.to_thread(_delete_skill_sync, _profile_override(request, profile))


@router.post("/skills/files/skill/move")
async def move_skill(
    request: SkillRequest, profile: str | None = Query(default=None)
) -> dict[str, Any]:
    """Move or rename a complete skill directory while preserving relative paths."""

    return await asyncio.to_thread(_move_skill_sync, _profile_override(request, profile))


@router.get("/skills/files/archive")
async def export_skill_archive(
    profile: str = Query(default="default"),
    skill: str | None = Query(default=None),
    name: str | None = Query(default=None),
) -> Response:
    """Export a complete skill as ZIP with paths relative to the skill root."""

    normalized, skill_id, data = await asyncio.to_thread(
        _archive_bytes_sync, profile, _selected_skill(skill, name)
    )
    filename = re.sub(r'[\x00-\x1f\x7f"]', "_", f"{skill_id.name}.zip")
    headers = dict(_INLINE_HEADERS)
    headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    headers["X-Hermes-Profile"] = normalized
    return Response(content=data, media_type="application/zip", headers=headers)


@router.post("/skills/files/archive")
async def import_skill_archive(
    archive: UploadFile | None = File(default=None),
    file: UploadFile | None = File(default=None),
    profile: str = Form(default="default"),
    profile_query: str | None = Query(default=None, alias="profile"),
    skill: str = Form(...),
    mode: str = Form(default="create"),
) -> dict[str, Any]:
    """Import a complete skill ZIP; explicitly select create or replace via ``mode``."""

    upload = archive or file
    if upload is None:
        _http_error(400, "ZIP archive is required")
    data = await upload.read(_MAX_ARCHIVE_BYTES + 1)
    if len(data) > _MAX_ARCHIVE_BYTES:
        _http_error(413, "Archive is too large")
    return await asyncio.to_thread(
        _import_archive_sync, profile_query or profile, skill, mode, data
    )


__all__ = [
    "DirectoryRequest",
    "DeleteRequest",
    "MoveRequest",
    "SkillRequest",
    "TextWriteRequest",
    "create_router",
    "router",
]
