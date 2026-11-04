#!/usr/bin/env python3
"""Add OpenCode Go to an explicitly chosen, stopped OpenCodex instance.

Only an environment-variable reference is written. Existing providers and the
runtime's default provider are preserved; an existing Go entry is left alone.
"""
from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import tempfile
from pathlib import Path

PROVIDER = {
    'adapter': 'openai-chat',
    'baseUrl': 'https://opencode.ai/zen/go/v1',
    'authMode': 'key',
    'apiKey': '${OPENCODE_GO_API_KEY}',
    'defaultModel': 'kimi-k3',
    'statelessResponses': True,
    'headers': {'User-Agent': 'Hermes-Workbench/1.0'},
}


def merge_provider_config(config_path: Path, dry_run: bool = False) -> str:
    """Atomically add a provider without replacing an existing Go definition."""
    if config_path.is_symlink():
        raise ValueError('Config must not be a symbolic link')
    if config_path.exists():
        if not stat.S_ISREG(config_path.stat().st_mode):
            raise ValueError('Config must be a regular file')
        try:
            config = json.loads(config_path.read_text(encoding='utf-8'))
        except (ValueError, UnicodeError):
            raise ValueError('Config must contain valid JSON') from None
    else:
        config = {}
    if not isinstance(config, dict) or not isinstance(config.get('providers', {}), dict):
        raise ValueError('Config and providers must be JSON objects')
    providers = config.setdefault('providers', {})
    if 'opencode-go' in providers:
        return 'present (unchanged; verify its credentials and endpoint separately)'
    providers['opencode-go'] = PROVIDER
    if dry_run:
        return 'dry-run'
    config_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=config_path.parent, delete=False) as output:
            name = output.name
            json.dump(config, output, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, config_path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)
    return 'added'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--opencodex-home', required=True, help='Explicit OpenCodex config directory; stop that instance before applying')
    parser.add_argument('--dry-run', action='store_true', help='Validate without writing')
    args = parser.parse_args(argv)
    try:
        outcome = merge_provider_config(Path(args.opencodex_home).expanduser() / 'config.json', args.dry_run)
    except (OSError, ValueError):
        # Never echo a config value, decoder excerpt, or credential-bearing path.
        print('Cannot configure OpenCode Go: check config JSON, file type and permissions.', file=sys.stderr)
        return 1
    print(f'OpenCode Go provider: {outcome}')
    print('Supply OPENCODE_GO_API_KEY privately to both OpenCodex and Workbench service environments.')
    print('Select opencode-go/<model-id> in Workbench; keep Codex connected to OpenCodex.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
