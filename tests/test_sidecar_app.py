"""Authentication and asset contracts for the independently deployed sidecar."""

from __future__ import annotations

import importlib
import os
import sqlite3
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def test_sidecar_entrypoint_maps_runtime_uid_to_hermes(tmp_path: Path) -> None:
    """The shell PTY must resolve its bind-mount UID through /etc/passwd."""

    passwd = tmp_path / "passwd"
    passwd.write_text("root:x:0:0:root:/root:/bin/sh\nhermes:x:10000:10000::/opt/data:/bin/sh\n")
    script = Path(__file__).parents[1] / "dashboard" / "sidecar_entrypoint.sh"
    env = {
        **os.environ,
        "HERMES_WORKBENCH_RUNTIME_UID": "1001",
        "HERMES_WORKBENCH_RUNTIME_GID": "100",
        "HERMES_WORKBENCH_PASSWD_FILE": str(passwd),
        "HERMES_WORKBENCH_IDENTITY_ONLY": "1",
    }

    subprocess.run(["/bin/sh", str(script)], env=env, check=True)

    assert "hermes:x:1001:100::/opt/data:/bin/sh" in passwd.read_text()


@pytest.fixture()
def sidecar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Create one disposable release with an instance-scoped proxy identity."""

    dashboard = Path(__file__).parents[1] / "dashboard"
    monkeypatch.syspath_prepend(str(dashboard))
    module = importlib.import_module("sidecar_app")
    assets = tmp_path / "dist"
    assets.mkdir()
    (assets / "index.js").write_text("window.workbench = true", encoding="utf-8")
    (assets / "style.css").write_text("body{}", encoding="utf-8")
    (tmp_path / "manifest.json").write_text('{"version":"test-release"}', encoding="utf-8")
    monkeypatch.setenv("HERMES_DASHBOARD_TRUSTED_PROXY_SECRET", "proxy-secret")
    monkeypatch.setenv("HERMES_WORKBENCH_ALLOWED_USERS", "alice,developer")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(module.plugin_api, "_workspace_root", lambda: tmp_path.resolve())
    return module, TestClient(module.create_app(tmp_path))


def test_health_and_assets_are_ready_without_api_credentials(sidecar) -> None:
    """Caddy and Docker can probe assets before routing authenticated users."""

    _module, client = sidecar
    health = client.get("/health")
    script = client.get("/workbench-sidecar/index.js")

    assert health.json() == {"status": "ok", "version": "test-release"}
    assert script.status_code == 200
    assert script.headers["cache-control"] == "no-store"
    assert script.headers["x-content-type-options"] == "nosniff"


def test_healthz_reports_liveness_while_release_assets_are_missing(
    sidecar, tmp_path: Path
) -> None:
    """Probes that only need liveness stay green when readiness cannot pass."""

    _module, client = sidecar
    (tmp_path / "dist" / "index.js").unlink()
    (tmp_path / "dist" / "style.css").unlink()

    liveness = client.get("/healthz")
    readiness = client.get("/health")

    assert liveness.status_code == 200
    assert liveness.json() == {"ok": True}
    assert readiness.status_code == 503


def test_versioned_runtime_assets_are_immutable_and_reject_other_releases(sidecar) -> None:
    """Repeat visits can reuse the large runtime without serving a stale version."""

    _module, client = sidecar
    script = client.get("/workbench-sidecar/v/test-release/workbench.js")
    stylesheet = client.get("/workbench-sidecar/v/test-release/workbench.css")
    stale = client.get("/workbench-sidecar/v/old-release/workbench.js")

    assert script.status_code == 200
    assert script.text == "window.workbench = true"
    assert script.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert stylesheet.status_code == 200
    assert stylesheet.text == "body{}"
    assert stylesheet.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert stale.status_code == 404


def test_capabilities_make_codex_the_only_new_chat_provider(sidecar) -> None:
    """External Claude/Pi sessions are discoverable history, never new Workbench chats."""

    _module, client = sidecar
    response = client.get(
        "/api/plugins/workbench/capabilities",
        headers={"X-Hermes-Proxy-Secret": "proxy-secret", "Remote-User": "alice"},
    )
    assert response.status_code == 200
    assert response.json()["newChatProviders"] == ["codex"]
    assert response.json()["historyOnlyProviders"] == ["claude", "pi"]
    assert response.json()["supportsExternalContinuation"] is False


def test_profile_roster_hides_directories_without_profile_identity(
    sidecar, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A ghost profile shell must not be advertised as an agent whose sessions 404."""

    _module, client = sidecar
    monkeypatch.delenv("HERMES_WORKBENCH_HERMES_HOME", raising=False)
    profiles = tmp_path / "profiles"
    (profiles / "writer").mkdir(parents=True)
    (profiles / "writer" / "config.yaml").write_text("model: fictional-model\n", encoding="utf-8")
    ghost = profiles / "zz-removed"
    (ghost / "logs").mkdir(parents=True)
    (ghost / "logs" / "agent.log").write_text("", encoding="utf-8")
    retired = profiles / "retired"
    retired.mkdir()
    (retired / "config.yaml").write_text("model: fictional-model\n", encoding="utf-8")
    (profiles / ".deleted").mkdir()
    (profiles / ".deleted" / "retired").write_text("deleted\n", encoding="utf-8")

    response = client.get(
        "/api/plugins/workbench/profile-names",
        headers={"X-Hermes-Proxy-Secret": "proxy-secret", "Remote-User": "alice"},
    )

    assert response.status_code == 200
    assert [row["name"] for row in response.json()["profiles"]] == ["default", "writer"]


