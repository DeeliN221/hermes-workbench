"""Resolve the subscription allowance for the model that served a turn.

Only subscription-backed models have an allowance worth showing. Direct
API-key providers (for example DeepSeek) deliberately return no quota.
"""
from __future__ import annotations

import json
import math
import os
import re
import time
import urllib.request
from pathlib import Path
from typing import Any

GOOGLE_PROVIDER = "google-antigravity"
_GOOGLE_PREFIXES = ("google-antigravity/", "antigravity/", "agy/")
_CLAUDE_MODEL = re.compile(r"claude|opus|sonnet|gpt[-_]?oss", re.IGNORECASE)
_OPENAI_MODEL = re.compile(r"^(?:gpt-|o[134]-|codex)", re.IGNORECASE)
_REPORT_CACHE_SECONDS = 15.0
_REPORT_CACHE: tuple[float, dict[str, Any] | None] = (0.0, None)
_DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def model_provider(model: str | None) -> str | None:
    """Classify a model id as a subscription, API, or unknown provider."""

    value = (model or "").strip().lower()
    if not value:
        return None
    if value.startswith(_GOOGLE_PREFIXES):
        return "google"
    if value.startswith("deepseek/") or value == "deepseek":
        return "api"
    if value.startswith("openai/") or _OPENAI_MODEL.match(value):
        return "openai"
    return None


def google_family(model: str | None) -> str:
    """Return the Antigravity quota family: Cla for Claude/3P, Gem for Gemini."""

    return "Cla" if _CLAUDE_MODEL.search(model or "") else "Gem"


def family_label(family: str) -> str:
    return "Claude" if family == "Cla" else "Gemini"


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def _remaining_from_used(value: Any) -> float | None:
    used = _number(value)
    if used is None:
        return None
    return round(max(0.0, min(100.0, 100.0 - used)), 1)


def openai_quota(result: Any) -> dict[str, Any] | None:
    """Read the Codex subscription windows from an account/rateLimits response."""

    if not isinstance(result, dict):
        return None
    buckets = result.get("rateLimitsByLimitId")
    bucket = buckets.get("codex") if isinstance(buckets, dict) else result.get("rateLimits")
    if not isinstance(bucket, dict) or bucket.get("limitId") not in (None, "codex"):
        return None
    five_hour: float | None = None
    weekly: float | None = None
    for name in ("primary", "secondary"):
        window = bucket.get(name)
        if not isinstance(window, dict):
            continue
        minutes = _number(window.get("windowDurationMins", window.get("window_duration_mins")))
        used = window.get("usedPercent", window.get("used_percent"))
        remaining = _remaining_from_used(used)
        if remaining is None:
            continue
        if minutes == 300:
            five_hour = remaining
        elif minutes == 7 * 24 * 60:
            weekly = remaining
    if five_hour is None and weekly is None:
        return None
    return {
        "kind": "openai",
        "label": "Codex",
        "subscription": True,
        **({"fiveHourRemaining": five_hour} if five_hour is not None else {}),
        **({"weeklyRemaining": weekly} if weekly is not None else {}),
    }


def _google_report(report: Any) -> dict[str, Any] | None:
    if not isinstance(report, dict):
        return None
    reports = report.get("reports")
    if isinstance(reports, list):
        for item in reports:
            if isinstance(item, dict) and item.get("provider") == GOOGLE_PROVIDER:
                return item
    if report.get("provider") == GOOGLE_PROVIDER:
        return report
    return None


def google_quota_from_report(report: Any, model: str | None) -> dict[str, Any]:
    """Select the Gem/Cla five-hour and weekly windows for one Antigravity model."""

    family = google_family(model)
    result: dict[str, Any] = {
        "kind": "google",
        "label": family_label(family),
        "subscription": True,
        **({"model": model.strip()} if isinstance(model, str) and model.strip() else {}),
    }
    provider_report = _google_report(report)
    quota = provider_report.get("quota") if isinstance(provider_report, dict) else None
    windows = quota.get("customWindows") if isinstance(quota, dict) else None
    if not isinstance(windows, list):
        return result
    by_label = {item.get("label"): item for item in windows if isinstance(item, dict)}
    for suffix, key, reset_key in (("", "fiveHourRemaining", "fiveHourResetAt"), (" (Weekly)", "weeklyRemaining", "weeklyResetAt")):
        window = by_label.get(f"{family}{suffix}")
        if not isinstance(window, dict):
            continue
        remaining = _remaining_from_used(window.get("percent"))
        if remaining is None:
            continue
        result[key] = remaining
        if isinstance(window.get("resetAt"), (int, float)) and not isinstance(window.get("resetAt"), bool):
            result[reset_key] = window["resetAt"]
    return result


def _config_dir() -> Path:
    configured = (os.environ.get("OPENCODEX_HOME") or os.environ.get("OPENCODEX_CONFIG_DIR") or "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".opencodex"


def _base_url() -> str:
    configured = os.environ.get("OPENCODEX_BASE_URL", "").strip()
    if configured:
        return configured.rstrip("/")
    port = 10100
    try:
        value = json.loads((_config_dir() / "runtime-port.json").read_text(encoding="utf-8"))
        candidate = value.get("port") if isinstance(value, dict) else None
        if isinstance(candidate, int) and 0 < candidate < 65536:
            port = candidate
    except (OSError, ValueError, TypeError):
        pass
    return f"http://127.0.0.1:{port}"


def _admin_token() -> str:
    configured = (os.environ.get("OPENCODEX_ADMIN_AUTH_TOKEN") or os.environ.get("OPENCODEX_ADMIN_TOKEN") or "").strip()
    if configured:
        return configured
    try:
        return (_config_dir() / "admin-api-token").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _fetch_report() -> dict[str, Any] | None:
    global _REPORT_CACHE
    now = time.monotonic()
    cached_at, cached = _REPORT_CACHE
    if now - cached_at < _REPORT_CACHE_SECONDS:
        return cached
    token = _admin_token()
    if not token:
        _REPORT_CACHE = (now, None)
        return None
    request = urllib.request.Request(
        f"{_base_url()}/api/provider-quotas",
        headers={"Accept": "application/json", "X-OpenCodex-API-Key": token},
        method="GET",
    )
    try:
        with _DIRECT_OPENER.open(request, timeout=4) as response:
            report = json.loads(response.read(200_000).decode("utf-8"))
        _REPORT_CACHE = (now, report if isinstance(report, dict) else None)
    except (OSError, ValueError, TypeError):
        _REPORT_CACHE = (now, None)
    return _REPORT_CACHE[1]


def fetch_google_quota(model: str | None) -> dict[str, Any]:
    """Return the Antigravity windows for a model; missing data stays visibly unknown."""

    return google_quota_from_report(_fetch_report(), model)
