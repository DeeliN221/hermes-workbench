"""Execution and data ownership policy for Workbench sessions.

Repository sessions still need local context compaction to keep a long-running
agent usable. They must not, however, read or mutate the user's cross-session
memory, review queue, or Kanban state on an execution node. Those operations
belong to the controlling Workbench instance.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


PERSONAL_SCOPE = "personal"
REPOSITORY_SCOPE = "repository"
_SCOPES = frozenset({PERSONAL_SCOPE, REPOSITORY_SCOPE})


def normalize_session_scope(value: Any) -> str:
    """Return a stable session scope, defaulting legacy callers to personal."""

    scope = str(value or PERSONAL_SCOPE).strip().lower()
    if scope not in _SCOPES:
        raise ValueError(f"Unknown session scope: {scope}")
    return scope


@dataclass(frozen=True)
class SessionPolicy:
    """Capabilities granted to the process that owns a session."""

    scope: str
    context_compaction: bool
    cross_session_recall: bool
    memory_projection: bool
    kanban_projection: bool
    raw_transcript: bool


def policy_for_scope(value: Any) -> SessionPolicy:
    """Build the node policy without changing the legacy personal default."""

    scope = normalize_session_scope(value)
    if scope == REPOSITORY_SCOPE:
        return SessionPolicy(
            scope=scope,
            context_compaction=True,
            cross_session_recall=False,
            memory_projection=False,
            kanban_projection=False,
            raw_transcript=True,
        )
    return SessionPolicy(
        scope=scope,
        context_compaction=True,
        cross_session_recall=True,
        memory_projection=True,
        kanban_projection=True,
        raw_transcript=True,
    )
