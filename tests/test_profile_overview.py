"""Aggregate the existing sidebar store with the same trusted user boundary."""
import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pathlib import Path


@pytest.fixture(autouse=True)
def dashboard_path(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parents[1] / "dashboard"))

from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_overview_preserves_order_empty_profiles_pagination_and_partial_sources(monkeypatch):
    from profile_overview import profile_overview
    store = Mock()
    calls = []
    def sessions(user, profile, limit, offset):
        calls.append((user, profile, limit, offset))
        if profile == 'broken':
            raise RuntimeError('private database path')
        return [{'id': str(i)} for i in range(offset, min(offset + limit, 105))] if profile == 'writer' else []
    store.list_sessions.side_effect = sessions
    store.groups.side_effect = lambda user, profile: [{'id': 'project'}] if profile == 'broken' else []
    result = asyncio.run(profile_overview(SimpleNamespace(store=store), 'alice', [{'name': n} for n in ['writer', 'empty', 'broken']]))
    assert [p['name'] for p in result['profiles']] == ['writer', 'empty', 'broken']
    assert len(result['profiles'][0]['sessions']) == 105
    assert result['profiles'][1]['sessions'] == []
    assert result['profiles'][2]['projects'] == [{'id': 'project'}]
    assert result['profiles'][2]['failed'] == ['sessions']
    assert all(call[0] == 'alice' for call in calls)
    assert 'private database path' not in str(result)


def test_route_requires_identity_and_uses_configured_bridge(monkeypatch):
    import plugin_api
    async def roster():
        return {'profiles': [{'name': 'default'}]}
    monkeypatch.setattr(plugin_api, 'profile_names', roster)
    app = FastAPI()
    store = Mock()
    store.groups.return_value = []
    store.list_sessions.return_value = []
    app.state.codex_bridge = SimpleNamespace(store=store)
    app.include_router(plugin_api.router)
    with TestClient(app) as client:
        assert client.get('/profile-overview').status_code == 401
        result = client.get('/profile-overview', headers={'remote-user': 'Alice'})
    assert result.status_code == 200
    assert result.json()['profiles'][0]['name'] == 'default'
    store.groups.assert_called_once_with('alice', 'default')
    store.list_sessions.assert_called_once_with('alice', 'default', 100, 0)


def test_optional_codex_bridge_keeps_roster_for_hermes():
    from profile_overview import profile_overview
    result = asyncio.run(profile_overview(None, 'alice', [{'name': 'empty'}]))
    assert result['profiles'] == [{'name': 'empty', 'projects': [], 'sessions': [], 'failed': []}]
