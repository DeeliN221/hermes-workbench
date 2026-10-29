"""Attachment storage keeps large uploads and folder batches inside one session."""

from __future__ import annotations

import asyncio
import io
import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
from codex_attachments import (  # noqa: E402
    DEFAULT_MAX_ATTACHMENT_BYTES,
    AttachmentStore,
    _decode_folder_paths,
    create_router,
    normalize_relative_path,
)
import codex_bridge  # noqa: E402
import codex_files  # noqa: E402


class Upload:
    """Minimal object matching FastAPI's UploadFile fields used by the store."""

    def __init__(self, name: str, data: bytes, content_type: str = "text/plain") -> None:
        self.filename = name
        self.content_type = content_type
        self.file = io.BytesIO(data)


class RepeatedUpload:
    """Generate a large body one chunk at a time without holding it in memory."""

    filename = "large.bin"
    content_type = "application/octet-stream"

    def __init__(self, total: int) -> None:
        self.remaining = total
        self.file = self

    def read(self, size: int) -> bytes:
        if self.remaining <= 0:
            return b""
        count = min(size, self.remaining)
        self.remaining -= count
        return b"x" * count


def _resolve(store: AttachmentStore, root: Path, identifier: str) -> list[dict[str, str]]:
    return store.resolve_inputs(root, "user", "default", "session", [identifier])


def _path_from(text: str) -> Path:
    return Path(next(line for line in text.splitlines() if line.startswith("Path: "))[6:])


def test_uploads_are_uncapped_by_default(tmp_path: Path) -> None:
    assert DEFAULT_MAX_ATTACHMENT_BYTES is None
    store = AttachmentStore()
    root = tmp_path / "workspace"
    root.mkdir()

    saved = asyncio.run(
        store.save_upload(root, "user", "default", "session", RepeatedUpload(21 * 1024 * 1024))
    )

    assert saved["size"] == 21 * 1024 * 1024
    resolved = _resolve(store, root, saved["id"])
    assert resolved[0]["type"] == "text"
    assert _path_from(resolved[0]["text"]).stat().st_size == saved["size"]


def test_optional_byte_limit_still_rejects_oversized_uploads(tmp_path: Path) -> None:
    store = AttachmentStore(max_bytes=1024)
    root = tmp_path / "workspace"
    root.mkdir()

    with pytest.raises(HTTPException) as raised:
        asyncio.run(
            store.save_upload(root, "user", "default", "session", Upload("big.txt", b"x" * 2048))
        )

    assert raised.value.status_code == 413
    assert not list(root.rglob("big.txt"))


def test_folder_upload_preserves_relative_paths(tmp_path: Path) -> None:
    store = AttachmentStore()
    root = tmp_path / "workspace"
    root.mkdir()
    entries = [
        ("src/main.py", Upload("main.py", b"print('hi')\n", "text/x-python")),
        ("docs/nested/readme.md", Upload("readme.md", b"# Read me\n", "text/markdown")),
    ]

    saved = asyncio.run(
        store.save_folder(root, "user", "default", "session", "project", entries)
    )

    assert saved["kind"] == "folder"
    assert saved["fileCount"] == 2
    assert saved["size"] == 22
    resolved = _resolve(store, root, saved["id"])
    assert len(resolved) == 1
    assert "User attachment folder: project (2 files, 22 bytes)" in resolved[0]["text"]
    assert "do not paste the entire file or folder" in resolved[0]["text"]
    folder = _path_from(resolved[0]["text"])
    assert (folder / "src" / "main.py").read_bytes() == b"print('hi')\n"
    assert (folder / "docs" / "nested" / "readme.md").read_bytes() == b"# Read me\n"


def test_folder_paths_reject_traversal_and_missing_entries() -> None:
    with pytest.raises(ValueError):
        normalize_relative_path("../escape.txt")
    with pytest.raises(ValueError):
        normalize_relative_path("/absolute.txt")
    with pytest.raises(ValueError):
        normalize_relative_path("C:/windows.txt")
    with pytest.raises(HTTPException):
        _decode_folder_paths('["a.txt"]', 2)
    with pytest.raises(HTTPException):
        _decode_folder_paths('["a.txt", "a.txt"]', 2)


def test_folder_resolution_rejects_symlinked_roots(tmp_path: Path) -> None:
    store = AttachmentStore()
    root = tmp_path / "workspace"
    root.mkdir()
    saved = asyncio.run(
        store.save_folder(
            root, "user", "default", "session", "project", [("a.txt", Upload("a.txt", b"a"))]
        )
    )
    resolved = _resolve(store, root, saved["id"])
    folder = _path_from(resolved[0]["text"])
    target = tmp_path / "outside"
    target.mkdir()
    folder.rename(tmp_path / "moved")
    folder.symlink_to(target, target_is_directory=True)

    with pytest.raises(HTTPException) as raised:
        _resolve(store, root, saved["id"])

    assert raised.value.status_code == 404


def test_images_are_passed_as_on_demand_paths_only(tmp_path: Path) -> None:
    store = AttachmentStore()
    root = tmp_path / "workspace"
    root.mkdir()
    ids = []
    for index in range(6):
        saved = asyncio.run(
            store.save_upload(
                root,
                "user",
                "default",
                "session",
                Upload(f"image-{index}.png", b"\x89PNG\r\n\x1a\n" + bytes([index])),
            )
        )
        ids.append(saved["id"])

    resolved = store.resolve_inputs(root, "user", "default", "session", ids)

    assert all(item["type"] == "text" for item in resolved)
    assert all("Image attachment:" in item["text"] for item in resolved)
    assert all("Open the image only when the task needs it" in item["text"] for item in resolved)


def test_folder_endpoint_accepts_multipart_files_and_one_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    bridge = type("Bridge", (), {"attachments": AttachmentStore()})()
    monkeypatch.setattr(codex_bridge, "_user", lambda request: "user")
    monkeypatch.setattr(codex_bridge, "_safe", lambda value, label: value)

    async def workspace(_bridge, _request, _profile, _session):
        return root

    monkeypatch.setattr(codex_files, "_session_workspace", workspace)
    app = FastAPI()
    app.include_router(create_router(bridge), prefix="/api/codex")
    response = TestClient(app).post(
        "/api/codex/attachments/folder",
        params={"profile": "default", "session_id": "session"},
        data={
            "paths": json.dumps(["a.txt", "sub/b.txt"]),
            "name": "project",
        },
        files=[
            ("files", ("a.txt", b"alpha", "text/plain")),
            ("files", ("b.txt", b"beta", "text/plain")),
        ],
    )

    assert response.status_code == 200, response.text
    attachment = response.json()["attachment"]
    assert attachment["kind"] == "folder"
    assert attachment["fileCount"] == 2
    assert attachment["size"] == 9
    resolved = bridge.attachments.resolve_inputs(root, "user", "default", "session", [attachment["id"]])
    folder = _path_from(resolved[0]["text"])
    assert (folder / "sub" / "b.txt").read_bytes() == b"beta"
