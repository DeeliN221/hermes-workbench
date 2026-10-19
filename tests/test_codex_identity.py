"""Verify explicit Workbench storage-user mapping preserves authenticated access."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
from codex_bridge import _user


def _request(remote_user: str | None) -> Request:
    """Build the smallest request scope needed by the trusted-user helper."""

    headers = [] if remote_user is None else [(b"remote-user", remote_user.encode())]
    return Request({"type": "http", "headers": headers})


def test_storage_user_mapping_is_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use the authenticated identity by default and an explicit owner when configured."""

    monkeypatch.delenv("HERMES_WORKBENCH_DATA_USER", raising=False)
    assert _user(_request("Operator")) == "operator"

    monkeypatch.setenv("HERMES_WORKBENCH_DATA_USER", "zzl")
    assert _user(_request("Operator")) == "zzl"


def test_storage_user_mapping_still_validates_proxy_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never let a storage mapping bypass the required trusted proxy header."""

    monkeypatch.setenv("HERMES_WORKBENCH_DATA_USER", "zzl")
    with pytest.raises(HTTPException) as error:
        _user(_request(None))
    assert error.value.status_code == 401


def test_storage_user_mapping_rejects_invalid_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reject unsafe storage identities before they reach SQLite queries."""

    monkeypatch.setenv("HERMES_WORKBENCH_DATA_USER", "../zzl")
    with pytest.raises(HTTPException) as error:
        _user(_request("Operator"))
    assert error.value.status_code == 400