def test_update_window_rejects_mutations_as_retryable(sidecar, monkeypatch: pytest.MonkeyPatch) -> None:
    """A release switch is transient: writes must look retryable, not like client errors."""

    module, client = sidecar
    monkeypatch.setattr(module, "begin_mutation", lambda: False)
    headers = {"X-Hermes-Proxy-Secret": "proxy-secret", "Remote-User": "alice"}

    blocked = client.post(
        "/api/plugins/workbench/codex/session?profile=default&session_id=session-test",
        json={"text": "hello"},
        headers=headers,
    )
    allowed = client.get("/api/plugins/workbench/profile-names", headers=headers)

    assert blocked.status_code == 503
    assert blocked.headers["retry-after"] == "5"
    assert "Workbench is updating" in blocked.json()["detail"]
    assert allowed.status_code == 200


def test_thin_manifest_keeps_cached_asset_paths_without_an_in_process_api() -> None:
    """Initial migration works before Hermes naturally refreshes its plugin cache."""

    import json

    manifest_path = Path(__file__).parents[1] / "dashboard" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert manifest["entry"] == "dist/index.js"
    assert manifest["css"] == "dist/style.css"
    assert "api" not in manifest


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Remote-User": "alice"},
        {"X-Hermes-Proxy-Secret": "proxy-secret", "Remote-User": "unknown"},
        {"X-Hermes-Proxy-Secret": "wrong", "Remote-User": "alice"},
    ],
)
def test_api_fails_closed_without_both_proxy_claims(sidecar, headers: dict[str, str]) -> None:
    """Neither a forgeable user header nor a secret alone can reach user files."""

    _module, client = sidecar
    response = client.get("/api/plugins/workbench/workspace", headers=headers)

    assert response.status_code == 401


@pytest.mark.parametrize("remote_user", ["alice", "developer", "DEVELOPER"])
def test_api_accepts_only_configured_instance_users(sidecar, remote_user: str) -> None:
    """Aliases mapped to the same Hermes instance share its sidecar and no other one."""

    _module, client = sidecar
    response = client.get(
        "/api/plugins/workbench/workspace",
        headers={
            "X-Hermes-Proxy-Secret": "proxy-secret",
            "Remote-User": remote_user,
        },
    )

    assert response.status_code == 200
    assert response.json()["workspace"]["path"]


