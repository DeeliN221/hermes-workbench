"""Read-only server adapters. Provider output and credentials never cross the API boundary."""
from __future__ import annotations

import asyncio
import csv
import io
import json
import math
import os
import signal
import stat
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

GEMINI_TIMEOUT = 20
OPENCODE_TIMEOUT = 8
OPENCODE_URL = 'https://opencode.ai/zen/go/v1/usage'
SOURCES = {'gemini': "agy -p '/usage' · Gemini Models", 'opencode': 'OpenCode Go · GET /zen/go/v1/usage'}
SETUP = ('需要配置 OpenCode Go 登录。On the server, save {"token":"<OpenCode Go API key>"} '
         'or {"cookie":"<session cookie>"} in a mode-0600 JSON file; set '
         'WORKBENCH_OPENCODE_AUTH_FILE to its absolute path, then Refresh. Never paste credentials into this page.')


def result(provider, status, reason, windows=None):
    checked = datetime.now(timezone.utc).isoformat()
    return dict(id=provider, status=status, reason=reason, windows=windows or [],
                source=SOURCES[provider], checkedAt=checked, updatedAt=checked if windows else None)


def reset_time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None
    except ValueError:
        return None


def percent(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 100


def parse_gemini(text):
    windows = {}
    labels = {'Week Limit Remaining': 10080, 'Weekly Limit Remaining': 10080, 'Five Hour Limit Remaining': 300}
    for row in csv.reader(io.StringIO(text), delimiter='\t'):
        if len(row) != 4 or row[0].strip() != 'Gemini Models' or row[1].strip() not in labels:
            continue
        try:
            value = float(row[2].strip().removesuffix('%')) if row[2].strip().endswith('%') else None
        except ValueError:
            continue
        if percent(value):
            minutes = labels[row[1].strip()]
            windows[minutes] = dict(minutes=minutes, remainingPercent=value, resetsAt=reset_time(row[3].strip()))
    return list(windows.values())


def parse_opencode(payload):
    usage = payload.get('usage') if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        return []
    windows = []
    for name, minutes in [('rolling', 300), ('weekly', 10080), ('monthly', 43200)]:
        item = usage.get(name)
        if isinstance(item, dict) and percent(item.get('percent')):
            windows.append(dict(minutes=minutes, label=name.title() + ' window',
                                remainingPercent=round(100 - item['percent'], 2), resetsAt=reset_time(item.get('resetsAt'))))
    return windows


async def gemini():
    try:
        proc = await asyncio.create_subprocess_exec('agy', '-p', '/usage', stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
    except FileNotFoundError:
        return result('gemini', 'command_missing', 'Install agy on the Workbench server and make it available on the service PATH, then Refresh.')
    try:
        output, _ = await asyncio.wait_for(proc.communicate(), GEMINI_TIMEOUT)
    except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.communicate()
        if isinstance(exc, asyncio.CancelledError):
            raise
        return result('gemini', 'timeout', 'agy usage exceeded 20 seconds. Check agy login/connectivity on the server, then Refresh.')
    text = output.decode('utf-8', errors='replace')
    if proc.returncode or any(marker in text.lower() for marker in ('not logged in', 'unauthorized', 'please login', 'please log in', 'authentication required')):
        return result('gemini', 'login_required', "Run agy on the Workbench server, sign in, and verify agy -p '/usage', then Refresh.")
    if not text.strip():
        return result('gemini', 'empty', "agy returned empty output. Verify agy -p '/usage' under the service account, then Refresh.")
    windows = parse_gemini(text)
    return result('gemini', 'available' if windows else 'invalid',
                  'Gemini Models only; the CLI does not verify the subscription tier.' if windows else 'No Gemini Models TSV windows found. Check the agy usage format.', windows)


def private_json(path):
    # Refuse symlinks, other owners and group/world-readable credential files.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('Unsafe credentials file')
        return json.loads(stream.read(65536))


def opencode_headers():
    configured = os.environ.get('WORKBENCH_OPENCODE_AUTH_FILE')
    if configured:
        value = private_json(Path(configured).expanduser())
    else:
        path = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'opencode/auth.json'
        if not path.exists():
            return {}
        auth = private_json(path)
        value = {}
        for provider in ('opencode-go', 'opencode'):
            entry = auth.get(provider, {})
            if entry.get('type') == 'api' and entry.get('key'):
                value = {'token': entry['key']}
                break
    headers = {}
    for field, header, prefix in [('token', 'Authorization', 'Bearer '), ('cookie', 'Cookie', '')]:
        secret = value.get(field)
        if secret is not None:
            if not isinstance(secret, str) or not secret.strip() or '\r' in secret or '\n' in secret:
                raise ValueError('Invalid credential')
            headers[header] = prefix + secret.strip()
    return headers


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward credentials to a redirect target.


def opencode_sync():
    try:
        headers = opencode_headers()
    except (OSError, ValueError, TypeError, AttributeError):
        return result('opencode', 'configuration_error', 'Cannot read a private OpenCode credentials file. Check owner, mode 0600 and JSON format. ' + SETUP)
    if not headers:
        return result('opencode', 'login_required', SETUP)
    try:
        request = urllib.request.Request(OPENCODE_URL, headers={**headers, 'Accept': 'application/json'})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=OPENCODE_TIMEOUT) as response:
            raw = response.read(200001)
        if not raw.strip():
            return result('opencode', 'empty', 'OpenCode returned empty output. Retry using Refresh.')
        windows = parse_opencode(json.loads(raw)) if len(raw) <= 200000 else []
        return result('opencode', 'available' if windows else 'invalid',
                      'Provider-reported Go usage; remaining = 100 − used percent.' if windows else 'No usable OpenCode usage windows. Check the provider account, then Refresh.', windows)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return result('opencode', 'login_required', 'OpenCode rejected the login (401). ' + SETUP)
        if exc.code == 403:
            return result('opencode', 'subscription_required', 'OpenCode Go subscription required (403). Verify Go access for this server credential, then Refresh.')
        return result('opencode', 'error', 'OpenCode usage request failed. Retry using Refresh.')
    except (TimeoutError, asyncio.TimeoutError):
        return result('opencode', 'timeout', 'OpenCode usage request timed out. Check connectivity, then Refresh.')
    except urllib.error.URLError as exc:
        return result('opencode', 'timeout' if isinstance(exc.reason, TimeoutError) else 'error', 'OpenCode connection failed or timed out. Check connectivity, then Refresh.')
    except (OSError, ValueError, TypeError):
        return result('opencode', 'error', 'OpenCode returned an unreadable response. Retry using Refresh.')


async def opencode():
    return await asyncio.to_thread(opencode_sync)
