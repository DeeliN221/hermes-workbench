#!/usr/bin/env python3
"""Set/check the single release version, mirrored in the Hermes manifest."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('version', nargs='?')
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
files = [ROOT / 'package.json', ROOT / 'dashboard/manifest.json']
data = [json.loads(p.read_text()) for p in files]
version = args.version or data[0]['version']
if re.fullmatch(r'[0-9]{8}-[1-9][0-9]*', version):
    try:
        datetime.strptime(version.split('-')[0], '%Y%m%d')
    except ValueError:
        parser.error('Expected a valid calendar date in YYYYMMDD-N')
elif not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?', version):
    parser.error('Expected YYYYMMDD-N (positive counter), or a legacy SemVer version')
if args.check:
    if any(item['version'] != version for item in data):
        parser.error('package.json and dashboard/manifest.json versions differ')
else:
    if not args.version:
        parser.error('Provide a version, or --check')
    for path, item in zip(files, data):
        item['version'] = version
        path.write_text(json.dumps(item, indent=2, ensure_ascii=False) + '\n')
print(version)
