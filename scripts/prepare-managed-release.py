#!/usr/bin/env python3
"""Verify and stage a release as the service user, without activating it."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys


def runtime_identity() -> tuple[int, int]:
    try:
        uid = int(os.environ['HERMES_WORKBENCH_RUNTIME_UID'])
        gid = int(os.environ['HERMES_WORKBENCH_RUNTIME_GID'])
    except (KeyError, ValueError) as error:
        raise ValueError('Configure the instance runtime UID and GID before preparing a release') from error
    if uid <= 0 or gid < 0:
        raise ValueError('The runtime identity must be a non-root user')
    if os.geteuid() == 0:
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
    if (os.geteuid(), os.getegid()) != (uid, gid):
        raise ValueError('Run as the configured instance UID and GID')
    return uid, gid


def check_state_permissions(home: Path, uid: int, gid: int) -> None:
    for name in ('update.json', 'update.lock'):
        path = home / name
        if path.is_symlink():
            raise ValueError('Update state must not be a symlink')
        if not path.exists():
            continue
        metadata = path.stat()
        if (metadata.st_uid, metadata.st_gid) != (uid, gid):
            raise ValueError(f'{name} is not owned by the runtime identity; repair its ownership before preparing')
        if not os.access(path, os.R_OK | os.W_OK):
            raise ValueError(f'{name} must be readable and writable by the runtime identity')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--archive', default='-', help='Published archive path, or - for stdin')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-fA-F0-9]{64}', args.sha256):
        raise ValueError('Invalid archive SHA-256')
    if not re.fullmatch(r'[a-fA-F0-9]{40}', args.source_commit):
        raise ValueError('Invalid source commit')

    # Drop root before importing runtime code or opening any shared state.
    uid, gid = runtime_identity()
    home = Path(os.environ['WORKBENCH_RELEASE_HOME'])
    check_state_permissions(home, uid, gid)
    source_root = Path(__file__).resolve().parents[1] if '__file__' in globals() else home / 'current'
    backend = source_root / 'dashboard'
    if not (backend / 'release_runtime.py').is_file():
        backend = home / 'current/sidecar/dashboard'
    sys.path.insert(0, str(backend))
    from release_runtime import PENDING, ReleaseStore

    store = ReleaseStore(home)
    active = store.active()
    if store.status().get('phase') in PENDING:
        raise ValueError('Another release update is pending')
    limit = 50 * 1024 * 1024
    if args.archive == '-':
        data = sys.stdin.buffer.read(limit + 1)
    else:
        with Path(args.archive).open('rb') as stream:
            data = stream.read(limit + 1)
    if len(data) > limit or hashlib.sha256(data).hexdigest() != args.sha256.lower():
        raise ValueError('Release archive size or checksum mismatch')

    # Check the source before staging, including when a version is already cached.
    import io
    import tarfile
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        candidates = {f'hermes-workbench-{args.version}/release.json', f'hermes-workbench-v{args.version}/release.json'}
        entries = [entry for entry in archive if entry.name in candidates]
        if len(entries) != 1 or not entries[0].isfile() or entries[0].size > 65536:
            raise ValueError('Invalid release metadata')
        metadata = json.load(archive.extractfile(entries[0]))
    if metadata.get('version') != args.version or metadata.get('source_commit') != args.source_commit:
        raise ValueError('Published release version or source commit mismatch')
    target = store.stage(data, args.version)
    if json.loads((target / 'release.json').read_text()) != metadata:
        raise ValueError('Cached release metadata differs from the published archive')
    if store.active() != active:
        raise ValueError('Active release changed during preparation')
    print(json.dumps({'prepared': args.version, 'active': active, 'activated': False,
                      'uid': uid, 'gid': gid, 'sha256': args.sha256.lower(), 'source_commit': args.source_commit}))


if __name__ == '__main__':
    main()
