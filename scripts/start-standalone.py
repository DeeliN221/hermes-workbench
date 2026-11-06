#!/usr/bin/env python3
"""Verify and supervise a standalone candidate. No provider probes or discovery."""
from __future__ import annotations

import argparse
from contextlib import closing
import fcntl
import hashlib
from http.client import HTTPConnection
from http.cookiejar import CookieJar
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[1]
DSH_PIN = '0.2.2-rc.1'
ENV_KEYS = {
    'WORKBENCH_AUTH_MODE', 'WORKBENCH_PUBLIC_ORIGIN', 'WORKBENCH_ALLOWED_HOSTS',
    'WORKBENCH_ALLOWED_USERS', 'WORKBENCH_TRUSTED_PROXY_SECRET_FILE',
    'WORKBENCH_FLEET_URL', 'WORKBENCH_FLEET_TOKEN_FILE', 'WORKBENCH_FLEET_REVIEW_TOKEN_FILE',
}


class ReleaseError(Exception):
    """Safe operator-facing error: never contains child output or config values."""


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_manifest(root):
    """Verify the complete file set before importing or executing bundled source."""
    try:
        manifest = json.loads((root / 'standalone-manifest.json').read_text())
        expected = manifest['files']
        actual = set()
        for path in root.rglob('*'):
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                raise ReleaseError('Candidate contains a symbolic link')
            if path.is_file() and relative != 'standalone-manifest.json':
                actual.add(relative)
        if actual != set(expected):
            raise ReleaseError('Candidate file set does not match manifest')
        for name, value in expected.items():
            if digest(root / name) != value:
                raise ReleaseError('Candidate hash mismatch')
        if manifest['dsh_version'] != DSH_PIN or not re.fullmatch(r'[a-f0-9]{40}', manifest['source_commit']):
            raise ReleaseError('Invalid candidate metadata')
        return manifest
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ReleaseError('Candidate manifest is missing or invalid') from error


def private_file(path, *, contents=False):
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
            raise ReleaseError('A configured private file must be owned by this user with mode 0600')
        if contents:
            value = path.read_text().strip()
            if not value or '\n' in value or '\r' in value:
                raise ReleaseError('Invalid private token file')
            return value
    except OSError as error:
        raise ReleaseError('A configured private file is unavailable') from error


