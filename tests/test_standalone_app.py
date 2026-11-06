"""Host isolation + neutral protocol fixture tests. No model/runtime launch."""
import asyncio
import importlib.util
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dashboard.standalone_app import create_app
from dashboard.standalone_store import Store

spec = importlib.util.spec_from_file_location('standalone_protocol_fixture', Path(__file__).with_name('standalone_protocol_fixture.py'))
fixture_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_module)


def setup(tmp_path, **options):
    fixture = fixture_module.create_fixture()
    app = create_app(home=tmp_path / 'state', workspace_root=tmp_path / 'workspaces', runtime_url='http://localhost', transport=httpx.ASGITransport(app=fixture), runtime_token='fixture-only-credential', allow_missing_services=True, **options)
    client = TestClient(app)
    return app, client, fixture


def login(app, client):
    assert client.post('/api/standalone/bootstrap', headers={'X-Workbench-Request': '1', 'Authorization': 'Bearer ' + app.state.bootstrap_token}).status_code == 200
    client.headers['X-Workbench-Request'] = '1'


def create_session(client, profile='default', project='default'):
    result = client.post('/api/runtime/sessions', json={'profile_id': profile, 'project_id': project})
    assert result.status_code == 200, result.text
    return result.json()['id']


def test_auth_origin_and_no_legacy_runtime(tmp_path):
    before = set(sys.modules)
    app, client, fixture = setup(tmp_path)
    assert client.get('/api/profiles', headers={'X-User-ID': 'owner'}).status_code == 401
    assert client.post('/api/standalone/bootstrap', headers={'X-Workbench-Request': '1', 'Authorization': 'Bearer wrong'}).status_code == 401
    assert client.post('/api/standalone/bootstrap').status_code == 403
    login(app, client)
    assert client.get('/api/profiles').status_code == 200
    assert client.put('/api/config', json={}, headers={'Origin': 'https://untrusted.example'}).status_code == 403
    assert client.get('/api/profiles', headers={'Host': 'untrusted.example'}).status_code == 403
    assert client.get('/api/runtime/models').status_code == 200
    assert 'fixture-only-credential' not in client.get('/api/runtime/models').text
    assert fixture.state.requests[-1][2]['authorization'] == 'Bearer fixture-only-credential'
    assert not any(name.startswith(('hermes', 'codex_runtime', 'dashboard.plugin')) for name in set(sys.modules) - before)
    with pytest.raises(Exception):
        with client.websocket_connect('/api/plugins/workbench/terminal', headers={'Origin': 'https://untrusted.example'}):
            pass


def test_scoped_projects_context_and_sessions(tmp_path):
    app, client, fixture = setup(tmp_path)
    login(app, client)
    sid = create_session(client)
    other = client.post('/api/profiles', json={'name': 'Other'}).json()['name']
    for url in [f'/api/standalone/context?profile={other}&session={sid}', f'/api/runtime/sessions/{sid}/snapshot?profile_id={other}', '/api/standalone/context?profile=missing', '/api/standalone/context?project_id=missing']:
        assert client.get(url).status_code == 404, url
    assert client.post('/api/runtime/sessions', json={'profile_id': 'missing'}).status_code == 404
    assert client.post('/api/runtime/sessions', json={'cwd': '/tmp'}).status_code == 422
    assert client.post('/api/plugins/workbench/runtime-ui/groups', json={'name': 'Escape', 'relative_path': '..'}).status_code == 422
    assert client.get(f'/api/runtime/sessions/{sid}/snapshot').status_code == 200
    assert fixture.state.sessions[sid]['cwd'] == str((tmp_path / 'workspaces').resolve())
    assert client.get(f'/api/runtime/sessions?profile_id={other}').json() == []
    # A session not created by this authenticated host is never adopted from a list.
    fixture.state.sessions['foreign'] = {'session': {'id': 'foreign', 'profile_id': 'default', 'project_id': 'default', 'runtime': 'dsh'}}
    assert [r['id'] for r in client.get('/api/runtime/sessions').json()] == [sid]
    assert client.get('/api/runtime/sessions/foreign/snapshot').status_code == 404


