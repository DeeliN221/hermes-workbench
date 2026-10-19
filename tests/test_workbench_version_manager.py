"""Verify version switching ignores terminal Codex thread states."""

import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / 'dashboard'))
SPEC = importlib.util.spec_from_file_location(
    'workbench_version_manager', ROOT / 'dashboard/workbench_version_manager.py'
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_terminal_thread_states_do_not_block_updates():
    """Completed, unloaded, and system-error threads have no active turn."""

    for status in ('idle', 'notLoaded', 'systemError'):
        assert MODULE._thread_blocks_update({'status': {'type': status}}) is False


def test_active_and_unknown_thread_states_remain_safe():
    """An active or unrecognized state must prevent a restart."""

    for thread in (
        {'status': {'type': 'active'}},
        {'status': {'type': 'futureState'}},
        {'status': None},
        {},
    ):
        assert MODULE._thread_blocks_update(thread) is True
