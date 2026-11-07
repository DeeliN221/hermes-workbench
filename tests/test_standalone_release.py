"""Pure packaging and subprocess lifecycle tests. No credentials or live providers."""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import time

import pytest

ROOT = Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


start = module('standalone_start', 'start-standalone.py')
package = module('standalone_package', 'package-standalone.py')


def command(root, *args):
    return subprocess.check_output(['git', *args], cwd=root).decode().strip()


def commit(root):
    command(root, 'add', '.')
    command(root, '-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', 'commit', '-qm', 'Fixture source')


@pytest.fixture
def source(tmp_path):
    root = tmp_path / 'source'
    root.mkdir()
    command(root, 'init', '-q')
    for name in package.REQUIRED:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    shutil.copytree(ROOT / 'dashboard/runtime', root / 'dashboard/runtime', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
    (root / '.gitignore').write_text('.env\nnode_modules/\ndashboard/standalone-dist/\n')
    commit(root)
    return root


def fake_build(root, head, tree):
    dist = root / 'dashboard/standalone-dist'
    (dist / 'assets').mkdir(parents=True)
    (dist / 'standalone.html').write_text('<script src="/assets/app.js"></script>')
    (dist / 'assets/app.js').write_text('console.log("fixture browser");')
    package.frontend_provenance(root, head, tree)


def fake_licenses(root, stage):
    (stage / 'third-party-licenses').mkdir()
    (stage / 'third-party-licenses/fixture.txt').write_text('Fixture license text')


def candidate(source, output, builder=fake_build):
    return package.create_candidate(source, output, builder=builder, license_collector=fake_licenses)


def extract(archive, destination):
    with tarfile.open(archive) as tar:
        tar.extractall(destination, filter='data')
    return next(destination.iterdir())


def test_clean_reproducible_candidate_exact_head_and_relocation(source, tmp_path, monkeypatch):
    # Arbitrary ancestor overrides are ignored; only exact HEAD may be recorded.
    monkeypatch.setenv('RELEASE_SOURCE_COMMIT', '0' * 40)
    (source / '.env').write_text('fixture-ignored-value')
    (source / 'node_modules').mkdir()
    (source / 'node_modules/ignored.log').write_text('fixture-excluded')
    archive = candidate(source, tmp_path / 'out1')
    second = candidate(source, tmp_path / 'out2')
    assert archive.read_bytes() == second.read_bytes()
    relocated = extract(archive, tmp_path / 'relocated')
    manifest = start.verify_manifest(relocated)
    assert manifest['source_commit'] == command(source, 'rev-parse', 'HEAD')
    assert manifest['source_tree'] == command(source, 'rev-parse', 'HEAD^{tree}')
    assert manifest['dsh_version'] == '0.2.2-rc.1'
    assert manifest['files'] == package.hashes(relocated, ('standalone-manifest.json',))
    assert 'dashboard/standalone-dist/index.html' in manifest['files']
    assert not any('.env' in name or 'node_modules' in name or '__pycache__' in name for name in manifest['files'])
    result = subprocess.run([sys.executable, str(relocated / 'scripts/start-standalone.py'), '--verify'], capture_output=True)
    assert result.returncode == 0, result.stderr
    assert hashlib.sha256(archive.read_bytes()).hexdigest() in (archive.parent / 'SHA256SUMS').read_text()


@pytest.mark.parametrize('change', ['tracked', 'untracked', 'missing', 'symlink'])
def test_reject_dirty_missing_and_symlink_source(source, tmp_path, change):
    target = source / 'dashboard/standalone_services.py'
    if change == 'tracked':
        target.write_text('# changed\n')
    elif change == 'untracked':
        (source / 'untracked.py').write_text('# extra\n')
    elif change == 'missing':
        target.unlink()
        commit(source)
    else:
        (source / 'escaping-link').symlink_to(tmp_path / 'outside-secret')
        commit(source)
    with pytest.raises(package.PackageError):
        candidate(source, tmp_path / 'out')


@pytest.mark.parametrize('fault', ['missing-provenance', 'stale-commit', 'changed-dist', 'missing-entry', 'symlink'])
def test_reject_stale_or_missing_frontend(source, tmp_path, fault):
    def builder(root, head, tree):
        fake_build(root, head, tree)
        dist = root / 'dashboard/standalone-dist'
        if fault == 'missing-provenance':
            (dist / 'build-provenance.json').unlink()
        elif fault == 'stale-commit':
            package.frontend_provenance(root, '0' * 40, tree)
        elif fault == 'changed-dist':
            (dist / 'assets/app.js').write_text('changed')
        elif fault == 'missing-entry':
            (dist / 'standalone.html').unlink()
            package.frontend_provenance(root, head, tree)
        else:
            (dist / 'leak').symlink_to(tmp_path / 'outside')
    with pytest.raises(package.PackageError):
        candidate(source, tmp_path / 'out', builder)


def test_build_cannot_replace_committed_backend(source, tmp_path):
    def builder(root, head, tree):
        fake_build(root, head, tree)
        (root / 'dashboard/standalone_app.py').write_text('# replaced by build')
    with pytest.raises(package.PackageError, match='modified committed'):
        candidate(source, tmp_path / 'out', builder)


@pytest.mark.parametrize('fault', ['changed', 'extra', 'missing', 'symlink'])
def test_loader_refuses_tampering_before_source_execution(source, tmp_path, fault):
    relocated = extract(candidate(source, tmp_path / 'out'), tmp_path / 'relocated')
    marker = tmp_path / 'executed'
    app = relocated / 'dashboard/standalone_app.py'
    if fault == 'changed':
        app.write_text(f'from pathlib import Path\nPath({str(marker)!r}).touch()\n')
    elif fault == 'extra':
        (relocated / 'unlisted.py').write_text('bad')
    elif fault == 'missing':
        app.unlink()
    else:
        app.unlink()
        app.symlink_to(tmp_path / 'external')
    result = subprocess.run([sys.executable, str(relocated / 'scripts/start-standalone.py'), '--check'], capture_output=True)
    assert result.returncode == 1
    assert not marker.exists()
    assert b'Candidate' in result.stderr


def test_license_scan_is_bounded_and_requires_text(tmp_path):
    (tmp_path / 'package.json').write_text(json.dumps({'dependencies': {'fixture-package': '1'}}))
    for name in ('fixture-package', 'react', 'react-dom'):
        root = tmp_path / 'node_modules/.pnpm' / name / 'node_modules' / name
        root.mkdir(parents=True)
        (root / 'package.json').write_text(json.dumps({'name': name, 'version': '1.0.0', 'license': 'MIT'}))
        (root / 'LICENSE').write_text('Fixture license')
        (root / 'private-not-a-license').write_text('Must not be copied')
    stage = tmp_path / 'stage'
    stage.mkdir()
    package.collect_licenses(tmp_path, stage)
    assert len(list(stage.rglob('LICENSE'))) == 3
    assert not list(stage.rglob('private-not-a-license'))
    next((tmp_path / 'node_modules/.pnpm').rglob('LICENSE')).unlink()
    with pytest.raises(package.PackageError, match='license text'):
        package.collect_licenses(tmp_path, stage)


@pytest.mark.skipif(
    not (ROOT / 'dashboard/runtime/node_modules/@deepseek-ai/dsh/package.json').is_file(),
    reason='Actual runtime install is verified by the dedicated Node 24 standalone job',
)
def test_actual_installed_module_checks_are_offline(tmp_path):
    path, _ = config_file(tmp_path)
    config = start.load_config(path, development=True)
    config['node'] = shutil.which('node')
    # CI checks the same minimal Python closure used by the extracted candidate,
    # independently of uv's temporary pytest/development environment.
    config['python'] = os.environ.get('STANDALONE_TEST_PYTHON', sys.executable)
    home = config['dsh_home']
    home.mkdir(mode=0o700)
    for name in ('settings.yaml', '.env'):
        private = home / name
        private.write_text('Fixture content intentionally not valid provider configuration')
        private.chmod(0o600)
    # Uses the real pinned Node modules and Python dependency closure. Neither
    # bridge nor app starts, and the invalid provider files must never be parsed.
    start.check_runtime(config)
    assert not config['state_dir'].exists()


def test_interpreter_path_preserves_virtual_environment(tmp_path):
    binary = tmp_path / 'python'
    binary.symlink_to(sys.executable)
    assert start.executable(str(binary)) == str(binary)


def test_private_token_symlink_is_rejected(tmp_path):
    target = tmp_path / 'actual-token'
    target.write_text('fixture')
    target.chmod(0o600)
    link = tmp_path / 'token-link'
    link.symlink_to(target)
    with pytest.raises(start.ReleaseError):
        start.private_file(start.absolute(str(link)))


def ports():
    # Fixtures need adjacent app/bridge ports; sockets are released just before spawning.
    for _ in range(100):
        sockets = []
        try:
            first = socket.socket()
            sockets.append(first)
            # Stay below OS ephemeral client ranges to avoid health-client port races.
            first.bind(('127.0.0.1', 20000 + secrets.randbelow(9000)))
            port = first.getsockname()[1]
            for number in (port + 1, port + 2):
                sock = socket.socket()
                sockets.append(sock)
                sock.bind(('127.0.0.1', number))
            return port
        except OSError:
            pass
        finally:
            for sock in sockets:
                sock.close()
    raise RuntimeError('No fixture ports')


def config_file(tmp_path, **changes):
    port = ports()
    config = {
        'node': sys.executable, 'python': sys.executable,
        'state_dir': str(tmp_path / 'state'), 'app_home': str(tmp_path / 'app'),
        'workspace': str(tmp_path / 'workspace'), 'dsh_home': str(tmp_path / 'dsh-home'),
        'bridge_token_file': str(tmp_path / 'secrets/bridge.token'),
        'provider': 'fixture-provider', 'model': 'fixture-model',
        'app_port': port, 'bridge_port': port + 1, 'host_port': port + 2,
        'max_restarts': 0, 'startup_timeout': 1.5, 'stop_timeout': 0.15, 'health_interval': 0.05,
        'environment': {'WORKBENCH_AUTH_MODE': 'local'},
        **changes,
    }
    path = tmp_path / 'config.json'
    path.write_text(json.dumps(config))
    path.chmod(0o600)
    return path, config


def wait_for(predicate, timeout=6):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            result = predicate()
            if result:
                return result
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(0.03)
    raise AssertionError('Fixture condition timed out')


def read_status(config):
    return json.loads((Path(config['state_dir']) / 'status.json').read_text())


def process_running(pid):
    # A reparented zombie has already stopped executing and cannot retain listeners.
    result = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True)
    return bool(result.stdout.strip()) and not result.stdout.strip().startswith('Z')