def test_kanban_activity_reads_many_logs_without_starting_sessions(
    sidecar, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One bounded request returns several worker tails and rejects path traversal."""

    module, client = sidecar
    home = module.plugin_api._workspace_root()
    monkeypatch.setenv("HERMES_KANBAN_HOME", str(home))
    logs = home / "kanban" / "boards" / "digital-hub" / "logs"
    logs.mkdir(parents=True)
    (logs / "t_one.log").write_text("old\nlatest one\n", encoding="utf-8")
    (logs / "t_two.log").write_text("latest two\n", encoding="utf-8")
    headers = {
        "X-Hermes-Proxy-Secret": "proxy-secret",
        "Remote-User": "alice",
    }
    endpoint = "/api/plugins/workbench/kanban-activity"

    response = client.post(
        endpoint,
        headers=headers,
        json={"board": "digital-hub", "task_ids": ["t_one", "t_two"], "tail_bytes": 512},
    )
    rejected = client.post(
        endpoint,
        headers=headers,
        json={"board": "digital-hub", "task_ids": ["../secrets"], "tail_bytes": 512},
    )

    assert response.status_code == 200
    assert response.json() == {
        "board": "digital-hub",
        "items": [
            {"task_id": "t_one", "content": "old\nlatest one\n"},
            {"task_id": "t_two", "content": "latest two\n"},
        ],
    }
    assert rejected.status_code == 400


def test_kanban_overview_reports_progress_and_delivery_success(
    sidecar, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Board progress, card summaries and the run success rate share one read."""

    module, client = sidecar
    home = module.plugin_api._workspace_root()
    monkeypatch.setenv("HERMES_KANBAN_HOME", str(home))
    database = home / "kanban" / "boards" / "digital-hub" / "kanban.db"
    database.parent.mkdir(parents=True)
    connection = sqlite3.connect(database)
    connection.executescript(
        """
        CREATE TABLE tasks (
            id TEXT PRIMARY KEY, title TEXT, status TEXT, assignee TEXT, result TEXT,
            created_at REAL, started_at REAL, completed_at REAL, last_failure_error TEXT
        );
        CREATE TABLE task_runs (
            id INTEGER PRIMARY KEY, task_id TEXT, status TEXT, outcome TEXT,
            summary TEXT, started_at REAL, ended_at REAL
        );
        """
    )
    connection.executemany(
        "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)",
        [
            ("t_done", "Ship the overview", "done", "project-manager", "Delivered the board overview", 10, 11, 12, None),
            ("t_live", "Track the rollout", "running", "writer", None, 20, 21, None, None),
            ("t_stuck", "Blocked delivery", "blocked", "default", None, 30, 31, None, "Provider refused the request"),
        ],
    )
    connection.executemany(
        "INSERT INTO task_runs VALUES (?,?,?,?,?,?,?)",
        [
            (1, "t_done", "done", "completed", "First delivery", 11, 12),
            (2, "t_done", "crashed", "crashed", "Worker exited", 13, 14),
            (3, "t_done", "done", "completed", "Second delivery", 15, 16),
            (4, "t_live", "running", None, None, 21, None),
            (5, "t_stuck", "blocked", "blocked", "Waiting for input", 31, None),
        ],
    )
    connection.commit()
    connection.close()
    headers = {"X-Hermes-Proxy-Secret": "proxy-secret", "Remote-User": "alice"}
    endpoint = "/api/plugins/workbench/kanban-overview"

    response = client.post(endpoint, headers=headers, json={"board": "digital-hub"})
    missing = client.post(endpoint, headers=headers, json={"board": "research"})
    rejected = client.post(endpoint, headers=headers, json={"board": "../etc"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["stats"]["tasks_total"] == 3
    assert payload["stats"]["by_status"] == {"done": 1, "running": 1, "blocked": 1}
    assert payload["stats"]["runs_total"] == 5
    assert payload["stats"]["runs_completed"] == 2
    assert payload["stats"]["runs_failed"] == 1
    assert payload["stats"]["runs_in_flight"] == 1
    assert payload["stats"]["runs_neutral"] == 1
    assert payload["stats"]["success_rate"] == 0.6667
    tasks = {item["task_id"]: item for item in payload["tasks"]}
    assert tasks["t_done"]["summary"] == "Delivered the board overview"
    assert tasks["t_done"]["latest_run"]["outcome"] == "completed"
    assert tasks["t_done"]["run_count"] == 3
    assert tasks["t_done"]["failed_runs"] == 1
    assert tasks["t_live"]["latest_run"]["status"] == "running"
    assert tasks["t_stuck"]["failure"] == "Provider refused the request"
    assert missing.status_code == 200
    assert missing.json()["available"] is False
    assert missing.json()["stats"] is None
    assert rejected.status_code == 400


def test_kanban_task_keeps_its_first_session_binding(sidecar) -> None:
    """A board/task pair remains pinned to its first conversation."""

    _module, client = sidecar
    headers = {
        "X-Hermes-Proxy-Secret": "proxy-secret",
        "Remote-User": "alice",
    }
    endpoint = "/api/plugins/workbench/kanban-sessions"
    first = {
        "board": "delivery",
        "task_id": "task-42",
        "profile": "default",
        "session_id": "session-first",
    }
    second = {**first, "profile": "research", "session_id": "session-second"}

    first_response = client.put(endpoint, headers=headers, json=first)
    second_response = client.put(endpoint, headers=headers, json=second)
    listed = client.get(endpoint, headers=headers, params={"board": "delivery", "task_id": "task-42"})

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["link"] == first_response.json()["link"]
    assert listed.status_code == 200
    assert listed.json()["items"] == [first_response.json()["link"]]


def test_kanban_link_migration_keeps_newest_legacy_row(sidecar) -> None:
    """Opening an old multi-row database collapses each task to its newest link."""

    module, client = sidecar
    database = module.plugin_api._organization_db_path()
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE kanban_session_links (
                board TEXT NOT NULL DEFAULT '',
                task_id TEXT NOT NULL,
                profile TEXT NOT NULL,
                session_id TEXT NOT NULL,
                created_at REAL NOT NULL,
                PRIMARY KEY (board, task_id, profile, session_id)
            )
            """
        )
        connection.executemany(
            """
            INSERT INTO kanban_session_links (board, task_id, profile, session_id, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                ("legacy", "task-7", "default", "older-session", 10.0),
                ("legacy", "task-7", "research", "newest-session", 20.0),
            ],
        )

    response = client.get(
        "/api/plugins/workbench/kanban-sessions",
        headers={
            "X-Hermes-Proxy-Secret": "proxy-secret",
            "Remote-User": "alice",
        },
        params={"board": "legacy", "task_id": "task-7"},
    )

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "board": "legacy",
            "task_id": "task-7",
            "profile": "research",
            "session_id": "newest-session",
            "created_at": 20.0,
        }
    ]


