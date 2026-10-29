"""Quota snapshots must describe one completed response, not the current account."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
from codex_bridge import BridgeStore
from response_metrics import weekly_remaining, observe_item, reserve_completion, save_quota, decorate_turns
import provider_quotas


def test_weekly_bucket_not_hourly_or_another_product():
    week = {'usedPercent': 23.5, 'windowDurationMins': 10080}
    assert weekly_remaining({'rateLimits': {'limitId': 'codex', 'primary': {'usedPercent': 99, 'windowDurationMins': 300}, 'secondary': week}}) == 76.5
    assert weekly_remaining({'rateLimits': {'primary': week}, 'rateLimitsByLimitId': {'other': {'secondary': week}}}) is None
    assert weekly_remaining({'rateLimits': {'secondary': {'usedPercent': float('nan'), 'windowDurationMins': 10080}}}) is None
    assert weekly_remaining({}) is None


def test_openai_quota_keeps_both_subscription_windows_and_stays_limited_to_codex():
    quota = provider_quotas.openai_quota({'rateLimits': {'limitId': 'codex',
        'primary': {'usedPercent': 20, 'windowDurationMins': 300},
        'secondary': {'usedPercent': 40, 'windowDurationMins': 10080}}})
    assert quota == {'kind': 'openai', 'label': 'Codex', 'subscription': True,
                     'fiveHourRemaining': 80.0, 'weeklyRemaining': 60.0}
    assert provider_quotas.openai_quota({'rateLimitsByLimitId': {'other': {'secondary': {'usedPercent': 1, 'windowDurationMins': 10080}}}}) is None


def test_google_quota_uses_the_claude_family_instead_of_gemini():
    report = {'reports': [{'provider': 'google-antigravity', 'quota': {'customWindows': [
        {'label': 'Gem', 'percent': 0, 'resetAt': 1},
        {'label': 'Gem (Weekly)', 'percent': 0.69, 'resetAt': 2},
        {'label': 'Cla', 'percent': 100, 'resetAt': 3},
        {'label': 'Cla (Weekly)', 'percent': 52.77, 'resetAt': 4},
    ]}}]}
    claude = provider_quotas.google_quota_from_report(report, 'google-antigravity/claude-opus-5-5')
    assert claude['label'] == 'Claude'
    assert claude['fiveHourRemaining'] == 0.0
    assert claude['weeklyRemaining'] == 47.2
    assert claude['fiveHourResetAt'] == 3 and claude['weeklyResetAt'] == 4
    gemini = provider_quotas.google_quota_from_report(report, 'google-antigravity/gemini-4-argon')
    assert gemini['label'] == 'Gemini'
    assert gemini['fiveHourRemaining'] == 100.0
    assert gemini['weeklyRemaining'] == 99.3


def test_model_provider_distinguishes_subscriptions_from_direct_api():
    assert provider_quotas.model_provider('google-antigravity/gemini-4-argon') == 'google'
    assert provider_quotas.model_provider('gpt-6-astra') == 'openai'
    assert provider_quotas.model_provider('deepseek/deepseek-flash') == 'api'
    assert provider_quotas.model_provider('unknown-model') is None


def test_turn_model_keeps_the_start_model_when_a_steer_has_no_model(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    try:
        identity = ('reader', 'default', 'session')
        store.save_request(*identity, 'start', status='accepted', turn_id='turn',
                           payload=json.dumps({'model': 'google-antigravity/claude-opus-5-5'}))
        store.save_request(*identity, 'steer', status='accepted', turn_id='turn',
                           payload=json.dumps({'expectedTurnId': 'turn'}))
        store.connection.execute("UPDATE codex_requests SET updated_at=1 WHERE client_request_id='start'")
        store.connection.execute("UPDATE codex_requests SET updated_at=2 WHERE client_request_id='steer'")
        store.connection.commit()
        assert store.turn_model(*identity, 'turn') == 'google-antigravity/claude-opus-5-5'
    finally:
        store.close()


def test_metrics_survive_reopen_and_do_not_rewrite_previous_turns(tmp_path):
    path = tmp_path / 'db'
    identity = ('reader', 'default', 'session')
    store = BridgeStore(path)
    assert observe_item(store, identity, 'first', 1000) == 1000
    assert observe_item(store, identity, 'first', 2000) == 1000
    assert reserve_completion(store, identity, 'turn-1', 3000)
    save_quota(store, identity, 'turn-1', 73)
    assert reserve_completion(store, identity, 'turn-3', 5000)
    save_quota(store, identity, 'turn-3', {'kind': 'google', 'label': 'Claude', 'subscription': True,
                                            'fiveHourRemaining': 0, 'weeklyRemaining': 47.2},
               'google-antigravity/claude-opus-5-5')
    assert reserve_completion(store, identity, 'turn-4', 6000)
    save_quota(store, identity, 'turn-4', None, 'deepseek/deepseek-flash')
    assert not reserve_completion(store, identity, 'turn-1', 9000)
    assert reserve_completion(store, identity, 'turn-2', 10000)
    save_quota(store, identity, 'turn-2', 65)
    store.close()
    store = BridgeStore(path)
    try:
        rows = decorate_turns(store, identity, [{'id': 'turn-1', 'items': [{'id': 'first'}]}, {'id': 'turn-2'}, {'id': 'turn-3'}, {'id': 'turn-4'}, {'id': 'historical'}])
        assert rows[0]['completedAt'] == 3000 and rows[0]['weeklyRemainingPercent'] == 73
        assert rows[0]['items'][0]['observedAt'] == 1000
        assert rows[1]['weeklyRemainingPercent'] == 65
        assert rows[2]['quota']['label'] == 'Claude' and rows[2]['quota']['fiveHourRemaining'] == 0
        assert rows[2]['weeklyRemainingPercent'] == 47.2
        assert 'quota' not in rows[3] and 'weeklyRemainingPercent' not in rows[3]
        assert 'weeklyRemainingPercent' not in rows[4]
        assert 'weeklyRemainingPercent' not in decorate_turns(store, ('other', 'default', 'session'), [{'id': 'turn-1'}])[0]
    finally:
        store.close()


def test_completion_time_uses_provider_timing_before_delayed_delivery():
    from response_metrics import completion_time
    assert completion_time({'startedAt': 1700000000, 'durationMs': 2500}, 1700000100) == 1700000002500
    assert completion_time({'completedAt': 1700000005}, 1700000100) == 1700000005000
    assert completion_time({}, 1700000100) == 1700000100000
