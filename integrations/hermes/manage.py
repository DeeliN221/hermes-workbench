#!/usr/bin/env python3
"""Check, apply, or verify the pinned Hermes compatibility patch."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent


def git(target, *args):
    return subprocess.check_output(
        ["git", "-C", str(target), *args], stderr=subprocess.PIPE
    ).decode().strip()


def verify(target, manifest):
    bad = []
    for entry in manifest["files"]:
        path = target / entry["path"]
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            bad.append(entry["path"])
    if bad:
        raise ValueError("Files differ from the manifest: " + ", ".join(bad))
    print(f"Verified {len(manifest['files'])} patched files.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="Hermes checkout root")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    target = args.target.resolve()
    manifest = json.loads((HERE / "manifest.json").read_text())
    patch = HERE / manifest["patch"]
    if hashlib.sha256(patch.read_bytes()).hexdigest() != manifest["patch_sha256"]:
        raise ValueError("Patch checksum mismatch")
    if Path(git(target, "rev-parse", "--show-toplevel")).resolve() != target:
        raise ValueError("Target must be the checkout root")
    if args.verify:
        verify(target, manifest)
        return
    if git(target, "rev-parse", "HEAD") != manifest["base_commit"]:
        raise ValueError("Checkout is not at the supported upstream base")
    if git(target, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Target has local changes; preserve them before applying")
    git(target, "apply", "--check", str(patch))
    if args.apply:
        git(target, "apply", str(patch))
        verify(target, manifest)
        print("Applied. Review and commit before building or deploying.")
    else:
        print("Patch checksum, upstream base, clean state, and applicability verified.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        # Do not print subprocess stderr: target Git configuration may contain credentials.
        print(f"Compatibility check failed: {exc}", file=sys.stderr)
        sys.exit(1)
