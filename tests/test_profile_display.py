"""Display names survive restarts without modifying profile identity or session data."""
import sys
from pathlib import Path
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
import plugin_api as api
import skill_files
from sidecar_app import TrustedProxyGate

@pytest.fixture()
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    monkeypatch.setattr(skill_files, '_workspace_root', lambda: tmp_path)
    (tmp_path / 'profiles/writer').mkdir(parents=True)
    (tmp_path / 'profiles/writer/config.yaml').write_text('model: unchanged')
    return tmp_path

def test_persistence_owner_boundary_and_reset(root):
    body = api.ProfileDisplayBody(display_name='Main Agent')
    api._profile_display('alice', 'default', body)
    api._profile_display('alice', 'writer', api.ProfileDisplayBody(display_name='Author'))
    assert api._profile_display('alice')['aliases'] == {'default': 'Main Agent', 'writer': 'Author'}
    assert api._profile_display('bob')['aliases'] == {}
    api._profile_display('alice', 'default', api.ProfileDisplayBody(display_name=''))
    assert api._profile_display('alice')['aliases'] == {'writer': 'Author'}
    assert (root / 'profiles/writer/config.yaml').read_text() == 'model: unchanged'
    assert not (root / 'profiles/default').exists()
    assert (root / '.hermes-workbench/session-organization.sqlite3').is_file()

def test_invalid_profile_does_not_fall_back(root):
    for profile in ['../writer', 'missing']:
        with pytest.raises(HTTPException):
            api._profile_display('alice', profile, api.ProfileDisplayBody(display_name='Wrong'))
    assert api._profile_display('alice')['aliases'] == {}

def test_authenticated_api_restart(root, monkeypatch):
    monkeypatch.setenv('HERMES_DASHBOARD_TRUSTED_PROXY_SECRET', 'test-secret')
    monkeypatch.setenv('HERMES_WORKBENCH_ALLOWED_USERS', 'alice,bob')
    def client():
        app = FastAPI()
        app.include_router(api.router, prefix='/api/plugins/workbench')
        app.add_middleware(TrustedProxyGate)
        return TestClient(app)
    headers = {'x-hermes-proxy-secret': 'test-secret', 'remote-user': 'alice', 'Origin': 'https://workbench.example'}
    url = '/api/plugins/workbench/profile-display'
    with client() as first:
        assert first.put(url, headers=headers, json={'display_name': 'Main Agent'}).status_code == 200
        assert first.put(url, json={'display_name': 'Intruder'}).status_code == 401
        assert first.get(url).status_code == 401
        assert first.put(url, headers=headers, json={'display_name': 'x' * 65}).status_code == 422
    with client() as second:
        response = second.get(url, headers=headers)
        assert response.json()['aliases'] == {'default': 'Main Agent'}
        assert response.headers['cache-control'] == 'no-store'
        headers['remote-user'] = 'bob'
        assert second.get(url, headers=headers).json()['aliases'] == {}
