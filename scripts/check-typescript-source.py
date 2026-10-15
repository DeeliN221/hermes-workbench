#!/usr/bin/env python3
"""Keep new dashboard application code under strict TypeScript checking."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'dashboard/src'
# The remaining legacy integration/UI is extracted incrementally, never relabelled.
legacy = source / 'recovered-runtime.js'
errors = []
for path in source.rglob('*'):
    if path.suffix in {'.js', '.jsx', '.mjs', '.cjs'} and path != legacy:
        errors.append(f'Use checked TypeScript for application code: {path.relative_to(root)}')
    if path.suffix in {'.ts', '.tsx'} and '@ts-nocheck' in path.read_text():
        errors.append(f'Do not bypass type checking: {path.relative_to(root)}')
if errors:
    raise SystemExit('\n'.join(errors))
print('Application TypeScript boundary verified')
