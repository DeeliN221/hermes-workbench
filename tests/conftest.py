"""Never inherit a running managed instance's install target in unit tests."""
import pytest


@pytest.fixture(autouse=True)
def isolated_release_home(monkeypatch):
    monkeypatch.delenv('WORKBENCH_RELEASE_HOME', raising=False)
