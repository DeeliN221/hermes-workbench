import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "dashboard"))

from session_scope import policy_for_scope, normalize_session_scope


def test_legacy_sessions_remain_personal():
    assert normalize_session_scope(None) == "personal"
    policy = policy_for_scope(None)
    assert policy.cross_session_recall is True
    assert policy.memory_projection is True


def test_repository_sessions_keep_compaction_but_isolate_personal_data():
    policy = policy_for_scope("repository")
    assert policy.context_compaction is True
    assert policy.raw_transcript is True
    assert policy.cross_session_recall is False
    assert policy.memory_projection is False
    assert policy.kanban_projection is False


def test_unknown_scope_fails_closed():
    with pytest.raises(ValueError, match="Unknown session scope"):
        normalize_session_scope("remote")