def test_legacy_kanban_chat_is_discovered_and_bound_to_requested_board(sidecar) -> None:
    """Pre-link Workbench chats are lazily migrated instead of opening a new conversation."""

    module, client = sidecar
    state_db = module.plugin_api._hermes_state_db_path()
    with sqlite3.connect(state_db) as connection:
        connection.executescript(
            """
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                started_at REAL NOT NULL,
                profile_name TEXT
            );
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT
            );
            """
        )
        connection.executemany(
            "INSERT INTO sessions (id, started_at, profile_name) VALUES (?, ?, ?)",
            [
                ("worker-session", 5.0, "default"),
                ("first-discussion", 10.0, None),
                ("duplicate-discussion", 20.0, "research"),
            ],
        )
        connection.executemany(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
            [
                ("worker-session", "user", "Work kanban task task-legacy"),
                (
                    "first-discussion",
                    "user",
                    "我从看板打开了任务 task-legacy。请先读取这张卡的详情，再讨论下一步。",
                ),
                (
                    "duplicate-discussion",
                    "user",
                    "我从看板打开了任务 task-legacy。重复打开不应取代第一次讨论。",
                ),
            ],
        )

    headers = {
        "X-Hermes-Proxy-Secret": "proxy-secret",
        "Remote-User": "alice",
    }
    endpoint = "/api/plugins/workbench/kanban-sessions"
    response = client.get(
        endpoint,
        headers=headers,
        params={"board": "digital-hub", "task_id": "task-legacy"},
    )
    repeated = client.get(
        endpoint,
        headers=headers,
        params={"board": "digital-hub", "task_id": "task-legacy"},
    )

    assert response.status_code == 200
    [link] = response.json()["items"]
    assert link["board"] == "digital-hub"
    assert link["profile"] == "default"
    assert link["session_id"] == "first-discussion"
    assert repeated.json()["items"] == [link]


