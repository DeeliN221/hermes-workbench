"""Quota snapshots must describe one completed response, not the current account."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
from codex_bridge import BridgeStore
from response_metrics import weekly_remaining, observe_item, reserve_completion, save_quota, decorate_turns


def test_weekly_bucket_not_hourly_or_another_product():
    week = {'usedPercent': 23.5, 'windowDurationMins': 10080}
    assert weekly_remaining({'rateLimits': {'limitId': 'codex', 'primary': {'usedPercent': 99, 'windowDurationMins': 300}, 'secondary': week}}) == 76.5
    assert weekly_remaining({'rateLimits': {'primary': week}, 'rateLimitsByLimitId': {'other': {'secondary': week}}}) is None
    assert weekly_remaining({'rateLimits': {'secondary': {'usedPercent': float('nan'), 'windowDurationMins': 10080}}}) is None
    assert weekly_remaining({}) is None


def test_metrics_survive_reopen_and_do_not_rewrite_previous_turns(tmp_path):
    path = tmp_path / 'db'
    identity = ('reader', 'default', 'session')
    store = BridgeStore(path)
    assert observe_item(store, identity, 'first', 1000) == 1000
    assert observe_item(store, identity, 'first', 2000) == 1000
    assert reserve_completion(store, identity, 'turn-1', 3000)
    save_quota(store, identity, 'turn-1', 73)
    assert not reserve_completion(store, identity, 'turn-1', 9000)
    assert reserve_completion(store, identity, 'turn-2', 10000)
    save_quota(store, identity, 'turn-2', 65)
    store.close()
    store = BridgeStore(path)
    try:
        rows = decorate_turns(store, identity, [{'id': 'turn-1', 'items': [{'id': 'first'}]}, {'id': 'turn-2'}, {'id': 'historical'}])
        assert rows[0]['completedAt'] == 3000 and rows[0]['weeklyRemainingPercent'] == 73
        assert rows[0]['items'][0]['observedAt'] == 1000
        assert rows[1]['weeklyRemainingPercent'] == 65
        assert 'weeklyRemainingPercent' not in rows[2]
        assert 'weeklyRemainingPercent' not in decorate_turns(store, ('other', 'default', 'session'), [{'id': 'turn-1'}])[0]
    finally:
        store.close()


def test_completion_time_uses_provider_timing_before_delayed_delivery():
    from response_metrics import completion_time
    assert completion_time({'startedAt': 1700000000, 'durationMs': 2500}, 1700000100) == 1700000002500
    assert completion_time({'completedAt': 1700000005}, 1700000100) == 1700000005000
    assert completion_time({}, 1700000100) == 1700000100000
