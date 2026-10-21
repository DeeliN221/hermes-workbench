"""Cross-device recent-home acknowledgements."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import plugin_api


@pytest.fixture()
def state_root(tmp_path: Path):
    token = plugin_api._WORKSPACE_ROOT_OVERRIDE.set(tmp_path)
    try:
        yield tmp_path
    finally:
        plugin_api._WORKSPACE_ROOT_OVERRIDE.reset(token)


def test_home_read_state_is_upserted_and_listed_across_profiles(state_root: Path) -> None:
    first = plugin_api.HomeReadStateBody(
        profile="writer",
        source="Hermes",
        session_id="history-1",
        activity_version='["v2",2]',
    )
    saved = plugin_api._save_home_read_state(first)
    assert saved["activity_version"] == '["v2",2]'

    plugin_api._save_home_read_state(
        plugin_api.HomeReadStateBody(
            profile="writer",
            source="Hermes",
            session_id="history-1",
            activity_version='["v2",3]',
        )
    )
    plugin_api._save_home_read_state(
        plugin_api.HomeReadStateBody(
            profile="default",
            source="Codex",
            session_id="session-1",
            activity_version='["v2",12]',
        )
    )

    rows = plugin_api._list_home_read_state()
    assert len(rows) == 2
    writer = next(row for row in rows if row["profile"] == "writer")
    assert writer["activity_version"] == '["v2",3]'
    assert [row["session_id"] for row in plugin_api._list_home_read_state("default")] == ["session-1"]


def test_home_read_state_rejects_unknown_sources(state_root: Path) -> None:
    with pytest.raises(HTTPException) as error:
        plugin_api._save_home_read_state(
            plugin_api.HomeReadStateBody(
                profile="writer",
                source="kanban",
                session_id="run-1",
                activity_version='["v2",1]',
            )
        )
    assert error.value.status_code == 400


def test_home_read_state_routes_round_trip(state_root: Path) -> None:
    app = FastAPI()
    app.include_router(plugin_api.router, prefix="/api/plugins/workbench")
    client = TestClient(app)
    body = {
        "profile": "writer",
        "source": "Hermes",
        "session_id": "history-1",
        "activity_version": '["v2",2]',
    }
    saved = client.post("/api/plugins/workbench/home-read-state", json=body)
    assert saved.status_code == 200
    listed = client.get("/api/plugins/workbench/home-read-state")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["activity_version"] == '["v2",2]'
