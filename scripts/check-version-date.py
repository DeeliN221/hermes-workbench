#!/usr/bin/env python3
"""Verify that the release version date matches the latest source commit date."""
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ZONE = timezone(timedelta(hours=8))


def main() -> int:
    """Reject stale or future date-stamped package versions in CI."""
    version = str(json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"])
    date_text = version.split("-", 1)[0]
    try:
        version_date = datetime.strptime(date_text, "%Y%m%d").date()
    except ValueError:
        print(f"Invalid date in package version: {version}", file=sys.stderr)
        return 1
    stamp = subprocess.check_output(
        ["git", "log", "-1", "--format=%cI"], cwd=ROOT, text=True
    ).strip()
    commit_date = datetime.fromisoformat(stamp).astimezone(ZONE).date()
    if version_date != commit_date:
        print(
            f"package.json version date {version_date:%Y%m%d} does not match "
            f"latest commit date {commit_date:%Y%m%d} (UTC+08:00)",
            file=sys.stderr,
        )
        return 1
    print(f"version date {version_date:%Y%m%d} matches latest commit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
