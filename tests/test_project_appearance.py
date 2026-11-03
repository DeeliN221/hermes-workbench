"""Project appearance is persisted with exact ownership and survives legacy migration."""
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
from codex_bridge import BridgeStore


def test_appearance_restart_scope_and_rename(tmp_path):
    path = tmp_path / "db"
    store = BridgeStore(path)
    group = store.create_group("user", "default", "", "", "Project")
    gid = group["id"]
    for user, profile in [("other", "default"), ("user", "other")]:
        with pytest.raises(HTTPException) as error:
            store.style_group(user, profile, gid, "blue", "code")
        assert error.value.status_code == 404
    for color, icon in [("invalid", "code"), ("blue", "<script>")]:
        with pytest.raises(HTTPException):
            store.style_group("user", "default", gid, color, icon)
    store.style_group("user", "default", gid, "purple", "book")
    store.rename_group("user", "default", gid, "Renamed")
    store.close()
    store = BridgeStore(path)
    assert store.groups("user", "default")[0]["color"] == "purple"
    assert store.group("user", "default", gid)["icon"] == "book"
    store.style_group("user", "default", gid, "", "")
    assert store.group("user", "default", gid)["color"] == ""
    store.close()


def test_legacy_group_migration(tmp_path):
    path = tmp_path / "db"
    store = BridgeStore(path)
    gid = store.create_group("u", "p", "", "", "Legacy")["id"]
    store.close()
    with sqlite3.connect(path) as db:
        db.execute("ALTER TABLE codex_session_groups DROP COLUMN color")
        db.execute("ALTER TABLE codex_session_groups DROP COLUMN icon")
    store = BridgeStore(path)
    assert store.group("u", "p", gid)["icon"] == ""
    store.style_group("u", "p", gid, "green", "star")
    assert store.groups("u", "p")[0]["color"] == "green"
    store.close()


def test_appearance_http_validation(tmp_path):
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from codex_bridge import create_router

    store = BridgeStore(tmp_path / "api-db")
    gid = store.create_group("user", "default", "", "", "Project")["id"]
    app = FastAPI()
    app.include_router(create_router(SimpleNamespace(store=store)))
    with TestClient(app) as client:
        url = f"/groups/{gid}/appearance"
        assert client.patch(url, json={"color": "blue", "icon": "code"}).status_code == 401
        assert client.patch(url, headers={"remote-user": "other"}, json={"color": "blue"}).status_code == 404
        assert client.patch(url, headers={"remote-user": "user"}, json={"color": "#bad"}).status_code == 400
        response = client.patch(url, headers={"remote-user": "user"}, json={"color": "blue", "icon": "code"})
        assert response.status_code == 200
        assert response.json()["group"]["icon"] == "code"
    store.close()
