"""Quota truthfulness, isolation, refresh and failure contracts."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
from quota_dashboard import QuotaDashboard, normalize

PAYLOAD = {'rateLimits': {'limitId': 'codex', 'primary': {
    'usedPercent': 25, 'windowDurationMins': 300, 'resetsAt': 1893456000},
    'secondary': {'usedPercent': 60, 'windowDurationMins': 10080, 'resetsAt': 1894060800}}}


def test_real_windows_and_whitelist():
    result = normalize({**PAYLOAD, 'secret': 'never-return'}, 'checked')
    assert result['status'] == 'available'
    assert [w['remainingPercent'] for w in result['windows']] == [75, 40]
    assert result['updatedAt'] == 'checked'
    assert 'never-return' not in str(result)
    assert normalize({'rateLimitsByLimitId': {'other': PAYLOAD['rateLimits']}, **PAYLOAD}, 'now')['status'] == 'unavailable'
    assert normalize({'rateLimits': {'primary': {'usedPercent': 1, 'windowDurationMins': 15}}}, 'now')['windows'][0]['minutes'] == 15


def test_invalid_data_never_becomes_a_balance():
    for value in (None, {}, [], {'rateLimits': None}):
        assert normalize(value, 'now')['updatedAt'] is None
    for used in (True, '25', -1, 101, float('nan'), float('inf')):
        value = {'rateLimits': {'primary': {'usedPercent': used, 'windowDurationMins': 300}}}
        assert normalize(value, 'now')['windows'] == []


def test_success_partial_unavailable_refresh_and_duplicate_requests():
    async def scenario():
        calls = []
        async def read(user, profile):
            calls.append((user, profile))
            await asyncio.sleep(.01)
            return PAYLOAD
        service = QuotaDashboard(SimpleNamespace(read_quota=read))
        results = await asyncio.gather(*(service.read('alice', 'default', True) for _ in range(8)))
        assert len(calls) == 1
        assert all(r == results[0] for r in results)
        assert [p['status'] for p in results[0]['providers']] == ['unavailable', 'unavailable', 'available']
        assert all(p['checkedAt'] for p in results[0]['providers'])
        await service.read('alice', 'default')
        assert len(calls) == 1
        await service.read('alice', 'default', True)
        await service.read('bob', 'default')
        await service.read('alice', 'other')
        assert len(calls) == 4
    asyncio.run(scenario())


def test_timeout_retry_and_redaction():
    async def scenario():
        async def slow(*args):
            await asyncio.sleep(1)
        bridge = SimpleNamespace(read_quota=slow)
        service = QuotaDashboard(bridge, timeout=.01)
        result = await service.read('alice', 'default')
        assert result['providers'][2]['status'] == 'timeout'
        assert result['providers'][2]['updatedAt'] is None
        async def fail(*args):
            raise RuntimeError('Bearer PRIVATE-TOKEN')
        bridge.read_quota = fail
        result = await service.read('alice', 'default', True)
        assert result['providers'][2]['status'] == 'error'
        assert 'PRIVATE-TOKEN' not in str(result)
        assert not service.pending
    asyncio.run(scenario())


def test_missing_connection_and_cancelled_client():
    async def scenario():
        missing = await QuotaDashboard().read('alice', 'default')
        assert all(p['status'] == 'unavailable' for p in missing['providers'])
        calls = []
        async def read(*args):
            calls.append(1)
            await asyncio.sleep(.02)
            return PAYLOAD
        service = QuotaDashboard(SimpleNamespace(read_quota=read))
        task = asyncio.create_task(service.read('alice', 'default'))
        await asyncio.sleep(.001)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        result = await service.read('alice', 'default')
        assert result['providers'][2]['status'] == 'available'
        assert len(calls) == 1
    asyncio.run(scenario())


def test_bridge_uses_only_readonly_quota_rpc():
    from codex_bridge import CodexBridge
    async def scenario():
        calls = []
        async def request(method, params):
            calls.append((method, params))
            return PAYLOAD
        async def connection(user, profile):
            assert (user, profile) == ('alice', 'default')
            return SimpleNamespace(request=request)
        result = await CodexBridge.read_quota(SimpleNamespace(_connection=connection), 'alice', 'default')
        assert result == PAYLOAD
        assert calls == [('account/rateLimits/read', {})]
    asyncio.run(scenario())


def test_rpc_timeout_cancellation_cleans_pending_request():
    from codex_bridge import JsonRpcConnection
    async def scenario():
        async def send(message):
            pass
        connection = JsonRpcConnection(SimpleNamespace(send=send), None)
        try:
            await asyncio.wait_for(connection.request('account/rateLimits/read', {}), .01)
        except asyncio.TimeoutError:
            pass
        assert connection._pending == {}
    asyncio.run(scenario())