def assert_children_gone(config):
    for part in ('bridge', 'app', 'host'):
        path = Path(config['state_dir']) / (part + '-pids')
        if path.exists():
            for pid in map(int, path.read_text().splitlines()):
                wait_for(lambda: not process_running(pid))


@contextlib.contextmanager
def running(path):
    env = {**os.environ, 'RELEASE_AMBIENT_SECRET': 'fixture-ambient-do-not-forward'}
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('test_standalone_release_fixture.py')),
                                'supervisor', str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    try:
        yield process
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=6)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)
            raise


def test_graceful_stop_auth_private_logs_lock_and_stale_pid(tmp_path):
    path, config = config_file(tmp_path)
    state = Path(config['state_dir'])
    state.mkdir(mode=0o700)
    unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], start_new_session=True)
    try:
        (state / 'status.json').write_text(json.dumps({'pid': unrelated.pid, 'state': 'ready'}))
        with running(path) as process:
            wait_for(lambda: read_status(config).get('owner') and read_status(config)['state'] == 'ready')
            with running(path) as duplicate:
                assert duplicate.wait(timeout=3) == 1
                assert b'already owns' in duplicate.stderr.read()
            assert unrelated.poll() is None
            assert (state.stat().st_mode & 0o777) == 0o700
            for file in ('status.json', 'logs/app.log', 'logs/bridge.log'):
                assert (state / file).stat().st_mode & 0o777 == 0o600
            process.terminate()
            assert process.wait(timeout=4) == 0
            stdout, stderr = process.communicate()
            assert b'fixture-console-sensitive-marker' not in stdout + stderr
            assert b'fixture-bridge-value' not in stdout + stderr
        assert read_status(config)['state'] == 'stopped'
        assert_children_gone(config)
        observations = [json.loads(line) for line in (state / 'environment-observations').read_text().splitlines()]
        assert observations and all(row['ambient_secret_absent'] for row in observations)
        assert all(row['bridge_file'] == row['app_file'] == config['bridge_token_file'] for row in observations)
    finally:
        unrelated.terminate()
        unrelated.wait(timeout=2)


