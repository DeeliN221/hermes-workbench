"""OpenCode Go model adapter for Workbench.

Workbench reads the OpenCode Go model catalog so that models available through an
OpenCode Go subscription can be selected alongside Codex and direct-API models.
The adapter is read-only and server-side only: credentials stay in the existing
private OpenCode auth file and never cross the API boundary.
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
import time
import urllib.error
import urllib.request
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import live_allowances

BASE_URL = os.environ.get("WORKBENCH_OPENCODE_BASE_URL", "https://opencode.ai/zen/go").rstrip("/")
MODELS_URL = f"{BASE_URL}/v1/models"
OPENCODE_USER_AGENT = "Hermes-Workbench/1.0"
PROVIDER = "opencode-go"
_TIMEOUT = 8.0
_MAX_MODELS = 200
_CACHE_SECONDS = 300.0
_CACHE_LOCK = threading.Lock()
_CACHE: tuple[float, tuple[dict[str, Any], ...]] = (0.0, ())


class ModelOption(BaseModel):
    """Profile-editor provider entry."""

    slug: str
    name: str
    authenticated: bool
    models: list[str]


def _auth_headers() -> dict[str, str]:
    """Return request headers when a private OpenCode credential is available."""
    try:
        return live_allowances.opencode_headers()
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def _fetch_raw(url: str, headers: dict[str, str]) -> dict[str, Any]:
    """Fetch one JSON document without following redirects that could carry credentials."""
    request = urllib.request.Request(
        url,
        headers={
            **headers,
            "Accept": "application/json",
            "User-Agent": OPENCODE_USER_AGENT,
        },
        method="GET",
    )
    opener = urllib.request.build_opener(live_allowances.NoRedirect())
    with opener.open(request, timeout=_TIMEOUT) as response:
        raw = response.read(1_000_001)
    if len(raw) > 1_000_000:
        raise ValueError("OpenCode model list too large")
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("OpenCode model list is not an object")
    return payload


def _reasoning_efforts(row: dict[str, Any]) -> tuple[list[dict[str, str]], str]:
    capabilities = row.get("capabilities")
    reasoning = capabilities.get("reasoning") if isinstance(capabilities, dict) else None
    if not isinstance(reasoning, dict) or reasoning.get("supported") is not True:
        return [], ""
    raw = reasoning.get("effort")
    efforts = [value.strip() for value in raw if isinstance(value, str) and value.strip()] if isinstance(raw, list) else []
    default = reasoning.get("default")
    default_effort = default.get("value") if isinstance(default, dict) else None
    if not isinstance(default_effort, str) or default_effort not in efforts:
        default_effort = efforts[0] if efforts else ""
    return [{"reasoningEffort": effort, "description": ""} for effort in dict.fromkeys(efforts)], default_effort


def _input_modalities(row: dict[str, Any]) -> list[str]:
    modalities = row.get("modalities")
    raw = modalities.get("input") if isinstance(modalities, dict) else None
    if not isinstance(raw, list):
        return ["text"]
    values = set()
    for value in raw:
        if not isinstance(value, str):
            continue
        kind = value.strip().lower().split("/", 1)[0]
        if kind in {"text", "image", "audio", "video"}:
            values.add(kind)
    return [kind for kind in ("text", "image", "audio", "video") if kind in values] or ["text"]


def _context_window(row: dict[str, Any]) -> int | None:
    limit = row.get("limit")
    value = limit.get("context") if isinstance(limit, dict) else None
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _normalize_models(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Map the Go /v1/models response to the Codex model-catalog shape."""
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in data:
        if not isinstance(row, dict):
            continue
        model_id = str(row.get("id") or "").strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        display = str(row.get("displayName") or row.get("name") or model_id).strip() or model_id
        efforts, default_effort = _reasoning_efforts(row)
        context_window = _context_window(row)
        description = str(row.get("description") or "").strip()
        slug = f"{PROVIDER}/{model_id}"
        models.append({
            "id": slug,
            "model": slug,
            "displayName": display,
            "description": description,
            "hidden": False,
            "supportedReasoningEfforts": efforts,
            "defaultReasoningEffort": default_effort,
            "inputModalities": _input_modalities(row),
            "serviceTiers": [],
            "isDefault": False,
            **({"contextWindow": context_window} if context_window is not None else {}),
        })
    return models[:_MAX_MODELS]


def _cached_models() -> list[dict[str, Any]]:
    """Return a short-lived snapshot; the public catalog changes rarely."""
    global _CACHE
    now = time.monotonic()
    with _CACHE_LOCK:
        fetched_at, rows = _CACHE
        if rows and now - fetched_at < _CACHE_SECONDS:
            return [dict(row) for row in rows]
    payload = _fetch_raw(MODELS_URL, _auth_headers())
    models = _normalize_models(payload)
    with _CACHE_LOCK:
        _CACHE = (time.monotonic(), tuple(dict(row) for row in models))
    return models


def model_options() -> ModelOption:
    """Return one provider option for the profile-editor model picker."""
    if not _auth_headers():
        return ModelOption(slug=PROVIDER, name="OpenCode Go", authenticated=False, models=[])
    try:
        models = _cached_models()
    except urllib.error.HTTPError as exc:
        exc.close()
        if exc.code in (401, 403):
            raise HTTPException(
                status_code=exc.code,
                detail="OpenCode Go rejected the credentials or does not allow this account to use its models.",
            ) from exc
        raise HTTPException(status_code=502, detail=f"OpenCode Go returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=503, detail="Could not reach OpenCode Go. Check server connectivity.") from exc
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="OpenCode Go returned an unreadable model list.") from exc
    return ModelOption(
        slug=PROVIDER,
        name="OpenCode Go",
        authenticated=True,
        models=[str(row["id"]) for row in models],
    )


def model_catalog() -> dict[str, Any]:
    """Return a Codex-shaped model catalog for the chat model picker."""
    if not _auth_headers():
        return {"data": []}
    try:
        return {"data": _cached_models()}
    except Exception:
        # A model-catalog failure must never hide the existing Codex/DeepSeek choices.
        return {"data": []}


router = APIRouter()


@router.get("/model-options")
async def opencode_model_options() -> ModelOption:
    """Provider metadata and available models for the profile editor."""
    return await asyncio.to_thread(model_options)


@router.get("/models")
async def opencode_models() -> dict[str, Any]:
    """OpenCode Go models merged into the Codex chat catalog."""
    return await asyncio.to_thread(model_catalog)
