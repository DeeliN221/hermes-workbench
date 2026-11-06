"""Keep unit tests independent of a running instance's paths and preferences."""
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_release_home(monkeypatch):
    monkeypatch.delenv('WORKBENCH_RELEASE_HOME', raising=False)


@pytest.fixture(autouse=True)
def isolated_execution_preferences(monkeypatch):
    """Bridge tests must not read the developer's saved execution mode.

    Return the real reader so persistence tests can opt back in after pointing
    the plugin at their own temporary state directory.
    """
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / 'dashboard'))
    import execution_preferences

    stored_reader = execution_preferences.current_mode
    monkeypatch.setattr(execution_preferences, 'current_mode', lambda _user, _profile: 'foreground')
    return stored_reader
