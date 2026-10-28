#!/usr/bin/env python3
"""Record source and asset hashes so a stale build cannot be published."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def source_digest(root):
    paths = list((root / 'dashboard/src').rglob('*')) + list((root / 'dashboard/vendor').rglob('*'))
    paths += [root / name for name in ('package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'vite.loader.config.ts', 'dashboard/loader.ts', 'dashboard/manifest.json')]
    digest = hashlib.sha256()
    for path in sorted(paths):
        if path.is_file():
            digest.update(str(path.relative_to(root)).encode() + b'\0')
            digest.update(path.read_bytes())
    return digest.hexdigest()

def asset_hashes(root):
    return {name: hashlib.sha256((root/'dashboard/dist'/name).read_bytes()).hexdigest()
            for name in ['index.js', 'loader.js', 'style.css', 'pele.global.js']
            + [str(p.relative_to(root/'dashboard/dist')) for p in sorted((root/'dashboard/dist/plantuml').rglob('*')) if p.is_file()]}

if __name__ == '__main__':
    record = {'source': str(ROOT), 'source_sha256': source_digest(ROOT), 'assets': asset_hashes(ROOT)}
    path = ROOT/'dashboard/dist/build-provenance.json'
    path.write_text(json.dumps(record, indent=2)+'\n')
    path.chmod(0o664)