def test_gate_marks_websocket_scope_for_plugin_api(monkeypatch: pytest.MonkeyPatch) -> None:
    """The raw-shell endpoint can trust the sidecar gate without private Hermes hooks."""

    dashboard = Path(__file__).parents[1] / "dashboard"
    monkeypatch.syspath_prepend(str(dashboard))
    module = importlib.import_module("sidecar_app")
    monkeypatch.setenv("HERMES_DASHBOARD_TRUSTED_PROXY_SECRET", "proxy-secret")
    monkeypatch.setenv("HERMES_WORKBENCH_ALLOWED_USERS", "bob")
    captured: dict[str, object] = {}

    async def inner(scope, _receive, _send) -> None:
        """Capture the authenticated scope passed to the plugin router."""

        captured.update(scope.get("state", {}))

    gate = module.TrustedProxyGate(inner)
    scope = {
        "type": "websocket",
        "path": "/api/plugins/workbench/shell",
        "headers": [
            (b"x-hermes-proxy-secret", b"proxy-secret"),
            (b"remote-user", b"bob"),
        ],
    }

    import asyncio

    asyncio.run(gate(scope, lambda: None, lambda _message: None))
    assert captured == {"workbench_authenticated": True}


def test_pending_managed_update_blocks_mutations_but_keeps_status_and_auth(sidecar, tmp_path, monkeypatch):
    import json
    monkeypatch.setenv('WORKBENCH_RELEASE_HOME', str(tmp_path / 'managed'))
    root = tmp_path / 'managed';root.mkdir()
    (root/'update.json').write_text(json.dumps({'id':'job','phase':'queued'}))
    _module,client=sidecar
    headers={'X-Hermes-Proxy-Secret':'proxy-secret','Remote-User':'developer'}
    blocked = client.post('/api/plugins/workbench/files', headers=headers, json={})
    assert blocked.status_code == 503
    assert blocked.headers['retry-after'] == '5'
    assert client.post('/api/plugins/workbench/files',json={}).status_code == 401
    assert client.get('/api/plugins/workbench/versions/update-status',headers=headers).json()['id'] == 'job'


def test_idle_event_subscription_does_not_reserve_mutation_slot(monkeypatch):
    import asyncio
    import sidecar_app
    import workbench_version_manager as versions
    monkeypatch.setenv('HERMES_DASHBOARD_TRUSTED_PROXY_SECRET', 'proxy-secret')
    monkeypatch.setenv('HERMES_WORKBENCH_ALLOWED_USERS', 'developer')
    observed = []
    async def endpoint(scope, receive, send):
        observed.append(versions._active_mutations)
    gate = sidecar_app.TrustedProxyGate(endpoint)
    async def noop(*args): pass
    def call(path):
        asyncio.run(gate({'type': 'websocket', 'path': path, 'headers': [(b'x-hermes-proxy-secret', b'proxy-secret'), (b'remote-user', b'developer')]}, noop, noop))
    call('/api/plugins/workbench/codex/events')
    call('/api/plugins/workbench/terminal')
    assert observed == [0, 1]
    assert versions._active_mutations == 0
