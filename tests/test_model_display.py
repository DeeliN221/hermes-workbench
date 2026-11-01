"""Durable per-owner/profile preferences in the existing plugin database."""
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
import plugin_api as api
from sidecar_app import TrustedProxyGate

@pytest.fixture()
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    return tmp_path

def body(**changes):
    return api.ModelDisplayBody(visible=['gpt-6-astra'], aliases={'gpt-6-astra': 'astra'}, **changes)

def test_migration_restart_isolation_and_conflict(root):
    first = api._model_display('alice', 'default', body(), True)
    assert api._model_display('alice', 'default', body(), True) == first
    # Every call closes/reopens the database; persisted data is not module state.
    assert api._model_display('alice', 'default') == first
    assert api._model_display('bob', 'default')['preferences'] is None
    assert api._model_display('alice', 'writer')['preferences'] is None
    newer = api._model_display('alice', 'default', api.ModelDisplayBody(visible=[], aliases={}, revision=1))
    assert api._model_display('alice', 'default', body(), True) == newer
    with pytest.raises(HTTPException) as error:
        api._model_display('alice', 'default', body())
    assert error.value.status_code == 409
    assert api._model_display('alice', 'default') == newer
    assert (root / '.hermes-workbench/session-organization.sqlite3').is_file()

@pytest.mark.parametrize('attempt', range(20))
def test_concurrent_first_migration_has_one_winner(root, attempt):
    barrier = Barrier(8)
    def migrate(_):
        barrier.wait(timeout=10)
        return api._model_display('alice', 'default', body(), True)
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(migrate, range(8)))
    assert all(result == results[0] for result in results)
    assert results[0]['preferences']['revision'] == 1

def test_proxy_users_origins_and_recreated_backend(root, monkeypatch):
    monkeypatch.setenv('HERMES_DASHBOARD_TRUSTED_PROXY_SECRET', 'test-secret')
    monkeypatch.setenv('HERMES_WORKBENCH_ALLOWED_USERS', 'alice,bob')
    def client():
        app = FastAPI()
        app.include_router(api.router, prefix='/api/plugins/workbench')
        app.add_middleware(TrustedProxyGate)
        return TestClient(app)
    headers = {'x-hermes-proxy-secret': 'test-secret', 'remote-user': 'alice', 'Origin': 'http://localhost:8080'}
    url = '/api/plugins/workbench/model-display'
    with client() as first:
        saved = first.post(url + '/migrate', headers=headers, json=body().model_dump()).json()
        assert first.get(url, headers={'remote-user': 'alice'}).status_code == 401
    with client() as restarted:
        headers['Origin'] = 'https://workbench.example'
        response = restarted.get(url, headers=headers)
        assert response.json() == saved
        assert response.headers['cache-control'] == 'no-store'
        headers['remote-user'] = 'bob'
        assert restarted.get(url, headers=headers).json()['preferences'] is None

def test_failed_write_preserves_saved_state(root, monkeypatch):
    saved = api._model_display('alice', 'default', body(), True)
    original = api._open_organization_db
    def broken():
        raise OSError('disk full')
    monkeypatch.setattr(api, '_open_organization_db', broken)
    with pytest.raises(OSError):
        api._model_display('alice', 'default', body(revision=1))
    monkeypatch.setattr(api, '_open_organization_db', original)
    assert api._model_display('alice', 'default') == saved