def test_persistence_and_store_user_isolation(tmp_path):
    app, client, _ = setup(tmp_path)
    login(app, client)
    preferences = {'locale': 'en', 'theme': 'dark', 'cache': {'hermes-workbench.chat-detail': 'detailed'}}
    assert client.put('/api/plugins/workbench/preferences', json=preferences).json() == preferences
    assert client.put('/api/profiles/default/model', json={'provider': 'dsh', 'model': 'protocol-fixture'}).json() == {'ok': True}
    project = client.post('/api/plugins/workbench/runtime-ui/groups', json={'name': 'Project'}).json()['group']
    assert client.patch(f"/api/plugins/workbench/runtime-ui/groups/{project['id']}/appearance", json={'color': 'blue', 'icon': 'book', 'model': 'protocol-fixture'}).status_code == 200
    sid = create_session(client, project=project['id'])
    app.state.store.bootstrap('another-user')
    assert app.state.store.preferences('another-user', 'default') == {}
    assert not app.state.store.owns_session(app.state.store.context('another-user', 'default', 'default'), sid)
    app.state.store.close()
    app2, client2, _ = setup(tmp_path)
    login(app2, client2)
    assert client2.get('/api/plugins/workbench/preferences').json() == preferences
    assert client2.get('/api/config').json()['model'] == 'protocol-fixture'
    projects = client2.get('/api/plugins/workbench/runtime-ui/groups').json()['items']
    assert next(p for p in projects if p['id'] == project['id'])['color'] == 'blue'
    assert app2.state.store.session_context('local-owner', 'default', sid)['project_id'] == project['id']


def test_create_send_stream_refresh_cancel_interactions(tmp_path):
    app, client, fixture = setup(tmp_path)
    login(app, client)
    with client:
        sid = create_session(client)
        base = f'/api/runtime/sessions/{sid}'
        result = client.post(base + '/messages', json={'content': 'hello', 'request_id': 'once'})
        assert result.json()['accepted'] is True
        # Receipt is not completion. The durable snapshot is still running.
        assert client.get(base + '/snapshot').json()['status'] == 'running'
        client.post(base + '/messages', json={'content': 'hello', 'request_id': 'once'})
        client.portal.call(asyncio.sleep, .3)
        snapshot = client.get(base + '/snapshot').json()
        assert snapshot['status'] == 'completed'
        assert len(snapshot['messages']) == 2
        assert snapshot['messages'][-1]['content'] == 'Protocol fixture reply: hello'
        # Check the actual host stream proxy with a bounded deterministic SSE transport.
        class OneStream(httpx.AsyncBaseTransport):
            async def handle_async_request(self, request):
                event = fixture.state.sessions[sid]['events'][-1]
                return httpx.Response(200, text='data: ' + __import__('json').dumps(event) + '\n\n', headers={'Content-Type': 'text/event-stream'})
        stream_app = create_app(home=tmp_path / 'state', workspace_root=tmp_path / 'workspaces', runtime_url='http://localhost', transport=OneStream(), allow_missing_services=True)
        stream_client = TestClient(stream_app)
        login(stream_app, stream_client)
        streamed = stream_client.get(base + '/events?cursor=0')
        assert streamed.status_code == 200
        assert '"type": "state"' in streamed.text
        assert '"status": "completed"' in streamed.text
        client.post(base + '/messages', json={'content': 'slow', 'request_id': 'slow'})
        assert client.post(base + '/cancel').json()['accepted'] is True
        assert client.get(base + '/snapshot').json()['status'] == 'cancelled'
        client.post(base + '/messages', json={'content': 'interaction', 'request_id': 'interact'})
        client.portal.call(asyncio.sleep, .2)
        assert client.get(base + '/snapshot').json()['interactions'][0]['id'] == 'permission-1'
        assert client.post(base + '/interactions/permission-1', json={'decision': 'approve'}).status_code == 200
        assert client.post(base + '/interactions/permission-1', json={'decision': 'approve'}).status_code == 410
        assert client.get(base + '/snapshot').json()['interactions'] == []