@pytest.mark.parametrize('part', ['bridge', 'app'])
def test_child_sigkill_cleans_host_and_exhausts_bounded_restart(tmp_path, part):
    path, config = config_file(tmp_path, max_restarts=1)
    with running(path) as process:
        wait_for(lambda: read_status(config)['state'] == 'ready')
        state = Path(config['state_dir'])
        original_token = Path(config['bridge_token_file']).read_bytes()
        first_pid = int((state / (part + '-pids')).read_text().splitlines()[-1])
        os.kill(first_pid, signal.SIGKILL)
        wait_for(lambda: read_status(config)['state'] == 'ready' and read_status(config)['attempt'] == 1)
        assert Path(config['bridge_token_file']).read_bytes() == original_token
        second_pid = int((state / (part + '-pids')).read_text().splitlines()[-1])
        assert second_pid != first_pid
        os.kill(second_pid, signal.SIGKILL)
        assert process.wait(timeout=5) == 1
    assert read_status(config)['state'] == 'failed'
    assert len((state / 'bridge-pids').read_text().splitlines()) == 2
    assert_children_gone(config)


@pytest.mark.parametrize('part,mode', [('bridge', 'bad-status'), ('bridge', 'bad-runtime'),
                                     ('bridge', 'html'), ('bridge', 'redirect'),
                                     ('app', 'bad-status'), ('app', 'bad-runtime'), ('app', 'unavailable')])
