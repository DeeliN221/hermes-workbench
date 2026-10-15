#!/usr/bin/env python3
"""Check, build and publish from the developer's authoritative source directory."""
from development_policy import load_policy
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parent.parent
policy = load_policy(required=True)
if root != Path(policy['source']).resolve():
    raise SystemExit('Deploy rejected: use the authoritative source at '+policy['source'])
for command in [['npm','run','typecheck'], ['npm','test'], ['npm','run','build'],
                [sys.executable,'scripts/publish-dev.py','dashboard','--target',policy['target']]]:
    subprocess.run(command, cwd=root, check=True)
