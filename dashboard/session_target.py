"""Resolve task references through user/profile-scoped Workbench mappings.

Remote devices are administrator configured, never taken from task/spec URLs.
"""
import json
import os
from urllib.parse import urlencode, urlsplit
from urllib.request import Request as URLRequest


def mapped_target(service, user, profile, conversation_id, device=""):
    if service is None:
        return {"state": "unavailable"}
    store = service.store
    row = store.session_by_thread(user, profile, conversation_id) or store.session(user, profile, conversation_id)
    if not row:
        return {"state": "unavailable"}
    node = row.get("execution_node_id") or ""
    local_devices = {v.strip() for v in os.getenv("HERMES_WORKBENCH_LOCAL_DEVICES", "").split(",") if v.strip()}
    if device and device != node and device not in local_devices:
        return {"state": "unavailable"}
    if row.get("deleted") or row.get("status") in ("archived", "deleted"):
        return {"state": "archived"}
    return {"state": "available", "id": row["session_id"], "profile": profile, "kind": "codex"}


def resolve_target(service, user, profile, conversation_id, device=""):
    local = mapped_target(service, user, profile, conversation_id, device)
    try:
        devices = json.loads(os.getenv("HERMES_WORKBENCH_SESSION_DEVICES", "{}"))
        if device not in devices:
            return local
        config = devices.get(device, {})
        base = config.get("url", "").rstrip("/")
        parsed = urlsplit(base)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or not config.get("proxy_secret")):
            return {"state": "unavailable"}
        query = urlencode({"profile": profile, "conversation_id": conversation_id, "device": device})
        request = URLRequest(base + "/api/plugins/workbench/codex/session-target?" + query, headers={
            "remote-user": user, "x-hermes-proxy-secret": config["proxy_secret"],
        })
        # Do not forward identity/credentials through redirects.
        from urllib.request import HTTPRedirectHandler, build_opener
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        with build_opener(NoRedirect()).open(request, timeout=5) as response:
            target = json.loads(response.read(16384))
        if target.get("state") == "archived":
            return {"state": "archived"}
        if (target.get("state") != "available" or target.get("profile") != profile
                or target.get("kind") != "codex" or not isinstance(target.get("id"), str) or not target["id"]):
            return {"state": "unavailable"}
        return {"state": "available", "id": target["id"], "profile": profile, "kind": "codex",
                "remoteUrl": base + "/chat?" + urlencode({"session": target["id"], "profile": profile})}
    except (ValueError, TypeError, AttributeError, OSError):
        return {"state": "unavailable"}
