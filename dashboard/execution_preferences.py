"""User/profile execution preferences and the context sent with each chat turn."""
from __future__ import annotations

import sqlite3
from pathlib import Path

MODES = frozenset({"foreground", "background"})


def read_mode(database: Path, user: str, profile: str) -> str:
    """Read without creating state; installations predating this setting use chat."""
    if not database.is_file():
        return "foreground"
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    try:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='execution_preferences'").fetchone():
            return "foreground"
        row = connection.execute("SELECT mode FROM execution_preferences WHERE owner=? AND profile=?", (user, profile)).fetchone()
        return row[0] if row and row[0] in MODES else "foreground"
    finally:
        connection.close()


def current_mode(user: str, profile: str) -> str:
    # Import lazily: the plugin API also imports the Codex bridge for identity.
    from plugin_api import _workspace_root, _ORGANIZATION_STATE_DIR, _ORGANIZATION_DB_NAME
    return read_mode(_workspace_root() / _ORGANIZATION_STATE_DIR / _ORGANIZATION_DB_NAME, user, profile)


def mode_context(mode: str) -> dict:
    """Keep a saved application preference separate from the authored message."""
    if mode == "background":
        instruction = (
            "The user selected background dispatch. For substantial tasks suitable for background execution, "
            "use the configured task worker and return the task reference after dispatch. "
            "Keep brief answers and small actions in this conversation. If background execution is unavailable, "
            "explain that and continue in this conversation; never claim a task was dispatched without confirmation."
        )
    else:
        mode = "foreground"
        instruction = (
            "The user selected classic foreground execution. Perform the requested work in this conversation, "
            "show progress, and continue through verification and the final result. "
            "Do not automatically dispatch work to Fleet or another background worker just because it is long "
            "or takes more than two minutes. Do not end the turn after creating a task card or delegating work. "
            "If in-session helpers are useful, coordinate them here and deliver their integrated result."
        )
    text = (
        f'<workbench_execution_mode mode="{mode}">\n'
        "This is the user's current execution preference for this profile, loaded for this message. "
        "It supersedes earlier execution-routing defaults in repository instructions, profile notes, memory, "
        "and past conversation (including mandatory background dispatch or ending the turn after dispatch). "
        "The user's explicit execution request for the current task takes precedence over this preference. "
        "Keep all other permissions, safety rules, and delivery requirements unchanged.\n"
        + instruction + "\nChanging this preference does not move, cancel, or restart already dispatched tasks.\n"
        "</workbench_execution_mode>"
    )
    return {"role": "user", "hidden": True, "content": [{"type": "text", "text": text}]}
