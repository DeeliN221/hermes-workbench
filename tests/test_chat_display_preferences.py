"""Optional chat utility visibility persists per identity and profile."""
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
import plugin_api as api


def application(monkeypatch, tmp_path):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    monkeypatch.setattr(api, '_model_display_owner', lambda request: request.headers.get('remote-user', '').lower())
    app = FastAPI()
    app.include_router(api.router)
    return app


def test_optional_chat_utilities_default_off_and_are_profile_scoped(tmp_path, monkeypatch):
    with TestClient(application(monkeypatch, tmp_path)) as client:
        headers = {'remote-user': 'Alice'}
        default = client.get('/chat-display-preferences', headers=headers)
        assert default.json() == {
            'generationSpeedEnabled': False,
            'userMessageNavigatorEnabled': False,
        }
        assert default.headers['cache-control'] == 'no-store'
        enabled = {'generationSpeedEnabled': True, 'userMessageNavigatorEnabled': True}
        assert client.put('/chat-display-preferences?profile=writer', headers=headers, json=enabled).json() == enabled
        assert client.get('/chat-display-preferences?profile=writer', headers=headers).json() == enabled
        assert client.get('/chat-display-preferences', headers=headers).json() == {
            'generationSpeedEnabled': False,
            'userMessageNavigatorEnabled': False,
        }
        assert client.get('/chat-display-preferences?profile=writer', headers={'remote-user': 'Bob'}).json() == {
            'generationSpeedEnabled': False,
            'userMessageNavigatorEnabled': False,
        }
        assert client.put('/chat-display-preferences?profile=../other', headers=headers, json=enabled).status_code == 422


def test_optional_chat_utilities_survive_app_restart(tmp_path, monkeypatch):
    enabled = {'generationSpeedEnabled': False, 'userMessageNavigatorEnabled': True}
    with TestClient(application(monkeypatch, tmp_path)) as client:
        client.put('/chat-display-preferences?profile=writer', headers={'remote-user': 'Alice'}, json=enabled)
    with TestClient(application(monkeypatch, tmp_path)) as restarted:
        assert restarted.get('/chat-display-preferences?profile=writer', headers={'remote-user': 'Alice'}).json() == enabled
