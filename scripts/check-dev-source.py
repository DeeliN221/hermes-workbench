#!/usr/bin/env python3
"""Reject builds outside the authoritative checkout when a developer policy exists."""
from pathlib import Path
from development_policy import load_policy

policy = load_policy()
if policy:
    canonical = Path(policy['source']).resolve()
    if Path(__file__).resolve().parent.parent != canonical:
        raise SystemExit('Build rejected: authoritative source is '+str(canonical))
