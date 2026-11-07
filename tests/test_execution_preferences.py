"""Execution choices persist independently of browser state and reach old threads."""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
import plugin_api as api
from codex_bridge import CodexBridge
from execution_preferences import read_mode


@pytest.fixture(autouse=True)
def stored_execution_preferences(monkeypatch, tmp_path, isolated_execution_preferences):
    """Exercise the real preference reader exclusively against temporary data."""
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    monkeypatch.setattr('execution_preferences.current_mode', isolated_execution_preferences)


def app(monkeypatch, tmp_path):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    application = FastAPI()
    application.include_router(api.router)
    return application


def test_defaults_persistence_identity_and_validation(tmp_path, monkeypatch):
    application = app(monkeypatch, tmp_path)
    with TestClient(application) as client:
        assert client.get('/execution-preferences').status_code == 401
        headers = {'remote-user': 'Alice'}
        result = client.get('/execution-preferences', headers=headers)
        assert result.json() == {'mode': 'foreground'}
        assert result.headers['cache-control'] == 'no-store'
        # Reading a missing setting does not create a database.
        database = tmp_path / '.hermes-workbench' / 'session-organization.sqlite3'
        assert not database.exists()
        assert client.put('/execution-preferences?profile=writer', headers=headers, json={'mode': 'background'}).json() == {'mode': 'background'}
        assert client.get('/execution-preferences', headers=headers).json() == {'mode': 'foreground'}
        assert client.get('/execution-preferences?profile=writer', headers={'remote-user': 'Bob'}).json() == {'mode': 'foreground'}
        for mode in ('auto', '', None, True):
            assert client.put('/execution-preferences', headers=headers, json={'mode': mode}).status_code == 422
        for method in ('get', 'put'):
            kwargs = {'json': {'mode': 'background'}} if method == 'put' else {}
            assert getattr(client, method)('/execution-preferences?profile=../other', headers=headers, **kwargs).status_code == 422
    with TestClient(app(monkeypatch, tmp_path)) as restarted:
        assert restarted.get('/execution-preferences?profile=writer', headers=headers).json() == {'mode': 'background'}
        assert restarted.put('/execution-preferences?profile=writer', headers=headers, json={'mode': 'foreground'}).json() == {'mode': 'foreground'}
    assert read_mode(database, 'alice', 'writer') == 'foreground'
    connection = api._open_organization_db()
    with connection:
        connection.execute("UPDATE execution_preferences SET mode='obsolete'")
    connection.close()
    assert read_mode(database, 'alice', 'writer') == 'foreground'


def test_existing_thread_uses_current_mode_without_showing_policy_or_changing_retries(tmp_path, monkeypatch):
    application = app(monkeypatch, tmp_path)

    async def run():
        bridge = CodexBridge(db_path=tmp_path / 'codex.db', workspace_root=tmp_path, workspace_map={})
        bridge.store.upsert_session('alice', 'default', dict(session_id='existing', thread_id='thread', workspace_id='w', workspace_path=str(tmp_path)))
        calls = []

        class Peer:
            async def request(self, method, payload):
                calls.append((method, payload))
                return {'turn': {'id': f'turn-{len(calls)}', 'status': 'completed'}}

        async def connection(*_): return Peer()
        bridge._connection = connection
        try:
            with TestClient(application) as client:
                headers = {'remote-user': 'Alice'}
                first = {'clientRequestId': 'one', 'text': 'Please finish this task here.'}
                await bridge.submit('alice', 'default', 'existing', first)
                assert calls[-1][0] == 'turn/start'
                blocks = calls[-1][1]['input']
                assert blocks[0]['text'] == first['text']
                assert 'mode="foreground"' in blocks[-1]['text']
                assert 'Do not automatically dispatch' in blocks[-1]['text']
                assert 'supersedes earlier execution-routing defaults' in blocks[-1]['text']
                client.put('/execution-preferences', headers=headers, json={'mode': 'background'})
                # An idempotent retry is not a fresh task and must not change mode.
                await bridge.submit('alice', 'default', 'existing', first)
                assert len(calls) == 1
                second = {'clientRequestId': 'two', 'text': 'Please run another task.'}
                await bridge.submit('alice', 'default', 'existing', second)
                assert 'mode="background"' in calls[-1][1]['input'][-1]['text']
                client.put('/execution-preferences', headers=headers, json={'mode': 'foreground'})
                await bridge.submit('alice', 'default', 'existing', {'clientRequestId': 'three', 'text': 'Continue here.', 'expectedTurnId': 'active'})
                assert calls[-1][0] == 'turn/steer'
                assert 'mode="foreground"' in calls[-1][1]['input'][-1]['text']
                stored = bridge.store.request('alice', 'default', 'existing', 'two')
                private = json.loads(stored['payload'])
                assert private['input'] == [{'type': 'text', 'text': second['text']}]
                assert private['_executionContext']['hidden'] is True
                projection = bridge.store.message_projection('alice', 'default', 'existing')
                native = {'type': 'userMessage', 'content': [{'type': 'text', 'text': '\n\n'.join(block['text'] for block in calls[1][1]['input'])}]}
                visible = projection.public(native)
                assert visible['content'] == private['input']
                assert 'workbench_execution_mode' not in json.dumps(projection.public(stored))
                assert '_executionContext' not in calls[-1][1]
        finally:
            await bridge.close()
    asyncio.run(run())
