import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "check-pr-body.py"
SPEC = importlib.util.spec_from_file_location("check_pr_body", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


GOOD = """![Change](https://example.test/change.svg)

## Behavior

The web chat uses the Codex interface.

## Scope

This change is limited to Workbench.

## Validation

Local checks passed.
"""


def test_pr_body_contract_accepts_image_first_english_body() -> None:
    assert MODULE.validate(GOOD) == []


def test_pr_body_contract_rejects_missing_image_and_non_english_text() -> None:
    errors = MODULE.validate("## Behavior\n\n中文\n")
    assert "the first non-empty line must be a Markdown image" in errors
    assert "GitHub PR bodies must use English" in errors
    assert "missing required section: ## Scope" in errors
