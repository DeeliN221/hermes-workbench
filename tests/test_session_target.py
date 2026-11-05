import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import io
import json
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import BridgeStore, create_router
from session_target import mapped_target, resolve_target
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def service(tmp_path):
    store = BridgeStore(tmp_path / 'bridge.db')
    for user, profile, sid, thread, device, status in [
        ('qa', 'default', 'workbench-local', 'native-local', 'studio', 'idle'),
        ('qa', 'writer', 'workbench-nas', 'native-nas', 'nas', 'idle'),
        ('qa', 'default', 'old', 'native-old', 'studio', 'archived'),
        ('other', 'default', 'private', 'native-private', 'studio', 'idle'),
    ]:
        store.upsert_session(user, profile, dict(session_id=sid, thread_id=thread, execution_node_id=device,
            status=status, workspace_id='default', workspace_path=str(tmp_path)))
    yield SimpleNamespace(store=store)
    store.close()


def test_scoped_resolution(service):
    assert mapped_target(service, 'qa', 'default', 'native-local', 'studio')['id'] == 'workbench-local'
    assert mapped_target(service, 'qa', 'writer', 'native-nas', 'nas')['id'] == 'workbench-nas'
    for user, profile, thread, device in [('qa', 'default', 'missing', 'studio'),
        ('qa', 'default', 'native-private', 'studio'), ('qa', 'default', 'native-nas', 'nas'),
        ('qa', 'default', 'native-local', 'nas')]:
        assert mapped_target(service, user, profile, thread, device) == {'state': 'unavailable'}
    assert mapped_target(service, 'qa', 'default', 'native-old', 'studio') == {'state': 'archived'}
    service.store.update_organization('qa', 'default', 'workbench-local', {'deleted': True})
    assert mapped_target(service, 'qa', 'default', 'native-local', 'studio')['state'] == 'archived'


def test_endpoint_identity_and_profile(service):
    app = FastAPI()
    app.include_router(create_router(service), prefix='/codex')
    client = TestClient(app)
    path = '/codex/session-target?conversation_id=native-nas&profile=writer&device=nas'
    assert client.get(path).status_code == 401
    assert client.get(path, headers={'remote-user': 'qa'}).json()['id'] == 'workbench-nas'
    assert client.get(path.replace('writer', 'default'), headers={'remote-user': 'qa'}).json()['state'] == 'unavailable'


def test_remote_allowlist(service, monkeypatch):
    assert resolve_target(service, 'qa', 'default', 'remote', 'evil.example')['state'] == 'unavailable'
    monkeypatch.setenv('HERMES_WORKBENCH_SESSION_DEVICES', json.dumps({'nas': {'url': 'https://nas.example', 'proxy_secret': 'test-secret'}}))
    response = {'state': 'available', 'id': 'real-session', 'kind': 'codex', 'profile': 'default'}
    with patch('urllib.request.build_opener') as opener:
        opener.return_value.open.return_value.__enter__.return_value = io.BytesIO(json.dumps(response).encode())
        result = resolve_target(service, 'qa', 'default', 'remote', 'nas')
        assert result['remoteUrl'] == 'https://nas.example/chat?session=real-session&profile=default'
        request = opener.return_value.open.call_args.args[0]
        assert request.get_header('Remote-user') == 'qa'
        assert 'conversation_id=remote' in request.full_url
        response['profile'] = 'other'
        opener.return_value.open.return_value.__enter__.return_value = io.BytesIO(json.dumps(response).encode())
        assert resolve_target(service, 'qa', 'default', 'remote', 'nas')['state'] == 'unavailable'


def test_remote_never_falls_back_to_local_or_task_url(service, monkeypatch):
    monkeypatch.setenv('HERMES_WORKBENCH_SESSION_DEVICES', json.dumps({'nas': {'url': 'https://nas.example', 'proxy_secret': 'test-secret'}}))
    with patch('urllib.request.build_opener') as opener:
        opener.return_value.open.side_effect = OSError('offline')
        # Even a local mapping for this remote node cannot override its owner.
        assert resolve_target(service, 'qa', 'writer', 'native-nas', 'nas') == {'state': 'unavailable'}
        redirect_policy = opener.call_args.args[0]
        assert redirect_policy.redirect_request(None, None, 302, '', {}, 'https://evil.example') is None
    for base in ['http://nas.example', 'https://user:password@nas.example', 'https://nas.example/?token=x']:
        monkeypatch.setenv('HERMES_WORKBENCH_SESSION_DEVICES', json.dumps({'nas': {'url': base, 'proxy_secret': 'test-secret'}}))
        assert resolve_target(service, 'qa', 'writer', 'native-nas', 'nas') == {'state': 'unavailable'}


def test_fleet_resolver_is_identity_scoped_and_rejects_other_session_kinds(service):
    from fleetd_proxy import router
    app = FastAPI()
    app.state.codex_bridge = service
    app.include_router(router, prefix='/fleet')
    client = TestClient(app)
    path = '/fleet/fleetd/session-target?conversation_id=native-local&profile=default&device=studio'
    assert client.get(path).status_code == 401
    response = client.get(path, headers={'remote-user': 'qa'})
    assert response.json()['id'] == 'workbench-local'
    assert response.headers['cache-control'] == 'no-store'
    assert client.get(path, headers={'remote-user': 'other'}).json() == {'state': 'unavailable'}
    assert client.get(path + '&kind=hermes', headers={'remote-user': 'qa'}).json() == {'state': 'unavailable'}