def test_missing_bridge_services_and_configuration(tmp_path, monkeypatch):
    original_import = __import__("importlib").import_module
    def absent(name, package=None):
        if name == ".standalone_services":
            raise ModuleNotFoundError("Isolated missing service fixture", name="dashboard.standalone_services")
        return original_import(name, package)
    monkeypatch.setattr("dashboard.standalone_app.importlib.import_module", absent)
    app = create_app(home=tmp_path / 'state', workspace_root=tmp_path / 'workspace', allow_missing_services=True)
    client = TestClient(app)
    login(app, client)
    assert client.get('/api/runtime/models').status_code == 503
    assert 'unavailable' in client.get('/api/runtime/models').text
    assert client.get('/api/plugins/workbench/memory').status_code == 503
    with pytest.raises(ValueError):
        create_app(home=tmp_path / 'other', workspace_root=tmp_path, runtime_url='https://external.example', allow_missing_services=True)


def test_real_host_callbacks_apply_memory_soul_description_model_and_background(tmp_path):
    service_fixture = fixture_module.create_services_fixture()
    app, client, bridge = setup(tmp_path, services_module=service_fixture)
    login(app, client)
    assert app.state.services.runtime is not None
    client.put('/api/plugins/workbench/memory', json={'files': {'MEMORY.md': 'Remember the fixture requirement'}, 'version': 0})
    assert client.put('/api/profiles/default/soul', json={'content': 'Use concise fixture responses'}).status_code == 200
    assert client.get('/api/plugins/workbench/memory').json()['files']['SOUL.md'] == 'Use concise fixture responses'
    client.put('/api/profiles/default/description', json={'description': 'Visible profile instruction'})
    client.put('/api/profiles/default/model', json={'model': 'protocol-fixture', 'provider': 'dsh'})
    sid = create_session(client)
    created = bridge.state.sessions[sid]['creation_payload']
    assert created['user_id'] == 'local-owner'
    assert created['runtime_context']['memory']['MEMORY.md'] == 'Remember the fixture requirement'
    assert created['runtime_context']['memory']['SOUL.md'] == 'Use concise fixture responses'
    assert 'Visible profile instruction' in created['runtime_context']['memory']['AGENTS.md']
    assert created['runtime_context']['skills'][0]['name'] == 'fixture-skill'
    assert created['model'] == 'protocol-fixture'
    assert app.state.services.bindings[-1][1]['id'] == sid
    assert client.get('/api/cron/jobs').json() == {'jobs': []}
    client.put('/api/plugins/workbench/execution-preferences', json={'mode': 'background'})
    payload = {'content': 'A background fixture task', 'request_id': 'background-once'}
    before = len([r for r in bridge.state.requests if r[1].endswith('/messages')])
    first = client.post(f'/api/runtime/sessions/{sid}/messages', json=payload)
    assert first.status_code == 200, first.text
    assert first.json()['execution'] == 'background'
    assert first.json()['origin']['session_id'] == sid
    assert client.post(f'/api/runtime/sessions/{sid}/messages', json=payload).json() == first.json()
    assert app.state.services.submissions == 1
    assert len([r for r in bridge.state.requests if r[1].endswith('/messages')]) == before
    assert len(client.get(f'/api/runtime/sessions/{sid}/tasks').json()['tasks']) == 1
    assert client.post(f'/api/runtime/sessions/{sid}/messages', json={**payload, 'content': 'changed'}).status_code == 409
    client.put('/api/plugins/workbench/execution-preferences', json={'mode': 'foreground'})
    with client:
        result = client.post(f'/api/runtime/sessions/{sid}/messages', json={'content': 'hello', 'request_id': 'foreground'})
        assert result.json()['accepted'] is True
        assert len([r for r in bridge.state.requests if r[1].endswith('/messages')]) == before + 1
    app2, client2, _ = setup(tmp_path, services_module=service_fixture)
    login(app2, client2)
    assert client2.get(f'/api/runtime/sessions/{sid}/tasks').json()['tasks'][0]['receipt']['task_id'] == first.json()['task_id']
    assert client2.get('/api/profiles/default/soul').json()['content'] == 'Use concise fixture responses'


def test_bridge_private_file_and_scope(tmp_path, monkeypatch):
    credential = tmp_path / 'bridge-credential'
    credential.write_text('test-only-private-bridge-credential')
    credential.chmod(0o644)
    monkeypatch.setenv('WORKBENCH_RUNTIME_BRIDGE_TOKEN_FILE', str(credential))
    with pytest.raises(ValueError, match='owner-only'):
        setup(tmp_path)
    credential.chmod(0o600)
    app, client, bridge = setup(tmp_path)
    login(app, client)
    sid = create_session(client)
    result = client.get(f'/api/runtime/sessions/{sid}/snapshot')
    assert result.status_code == 200
    assert bridge.state.requests[-1][3]['user_id'] == 'local-owner'
    assert bridge.state.requests[-1][2]['authorization'] == 'Bearer test-only-private-bridge-credential'
    assert 'test-only-private-bridge-credential' not in result.text


