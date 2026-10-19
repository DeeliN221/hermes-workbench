#!/usr/bin/env python3
"""Install the built archive in a disposable host layout, without source imports."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'dashboard'))
from release_runtime import ReleaseStore

version = json.loads((root / 'package.json').read_text())['version']
archive = root / 'release' / f'hermes-workbench-v{version}.tar.gz'
data = archive.read_bytes()
checksum = hashlib.sha256(data).hexdigest()
with tempfile.TemporaryDirectory() as temporary:
    temp = Path(temporary)
    try:
        unpacked = ReleaseStore(temp / 'download').stage(data, version)
        assert (unpacked / 'deploy/compose.example.yaml').is_file()
        assert (unpacked / 'deploy/.env.example').is_file()
        installer = unpacked / 'scripts/install-managed-release.py'
        destination = temp / 'installed'
        plugin = temp / 'plugins/workbench'
        (plugin / 'dashboard').mkdir(parents=True)
        (plugin / 'dashboard/previous.txt').write_text('previous installation')
        command = [sys.executable, '-I', str(installer), '--archive', str(archive),
                   '--version', version, '--root', str(destination),
                   '--plugin-root', str(plugin), '--uid', str(os.getuid()),
                   '--gid', str(os.getgid())]
        bad = subprocess.run(command + ['--sha256', '0' * 64], cwd=temp, capture_output=True, text=True)
        assert bad.returncode != 0 and 'checksum mismatch' in bad.stderr
        assert not destination.exists()
        subprocess.run(command + ['--sha256', checksum], cwd=temp, check=True)
        store = ReleaseStore(destination)
        assert store.active() == version
        store.validate(version)
        assert (plugin / 'dashboard').resolve() == (store.target(version) / 'plugin/dashboard').resolve()
        assert (destination / 'migration-backup/dashboard/previous.txt').read_text() == 'previous installation'
        assert (destination / 'bootstrap/combined_runtime.py').is_file()
        again = subprocess.run(command + ['--sha256', checksum], cwd=temp, capture_output=True, text=True)
        assert again.returncode != 0 and 'Already managed' in again.stderr
        assert store.active() == version
        print('Release smoke test passed: packaged installer, hashes, backup, links, and reinstall refusal.')
    finally:
        # Managed releases are intentionally read-only; permit disposable cleanup.
        for path in temp.rglob('*'):
            if not path.is_symlink():
                path.chmod(0o755 if path.is_dir() else 0o644)
