import sys
from pathlib import Path
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
import plugin_api as api


def test_persistence_isolation_reset(tmp_path, monkeypatch):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    app = FastAPI()
    app.include_router(api.router)
    with TestClient(app) as client:
        assert client.get('/profile-order').status_code == 401
        assert client.put('/profile-order', json={'order': []}).status_code == 401
        assert client.put('/profile-order', headers={'remote-user': 'Alice'}, json={'order': ['empty', 'default']}).json() == {'order': ['empty', 'default']}
    with TestClient(app) as client:
        assert client.get('/profile-order', headers={'remote-user': 'Alice'}).json() == {'order': ['empty', 'default']}
        assert client.get('/profile-order', headers={'remote-user': 'Bob'}).json() == {'order': []}
        assert client.put('/profile-order', headers={'remote-user': 'Alice'}, json={'order': ['x', 'x']}).status_code == 422
        assert client.put('/profile-order', headers={'remote-user': 'Alice'}, json={'order': []}).json() == {'order': []}
        assert client.get('/profile-order', headers={'remote-user': 'Alice'}).json() == {'order': []}


def test_home_labels_persist_per_user_and_profile(tmp_path, monkeypatch):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    app = FastAPI()
    app.include_router(api.router)
    with TestClient(app) as client:
        assert client.get('/home-preferences').status_code == 401
        assert client.put('/home-preferences', json={'show_project_labels': False}).status_code == 401
        assert client.put('/home-preferences?profile=writer', headers={'remote-user':'Alice'}, json={'show_project_labels':False}).json() == {'labels': {'writer': False}}
    with TestClient(app) as client:
        assert client.get('/home-preferences', headers={'remote-user':'Alice'}).json() == {'labels': {'writer': False}}
        assert client.get('/home-preferences', headers={'remote-user':'Bob'}).json() == {'labels': {}}
        assert client.put('/home-preferences?profile=../bad', headers={'remote-user':'Alice'}, json={'show_project_labels':False}).status_code == 422
