import sys
import subprocess
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
import plugin_api as api


def _app(monkeypatch, tmp_path):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    app = FastAPI()
    app.include_router(api.router)
    return app


def test_home_layout_defaults_persist_and_isolate_by_profile(tmp_path, monkeypatch):
    app = _app(monkeypatch, tmp_path)
    with TestClient(app) as client:
        assert client.get('/home-layout').status_code == 401
        assert client.get('/home-layout', headers={'remote-user': 'Alice'}).json() == {
            'columns': 3, 'sessions_per_profile': 3,
        }
        saved = client.put(
            '/home-layout?profile=writer',
            headers={'remote-user': 'Alice'},
            json={'columns': 4, 'sessions_per_profile': 5},
        )
        assert saved.status_code == 200
        assert saved.json() == {'columns': 4, 'sessions_per_profile': 5}
        assert client.get('/home-layout?profile=writer', headers={'remote-user': 'Alice'}).json() == {
            'columns': 4, 'sessions_per_profile': 5,
        }
        assert client.get('/home-layout?profile=default', headers={'remote-user': 'Alice'}).json() == {
            'columns': 3, 'sessions_per_profile': 3,
        }
        assert client.get('/home-layout?profile=writer', headers={'remote-user': 'Bob'}).json() == {
            'columns': 3, 'sessions_per_profile': 3,
        }

    # A new application process reads the same profile-scoped database.
    with TestClient(_app(monkeypatch, tmp_path)) as client:
        assert client.get('/home-layout?profile=writer', headers={'remote-user': 'Alice'}).json() == {
            'columns': 4, 'sessions_per_profile': 5,
        }

    # A separate interpreter has no in-memory application or SQLite connection.
    restarted = subprocess.run(
        [sys.executable, '-c', """
import json, sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path.cwd() / 'dashboard'))
import plugin_api as api
api._workspace_root = lambda: Path(sys.argv[1])
app = FastAPI()
app.include_router(api.router)
with TestClient(app) as client:
    print(json.dumps(client.get('/home-layout?profile=writer', headers={'remote-user': 'Alice'}).json()))
""", str(tmp_path)],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True,
    )
    import json
    assert json.loads(restarted.stdout) == {'columns': 4, 'sessions_per_profile': 5}


def test_home_layout_rejects_out_of_range_and_invalid_profile(tmp_path, monkeypatch):
    app = _app(monkeypatch, tmp_path)
    with TestClient(app) as client:
        for body in (
            {'columns': 0, 'sessions_per_profile': 3},
            {'columns': 7, 'sessions_per_profile': 3},
            {'columns': 3, 'sessions_per_profile': 0},
            {'columns': 3, 'sessions_per_profile': 21},
            {'columns': 2.5, 'sessions_per_profile': 3},
        ):
            assert client.put('/home-layout', headers={'remote-user': 'Alice'}, json=body).status_code == 422
        assert client.put(
            '/home-layout?profile=../bad',
            headers={'remote-user': 'Alice'},
            json={'columns': 3, 'sessions_per_profile': 3},
        ).status_code == 422
        assert client.get('/home-layout?profile=../bad', headers={'remote-user': 'Alice'}).status_code == 422


def test_home_layout_bounds_and_damaged_storage(tmp_path, monkeypatch):
    app = _app(monkeypatch, tmp_path)
    headers = {'remote-user': 'Alice'}
    with TestClient(app) as client:
        for columns, sessions in ((1, 1), (6, 20)):
            body = {'columns': columns, 'sessions_per_profile': sessions}
            assert client.put('/home-layout', headers=headers, json=body).json() == body
        for value in (True, '4', None):
            assert client.put('/home-layout', headers=headers, json={'columns': value, 'sessions_per_profile': 3}).status_code == 422
        connection = api._open_organization_db()
        with connection:
            connection.execute("UPDATE home_layout SET columns='bad', sessions_per_profile=99")
        connection.close()
        result = client.get('/home-layout', headers=headers)
        assert result.status_code == 200
        assert result.json() == {'columns': 3, 'sessions_per_profile': 3, 'invalid_fields': True}
