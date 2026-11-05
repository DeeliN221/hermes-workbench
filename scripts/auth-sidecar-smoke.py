#!/usr/bin/env python3
"""Deploy an isolated local sidecar, probe auth contracts, retain access evidence."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

root = Path(__file__).resolve().parent.parent
artifacts = root / 'artifacts'
state = root / 'test-results/auth-sidecar'
state.mkdir(parents=True, exist_ok=True)
env = {k: v for k, v in os.environ.items() if not k.startswith(('HERMES_', 'CODEX_', 'WORKBENCH_', 'FLEET'))}
env.update(HERMES_HOME=str(state), HERMES_WORKBENCH_ALLOWED_USERS='smoke',
           HERMES_DASHBOARD_TRUSTED_PROXY_SECRET='local-smoke-proxy',
           HERMES_WORKBENCH_INTERNAL_STATUS_TOKEN='local-smoke-status',
           XDG_CONFIG_HOME=str(state / 'config'))
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
origin = f'http://127.0.0.1:{port}'
results = []
def probe(path, headers=None):
    try:
        response = urlopen(Request(origin + path, headers=headers or {}), timeout=10)
    except HTTPError as error:
        response = error
    body = response.read().decode()
    results.append({'path': path, 'status': response.code})
    return response.code, body

with (artifacts / 'auth-sidecar-access.log').open('w') as log:
    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'sidecar_app:app', '--app-dir', str(root / 'dashboard'),
                                '--host', '127.0.0.1', '--port', str(port)], cwd=root, env=env, stdout=log, stderr=log)
    try:
        for _ in range(100):
            try:
                if probe('/healthz')[0] == 200:
                    break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('sidecar startup failed')
        assert probe('/health')[0] == 200
        path = '/api/plugins/workbench/versions/update-status'
        code, body = probe(path)
        assert code == 401 and json.loads(body)['code'] == 'auth_required'
        assert probe(path, {'Cookie': 'session=expired'})[0] == 401
        assert '<!doctype html>' in probe(path, {'Sec-Fetch-Mode': 'navigate'})[1]
        authenticated_start = len(results)
        for _ in range(20):
            assert probe(path, {'X-Workbench-Status-Token': 'local-smoke-status'})[0] == 200
            assert probe(path, {'X-Hermes-Proxy-Secret': 'local-smoke-proxy', 'Remote-User': 'smoke'})[0] == 200
        assert all(item['status'] == 200 for item in results[authenticated_start:])
        print(json.dumps({'deployment': 'local isolated subprocess; production NOT deployed',
                          'authenticated_poll_requests': 40, 'authenticated_401_count': 0,
                          'results': results}, indent=2))
    finally:
        process.terminate()
        process.wait(timeout=15)
