#!/usr/bin/env python3
"""Validate the repository's GitHub PR body contract."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


REQUIRED_HEADINGS = ("## Behavior", "## Scope", "## Validation")
FORBIDDEN_PATTERNS = ("Test Files", "Tests passed", "执行流水", "测试数量")


def validate(body: str) -> list[str]:
    errors: list[str] = []
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if not lines or not re.match(r"^!\[[^]]*\]\([^)]*\)$", lines[0]):
        errors.append("the first non-empty line must be a Markdown image")
    if re.search(r"[\u4e00-\u9fff]", body):
        errors.append("GitHub PR bodies must use English")
    for heading in REQUIRED_HEADINGS:
        if heading not in body:
            errors.append(f"missing required section: {heading}")
    for phrase in FORBIDDEN_PATTERNS:
        if phrase in body:
            errors.append(f"流水账-style detail is not allowed: {phrase}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("body_file", type=Path)
    args = parser.parse_args()
    errors = validate(args.body_file.read_text(encoding="utf-8"))
    if errors:
        for error in errors:
            print(f"PR body check failed: {error}")
        return 1
    print("PR body check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