def proxy_environment(monkeypatch):
    monkeypatch.setenv('WORKBENCH_AUTH_MODE', 'trusted-proxy')
    monkeypatch.setenv('WORKBENCH_TRUSTED_PROXY_SECRET', 'fixture-only-proxy-secret-value')
    monkeypatch.setenv('WORKBENCH_ALLOWED_USERS', 'operator-a,operator-b')
    monkeypatch.setenv('WORKBENCH_PUBLIC_ORIGIN', 'https://workbench.example.test')
    monkeypatch.setenv('WORKBENCH_ALLOWED_HOSTS', 'workbench.example.test')


def proxy_headers(user='operator-a', **extra):
    return {'Host': 'workbench.example.test', 'Origin': 'https://workbench.example.test',
            'x-hermes-proxy-secret': 'fixture-only-proxy-secret-value', 'remote-user': user,
            'X-Workbench-Request': '1', **extra}


def test_proxy_config_fails_closed_and_compatibility_env(tmp_path, monkeypatch):
    monkeypatch.setenv('WORKBENCH_AUTH_MODE', 'trusted-proxy')
    with pytest.raises(ValueError, match='Trusted proxy requires'):
        setup(tmp_path)
    proxy_environment(monkeypatch)
    monkeypatch.delenv('WORKBENCH_TRUSTED_PROXY_SECRET')
    monkeypatch.delenv('WORKBENCH_ALLOWED_USERS')
    monkeypatch.setenv('HERMES_DASHBOARD_TRUSTED_PROXY_SECRET', 'fixture-only-proxy-secret-value')
    monkeypatch.setenv('HERMES_WORKBENCH_ALLOWED_USERS', 'operator-a,operator-b')
    app, client, _ = setup(tmp_path)
    assert app.state.auth_mode == 'trusted-proxy'
    assert client.get('/api/profiles', headers=proxy_headers()).status_code == 200
    # Local credentials cannot bypass proxy identity verification.
    client.cookies.set('workbench_session', 'forged')
    assert client.get('/api/profiles', headers={'Host': 'workbench.example.test'}).status_code == 401
    assert client.post('/api/standalone/bootstrap', headers={**proxy_headers(), 'Authorization': 'Bearer ' + app.state.bootstrap_token}).status_code == 404
    monkeypatch.setenv('WORKBENCH_PUBLIC_ORIGIN', 'http://workbench.example.test')
    with pytest.raises(ValueError):
        setup(tmp_path / 'insecure')