def test_lost_readiness_stops_stack_despite_http_success(tmp_path, part, mode):
    path, config = config_file(tmp_path)
    with running(path) as process:
        wait_for(lambda: read_status(config)['state'] == 'ready')
        (Path(config['state_dir']) / (part + '-mode')).write_text(mode)
        assert process.wait(timeout=5) == 1
    assert read_status(config)['state'] == 'failed'
    assert_children_gone(config)


def test_startup_never_launches_app_when_bridge_not_ready(tmp_path):
    path, config = config_file(tmp_path, max_restarts=1, startup_timeout=0.3)
    state = Path(config['state_dir'])
    state.mkdir(mode=0o700)
    (state / 'bridge-mode').write_text('bad-status')
    with running(path) as process:
        assert process.wait(timeout=5) == 1
    assert not (state / 'app-pids').exists()
    assert read_status(config)['attempt'] == 1
    assert_children_gone(config)


def test_stop_during_startup_is_bounded(tmp_path):
    path, config = config_file(tmp_path, startup_timeout=30)
    state = Path(config['state_dir'])
    state.mkdir(mode=0o700)
    (state / 'bridge-mode').write_text('bad-status')
    with running(path) as process:
        wait_for(lambda: (state / 'host-pids').exists())
        process.terminate()
        assert process.wait(timeout=3) == 0
    assert read_status(config)['state'] == 'stopped'
    assert_children_gone(config)


