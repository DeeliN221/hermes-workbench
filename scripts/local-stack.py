#!/usr/bin/env python3
"""Own only this checkout's isolated local acceptance stack. Never deploy remotely."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import secrets
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT/'.local-stack'
PORTS = [9120, 9451, 9119, 9450, 19452]

def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)

def stop():
    path = STATE/'processes.json'
    if not path.exists():
        return
    for item in reversed(json.loads(path.read_text())):
        result = subprocess.run(['ps', '-p', str(item['pid']), '-o', 'lstart='], capture_output=True, text=True)
        if result.stdout.strip() == item['identity']:
            os.kill(item['pid'], signal.SIGTERM)
    path.unlink()
    for _ in range(50):
        if all(socket.socket().connect_ex(('127.0.0.1', p)) != 0 for p in PORTS):
            break
        time.sleep(.1)

def start():
    stop()
    for port in PORTS:
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise SystemExit(f'Port {port} is occupied by an unowned process; explicitly retire the old dev stack first')
    hermes = Path(os.environ.get('HERMES_SOURCE', str(Path.home()/'projects/hermes-agent'))).resolve()
    python = str(hermes/'.venv/bin/python')
    codex = os.environ.get('ACCEPTANCE_CODEX', shutil.which('codex') or '')
    fleet = os.environ.get('ACCEPTANCE_FLEETD', str(Path.home()/'projects/fleet/bin/fleetd'))
    STATE.mkdir(mode=0o700, exist_ok=True)
    home = STATE/'hermes'
    (home/'plugins').mkdir(parents=True, exist_ok=True)
    plugin = home/'plugins/workbench'
    if not plugin.exists():
        plugin.symlink_to(ROOT, target_is_directory=True)
    (home/'config.yaml').write_text(f'plugins:\n  enabled: [workbench]\ndashboard:\n  workbench:\n    root: {home}\n')
    (STATE/'codex-home').mkdir(exist_ok=True)
    token = STATE/'codex-home/ws-token'
    if not token.exists():
        token.write_text(secrets.token_urlsafe(32))
        token.chmod(0o600)
    env = {k: v for k, v in os.environ.items() if not k.startswith(('HERMES', 'CODEX', 'FLEET'))}
    env.update(HERMES_HOME=str(home), HERMES_WORKBENCH_HERMES_HOME=str(home),
        HERMES_SOURCE=str(hermes), HERMES_WORKBENCH_ALLOWED_USERS='acceptance',
        HERMES_DASHBOARD_TRUSTED_PROXY_SECRET='local-acceptance-only',
        HERMES_WORKBENCH_PORT='9451', HERMES_WORKBENCH_HOST='127.0.0.1',
        HERMES_WORKBENCH_CODEX_DB=str(STATE/'codex.sqlite3'),
        HERMES_WORKBENCH_CODEX_WORKSPACES=str(STATE/'workspace'),
        CODEX_HOME=str(STATE/'codex-home'), CODEX_APP_SERVER_ENDPOINT='ws://127.0.0.1:9450',
        CODEX_APP_SERVER_TOKEN_FILE=str(STATE/'codex-home/ws-token'), CODEX_AUTO_UPDATE_ENABLED='0',
        FLEETD_URL='http://127.0.0.1:19452/api/v1', FLEET_URL='http://127.0.0.1:19452',
        FLEET_TOKEN='local-acceptance', FLEET_REVIEW_TOKEN='local-acceptance-review',
        FLEET_TOKEN_FILE=str(STATE/'no-external-token'), PYTHONPATH=str(hermes))
    run([python, 'scripts/seed-local-stack.py'], env=env)
    config = f'''worker_processes 1;
pid {STATE}/nginx.pid;
error_log {STATE}/nginx-error.log;
events {{ worker_connections 128; }}
http {{
 include /opt/homebrew/etc/nginx/mime.types;
 access_log {STATE}/nginx-access.log;
 map $http_upgrade $connection_upgrade {{ default upgrade; '' close; }}
 server {{
 listen 127.0.0.1:9120;
 location /__acceptance/fonts/ {{ alias {ROOT}/node_modules/@fontsource/noto-sans-sc/; }}
 location = /__acceptance/version {{ proxy_set_header X-Hermes-Proxy-Secret local-acceptance-only; proxy_set_header Remote-User acceptance; proxy_pass http://127.0.0.1:9451/api/plugins/workbench/runtime-version; }}
 location = /__acceptance/health {{ proxy_pass http://127.0.0.1:9451/health; }}
 location /dashboard-plugins/workbench/dist/ {{ alias {ROOT}/dashboard/dist/; add_header Cache-Control no-store; }}
 location /workbench-sidecar/ {{ proxy_pass http://127.0.0.1:9451; }}
 location /api/plugins/workbench/ {{
 proxy_set_header X-Hermes-Proxy-Secret local-acceptance-only;
 proxy_set_header Remote-User acceptance;
 proxy_set_header Upgrade $http_upgrade;
 proxy_set_header Connection $connection_upgrade;
 proxy_pass http://127.0.0.1:9451;
 }}
 location / {{ proxy_set_header Host $http_host; proxy_set_header Upgrade $http_upgrade;
 proxy_set_header Connection $connection_upgrade; proxy_pass http://127.0.0.1:9119; }}
 }}
}}'''
    (STATE/'nginx.conf').write_text(config)
    commands = [
        ('fleetd', [fleet, '--db', str(STATE/'fleet.db'), '--listen', '127.0.0.1:19452']),
        ('codex', [codex, 'app-server', '--listen', env['CODEX_APP_SERVER_ENDPOINT'], '--ws-auth', 'capability-token', '--ws-token-file', env['CODEX_APP_SERVER_TOKEN_FILE']]),
        ('hermes', [python, '-m', 'uvicorn', 'hermes_cli.web_server:app', '--host', '127.0.0.1', '--port', '9119']),
        ('sidecar', [python, str(ROOT/'dashboard/sidecar_app.py')]),
        ('nginx', [shutil.which('nginx'), '-c', str(STATE/'nginx.conf'), '-g', 'daemon off;'])]
    processes = []
    try:
        for name, command in commands:
            with (STATE/f'{name}.log').open('a') as log:
                process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=log, start_new_session=True)
            identity = subprocess.check_output(['ps', '-p', str(process.pid), '-o', 'lstart='], text=True).strip()
            processes.append({'name': name, 'pid': process.pid, 'identity': identity})
            (STATE/'processes.json').write_text(json.dumps(processes, indent=2))
        for _ in range(60):
            if all(socket.socket().connect_ex(('127.0.0.1', p)) == 0 for p in PORTS):
                break
            time.sleep(.5)
        else:
            raise RuntimeError('Stack did not become ready within 30 seconds; inspect .local-stack/*.log')
        run([python, 'scripts/seed-local-stack.py', '--fleet'], env=env)
        run([python, 'scripts/probe-local-services.py'], env=env)
        run(['python3', 'scripts/verify-local-runtime.py'])
    except BaseException:
        stop()
        raise

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['restart', 'stop', 'check', 'rebuild'])
    action = parser.parse_args().action
    if action == 'stop': stop()
    elif action == 'check':
        python = str(Path(os.environ.get('HERMES_SOURCE', str(Path.home()/'projects/hermes-agent')))/'.venv/bin/python')
        run([python, 'scripts/probe-local-services.py'])
        run(['python3', 'scripts/verify-local-runtime.py'])
    else:
        if action == 'rebuild':
            run(['pnpm', 'install', '--frozen-lockfile'])
            run(['pnpm', 'build'])
        start()
