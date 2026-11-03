"""Fleet v1 boundary. Credentials never leave this server module."""
from __future__ import annotations

import json
import os
import socket
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener

from fastapi import HTTPException

DEFAULT_URL = "http://192.168.2.5:18787/api/v1"
MAX_JSON = 8 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class FleetClient:
    def __init__(self):
        self.base = os.getenv("FLEETD_URL", DEFAULT_URL).rstrip("/")
        try:
            url = urlsplit(self.base)
            if (url.scheme not in ("http", "https") or not url.hostname
                    or url.username or url.password or url.query or url.fragment):
                raise ValueError()
            self.timeout = max(0.1, min(float(os.getenv("FLEETD_TIMEOUT_SECONDS", "8")), 30))
        except ValueError:
            raise HTTPException(503, "Invalid server Fleet configuration") from None
        self.review_token = os.getenv("FLEET_REVIEW_TOKEN", "").strip()
        self.token = os.getenv("FLEET_TOKEN", "").strip()
        if not self.token:
            try:
                self.token = Path(os.getenv("FLEET_TOKEN_FILE", "/opt/data/.fleet-token")).read_text().strip()
            except (OSError, ValueError):
                pass
        if not self.token or "\n" in self.token or "\r" in self.token:
            raise HTTPException(503, "Fleet token missing or unreadable; configure it on the server and retry")

    def redact(self, value):
        # Even allowed free-text fields can repeat a credential. Scrub recursively.
        if isinstance(value, str):
            for token in sorted({self.token, self.review_token}, key=len, reverse=True):
                if token:
                    value = value.replace(token, "[redacted]")
            return value
        if isinstance(value, list):
            return [self.redact(v) for v in value]
        if isinstance(value, dict):
            return {self.redact(k): self.redact(v) for k, v in value.items()}
        return value

    def require_review(self):
        if (not self.review_token or self.review_token == self.token
                or any(ord(c) < 33 or ord(c) > 126 for c in self.review_token)):
            raise HTTPException(503, "FLEET_REVIEW_TOKEN missing or invalid; configure a separate review credential on the server")

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, body, *, review=False):
        return self.request("POST", path, body, review=review)

    def request(self, method, path, body=None, *, review=False):
        if review:
            self.require_review()
        request = Request(self.base + "/" + path, method=method,
                          data=None if body is None else json.dumps(body).encode(), headers={
            "Authorization": "Bearer " + (self.review_token if review else self.token),
            "Accept": "application/json", "Content-Type": "application/json"})
        try:
            with build_opener(NoRedirect()).open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_JSON + 1)
                if len(raw) > MAX_JSON:
                    raise HTTPException(502, "Fleet response too large")
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError()
                return self.redact(value)
        except HTTPError as error:
            status = error.code if error.code in (401, 403, 404, 409, 429) else 502
            message = {
                401: "Fleet authentication failed (401); check the server token and retry",
                403: "Fleet access denied (403); check server permissions",
                404: "Fleet task or endpoint not found (404); refresh and retry",
                409: "Fleet task changed (409); refresh and retry",
                429: "Fleet is busy (429); retry shortly",
                502: "Fleet server error; retry shortly",
            }[status]
            raise HTTPException(status, message) from None
        except (TimeoutError, socket.timeout):
            raise HTTPException(504, "Fleet request timed out; retry") from None
        except URLError as error:
            if isinstance(error.reason, (TimeoutError, socket.timeout)):
                raise HTTPException(504, "Fleet request timed out; retry") from None
            raise HTTPException(502, "Cannot connect to Fleet; check the connection and retry") from None
        except (OSError, ValueError):
            raise HTTPException(502, "Fleet returned an invalid response or disconnected; retry") from None

    def collection(self, name, **query):
        rows, seen = [], set()
        while True:
            value = self.get(name + ("?" + urlencode(query) if query else ""))
            batch = value.get(name)
            if not isinstance(batch, list) or any(not isinstance(r, dict) for r in batch):
                raise HTTPException(502, "Invalid Fleet collection; retry")
            rows.extend(batch)
            cursor = value.get("next_cursor")
            if not cursor:
                return rows
            if not isinstance(cursor, str) or cursor in seen or len(seen) >= 100:
                raise HTTPException(502, "Fleet pagination incomplete; retry")
            seen.add(cursor)
            query["cursor"] = cursor