def test_port_conflict_never_adopts_or_kills_existing_listener(tmp_path):
    path, config = config_file(tmp_path)
    with socket.socket() as unrelated:
        unrelated.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        unrelated.bind(('127.0.0.1', config['bridge_port']))
        unrelated.listen()
        with running(path) as process:
            assert process.wait(timeout=3) == 1
        assert unrelated.getsockname()[1] == config['bridge_port']
        with socket.create_connection(unrelated.getsockname(), timeout=1) as client:
            accepted, _ = unrelated.accept()
            with accepted:
                accepted.sendall(b'fixture-listener-still-owned')
                assert client.recv(64) == b'fixture-listener-still-owned'
        assert not (Path(config['state_dir']) / 'bridge-pids').exists()
    assert read_status(config)['state'] == 'failed'


def test_proxy_health_uses_explicit_host_user_and_file_secret(tmp_path):
    secret = tmp_path / 'proxy.token'
    secret.write_text('fixture-proxy-value')
    secret.chmod(0o600)
    path, config = config_file(tmp_path, environment={
        'WORKBENCH_AUTH_MODE': 'trusted-proxy', 'WORKBENCH_PUBLIC_ORIGIN': 'https://workbench.example.test:8443',
        'WORKBENCH_ALLOWED_HOSTS': 'workbench.example.test:8443', 'WORKBENCH_ALLOWED_USERS': 'operator',
        'WORKBENCH_TRUSTED_PROXY_SECRET_FILE': str(secret),
    })
    with running(path) as process:
        wait_for(lambda: read_status(config)['state'] == 'ready')
        process.terminate()
        assert process.wait(timeout=4) == 0
        stdout, stderr = process.communicate()
        assert secret.read_bytes() not in stdout + stderr
    assert_children_gone(config)


@pytest.mark.parametrize('fault', ['proxy-incomplete', 'proxy-host', 'external-host', 'ports', 'inside', 'file-mode', 'fleet-incomplete'])
def test_reject_unsafe_configuration(tmp_path, fault):
    path, config = config_file(tmp_path)
    if fault == 'proxy-incomplete':
        config['environment']['WORKBENCH_AUTH_MODE'] = 'trusted-proxy'
    elif fault == 'proxy-host':
        secret = tmp_path / 'proxy.token'
        secret.write_text('fixture')
        secret.chmod(0o600)
        config['environment'] = {'WORKBENCH_AUTH_MODE': 'trusted-proxy',
                                 'WORKBENCH_TRUSTED_PROXY_SECRET_FILE': str(secret),
                                 'WORKBENCH_ALLOWED_USERS': 'operator', 'WORKBENCH_ALLOWED_HOSTS': 'other.example.test',
                                 'WORKBENCH_PUBLIC_ORIGIN': 'https://workbench.example.test'}
    elif fault == 'external-host':
        config['environment']['DSH_HOST_URL'] = 'http://127.0.0.1:9000'
    elif fault == 'ports':
        config['bridge_port'] = config['app_port']
    elif fault == 'inside':
        config['workspace'] = str(ROOT / 'workspace')
    elif fault == 'file-mode':
        path.chmod(0o644)
    else:
        config['environment']['WORKBENCH_FLEET_URL'] = 'https://fleet.example.test/api/v1'
    path.write_text(json.dumps(config))
    with pytest.raises(start.ReleaseError):
        start.load_config(path, development=True)


@pytest.mark.parametrize('url', [
    'http://127.0.0.1:8080/api/v1', 'http://127.0.0.2/api/v1',
    'http://localhost:8080/api/v1', 'http://LOCALHOST/api/v1',
    'http://[::1]:8080/api/v1', 'http://[::1]/api/v1',
    'https://fleet.example.test/api/v1', 'https://fleet.example.test:8443/api/v1',
])
def test_explicit_fleet_url_acceptance_is_offline(tmp_path, url):
    token = tmp_path / 'fleet.token'
    token.write_text('fixture-only')
    token.chmod(0o600)
    path, _ = config_file(tmp_path, environment={
        'WORKBENCH_FLEET_URL': url, 'WORKBENCH_FLEET_TOKEN_FILE': str(token),
    })
    assert start.load_config(path, development=True)['environment']['WORKBENCH_FLEET_URL'] == url


