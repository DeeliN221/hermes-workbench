"""Subscription quota adapters and non-secret entry configuration."""
from __future__ import annotations

import asyncio
import math
import json
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request, Response, HTTPException
from codex_bridge import _safe, _user
from subscription_entries import Entry, SubscriptionStore, defaults
from pydantic import ValidationError


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def unavailable(provider: str, reason: str, checked: str) -> dict:
    return {"id": provider, "status": "unavailable", "reason": reason,
            "windows": [], "updatedAt": None, "checkedAt": checked}


def normalize(payload: Any, checked: str) -> dict:
    """Whitelist only Codex's explicitly identified bucket and numeric windows."""
    result = unavailable("openai", "Codex returned no usable quota windows.", checked)
    if not isinstance(payload, dict):
        return result
    buckets = payload.get("rateLimitsByLimitId")
    bucket = buckets.get("codex") if isinstance(buckets, dict) else payload.get("rateLimits")
    if not isinstance(bucket, dict) or bucket.get("limitId") not in (None, "codex"):
        return result
    windows = []
    for key in ("primary", "secondary"):
        window = bucket.get(key)
        if not isinstance(window, dict):
            continue
        used, minutes, reset = (window.get(k) for k in ("usedPercent", "windowDurationMins", "resetsAt"))
        if (type(used) not in (int, float) or not math.isfinite(used) or not 0 <= used <= 100
                or type(minutes) is not int or minutes <= 0):
            continue
        reset_at = None
        if type(reset) in (int, float) and math.isfinite(reset) and 0 <= reset <= 253402300799:
            reset_at = datetime.fromtimestamp(reset, timezone.utc).isoformat()
        windows.append({"minutes": minutes, "remainingPercent": round(100 - used, 2), "resetsAt": reset_at})
    if windows:
        result.update(status="available", reason="Codex allowance only; not a ChatGPT-wide balance. Subscription tier is not verified.",
                      windows=windows, updatedAt=checked)
    return result


class QuotaDashboard:
    """Bounded identity-scoped cache and single-flight refresh; no stored secrets."""
    def __init__(self, bridge=None, timeout=8.0, ttl=15.0):
        self.bridge, self.timeout, self.ttl = bridge, timeout, ttl
        self.cache = {}
        self.pending = {}

    async def codex(self, entry, user, profile):
        checked = now()
        if self.bridge is None:
            return unavailable(entry['id'], "Workbench Codex App Server is not configured. No account credentials are read by this dashboard.", checked)
        return normalize(await self.bridge.read_quota(user, profile), now())

    async def unsupported(self, entry, user, profile):
        reasons = {
            'opencode': "No verified remaining-quota API or Workbench quota connection. Check OpenCode Console; per-request allowance is not an account balance.",
            'gemini': "The existing Antigravity intermediary report has no verified Google AI Pro account/window provenance. Gemini CLI /stats model is a separate model-quota view; no subscription balance is confirmed.",
        }
        return unavailable(entry['id'], reasons.get(entry['preset'], 'No quota adapter configured.'), now())

    async def manual(self, entry, user, profile):
        item = unavailable(entry['id'], 'Manually entered; not verified by the provider.', now())
        reset = entry['resetsAt']
        if reset and datetime.fromisoformat(reset.replace('Z', '+00:00')) <= datetime.now(timezone.utc):
            item['reason'] = 'Manual window expired. Update the value and reset time; previous values are no longer current.'
        elif entry['amount'] is not None:
            item.update(status='available', updatedAt=entry['observedAt'], manual={
                key: entry[key] for key in ('amount', 'limit', 'mode', 'unit', 'minutes', 'resetsAt')})
        return item

    async def collect(self, user, profile, entries=None):
        # Registry is the extension point for future server-only API adapters.
        adapters = {'codex': self.codex, 'unsupported': self.unsupported, 'manual': self.manual}
        async def read_entry(entry):
            if not entry['enabled']:
                item = unavailable(entry['id'], 'Disabled; no quota request is made.', now())
                item['status'] = 'disabled'
            else:
                try:
                    item = await asyncio.wait_for(adapters[entry['adapter']](entry, user, profile), self.timeout)
                except asyncio.TimeoutError:
                    item = unavailable(entry['id'], 'Quota refresh timed out. Retry later.', now())
                    item['status'] = 'timeout'
                except Exception:
                    item = unavailable(entry['id'], 'Quota lookup failed. Check the existing server connection.', now())
                    item['status'] = 'error'
            return {**item, 'id': entry['id'], 'name': entry['name'], 'service': entry['service'],
                    'plan': entry['plan'], 'adapter': entry['adapter'], 'enabled': entry['enabled'],
                    'description': 'Shared Workbench Codex connection · Plan unverified' if entry['adapter'] == 'codex' else ''}
        return {'providers': await asyncio.gather(*(read_entry(e) for e in (defaults() if entries is None else entries)))}

    async def read(self, user, profile, refresh=False, entries=None):
        key = (user, profile, json.dumps(entries, sort_keys=True))
        if key in self.pending:
            return await asyncio.shield(self.pending[key])
        cached = self.cache.get(key)
        # A cached manual observation cannot outlive its explicit window.
        if entries and any(e['adapter'] == 'manual' and e['resetsAt'] and
                           datetime.fromisoformat(e['resetsAt'].replace('Z', '+00:00')) <= datetime.now(timezone.utc)
                           for e in entries):
            cached = None
        if not refresh and cached and time.monotonic() - cached[0] < self.ttl:
            return cached[1]
        if len(self.pending) >= 128:
            raise HTTPException(503, "Quota refresh busy. Retry later.")

        async def run():
            try:
                result = await self.collect(user, profile, entries)
                if len(self.cache) >= 128:
                    self.cache.pop(next(iter(self.cache)))
                self.cache[key] = (time.monotonic(), result)
                return result
            finally:
                self.pending.pop(key, None)
        task = asyncio.create_task(run())
        self.pending[key] = task
        return await asyncio.shield(task)


