import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "check-pr-body.py"
SPEC = importlib.util.spec_from_file_location("check_pr_body", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


GOOD = """## Behavior

The web chat uses the Codex interface.

## Scope

This change is limited to Workbench.

## Validation

Local checks passed.
"""


def test_pr_body_contract_accepts_text_only_english_body() -> None:
    assert MODULE.validate(GOOD) == []


def test_pr_body_contract_accepts_optional_visual_section() -> None:
    body = """![Before](https://example.test/before.png)

## Behavior

The layout remains available.

## Scope

Frontend only.

## Validation

Compared the installed route.

## Visuals

Before and after screenshots are attached.
"""
    assert MODULE.validate(body) == []


def test_pr_body_contract_rejects_non_english_text_and_missing_sections() -> None:
    errors = MODULE.validate("## Behavior\n\n中文\n")
    assert "GitHub PR bodies must use English" in errors
    assert "missing required section: ## Scope" in errors