@pytest.mark.parametrize('url', [
    'http://fleet.example.test/api/v1', 'http://localhost.example.test/api/v1',
    'http://0.0.0.0:8080/api/v1', 'http://8.8.8.8:8080/api/v1',
    'http://127.1:8080/api/v1', 'http://2130706433:8080/api/v1',
    'http://operator:fixture@localhost:8080/api/v1', 'http://@localhost:8080/api/v1',
    'https://operator:fixture@fleet.example.test/api/v1',
    'http://localhost:8080/api/v1?key=fixture', 'https://fleet.example.test/api/v1#fragment',
    'http://localhost/api/v1?', 'http://localhost/api/v1#',
    'http://localhost:invalid/api/v1', 'https://fleet.example.test:invalid/api/v1',
    'http://localhost:65536/api/v1', 'http://localhost:0/api/v1',
    'http://localhost:-1/api/v1', 'https://fleet.example.test:/api/v1',
    'http://[::1]extra:8080/api/v1', 'http://[::1/api/v1',
    'http://local\nhost:8080/api/v1', 'https:///api/v1', 'ftp://localhost/api/v1',
])
def test_reject_unsafe_or_malformed_fleet_url_offline(tmp_path, url):
    token = tmp_path / 'fleet.token'
    token.write_text('fixture-only')
    token.chmod(0o600)
    path, _ = config_file(tmp_path, environment={
        'WORKBENCH_FLEET_URL': url, 'WORKBENCH_FLEET_TOKEN_FILE': str(token),
    })
    with pytest.raises(start.ReleaseError):
        start.load_config(path, development=True)


def test_development_can_default_to_checkout_runtime_install(tmp_path):
    path, _ = config_file(tmp_path)
    assert start.load_config(path, development=True)['module_root'] == ROOT / 'dashboard/runtime'


def test_release_requires_explicit_external_frozen_install_path(tmp_path):
    path, config = config_file(tmp_path)
    with pytest.raises(start.ReleaseError, match='explicit external module_root'):
        start.load_config(path)
    config['module_root'] = str(tmp_path / 'runtime-install')
    path.write_text(json.dumps(config))
    assert start.load_config(path)['module_root'] == tmp_path / 'runtime-install'
    # A path alias must not permit installation into the verified candidate either.
    alias = tmp_path / 'runtime-link'
    alias.symlink_to(ROOT / 'dashboard/runtime', target_is_directory=True)
    for internal in (ROOT / 'dashboard/runtime', alias):
        config['module_root'] = str(internal)
        path.write_text(json.dumps(config))
        with pytest.raises(start.ReleaseError, match='outside the immutable candidate'):
            start.load_config(path)


@pytest.mark.parametrize('leader_exits', [True, False])
def test_darwin_group_permission_race_reaps_only_owned_child(tmp_path, monkeypatch, leader_exits):
    _, raw = config_file(tmp_path)
    supervisor = start.Supervisor(raw)
    class Child:
        pid = 987654
        returncode = None
        def poll(self):
            return self.returncode
        def wait(self, timeout):
            assert 0 < timeout <= 5
            if not leader_exits:
                raise subprocess.TimeoutExpired('owned-child', timeout)
            self.returncode = -signal.SIGKILL
            return self.returncode
    child = Child()
    supervisor.children = [child]
    def denied(group, sig):
        assert group == child.pid
        raise PermissionError('Darwin empty process group race')
    monkeypatch.setattr(start.os, 'killpg', denied)
    if leader_exits:
        supervisor.cleanup()
        assert supervisor.children == []
    else:
        with pytest.raises(start.ReleaseError, match='could not be stopped'):
            supervisor.cleanup()
        assert supervisor.children == [child]
