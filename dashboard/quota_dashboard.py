"""Read-only subscription quotas. Never inspect credential files or infer usage."""
from __future__ import annotations

import asyncio
import math
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request, Response, HTTPException
from codex_bridge import _safe, _user


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

    async def collect(self, user, profile):
        checked = now()
        providers = [
            unavailable("opencode", "No verified remaining-quota API or Workbench quota connection. Check OpenCode Console; per-request allowance is not an account balance.", checked),
            unavailable("gemini", "The existing Antigravity intermediary report has no verified Google AI Pro account/window provenance. Gemini CLI /stats model is a separate model-quota view; no subscription balance is confirmed.", checked),
        ]
        if self.bridge is None:
            item = unavailable("openai", "Workbench Codex App Server is not configured. No account credentials are read by this dashboard.", checked)
        else:
            try:
                payload = await asyncio.wait_for(self.bridge.read_quota(user, profile), self.timeout)
                item = normalize(payload, now())
            except asyncio.TimeoutError:
                item = unavailable("openai", "Quota refresh timed out. Retry later.", now())
                item["status"] = "timeout"
            except Exception:
                # RPC errors can contain URLs, identities and tokens. Never echo them.
                item = unavailable("openai", "Codex quota lookup failed: account authentication, service access or this RPC may be unavailable. Check the existing connection.", now())
                item["status"] = "error"
        providers.append(item)
        return {"providers": providers}

    async def read(self, user, profile, refresh=False):
        key = (user, profile)
        if key in self.pending:
            return await asyncio.shield(self.pending[key])
        cached = self.cache.get(key)
        if not refresh and cached and time.monotonic() - cached[0] < self.ttl:
            return cached[1]
        if len(self.pending) >= 128:
            raise HTTPException(503, "Quota refresh busy. Retry later.")

        async def run():
            try:
                result = await self.collect(user, profile)
                if len(self.cache) >= 128:
                    self.cache.pop(next(iter(self.cache)))
                self.cache[key] = (time.monotonic(), result)
                return result
            finally:
                self.pending.pop(key, None)
        task = asyncio.create_task(run())
        self.pending[key] = task
        return await asyncio.shield(task)


def create_router(bridge=None):
    service = QuotaDashboard(bridge)
    router = APIRouter()

    @router.get("/quotas")
    async def quotas(request: Request, response: Response, profile: str = "default", refresh: bool = False):
        response.headers["Cache-Control"] = "no-store"
        return await service.read(_user(request), _safe(profile, "profile"), refresh)

    return router
