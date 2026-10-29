"""Persist per-response timing and the selected model's subscription allowance."""
from __future__ import annotations
import json
import math

import provider_quotas


def _ensure_column(connection, table, name, declaration):
    columns = {row[1] for row in connection.execute(f'PRAGMA table_info({table})')}
    if name not in columns:
        connection.execute(f'ALTER TABLE {table} ADD COLUMN {name} {declaration}')


def install_schema(connection):
    connection.executescript('''
        CREATE TABLE IF NOT EXISTS codex_item_times (
          user_id TEXT, profile TEXT, session_id TEXT, item_id TEXT, observed_at REAL,
          PRIMARY KEY(user_id, profile, session_id, item_id));
        CREATE TABLE IF NOT EXISTS codex_response_metrics (
          user_id TEXT, profile TEXT, session_id TEXT, turn_id TEXT,
          completed_at REAL, weekly_remaining REAL, quota_json TEXT, model TEXT,
          PRIMARY KEY(user_id, profile, session_id, turn_id));
    ''')
    _ensure_column(connection, 'codex_response_metrics', 'quota_json', 'TEXT')
    _ensure_column(connection, 'codex_response_metrics', 'model', 'TEXT')
    connection.commit()


def weekly_remaining(result):
    """Select the Codex seven-day window, never an hourly or unrelated bucket."""
    quota = provider_quotas.openai_quota(result)
    return quota.get('weeklyRemaining') if quota else None


def observe_item(store, identity, item_id, observed_at):
    with store.lock:
        store.connection.execute('INSERT OR IGNORE INTO codex_item_times VALUES (?,?,?,?,?)', (*identity, item_id, observed_at))
        row = store.connection.execute('SELECT observed_at FROM codex_item_times WHERE user_id=? AND profile=? AND session_id=? AND item_id=?', (*identity, item_id)).fetchone()
        # append_events commits this timestamp together with the notification.
        return row[0]


def reserve_completion(store, identity, turn_id, completed_at):
    with store.lock:
        cursor = store.connection.execute(
            'INSERT OR IGNORE INTO codex_response_metrics (user_id,profile,session_id,turn_id,completed_at) VALUES (?,?,?,?,?)',
            (*identity, turn_id, completed_at),
        )
        store.connection.commit()
        return cursor.rowcount == 1


def save_quota(store, identity, turn_id, quota, model=None):
    """Save the exact allowance snapshot for one completed response."""

    if isinstance(quota, (int, float)) and not isinstance(quota, bool) and math.isfinite(quota):
        quota = {'kind': 'openai', 'label': 'Codex', 'subscription': True, 'weeklyRemaining': round(max(0, min(100, quota)), 1)}
    weekly = quota.get('weeklyRemaining') if isinstance(quota, dict) else None
    quota_json = json.dumps(quota, ensure_ascii=False, separators=(',', ':')) if isinstance(quota, dict) else None
    with store.lock:
        store.connection.execute(
            'UPDATE codex_response_metrics SET weekly_remaining=?,quota_json=?,model=? WHERE user_id=? AND profile=? AND session_id=? AND turn_id=?',
            (weekly, quota_json, model, *identity, turn_id),
        )
        store.connection.commit()


def _turn_model(store, identity, turn_id):
    getter = getattr(store, 'turn_model', None)
    if getter is None:
        return ''
    try:
        return getter(*identity, turn_id) or ''
    except Exception:
        return ''


def _quota_for_metric(store, identity, turn_id, weekly, quota_json, model):
    if quota_json:
        try:
            quota = json.loads(quota_json)
        except (TypeError, ValueError):
            quota = None
        if isinstance(quota, dict):
            return quota
    if weekly is None:
        return None
    # Rows written before quotas carried their model remain readable. Recover the
    # model from the turn request when possible so an old Google turn is not
    # labelled as Codex.
    model = model or _turn_model(store, identity, turn_id)
    provider = provider_quotas.model_provider(model) if model else 'openai'
    if provider in (None, 'openai'):
        return {'kind': 'openai', 'label': 'Codex', 'subscription': True, 'weeklyRemaining': weekly}
    return None


def decorate_turns(store, identity, turns):
    with store.lock:
        items = dict(store.connection.execute('SELECT item_id,observed_at FROM codex_item_times WHERE user_id=? AND profile=? AND session_id=?', identity).fetchall())
        metrics = {row[0]: row[1:] for row in store.connection.execute('SELECT turn_id,completed_at,weekly_remaining,quota_json,model FROM codex_response_metrics WHERE user_id=? AND profile=? AND session_id=?', identity)}
    result = []
    for turn in turns:
        turn_id = str(turn.get('id'))
        metric = metrics.get(turn_id)
        extra = {}
        if metric:
            completed_at, weekly, quota_json, model = metric
            extra['completedAt'] = completed_at
            quota = _quota_for_metric(store, identity, turn_id, weekly, quota_json, model)
            if quota:
                extra['quota'] = quota
                if quota.get('weeklyRemaining') is not None:
                    extra['weeklyRemainingPercent'] = quota['weeklyRemaining']
        result.append({
            **turn,
            **extra,
            'items': [{**item, **({'observedAt': items[str(item.get('id'))]} if str(item.get('id')) in items else {})} for item in turn.get('items', [])],
        })
    return result


def completion_time(turn, observed_seconds):
    """Prefer provider timing; use the durable event time when it is unavailable."""
    def number(value):
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None
    value = number(turn.get('completedAt', turn.get('completed_at')))
    if value is not None:
        return value * 1000 if value < 1e12 else value
    start = number(turn.get('startedAt', turn.get('started_at')))
    duration = number(turn.get('durationMs', turn.get('duration_ms')))
    if start is not None and duration is not None:
        return (start * 1000 if start < 1e12 else start) + duration
    return observed_seconds * 1000
