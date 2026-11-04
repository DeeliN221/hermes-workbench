"""Stateless card cursors. No task detail, attempt history or server session cache."""
import base64
import hashlib
import json
from datetime import datetime
from fastapi import HTTPException

LANES = {"fast": {"running", "ready"}, "slow": {"review", "blocked", "triage", "scheduled"}}


def _encode(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def _decode(cursor):
    try:
        if not isinstance(cursor, str) or len(cursor) > 120000:
            raise ValueError()
        value = json.loads(base64.b64decode(cursor, altchars=b"-_", validate=True)) if cursor else {}
        if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in value.items()):
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid card cursor") from None


def card_summary(row, attempts):
    """Collapse list-provided execution records without fetching any detail endpoint."""
    if not isinstance(attempts, list) or not attempts:
        return row
    def timestamp(value):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except (ValueError, TypeError, AttributeError):
            return None
    ordered = sorted((a for a in attempts if isinstance(a, dict)), key=lambda a: timestamp(a.get("started_at")) or 0, reverse=True)
    if not ordered:
        return row
    latest = ordered[0]
    result = {**row, "attempt_count": len(ordered)}
    active = row.get("status") == "running" and row.get("assignee") and not latest.get("ended_at")
    if active:
        result["active_started_at"] = latest.get("started_at")
    if row.get("status") == "running":
        result["stale"] = not bool(active)
    total = 0
    for attempt in ordered:
        if active and attempt is latest:
            continue
        start, end = timestamp(attempt.get("started_at")), timestamp(attempt.get("ended_at"))
        if start is None or end is None:
            break
        total += max(0, end - start)
    else:
        result["duration_seconds"] = total
    return result


def card_sync(rows, lane="all", cursor=""):
    if not isinstance(lane, str) or lane not in {"all", *LANES}:
        raise HTTPException(422, "Invalid card lane")
    previous = _decode(cursor)
    # Only list metadata belongs on cards. Details remain an explicit user fetch.
    cards = [{k: v for k, v in row.items() if k not in {"attempts", "spec_json", "acceptance", "events", "artifacts", "review_notes"}} for row in rows]
    for row in cards:
        row["acceptance"] = []
    hashes = {row["id"]: hashlib.sha256(json.dumps(row, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:24] for row in cards}
    cursors = {name: _encode({row["id"]: hashes[row["id"]] for row in cards if row["status"] in statuses}) for name, statuses in LANES.items()}
    changed = cards if lane == "all" else [row for row in cards if
        (row["status"] in LANES[lane] or row["id"] in previous) and previous.get(row["id"]) != hashes[row["id"]]]
    return {"tasks": changed, "removed": [key for key in previous if key not in hashes],
            "cursors": cursors if lane == "all" else {lane: cursors[lane]}, "full": lane == "all"}