def create_router(bridge=None, store=None):
    store = store or SubscriptionStore()
    service = QuotaDashboard(bridge)
    router = APIRouter()

    @router.get("/quotas")
    async def quotas(request: Request, response: Response, profile: str = "default", refresh: bool = False):
        response.headers["Cache-Control"] = "no-store"
        user, profile = _user(request), _safe(profile, "profile")
        config = await asyncio.to_thread(store.read, user, profile)
        result = await service.read(user, profile, refresh, config['entries'])
        return {**result, **config, 'presets': defaults()}

    @router.put("/quotas/entries")
    async def save_entries(request: Request, response: Response, profile: str = "default"):
        response.headers["Cache-Control"] = "no-store"
        user, profile = _user(request), _safe(profile, "profile")
        # Parse manually so validation errors never echo a submitted secret or unknown field.
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 131072:
                raise HTTPException(413, 'Subscription configuration too large.')
        try:
            body = json.loads(raw)
            if (not isinstance(body, dict) or set(body) != {'revision', 'entries'} or
                    type(body['revision']) is not int or body['revision'] < 0 or
                    not isinstance(body['entries'], list) or len(body['entries']) > 100):
                raise ValueError()
            entries = [Entry.model_validate(e).model_dump() for e in body['entries']]
            if len({e['id'] for e in entries}) != len(entries):
                raise ValueError()
            if any(e['amount'] is not None and e['limit'] is not None and e['amount'] > e['limit'] for e in entries):
                raise ValueError()
        except (ValueError, TypeError, ValidationError):
            raise HTTPException(422, 'Invalid subscription configuration. Check labels, values and timezone-qualified reset times.') from None
        previous = {e['id']: e for e in (await asyncio.to_thread(store.read, user, profile))['entries']}
        for entry in entries:
            old = previous.get(entry['id'])
            fields = ('amount', 'limit', 'mode', 'unit', 'minutes', 'resetsAt', 'adapter')
            entry['observedAt'] = old['observedAt'] if old and all(old[k] == entry[k] for k in fields) else now()
        return await asyncio.to_thread(store.save, user, profile, body['revision'], entries)

    return router
