#!/usr/bin/env python3
"""Reject builds outside the authoritative checkout when a developer policy exists."""
from pathlib import Path
from development_policy import load_policy, allowed_build_source

policy = load_policy()
if policy:
    canonical = Path(policy['source']).resolve()
    if not allowed_build_source(Path(__file__).resolve().parent.parent, policy):
        raise SystemExit('Build rejected: use a linked feature worktree of '+str(canonical)
                         if policy.get('mode') == 'manual-release'
                         else 'Build rejected: authoritative source is '+str(canonical))
