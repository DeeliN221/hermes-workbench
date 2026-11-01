"""Separate durable user input from private attachment context at the RPC boundary.

Codex turn/start and turn/steer accept input blocks, not hidden messages. Keep a
separate hidden message in the bridge request and flatten it only on the wire.
Never expose the native echo (which may join those blocks) as display content.
"""
from __future__ import annotations

import json
import re
from typing import Any

_CONTEXT = "_attachmentContext"
_ATTACHMENTS = "_attachments"
_VERSION = "_messageVisibility"
_LEGACY = re.compile(
    r"^(?:Image attachment: |User attachment(?: folder)?: )[^\r\n]+\n"
    r"Path: [^\r\n]+/\.workbench-attachments/[^\r\n]+(?:\n"
    r"(?:Open the image only when the task needs it\. |List or search the folder first, then open only the relevant files or ranges\. )?"
    r"Read only what the task needs; do not paste the entire file or folder into the context window\.)?$"
)


def decode(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def split_payload(payload: dict) -> tuple[list, list]:
    inputs = payload.get("input", [])
    if not isinstance(inputs, list):
        return [], []
    context = payload.get(_CONTEXT)
    if isinstance(context, dict) and context.get("hidden") is True:
        return inputs, context.get("content", [])
    if payload.get(_VERSION) == 1:
        return inputs, []
    # Older bridge versions appended distinct generated blocks. Only remove a
    # trailing block with the exact generated grammar AND managed-storage path;
    # the first block always belongs to the user, even if it resembles a hint.
    visible = list(inputs)
    hidden = []
    while len(visible) > 1 and isinstance(visible[-1], dict) and _LEGACY.fullmatch(str(visible[-1].get("text", ""))):
        hidden.insert(0, visible.pop())
    return visible, hidden


def wire_payload(payload: dict) -> dict:
    """Adapt private bridge metadata to the supported Codex input schema."""
    visible, hidden = split_payload(payload)
    return {**{k: v for k, v in payload.items() if k not in {_CONTEXT, _ATTACHMENTS, _VERSION}}, "input": visible + hidden}


def input_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(input_text(part) for part in value if not isinstance(part, dict) or part.get("hidden") is not True)
    if isinstance(value, dict):
        return str(value.get("text", ""))
    return ""


def fingerprint(value: Any) -> str:
    return "".join(input_text(value).split())


def needs_attachment_projection(value: Any) -> bool:
    """Stream ordinary deltas/tools without scanning every historical request."""
    if isinstance(value, list):
        return any(needs_attachment_projection(item) for item in value)
    if not isinstance(value, dict):
        return False
    if value.get("type") == "userMessage" or value.get("role") == "user" or "input" in value and "threadId" in value:
        return True
    request = "client_request_id" in value or "clientRequestId" in value
    return any(needs_attachment_projection(decode(item) if request and key in {"payload", "result"} else item)
               for key, item in value.items())


class MessageProjection:
    """One identity-scoped, immutable display projection shared by all UI APIs."""

    def __init__(self, requests: list[dict]):
        self.by_client = {}
        self.by_content = {}
        self.has_context = False
        for request in requests:
            payload = decode(request.get("payload"))
            if not isinstance(payload, dict):
                continue
            visible, hidden = split_payload(payload)
            if not hidden:
                continue
            self.has_context = True
            record = {"content": visible, "attachments": payload.get(_ATTACHMENTS, [])}
            self.by_client[str(request.get("client_request_id", ""))] = record
            self.by_content[fingerprint(visible + hidden)] = record

    def public(self, value: Any) -> Any:
        if isinstance(value, list):
            return [self.public(item) for item in value if not isinstance(item, dict) or item.get("hidden") is not True]
        if not isinstance(value, dict):
            return value
        if value.get("hidden") is True:
            return {"hidden": True}
        result = dict(value)
        if value.get("type") == "userMessage" or value.get("role") == "user":
            projection = self.by_client.get(str(value.get("clientId") or value.get("clientRequestId") or ""))
            if projection is None:
                projection = self.by_content.get(fingerprint(value.get("content", value.get("text", ""))))
            if projection is not None:
                result.update(projection)
                result.pop("text", None)
        if "input" in result and ("threadId" in result or _CONTEXT in result):
            result["input"], _ = split_payload(result)
            if result.get(_ATTACHMENTS):
                result["attachments"] = result[_ATTACHMENTS]
        output = {}
        for key, item in result.items():
            if key in {_CONTEXT, _ATTACHMENTS, _VERSION}:
                continue
            # Request rows store these JSON envelopes as strings. Preserve the
            # API shape while projecting their nested messages too.
            if key in {"payload", "result"} and isinstance(item, str) and ("client_request_id" in value or "clientRequestId" in value):
                parsed = decode(item)
                output[key] = json.dumps(self.public(parsed)) if isinstance(parsed, (dict, list)) else item
            else:
                output[key] = self.public(item)
        return output