def test_proxy_http_user_isolation_roots_identity_and_scope(tmp_path, monkeypatch):
    proxy_environment(monkeypatch)
    app, client, bridge = setup(tmp_path, services_module=fixture_module.create_services_fixture())
    a, b = proxy_headers('operator-a'), proxy_headers('operator-b')
    assert client.get('/api/profiles', headers={**a, 'x-hermes-proxy-secret': 'forged'}).status_code == 401
    assert client.get('/api/profiles', headers=proxy_headers('not-allowed')).status_code == 403
    assert client.get('/api/profiles', headers={**a, 'Host': 'evil.example.test', 'X-Forwarded-Host': 'workbench.example.test'}).status_code == 403
    assert client.put('/api/config', headers={**a, 'Origin': 'https://evil.example.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'workbench.example.test'}, json={}).status_code == 403
    no_origin = {k: v for k, v in a.items() if k != 'Origin'}
    assert client.put('/api/config', headers={**no_origin, 'X-Workbench-Request': '0'}, json={}).status_code == 403
    ctx_a = client.get('/api/standalone/context', headers=a).json()
    ctx_b = client.get('/api/standalone/context', headers=b).json()
    assert ctx_a['user_id'] == 'operator-a' and ctx_b['user_id'] == 'operator-b'
    assert ctx_a['workspace'] != ctx_b['workspace']
    assert Path(ctx_a['workspace']).is_relative_to(tmp_path / 'workspaces')
    assert Path(ctx_b['workspace']).stat().st_mode & 0o077 == 0
    client.put('/api/plugins/workbench/preferences', headers=a, json={'theme': 'dark'})
    assert client.get('/api/plugins/workbench/preferences', headers=b).json() == {}
    client.put('/api/profiles/default/soul', headers=a, json={'content': 'Operator A only'})
    assert client.get('/api/profiles/default/soul', headers=b).json()['content'] == ''
    result = client.post('/api/runtime/sessions', headers=a, json={'profile_id': 'default', 'project_id': 'default'})
    assert result.status_code == 200, result.text
    sid = result.json()['id']
    assert bridge.state.sessions[sid]['creation_payload']['user_id'] == 'operator-a'
    assert bridge.state.sessions[sid]['cwd'] == ctx_a['workspace']
    assert client.get(f'/api/runtime/sessions/{sid}/snapshot', headers=a).status_code == 200
    assert bridge.state.requests[-1][3]['user_id'] == 'operator-a'
    assert bridge.state.sessions[sid]['creation_payload']['runtime_context']['memory']['SOUL.md'] == 'Operator A only'
    for suffix in ('snapshot', 'events', 'tasks'):
        assert client.get(f'/api/runtime/sessions/{sid}/{suffix}', headers=b).status_code == 404
    assert client.post(f'/api/runtime/sessions/{sid}/cancel', headers=b).status_code == 404
    assert client.post(f'/api/runtime/sessions/{sid}/messages', headers=b, json={'content': 'steal', 'request_id': 'forged', 'user_id': 'operator-a'}).status_code == 404
    assert client.post('/api/runtime/sessions', headers=a, json={'user_id': 'operator-b'}).status_code == 422
    p = client.post('/api/profiles', headers=a, json={'name': 'Private'}).json()['name']
    assert client.get('/api/standalone/context?profile=' + p, headers=b).status_code == 404
    assert all(row['name'] != p for row in client.get('/api/profiles', headers=b).json()['profiles'])
    assert client.get('/api/runtime/sessions', headers=b).json() == []


def test_proxy_websocket_tls_origin_and_current_identity(tmp_path, monkeypatch):
    from fastapi import WebSocket
    from starlette.websockets import WebSocketDisconnect
    proxy_environment(monkeypatch)
    app, client, _ = setup(tmp_path)
    @app.websocket('/api/ws-auth-test')
    async def socket(ws: WebSocket):
        context = app.state.resolve_context(ws)
        await ws.accept()
        await ws.send_json(context)
        await ws.close()
    # Backend is HTTP; authorization compares the explicit public TLS origin.
    for identity in ('operator-a', 'operator-b'):
        with client.websocket_connect('/api/ws-auth-test', headers=proxy_headers(identity)) as ws:
            value = ws.receive_json()
            assert value['user_id'] == identity
    invalid = [
        {'Host': 'workbench.example.test', 'Origin': 'https://workbench.example.test'},
        {**proxy_headers(), 'x-hermes-proxy-secret': 'forged'},
        proxy_headers('disallowed'),
        {**proxy_headers(), 'Origin': 'http://workbench.example.test'},
        {**proxy_headers(), 'Origin': 'https://evil.example.test'},
        {**proxy_headers(), 'Host': 'evil.example.test', 'X-Forwarded-Host': 'workbench.example.test'},
        {k: v for k, v in proxy_headers().items() if k != 'Origin'},
    ]
    for headers in invalid:
        with pytest.raises(WebSocketDisconnect) as caught:
            with client.websocket_connect('/api/ws-auth-test', headers=headers) as ws:
                ws.receive_json()
        assert caught.value.code in (4401, 4403)


def test_attachment_adapter_forwards_canonical_images_and_restores_opaque_cards(tmp_path):
    from types import SimpleNamespace
    app, client, bridge = setup(tmp_path, services_module=fixture_module.create_services_fixture())
    login(app, client)
    sid = create_session(client)
    canonical = {'type': 'image', 'media_type': 'image/png', 'data': 'fixture-base64', 'name': 'sample.png'}
    async def resolve(ctx, session_id, ids):
        assert ctx['user_id'] == 'local-owner' and session_id == sid and ids == ['image-1']
        return [canonical]
    app.state.services.attachments = SimpleNamespace(resolve_inputs=resolve, record=lambda ctx, session, aid: {'id': aid, 'name': 'sample.png', 'mimeType': 'image/png', 'kind': 'file', 'size': 10})
    with client:
        result = client.post(f'/api/runtime/sessions/{sid}/messages', json={'content': 'inspect', 'request_id': 'image-request', 'attachments': ['image-1']})
        assert result.status_code == 200
        assert bridge.state.sessions[sid]['last_message_payload']['attachments'] == [canonical]
        assert client.post(f'/api/runtime/sessions/{sid}/messages', json={'content': 'changed', 'request_id': 'image-request', 'attachments': ['image-1']}).status_code == 409
        restored = client.get(f'/api/runtime/sessions/{sid}/snapshot').json()['messages'][0]
        assert restored['attachments'][0]['attachmentId'] == 'image-1'
        assert 'fixture-base64' not in __import__('json').dumps(restored)
        # Reconnection starts with an upstream snapshot whose native image IDs
        # differ from service attachment IDs. Both SSE frame shapes need the
        # same presentation as the authenticated REST snapshot.
        native = {**restored, 'content': 'inspect + internal staged references', 'attachments': [{'attachmentId': 'sha256:native-image'}]}
        events = [
            {'type': 'snapshot', 'session_id': sid, 'data': {'session': {'id': sid}, 'messages': [native]}},
            {'type': 'message.committed', 'session_id': sid, 'data': {'message': native}},
        ]
        class AttachmentStream(httpx.AsyncBaseTransport):
            async def handle_async_request(self, request):
                return httpx.Response(200, text=''.join('data: ' + __import__('json').dumps(event) + '\n\n' for event in events))
        stream_app = create_app(home=tmp_path / 'state', workspace_root=tmp_path / 'workspaces', runtime_url='http://localhost', transport=AttachmentStream())
        stream_client = TestClient(stream_app)
        login(stream_app, stream_client)
        frames = stream_client.get(f'/api/runtime/sessions/{sid}/events').text
        assert 'sha256:native-image' not in frames
        assert frames.count('"attachmentId": "image-1"') == 2
        assert 'internal staged references' not in frames


def test_workspace_layout_changes_fail_closed(tmp_path):
    store = Store(tmp_path / 'state', tmp_path / 'workspace')
    store.close()
    with pytest.raises(ValueError, match='Workspace layout changed'):
        Store(tmp_path / 'state', tmp_path / 'different-workspace')


def test_browser_create_request_id_is_idempotent_and_user_scoped(tmp_path):
    app, client, bridge = setup(tmp_path)
    login(app, client)
    body = {'profile_id': 'default', 'project_id': 'default', 'request_id': 'create-once'}
    first = client.post('/api/runtime/sessions', json=body)
    assert first.status_code == 200
    assert client.post('/api/runtime/sessions', json=body).json()['id'] == first.json()['id']
    assert len(bridge.state.sessions) == 1


def test_durable_scheduled_receipt_and_fleet_notification_are_distinct_from_inference(tmp_path):
    app, client, bridge = setup(tmp_path, services_module=fixture_module.create_services_fixture())
    login(app, client)
    sid = create_session(client)
    ctx = app.state.store.session_context('local-owner', 'default', sid)
    with client:
        send = app.state.services.runtime['scheduled_input']
        receipt = client.portal.call(send, ctx, sid, {'text': 'slow', 'request_id': 'schedule-once'})
        assert receipt == {'request_id': 'schedule-once', 'status': 'accepted', 'durable': True}
        assert client.get(f'/api/runtime/sessions/{sid}/snapshot').json()['status'] == 'running'
        client.portal.call(send, ctx, sid, {'text': 'slow', 'request_id': 'schedule-once'})
        assert len(bridge.state.sessions[sid]['requests']) == 1
        persist = app.state.services.runtime['persist_delivery']
        delivery = {'id': 'd1', 'task_id': 'task-1', 'attempt_id': 'attempt-1', 'epoch': 1, 'text': 'Background result', 'origin': {**{k: ctx[k] for k in ('user_id','profile_id','project_id')}, 'session_id': sid, 'runtime': 'dsh'}}
        assert client.portal.call(persist, ctx, sid, delivery, 'fleet-delivery:d1') == {'persisted': True}
        client.portal.call(persist, ctx, sid, delivery, 'fleet-delivery:d1')
        snapshot = client.get(f'/api/runtime/sessions/{sid}/snapshot').json()
        assert len(snapshot['deliveries']) == 1
        assert snapshot['deliveries'][0]['source'] == 'fleet'
        assert len(bridge.state.sessions[sid]['requests']) == 1
        assert not any(message['role'] == 'assistant' for message in snapshot['messages'])
        body_delivery = {**delivery, 'id': 'd2', 'payload': {'result': 'Actual worker result', 'evidence_json': 'internal details'}}
        body_delivery.pop('text')
        client.portal.call(persist, ctx, sid, body_delivery, 'fleet-delivery:d2')
        rows = client.get(f'/api/runtime/sessions/{sid}/snapshot').json()['deliveries']
        assert rows[-1]['content'] == 'Actual worker result'
        assert 'internal details' not in rows[-1]['content']
        client.portal.call(persist, ctx, sid, {**body_delivery, 'id': 'd3', 'payload': {'status': 'done', 'result': ''}}, 'fleet-delivery:d3')
        row = client.get(f'/api/runtime/sessions/{sid}/snapshot').json()['deliveries'][-1]
        assert row['content'] == 'Fleet task status: done. No result text was returned by the worker.'
        with pytest.raises(Exception) as changed:
            client.portal.call(persist, ctx, sid, {**delivery, 'text': 'changed'}, 'fleet-delivery:d1')
        assert getattr(changed.value, 'status_code', None) == 409


def test_health_is_authenticated_and_requires_live_runtime_and_complete_assets(tmp_path):
    app, client, bridge = setup(tmp_path)
    assert client.get('/health').status_code == 401
    login(app, client)
    app.state.services_available = False
    assert client.get('/health').status_code == 503  # an unavailable service is not ready
    ready, c, ready_bridge = setup(tmp_path / 'ready', services_module=fixture_module.create_services_fixture())
    login(ready, c)
    assets = tmp_path / 'built-assets'
    (assets / 'assets').mkdir(parents=True)
    (assets / 'standalone.html').write_text('<script src="/assets/app.js"></script>')
    (assets / 'assets/app.js').write_text('// explicit build fixture')
    (assets / 'assets/lazy.js').write_text('// explicit recovered application fixture')
    (assets / 'standalone-manifest.json').write_text(__import__('json').dumps({'entry': {'file': 'assets/app.js', 'dynamicImports': ['lazy']}, 'lazy': {'file': 'assets/lazy.js'}}))
    ready.state.assets_root = assets
    result = c.get('/health')
    assert result.status_code == 200, result.text
    assert result.json() == {'status': 'ready', 'runtime': 'dsh'}
    (assets / 'assets/lazy.js').unlink()
    assert c.get('/health').status_code == 503
    (assets / 'assets/lazy.js').write_text('// restored build fixture')
    ready_bridge.state.runtime_status = 'reconnecting'
    assert c.get('/health').status_code == 503


def test_delivery_ack_withheld_for_scope_mismatch_or_nondurable_upstream(tmp_path):
    app, client, bridge = setup(tmp_path, services_module=fixture_module.create_services_fixture())
    login(app, client)
    sid = create_session(client)
    ctx = app.state.store.session_context('local-owner', 'default', sid)
    delivery = {'id': 'd1', 'task_id': 'task-1', 'attempt_id': 'attempt-1', 'epoch': 1, 'text': 'Result', 'origin': {**{k: ctx[k] for k in ('user_id','profile_id','project_id')}, 'session_id': sid, 'runtime': 'dsh'}}
    with client:
        persist = app.state.services.runtime['persist_delivery']
        with pytest.raises(Exception) as denied:
            client.portal.call(persist, ctx, sid, {**delivery, 'origin': {**delivery['origin'], 'user_id': 'forged'}}, 'delivery-one')
        assert denied.value.status_code == 403
        assert not bridge.state.sessions[sid].get('deliveries')
        # A successful HTTP receipt without durable storage must never allow ACK.
        bridge.state.notification_durable = False
        with pytest.raises(Exception) as pending:
            client.portal.call(persist, ctx, sid, delivery, 'delivery-one')
        assert pending.value.status_code == 502


def test_scheduled_input_waits_for_durable_journal_and_reuses_pending_identity(tmp_path):
    app, client, bridge = setup(tmp_path, services_module=fixture_module.create_services_fixture())
    login(app, client)
    sid = create_session(client)
    ctx = app.state.store.session_context('local-owner', 'default', sid)
    bridge.state.input_durable = False
    with client:
        send = app.state.services.runtime['scheduled_input']
        with pytest.raises(Exception) as pending:
            client.portal.call(send, ctx, sid, {'text': 'slow', 'request_id': 'pending-scheduled'})
        assert pending.value.status_code == 503
        assert len(bridge.state.sessions[sid]['requests']) == 1
        bridge.state.input_durable = True
        receipt = client.portal.call(send, ctx, sid, {'text': 'slow', 'request_id': 'pending-scheduled'})
        assert receipt['durable'] is True
        assert len(bridge.state.sessions[sid]['requests']) == 1


def test_readiness_rejects_malformed_successful_upstream_responses(tmp_path):
    for index, response in enumerate([httpx.Response(200, text='not JSON'), httpx.Response(200, json=['invalid catalog']), httpx.Response(200, json={'capabilities': []})]):
        app = create_app(home=tmp_path / str(index), workspace_root=tmp_path / 'workspace', runtime_url='http://localhost', transport=httpx.MockTransport(lambda request: response), services_module=fixture_module.create_services_fixture())
        client = TestClient(app)
        login(app, client)
        assets = tmp_path / 'assets'
        assets.mkdir(exist_ok=True)
        (assets / 'standalone.html').write_text('<script src="/assets/app.js"></script>')
        (assets / 'assets').mkdir(exist_ok=True)
        (assets / 'assets/app.js').write_text('// explicit build fixture')
        (assets / 'standalone-manifest.json').write_text('{"entry":{"file":"assets/app.js"}}')
        app.state.assets_root = assets
        assert client.get('/api/runtime/capabilities').status_code == 502
        assert client.get('/health').status_code == 503


def test_fleet_origin_hydration_keeps_current_user_scope_and_fails_closed(tmp_path):
    from dashboard.standalone_fleet_transport import FleetOriginTransport
    app, client, _ = setup(tmp_path)
    login(app, client)
    calls = []
    async def transport(method, path, body=None, params=None):
        calls.append(path)
        if path == '/tasks':
            return {'tasks': [{'id': 'owned', 'status': 'done'}, {'id': 'foreign', 'status': 'done'}], 'has_more': False}
        user = 'local-owner' if path.endswith('/owned') else 'another-user'
        return {'task': {'id': path.rsplit('/', 1)[-1], 'origin': {'user_id': user, 'profile_id': 'default', 'project_id': 'default', 'runtime': 'dsh', 'session_id': 'session'}}, 'attempts': [{'id': 'a1', 'status': 'ok'}, {'id': 'a2', 'status': 'failed'}]}
    app.state.services.fleet.transport = FleetOriginTransport(transport)
    response = client.get('/api/plugins/workbench/fleet/tasks')
    assert response.status_code == 200, response.text
    assert [task['id'] for task in response.json()['tasks']] == ['owned']
    assert set(calls) == {'/tasks', '/tasks/owned', '/tasks/foreign'}
    overview = client.post('/api/plugins/workbench/kanban-overview', json={'board': ''})
    assert overview.status_code == 200, overview.text
    assert overview.json()['stats'] == {'tasks_total': 1, 'by_status': {'done': 1}, 'runs_total': 2, 'runs_completed': 1, 'runs_failed': 1, 'runs_in_flight': 0, 'runs_neutral': 0, 'success_rate': .5}
    assert client.post('/api/plugins/workbench/kanban-overview', json={'board': '', 'user_id': 'another-user'}).status_code == 422
    async def missing_origin(method, path, body=None, params=None):
        return {'tasks': [{'id': 'missing'}]} if path == '/tasks' else {'task': {'id': 'missing'}}
    app.state.services.fleet.transport = FleetOriginTransport(missing_origin)
    assert client.get('/api/plugins/workbench/fleet/tasks').json() == {'tasks': []}
    async def mismatched_detail(method, path, body=None, params=None):
        return {'tasks': [{'id': 'missing'}]} if path == '/tasks' else {'task': {'id': 'different'}}
    app.state.services.fleet.transport = FleetOriginTransport(mismatched_detail)
    assert client.get('/api/plugins/workbench/fleet/tasks').status_code == 502
