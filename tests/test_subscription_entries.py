"""Persistence, identity boundaries, adapter isolation and redaction contracts."""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
from quota_dashboard import create_router, QuotaDashboard
from subscription_entries import SubscriptionStore, Entry


def manual(id='fourth', **kwargs):
    return Entry(id=id, name='Example account', service='Example', plan='Team', amount=42.0, **kwargs).model_dump()


def client(path):
    app = FastAPI()
    @app.middleware('http')
    async def identity(request, call_next):
        request.state.workbench_authenticated = True
        request.state.workbench_user = request.headers.get('test-user', 'alice')
        return await call_next(request)
    app.include_router(create_router(store=SubscriptionStore(path)))
    return TestClient(app, headers={'remote-user': 'alice'})


def test_crud_persistence_duplicates_order_and_identity(tmp_path):
    path = tmp_path / 'subscriptions.sqlite3'
    api = client(path)
    original = api.get('/quotas').json()
    assert [p['id'] for p in original['presets']] == [p['id'] for p in original['entries']]
    entries = original['entries'] + [manual(), manual('second-account')]
    saved = api.put('/quotas/entries', json={'revision': 0, 'entries': entries})
    assert saved.status_code == 200
    result = client(path).get('/quotas').json()  # New router, service and store (restart).
    assert [p['id'] for p in result['providers']] == [e['id'] for e in entries]
    assert result['providers'][-1]['manual']['amount'] == 42
    assert result['providers'][-1]['updatedAt']
    assert len(api.get('/quotas', headers={'remote-user': 'bob'}).json()['entries']) == 3
    assert len(api.get('/quotas?profile=other').json()['entries']) == 3
    changed = list(reversed(result['entries']))
    changed[0].update(name='Renamed', enabled=False)
    changed.pop()
    assert api.put('/quotas/entries', json={'revision': 1, 'entries': changed}).status_code == 200
    result = api.get('/quotas').json()
    assert result['providers'][0]['name'] == 'Renamed'
    assert result['providers'][0]['status'] == 'disabled'
    assert 'manual' not in result['providers'][0]
    assert len(result['providers']) == 4
    assert api.put('/quotas/entries', json={'revision': 1, 'entries': entries}).status_code == 409
    assert api.put('/quotas/entries', json={'revision': 2, 'entries': []}).status_code == 200
    assert client(path).get('/quotas').json()['providers'] == []
    assert path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('patch', [
    {'token': 'SECRET'}, {'amount': -1}, {'amount': True}, {'limit': 0},
    {'amount': 120, 'limit': 100}, {'adapter': 'http://example.invalid'},
    {'resetsAt': 'not-a-date'}, {'resetsAt': '2030-01-01T12:00:00'},
    {'name': ' '}, {'minutes': 1}, {'enabled': 'true'},
])
def test_invalid_configuration_never_echoes_values(tmp_path, patch):
    api = client(tmp_path / 'config.db')
    entry = {**manual(), **patch}
    response = api.put('/quotas/entries', json={'revision': 0, 'entries': [entry]})
    assert response.status_code == 422
    assert 'SECRET' not in response.text
    assert api.get('/quotas').json()['revision'] == 0


def test_duplicate_ids_and_size_limit(tmp_path):
    api = client(tmp_path / 'config.db')
    assert api.put('/quotas/entries', json={'revision': 0, 'entries': [manual(), manual()]}).status_code == 422
    assert api.put('/quotas/entries', content=b' ' * 131073).status_code == 413


def test_manual_expiry_and_adapter_failure_isolation():
    async def run():
        async def failure(*args):
            raise RuntimeError('SECRET-UPSTREAM')
        service = QuotaDashboard(SimpleNamespace(read_quota=failure))
        entries = [manual(), manual('expired', resetsAt='2000-01-01T00:00:00Z'),
                   manual('bridge', adapter='codex'), manual('disabled', enabled=False)]
        data = await service.read('alice', 'default', entries=entries)
        assert [p['status'] for p in data['providers']] == ['available', 'unavailable', 'error', 'disabled']
        assert 'SECRET' not in json.dumps(data)
        assert 'manual' not in data['providers'][1]
        # Config changes must never reuse a cached result from the old configuration.
        entries[0]['amount'] = 12
        assert (await service.read('alice', 'default', entries=entries))['providers'][0]['manual']['amount'] == 12
        async def slow(*args):
            await asyncio.sleep(10)
        service.bridge.read_quota = slow
        service.timeout = .01
        data = await service.read('alice', 'default', True, entries)
        assert data['providers'][0]['status'] == 'available'
        assert data['providers'][2]['status'] == 'timeout'
    asyncio.run(run())


def test_manual_cache_does_not_outlive_reset():
    from datetime import datetime, timedelta, timezone
    async def run():
        reset = (datetime.now(timezone.utc) + timedelta(milliseconds=40)).isoformat()
        entries = [manual(resetsAt=reset)]
        service = QuotaDashboard(ttl=60)
        assert (await service.read('alice', 'default', entries=entries))['providers'][0]['status'] == 'available'
        await asyncio.sleep(.06)
        assert (await service.read('alice', 'default', entries=entries))['providers'][0]['status'] == 'unavailable'
    asyncio.run(run())


def test_concurrent_updates_have_one_winner(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    store = SubscriptionStore(tmp_path / 'config.db')
    store.read('alice', 'default')
    def save(name):
        try:
            store.save('alice', 'default', 0, [manual(name)])
            return 200
        except Exception as error:
            return getattr(error, 'status_code', 500)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, ['one', 'two'])) == [200, 409]
