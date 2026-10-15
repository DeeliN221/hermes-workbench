"""Persist per-response timing and real Codex weekly quota snapshots."""
from __future__ import annotations
import math


def install_schema(connection):
    connection.executescript('''
        CREATE TABLE IF NOT EXISTS codex_item_times (
          user_id TEXT, profile TEXT, session_id TEXT, item_id TEXT, observed_at REAL,
          PRIMARY KEY(user_id, profile, session_id, item_id));
        CREATE TABLE IF NOT EXISTS codex_response_metrics (
          user_id TEXT, profile TEXT, session_id TEXT, turn_id TEXT,
          completed_at REAL, weekly_remaining REAL,
          PRIMARY KEY(user_id, profile, session_id, turn_id));
    ''')


def weekly_remaining(result):
    """Select the Codex seven-day window, never an hourly or unrelated bucket."""
    if not isinstance(result, dict):
        return None
    buckets = result.get('rateLimitsByLimitId')
    bucket = buckets.get('codex') if isinstance(buckets, dict) else result.get('rateLimits')
    if not isinstance(bucket, dict) or bucket.get('limitId') not in (None, 'codex'):
        return None
    for name in ('primary', 'secondary'):
        window = bucket.get(name)
        if not isinstance(window, dict) or window.get('windowDurationMins') != 7 * 24 * 60:
            continue
        used = window.get('usedPercent')
        if isinstance(used, (int, float)) and not isinstance(used, bool) and math.isfinite(used):
            return round(max(0, min(100, 100 - used)), 1)
    return None


def observe_item(store, identity, item_id, observed_at):
    with store.lock:
        store.connection.execute('INSERT OR IGNORE INTO codex_item_times VALUES (?,?,?,?,?)', (*identity, item_id, observed_at))
        row = store.connection.execute('SELECT observed_at FROM codex_item_times WHERE user_id=? AND profile=? AND session_id=? AND item_id=?', (*identity, item_id)).fetchone()
        # append_events commits this timestamp together with the notification.
        return row[0]


def reserve_completion(store, identity, turn_id, completed_at):
    with store.lock:
        cursor = store.connection.execute('INSERT OR IGNORE INTO codex_response_metrics VALUES (?,?,?,?,?,NULL)', (*identity, turn_id, completed_at))
        store.connection.commit()
        return cursor.rowcount == 1


def save_quota(store, identity, turn_id, remaining):
    with store.lock:
        store.connection.execute('UPDATE codex_response_metrics SET weekly_remaining=? WHERE user_id=? AND profile=? AND session_id=? AND turn_id=?', (remaining, *identity, turn_id))
        store.connection.commit()


def decorate_turns(store, identity, turns):
    with store.lock:
        items = dict(store.connection.execute('SELECT item_id,observed_at FROM codex_item_times WHERE user_id=? AND profile=? AND session_id=?', identity).fetchall())
        metrics = {row[0]: row[1:] for row in store.connection.execute('SELECT turn_id,completed_at,weekly_remaining FROM codex_response_metrics WHERE user_id=? AND profile=? AND session_id=?', identity)}
    return [{**turn,
             **({'completedAt': metrics[str(turn.get('id'))][0], 'weeklyRemainingPercent': metrics[str(turn.get('id'))][1]} if str(turn.get('id')) in metrics else {}),
             'items': [{**item, **({'observedAt': items[str(item.get('id'))]} if str(item.get('id')) in items else {})} for item in turn.get('items', [])]}
            for turn in turns]


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
