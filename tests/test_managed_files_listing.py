"""Safe Workbench fallback for a native Files root listing."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import plugin_api


@pytest.fixture()
def managed_root(tmp_path: Path):
    root = tmp_path / "managed"
    root.mkdir()
    (root / "workspace").mkdir()
    (root / "notes.txt").write_text("safe", encoding="utf-8")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("not managed", encoding="utf-8")
    os.symlink(outside, root / "external-link")
    token = plugin_api._WORKSPACE_ROOT_OVERRIDE.set(root)
    try:
        yield root
    finally:
        plugin_api._WORKSPACE_ROOT_OVERRIDE.reset(token)


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(plugin_api.router, prefix="/api/plugins/workbench")
    return TestClient(app)


def test_root_listing_skips_an_external_symlink_instead_of_failing(managed_root: Path) -> None:
    response = _client().get("/api/plugins/workbench/managed-files")

    assert response.status_code == 200
    payload = response.json()
    assert payload["root"] == str(managed_root)
    assert payload["path"] == str(managed_root)
    assert payload["locked_root"] == str(managed_root)
    assert payload["can_change_path"] is False
    assert [entry["name"] for entry in payload["entries"]] == ["workspace", "notes.txt"]
    assert payload["entries"][0]["path"] == str(managed_root / "workspace")
    assert payload["entries"][0]["is_directory"] is True
    assert payload["entries"][1]["mime_type"] == "text/plain"


def test_root_listing_keeps_the_existing_relative_contract(managed_root: Path) -> None:
    response = _client().get("/api/plugins/workbench/files")

    assert response.status_code == 200
    payload = response.json()
    assert payload["path"] == "."
    assert payload["root"] == str(managed_root)
    assert [entry["path"] for entry in payload["entries"]] == ["workspace", "notes.txt"]


@pytest.mark.parametrize("path", ["../outside", "absolute"])
def test_out_of_root_paths_remain_rejected(managed_root: Path, path: str) -> None:
    if path == "absolute":
        path = str(managed_root.parent / "outside")
    response = _client().get("/api/plugins/workbench/managed-files", params={"path": path})

    assert response.status_code in {400, 403}


def test_direct_listing_of_an_external_symlink_is_rejected(managed_root: Path) -> None:
    response = _client().get(
        "/api/plugins/workbench/managed-files",
        params={"path": "external-link"},
    )

    assert response.status_code == 403
