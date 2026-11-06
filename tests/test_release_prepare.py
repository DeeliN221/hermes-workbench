"""Preparation must use the service identity and leave activation state alone."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

from test_release_runtime import archive, release, ReleaseStore, write_json

PROJECT = Path(__file__).parents[1]
SCRIPT = (PROJECT / 'scripts/prepare-managed-release.py').read_text()
SOURCE = 'a' * 40


@pytest.fixture
def prepared_case():
    # A direct /tmp child also permits a real root -> service-user transition.
    with tempfile.TemporaryDirectory(prefix='release-identity-') as directory:
        base = Path(directory)
        store = ReleaseStore(base / 'runtime')
        current = release(store, '0.9.0')
        runtime_code = (PROJECT / 'dashboard/release_runtime.py').read_bytes()
        (current / 'sidecar/dashboard/release_runtime.py').write_bytes(runtime_code)
        inventory_path = current / 'release-files.json'
        inventory = json.loads(inventory_path.read_text())
        inventory['sidecar/dashboard/release_runtime.py'] = hashlib.sha256(runtime_code).hexdigest()
        inventory_path.write_text(json.dumps(inventory))
        store.activate('0.9.0')
        write_json(store.job, {'phase': 'idle'})
        (store.root / 'update.lock').touch(mode=0o600)
        source = release(ReleaseStore(base / 'published'), '1.0.0')
        metadata_path = source / 'release.json'
        metadata = json.loads(metadata_path.read_text())
        metadata['source_commit'] = SOURCE
        metadata_path.write_text(json.dumps(metadata))
        data = archive(source)
        uid = os.geteuid() or 65534
        gid = os.getegid() if os.geteuid() else 65534
        if os.geteuid() == 0:
            for path in [base, *base.rglob('*')]:
                os.chown(path, uid, gid, follow_symlinks=False)
        env = {**os.environ, 'HERMES_WORKBENCH_RUNTIME_UID': str(uid),
               'HERMES_WORKBENCH_RUNTIME_GID': str(gid), 'WORKBENCH_RELEASE_HOME': str(store.root)}
        yield store, data, env, uid, gid


def invoke(case, *, checksum=None, source=SOURCE, env=None):
    _, data, configured, _, _ = case
    return subprocess.run([sys.executable, '-c', SCRIPT, '--version', '1.0.0',
                           '--sha256', checksum or hashlib.sha256(data).hexdigest(),
                           '--source-commit', source], input=data, capture_output=True,
                          env=env or configured, timeout=15)


def test_preparation_uses_runtime_identity_without_queuing(prepared_case):
    store, _, _, uid, gid = prepared_case
    before = store.job.read_bytes()
    result = invoke(prepared_case)
    assert result.returncode == 0, result.stderr.decode()
    output = json.loads(result.stdout)
    assert output['uid'] == uid and output['gid'] == gid
    assert output['activated'] is False and output['active'] == '0.9.0'
    assert store.active() == '0.9.0' and store.job.read_bytes() == before
    assert store.job.stat().st_uid == uid and store.job.stat().st_gid == gid
    assert store.target('1.0.0').stat().st_uid == uid
    assert store.target('1.0.0').stat().st_mode & 0o777 == 0o555
    assert not (store.root / '.current-next').exists()
    # Reusing a previously verified archive is read-only with respect to state.
    assert invoke(prepared_case).returncode == 0
    assert store.job.read_bytes() == before


@pytest.mark.parametrize('kwargs', [{'checksum': '0' * 64}, {'source': 'b' * 40}])
def test_bad_published_identity_does_not_stage_or_queue(prepared_case, kwargs):
    store, _, _, _, _ = prepared_case
    before = store.job.read_bytes()
    assert invoke(prepared_case, **kwargs).returncode != 0
    assert not store.target('1.0.0').exists()
    assert store.job.read_bytes() == before and store.active() == '0.9.0'


def test_inaccessible_state_is_reported_before_staging(prepared_case):
    store, _, _, _, _ = prepared_case
    store.job.chmod(0)
    try:
        result = invoke(prepared_case)
        assert result.returncode != 0
        assert b'readable and writable' in result.stderr
        assert not store.target('1.0.0').exists()
    finally:
        store.job.chmod(0o600)


def test_wrong_runtime_identity_cannot_write_shared_state(prepared_case):
    store, _, env, uid, _ = prepared_case
    before = store.job.read_bytes()
    wrong = {**env, 'HERMES_WORKBENCH_RUNTIME_UID': str(0 if os.geteuid() == 0 else uid + 1)}
    assert invoke(prepared_case, env=wrong).returncode != 0
    assert store.job.read_bytes() == before and not store.target('1.0.0').exists()


def test_pending_update_is_not_overridden(prepared_case):
    store, _, _, uid, gid = prepared_case
    write_json(store.job, {'phase': 'preparing', 'version': '1.0.0', 'previous': '0.9.0'})
    if os.geteuid() == 0:
        os.chown(store.job, uid, gid)
    before = store.job.read_bytes()
    result = invoke(prepared_case)
    assert result.returncode != 0 and b'Another release update is pending' in result.stderr
    assert store.job.read_bytes() == before and not store.target('1.0.0').exists()


def test_cached_metadata_cannot_replace_published_metadata(prepared_case):
    store, _, _, _, _ = prepared_case
    assert invoke(prepared_case).returncode == 0
    metadata_path = store.target('1.0.0') / 'release.json'
    metadata_path.chmod(0o644)
    metadata = json.loads(metadata_path.read_text())
    metadata['source_commit'] = 'b' * 40
    metadata_path.write_text(json.dumps(metadata))
    result = invoke(prepared_case)
    assert result.returncode != 0 and b'Cached release metadata differs' in result.stderr
    assert store.active() == '0.9.0' and store.status()['phase'] == 'idle'
