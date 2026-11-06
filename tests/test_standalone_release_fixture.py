"""Private subprocess fixtures for release supervision tests; no provider access."""
from __future__ import annotations

import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def run():
    role = sys.argv[1]
    if role == 'supervisor':
        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location('release_start_fixture', root / 'scripts/start-standalone.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        config = module.load_config(Path(sys.argv[2]), development=True)
        commands = [[sys.executable, str(Path(__file__).resolve()), part] for part in ('bridge', 'app')]
        try:
            return module.Supervisor(config, root, commands=commands).run()
        except module.ReleaseError as error:
            print(error, file=sys.stderr)
            return 1
    state = Path(os.environ['WORKBENCH_DSH_STATE']).parent
    if role == 'host':
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        time.sleep(60)
        return 0
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    with (state / (role + '-pids')).open('a') as output:
        output.write(str(os.getpid()) + '\n')
    if role == 'bridge':
        host = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'host'])
        with (state / 'host-pids').open('a') as output:
            output.write(str(host.pid) + '\n')
        token = Path(os.environ['WORKBENCH_DSH_BRIDGE_TOKEN_FILE'])
        if not token.exists():
            token.write_text('fixture-bridge-value')
            token.chmod(0o600)
    else:
        token = Path(os.environ['WORKBENCH_STANDALONE_HOME']) / 'bootstrap-token'
        if not token.exists():
            token.write_text('fixture-bootstrap-value-is-at-least-32-characters')
            token.chmod(0o600)
    with (state / 'environment-observations').open('a') as output:
        json.dump({'role': role, 'ambient_secret_absent': 'RELEASE_AMBIENT_SECRET' not in os.environ,
                   'bridge_file': os.environ['WORKBENCH_DSH_BRIDGE_TOKEN_FILE'],
                   'app_file': os.environ['WORKBENCH_RUNTIME_BRIDGE_TOKEN_FILE'],
                   'dsh_home': os.environ['DSH_HOME']}, output)
        output.write('\n')
    # Deliberate fixture-only token output must stay in private logs.
    print('fixture-console-sensitive-marker', flush=True)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            okay = (role == 'app' and self.path == '/api/standalone/bootstrap'
                    and self.headers.get('Authorization') == 'Bearer ' + token.read_text()
                    and self.headers.get('x-workbench-request') == '1')
            self.send_response(200 if okay else 401)
            if okay:
                self.send_header('Set-Cookie', 'fixture_session=fixture-only; HttpOnly; Path=/')
            self.end_headers()
            self.wfile.write(b'{}')

        def do_GET(self):
            mode_file = state / (role + '-mode')
            mode = mode_file.read_text().strip() if mode_file.exists() else 'good'
            if role == 'bridge':
                okay = (self.path == '/api/runtime/capabilities'
                        and self.headers.get('Authorization') == 'Bearer ' + token.read_text())
            elif os.environ['WORKBENCH_AUTH_MODE'] == 'trusted-proxy':
                from urllib.parse import urlsplit
                okay = (self.headers.get('Host') == urlsplit(os.environ['WORKBENCH_PUBLIC_ORIGIN']).netloc
                        and self.headers.get('x-hermes-proxy-secret') == Path(os.environ['WORKBENCH_TRUSTED_PROXY_SECRET_FILE']).read_text()
                        and self.headers.get('remote-user') == os.environ['WORKBENCH_ALLOWED_USERS'].split(',')[0])
            else:
                okay = self.headers.get('Cookie') == 'fixture_session=fixture-only'
            if not okay:
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{}')
                return
            if mode == 'redirect':
                self.send_response(302)
                self.send_header('Location', '/redirect-destination')
            else:
                self.send_response(503 if mode == 'unavailable' else 200)
            self.end_headers()
            value = {'status': 'ready' if mode != 'bad-status' else 'starting',
                     'runtime': 'dsh' if mode != 'bad-runtime' else 'other'}
            self.wfile.write(b'<html>shell</html>' if mode == 'html' else json.dumps(value).encode())

    port = int(os.environ['PORT']) if role == 'bridge' else int(os.environ['WORKBENCH_RUNTIME_URL'].rsplit(':', 1)[1]) - 1
    # Fixture ports are allocated consecutively by the test harness.
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever(poll_interval=0.05)
    return 0


if __name__ == '__main__':
    raise SystemExit(run())
