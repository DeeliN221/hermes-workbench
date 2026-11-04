#!/usr/bin/env python3
"""Fail closed before screenshots: HEAD, source, disk and HTTP bytes must agree."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('provenance', ROOT/'scripts/build-provenance.py')
provenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provenance)

def verify(origin='http://127.0.0.1:9120'):
    def read(path):
        with urlopen(origin + path, timeout=5) as response:
            return response.read()
    record = json.loads((ROOT/'dashboard/dist/build-provenance.json').read_text())
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert record['git_commit'] == head, 'Stale build: commit differs from HEAD; rebuild and restart'
    assert record['source_sha256'] == provenance.source_digest(ROOT), 'Stale build: source changed'
    assert record['assets'] == provenance.asset_hashes(ROOT), 'Build assets changed after build'
    runtime = json.loads(read('/__acceptance/version'))
    assert runtime['git_commit'] == head, 'Stale process: restart required'
    assert runtime['assets'] == record['assets'], 'Stale process assets: restart required'
    assert runtime['source_sha256'] == record['source_sha256'], 'Stale process source'
    paths = {'index.js': '/dashboard-plugins/@default/workbench/dist/index.js',
             'style.css': '/dashboard-plugins/@default/workbench/dist/style.css'}
    for name, path in paths.items():
        assert hashlib.sha256(read(path)).hexdigest() == record['assets'][name], f'Stale HTTP bundle: {path}'
    assert json.loads(read('/__acceptance/health'))['status'] == 'ok'
    assert json.loads(read('/api/plugins/workbench/capabilities'))['codexChat']
    print(json.dumps({'verified': True, 'origin': origin, **runtime}, indent=2))
    return runtime

if __name__ == '__main__':
    verify()