def private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ReleaseError('Private directory ownership is invalid')
    path.chmod(0o700)


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(value, output, sort_keys=True)
        output.write('\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def absolute(value):
    if not isinstance(value, str) or not value or not Path(value).is_absolute():
        raise ReleaseError('Configured paths must be explicit absolute paths')
    return Path(os.path.abspath(value))


def load_config(path, root=ROOT, *, development=False):
    private_file(path)
    try:
        config = json.loads(path.read_text())
        required = {'node', 'python', 'state_dir', 'app_home', 'workspace', 'dsh_home',
                    'bridge_token_file', 'provider', 'model', 'app_port', 'bridge_port', 'host_port'}
        optional = {'module_root', 'environment', 'max_restarts', 'startup_timeout', 'stop_timeout', 'health_interval'}
        if not required <= config.keys() or config.keys() - required - optional:
            raise ReleaseError('Missing or unknown configuration keys')
        for key in ('state_dir', 'app_home', 'workspace', 'dsh_home', 'bridge_token_file'):
            config[key] = absolute(config[key])
            if config[key].resolve().is_relative_to(root.resolve()):
                raise ReleaseError('State, tokens and workspace must be outside the release')
        if config['dsh_home'].resolve() == (Path.home() / '.dsh').resolve():
            raise ReleaseError('DSH_HOME must be an explicitly prepared isolated home')
        directory_paths = [config[key] for key in ('state_dir', 'app_home', 'workspace', 'dsh_home')]
        if len(set(directory_paths)) != len(directory_paths):
            raise ReleaseError('State, app home, workspace and DSH home must be distinct')
        workspace = config['workspace'].resolve()
        for key in ('state_dir', 'app_home', 'dsh_home', 'bridge_token_file'):
            private = config[key].resolve()
            if private.is_relative_to(workspace) or workspace.is_relative_to(private):
                raise ReleaseError('Workspace and private state/token paths must not overlap')
        for key in ('provider', 'model'):
            if not isinstance(config[key], str) or not config[key].strip() or any(c in config[key] for c in '\r\n'):
                raise ReleaseError('Explicit provider and model names are required')
        ports = [config[key] for key in ('app_port', 'bridge_port', 'host_port')]
        if any(type(port) is not int or not 1024 <= port <= 65535 for port in ports) or len(set(ports)) != 3:
            raise ReleaseError('Configure three distinct unprivileged loopback ports')
        for key, default, lower, upper in (
            ('max_restarts', 2, 0, 10), ('startup_timeout', 30, 0.1, 300),
            ('stop_timeout', 5, 0.1, 30), ('health_interval', 2, 0.05, 60),
        ):
            config.setdefault(key, default)
            if type(config[key]) not in (int, float) or not lower <= config[key] <= upper:
                raise ReleaseError('Invalid supervisor timing or restart limit')
        if type(config['max_restarts']) is not int:
            raise ReleaseError('Restart limit must be an integer')
        env = config.setdefault('environment', {})
        if not isinstance(env, dict) or env.keys() - ENV_KEYS or any(not isinstance(v, str) for v in env.values()):
            raise ReleaseError('Only documented environment keys are allowed; external Host mode is unsupported')
        mode = env.setdefault('WORKBENCH_AUTH_MODE', 'local')
        if mode not in ('local', 'trusted-proxy'):
            raise ReleaseError('Invalid authentication mode')
        for key in ENV_KEYS:
            if key.endswith('_FILE') and key in env:
                secret_path = absolute(env[key])
                if secret_path.resolve().is_relative_to(root.resolve()):
                    raise ReleaseError('Secret files must be outside the release')
                if secret_path.resolve().is_relative_to(workspace):
                    raise ReleaseError('Secret files must be outside the workspace')
                private_file(secret_path)
        if mode == 'trusted-proxy':
            required_proxy = {'WORKBENCH_TRUSTED_PROXY_SECRET_FILE', 'WORKBENCH_ALLOWED_USERS',
                              'WORKBENCH_PUBLIC_ORIGIN', 'WORKBENCH_ALLOWED_HOSTS'}
            if not required_proxy <= env.keys() or any(not env[k].strip() for k in required_proxy):
                raise ReleaseError('Trusted proxy requires secret file, users, HTTPS origin and explicit hosts')
            origin = urlsplit(env['WORKBENCH_PUBLIC_ORIGIN'])
            hosts = env['WORKBENCH_ALLOWED_HOSTS'].lower().split(',')
            if (origin.scheme != 'https' or not origin.hostname or origin.username or origin.password
                    or origin.path or origin.query or origin.fragment or '*' in ','.join(hosts)
                    or origin.netloc.lower() not in [h.strip() for h in hosts]):
                raise ReleaseError('Trusted proxy requires an HTTPS origin and matching allowed authority')
        if ('WORKBENCH_FLEET_URL' in env) != ('WORKBENCH_FLEET_TOKEN_FILE' in env):
            raise ReleaseError('Fleet requires an explicit URL and token file together')
        if 'WORKBENCH_FLEET_REVIEW_TOKEN_FILE' in env and 'WORKBENCH_FLEET_URL' not in env:
            raise ReleaseError('Fleet review token requires explicit Fleet configuration')
        if 'WORKBENCH_FLEET_URL' in env:
            value = env['WORKBENCH_FLEET_URL']
            fleet = urlsplit(value)
            # Access .port explicitly: urlsplit alone accepts malformed/out-of-range ports.
            port = fleet.port
            host = fleet.hostname
            try:
                loopback = host == 'localhost' or ipaddress.ip_address(host or '').is_loopback
            except ValueError:
                loopback = False
            authority = ('[' + host + ']') if host and ':' in host else host
            if port is not None:
                authority = (authority or '') + ':' + fleet.netloc.rsplit(':', 1)[-1]
            if (fleet.scheme not in ('http', 'https') or not host
                    or fleet.scheme == 'http' and not loopback
                    or fleet.username is not None or fleet.password is not None
                    or fleet.netloc.lower() != authority or port is not None and port == 0
                    or any(c.isspace() for c in value) or any(c in value for c in ('?', '#', '\\'))):
                raise ReleaseError('Fleet requires HTTPS or literal loopback HTTP, without credentials, query or fragment')
        if not development and 'module_root' not in config:
            raise ReleaseError('Release mode requires an explicit external module_root for the frozen runtime installation')
        config['module_root'] = absolute(config['module_root']) if 'module_root' in config else root / 'dashboard/runtime'
        if not development and config['module_root'].resolve().is_relative_to(root.resolve()):
            raise ReleaseError('Release module_root must be outside the immutable candidate')
        return config
    except (ValueError, TypeError, AttributeError) as error:
        raise ReleaseError('Invalid external JSON configuration') from error


def clean_environment():
    # Do not forward ambient provider keys, proxy variables, Python paths or Node options.
    return {'PATH': os.defpath, 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONNOUSERSITE': '1'}


def executable(value):
    found = shutil.which(value) if isinstance(value, str) else None
    if not found:
        raise ReleaseError('A configured interpreter is unavailable')
    # Preserve virtualenv symlinks: resolving Python to its base binary loses the venv.
    return os.path.abspath(found)


def check_runtime(config, root=ROOT):
    config['node'] = executable(config['node'])
    config['python'] = executable(config['python'])
    env = clean_environment()
    try:
        version = subprocess.check_output([config['node'], '--version'], env=env, timeout=5).decode().strip()
        parts = tuple(map(int, version.lstrip('v').split('.')[:3]))
        if parts < (24, 9, 0):
            raise ReleaseError('Node >=24.9.0 is required')
        # Check exact tested pins without importing app source or reading provider configuration.
        code = ('import sys,importlib.metadata as m,json; '
                'assert sys.version_info >= (3,13); '
                'pins=json.loads(sys.argv[1]); '
                'assert all(m.version(k)==v for k,v in pins.items()); '
                'import fastapi,httpx,uvicorn,multipart')
        pins = dict(line.strip().split('==') for line in
                    (root / 'scripts/start-standalone-requirements.txt').read_text().splitlines()
                    if line.strip() and not line.startswith('#'))
        subprocess.run([config['python'], '-c', code, json.dumps(pins)], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=True)
        subprocess.run([config['node'], '--input-type=module', '-e',
                        "import {loadDsh} from './dashboard/runtime/dsh-peer.mjs'; await loadDsh(process.argv[1]);",
                        str(config['module_root'])], cwd=root, env=env, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=10, check=True)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise ReleaseError('Interpreter, pinned Python dependencies or frozen DSH installation check failed') from error
    for name in ('standalone_app.py', 'standalone_auth.py', 'standalone_store.py', 'standalone_services.py'):
        if not (root / 'dashboard' / name).is_file():
            raise ReleaseError('Required standalone backend is missing')
    if not (root / 'dashboard/standalone-dist/standalone.html').is_file():
        raise ReleaseError('Standalone frontend is missing')
    home = config['dsh_home']
    if not (home / 'settings.yaml').is_file() and not (home / 'profiles/web/cordis.patch.yml').is_file():
        raise ReleaseError('Prepare the isolated DSH home before startup')
    # Permission checks only: never parse or import private provider configuration.
    private_file(home / ('settings.yaml' if (home / 'settings.yaml').is_file() else 'profiles/web/cordis.patch.yml'))
    private_file(home / '.env')
    if config['bridge_token_file'].exists():
        private_file(config['bridge_token_file'])


class Health:
    def __init__(self, config):
        self.config = config
        self.cookies = CookieJar()
        self.logged_in = False

    def request(self, url, headers, data=None):
        request = Request(url, headers=headers, data=data)
        self.cookies.add_cookie_header(request)
        origin = urlsplit(url)
        # Direct connections have no proxy/redirect behavior. Close from the client
        # after consuming a keepalive response, so repeated health checks do not
        # leave the app listener trapped in server-side TIME_WAIT on restart.
        with closing(HTTPConnection(origin.hostname, origin.port, timeout=1)) as connection:
            connection.request(request.get_method(), origin.path, body=data, headers=dict(request.header_items()))
            response = connection.getresponse()
            if response.status != 200:
                return None
            self.cookies.extract_cookies(response, request)
            return json.loads(response.read(65537))

    def bridge(self):
        try:
            token = private_file(self.config['bridge_token_file'], contents=True)
            result = self.request(f"http://127.0.0.1:{self.config['bridge_port']}/api/runtime/capabilities",
                                  {'Authorization': 'Bearer ' + token})
            return isinstance(result, dict) and result.get('status') == 'ready' and result.get('runtime') == 'dsh'
        except Exception:
            return False

    def app(self):
        try:
            config = self.config
            env = config['environment']
            url = f"http://127.0.0.1:{config['app_port']}"
            headers = {}
            if env['WORKBENCH_AUTH_MODE'] == 'trusted-proxy':
                headers = {'Host': urlsplit(env['WORKBENCH_PUBLIC_ORIGIN']).netloc,
                           'x-hermes-proxy-secret': private_file(Path(env['WORKBENCH_TRUSTED_PROXY_SECRET_FILE']), contents=True),
                           'remote-user': re.split(r'[,;\s]+', env['WORKBENCH_ALLOWED_USERS'].strip())[0]}
            elif not self.logged_in:
                token = private_file(config['app_home'] / 'bootstrap-token', contents=True)
                self.request(url + '/api/standalone/bootstrap',
                             {'Authorization': 'Bearer ' + token, 'x-workbench-request': '1'}, b'')
                self.logged_in = True
            result = self.request(url + '/health', headers)
            return isinstance(result, dict) and result.get('status') == 'ready' and result.get('runtime') == 'dsh'
        except Exception:
            self.logged_in = False
            return False


class Supervisor:
    def __init__(self, config, root=ROOT, *, commands=None):
        self.config, self.root = config, root
        # Injectable only through the Python API for subprocess fault tests, never config/CLI.
        self.commands = commands or [
            [config['node'], str(root / 'dashboard/runtime/bridge.mjs')],
            [config['python'], '-m', 'dashboard.standalone_app', '--workspace', str(config['workspace']),
             '--port', str(config['app_port'])],
        ]
        self.children = []
        self.stopping = False
        self.stop_event = threading.Event()
        self.owner = secrets.token_hex(16)
        self.health = Health(config)
        self.attempt = 0

    def status(self, state, reason=''):
        atomic_json(self.config['state_dir'] / 'status.json', {
            'owner': self.owner, 'pid': os.getpid(), 'state': state, 'attempt': self.attempt,
            'children': [p.pid for p in self.children], 'reason': reason, 'updated_at': time.time(),
        })

    def child_env(self):
        c = self.config
        env = clean_environment()
        # HOME is isolated; no implicit original provider home can be discovered.
        env.update({'HOME': str(c['dsh_home']), 'DSH_HOME': str(c['dsh_home']),
                    'DSH_MODULE_ROOT': str(c['module_root']), 'DSH_PROVIDER': c['provider'], 'DSH_MODEL': c['model'],
                    'WORKBENCH_DSH_STATE': str(c['state_dir'] / 'runtime'),
                    'WORKBENCH_DSH_BRIDGE_TOKEN_FILE': str(c['bridge_token_file']),
                    'WORKBENCH_RUNTIME_BRIDGE_TOKEN_FILE': str(c['bridge_token_file']),
                    'WORKBENCH_STANDALONE_HOME': str(c['app_home']),
                    'WORKBENCH_WORKSPACE_ROOT': str(c['workspace']),
                    'WORKBENCH_RUNTIME_URL': f"http://127.0.0.1:{c['bridge_port']}",
                    'PORT': str(c['bridge_port']), 'DSH_HOST_PORT': str(c['host_port']),
                    **c['environment']})
        env['PATH'] = os.pathsep.join([str(Path(c['node']).parent), str(Path(c['python']).parent), os.defpath])
        return env

    def spawn(self, index):
        log = self.config['state_dir'] / 'logs' / ('bridge.log' if index == 0 else 'app.log')
        fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'ab') as stream:
            child = subprocess.Popen(self.commands[index], cwd=self.root, env=self.child_env(),
                                     stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, start_new_session=True)
        self.children.append(child)

    def require_free_ports(self):
        sockets = []
        try:
            for key in ('app_port', 'bridge_port', 'host_port'):
                listener = socket.socket()
                sockets.append(listener)
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(('127.0.0.1', self.config[key]))
                # Some SO_REUSEADDR platforms allow a competing bind; listen must
                # also succeed before this port can be considered available.
                listener.listen(1)
        finally:
            for listener in sockets:
                listener.close()

    def alive(self):
        return all(child.poll() is None for child in self.children)

    def wait_ready(self, probe):
        deadline = time.monotonic() + self.config['startup_timeout']
        while not self.stopping and self.alive() and time.monotonic() < deadline:
            if probe():
                return True
            self.stop_event.wait(min(self.config['health_interval'], 0.2))
        return False

    def cleanup(self):
        # Retain PGIDs even after bridge SIGKILL: its Host still belongs to this owned group.
        groups = {child.pid: child for child in self.children}
        def send(sig):
            for group in groups:
                try:
                    os.killpg(group, sig)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    # Darwin can report EPERM for an empty, just-reaped process group.
                    # A live owned leader must always remain signalable.
                    if groups[group].poll() is None:
                        raise ReleaseError('An owned process group could not be stopped')
        send(signal.SIGTERM)
        deadline = time.monotonic() + self.config['stop_timeout']
        while time.monotonic() < deadline:
            for child in self.children:
                child.poll()
            remaining = False
            for group in groups:
                try:
                    os.killpg(group, 0)
                    remaining = True
                except ProcessLookupError:
                    pass
                except PermissionError:
                    if groups[group].poll() is None:
                        raise ReleaseError('An owned process group could not be inspected')
            if not remaining:
                break
            time.sleep(0.05)
        send(signal.SIGKILL)
        for child in self.children:
            child.wait(timeout=5)
        self.children.clear()

    def stop(self, *_):
        self.stopping = True
        self.stop_event.set()

    def run(self):
        c = self.config
        os.umask(0o077)
        private_dir(c['state_dir'])
        descriptor = os.open(c['state_dir'] / 'supervisor.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'r+') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ReleaseError('A supervisor already owns this state directory') from error
            # The lock, not any stale PID file, is the authority. Never signal recorded PIDs.
            for path in (c['app_home'], c['state_dir'] / 'runtime', c['state_dir'] / 'logs', c['bridge_token_file'].parent):
                private_dir(path)
            c['workspace'].mkdir(parents=True, exist_ok=True)
            for sig in (signal.SIGINT, signal.SIGTERM):
                signal.signal(sig, self.stop)
            try:
                for attempt in range(c['max_restarts'] + 1):
                    self.attempt = attempt
                    self.status('starting' if attempt == 0 else 'restarting')
                    self.health = Health(c)
                    try:
                        self.require_free_ports()
                        self.spawn(0)
                        ready = self.wait_ready(self.health.bridge)
                        if ready and not self.stopping:
                            self.spawn(1)
                            ready = self.wait_ready(lambda: self.health.bridge() and self.health.app())
                        if ready and not self.stopping:
                            self.status('ready')
                            while not self.stopping and self.alive():
                                self.stop_event.wait(c['health_interval'])
                                if self.stopping:
                                    break
                                if not self.health.bridge() or not self.health.app():
                                    break
                    except (OSError, subprocess.SubprocessError):
                        pass
                    if self.stopping:
                        break
                    # Publish lost readiness before cleanup; never retain a healthy app shell.
                    self.status('restarting' if attempt < c['max_restarts'] else 'failed', 'child-exit-or-readiness-lost')
                    self.cleanup()
                    if self.stopping:
                        break
                    if attempt < c['max_restarts']:
                        self.stop_event.wait(min(0.25 * (attempt + 1), 1))
                return 0 if self.stopping else 1
            finally:
                self.cleanup()
                self.status('stopped' if self.stopping else 'failed')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, help='External 0600 JSON configuration (see docs/standalone-release)')
    parser.add_argument('--check', action='store_true', help='Verify candidate, configuration, interpreters and installed dependencies without starting services')
    parser.add_argument('--verify', action='store_true', help='Verify extracted candidate hashes only; needs no private config or installed dependencies')
    parser.add_argument('--status', action='store_true', help='Read private supervisor status; never signal recorded PIDs')
    parser.add_argument('--development', action='store_true', help='Explicit source checkout mode without a release manifest')
    args = parser.parse_args(argv)
    try:
        if args.verify or not args.development:
            verify_manifest(ROOT)
        if args.verify:
            print('Candidate hashes verified')
            return 0
        if not args.config:
            raise ReleaseError('--config is required')
        config = load_config(args.config.resolve(), development=args.development)
        if args.status:
            state = config['state_dir']
            with (state / 'supervisor.lock').open() as lock:
                status = json.loads((state / 'status.json').read_text())
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    if status['state'] in ('starting', 'ready', 'restarting'):
                        status['state'] = 'stopped'
                        status['reason'] = 'supervisor-not-running'
                except BlockingIOError:
                    pass
            print(json.dumps(status, sort_keys=True))
            return 0
        check_runtime(config)
        if args.check:
            print('Candidate and explicit configuration checks passed; no provider requests made')
            return 0
        return Supervisor(config).run()
    except (ReleaseError, OSError, ValueError) as error:
        # Only explicitly safe errors go to the console, never raw child/config exceptions.
        print(str(error) if isinstance(error, ReleaseError) else 'Standalone operation failed; inspect private configuration/state', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
