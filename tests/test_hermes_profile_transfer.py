import os
import sqlite3
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
from hermes_profile_transfer import recover_migrated_projections, transfer_projection


def _db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE sessions (id TEXT PRIMARY KEY, profile_name TEXT, source TEXT, hidden INTEGER DEFAULT 0, archived INTEGER DEFAULT 0);
        CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT, content TEXT);
        CREATE TABLE session_model_usage (session_id TEXT, model TEXT, input_tokens INTEGER, PRIMARY KEY(session_id, model));
        CREATE TABLE codex_hermes_imports (hermes_session_id TEXT, thread_id TEXT, turn_id TEXT, PRIMARY KEY(hermes_session_id, thread_id, turn_id));
        CREATE TABLE codex_hermes_review_outbox (id TEXT PRIMARY KEY, hermes_session_id TEXT, thread_id TEXT, profile_home TEXT, state TEXT);
        CREATE TABLE codex_hermes_learning_todos (id TEXT PRIMARY KEY, hermes_session_id TEXT, thread_id TEXT, profile_home TEXT, outbox_id TEXT);
        CREATE VIRTUAL TABLE messages_fts USING fts5(content);
        CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content); END;
        """
    )
    conn.commit()
    conn.close()


def test_projection_transfer_copies_rows_and_hides_source(tmp_path, monkeypatch):
    root = tmp_path / "hermes"
    source = root / "profiles" / "source"
    target = root / "profiles" / "target"
    source.mkdir(parents=True)
    target.mkdir(parents=True)
    _db(source / "state.db")
    _db(target / "state.db")
    conn = sqlite3.connect(source / "state.db")
    conn.execute("INSERT INTO sessions VALUES ('s1','source','codex',0,0)")
    conn.execute("INSERT INTO messages(session_id,role,content) VALUES ('s1','user','details')")
    conn.execute("INSERT INTO session_model_usage VALUES ('s1','model-a',4)")
    conn.execute("INSERT INTO codex_hermes_imports VALUES ('s1','t1','turn1')")
    conn.commit(); conn.close()
    monkeypatch.setenv("HERMES_WORKBENCH_HERMES_HOME", str(root))
    assert transfer_projection("source", "target", "s1") == {"sessions": 1, "messages": 1}
    target_db = sqlite3.connect(target / "state.db")
    assert target_db.execute("SELECT profile_name FROM sessions WHERE id='s1'").fetchone() == ("target",)
    assert target_db.execute("SELECT content FROM messages_fts WHERE rowid=1").fetchone() == ("details",)
    source_db = sqlite3.connect(source / "state.db")
    assert source_db.execute("SELECT hidden, archived FROM sessions WHERE id='s1'").fetchone() == (1, 1)


def test_projection_transfer_rejects_missing_target_database(tmp_path, monkeypatch):
    root = tmp_path / "hermes"
    source = root / "profiles" / "source"
    source.mkdir(parents=True)
    _db(source / "state.db")
    monkeypatch.setenv("HERMES_WORKBENCH_HERMES_HOME", str(root))
    with pytest.raises(RuntimeError, match="target Hermes profile database is missing"):
        transfer_projection("source", "target", "s1")


def test_recover_migrated_projection_from_hidden_source(tmp_path, monkeypatch):
    root = tmp_path / "hermes"
    source = root / "profiles" / "source"
    target = root / "profiles" / "target"
    source.mkdir(parents=True)
    target.mkdir(parents=True)
    _db(source / "state.db")
    _db(target / "state.db")
    source_db = sqlite3.connect(source / "state.db")
    source_db.execute("INSERT INTO sessions VALUES ('s1','source','codex',1,1)")
    source_db.execute("INSERT INTO messages(session_id,role,content) VALUES ('s1','user','restored')")
    source_db.commit(); source_db.close()
    codex = root / "codex.sqlite3"
    codex_db = sqlite3.connect(codex)
    codex_db.execute("CREATE TABLE codex_sessions (profile TEXT, session_id TEXT)")
    codex_db.execute("INSERT INTO codex_sessions VALUES ('target','s1')")
    codex_db.commit(); codex_db.close()
    monkeypatch.setenv("HERMES_WORKBENCH_HERMES_HOME", str(root))
    monkeypatch.setenv("HERMES_WORKBENCH_CODEX_DB", str(codex))
    assert recover_migrated_projections() == {"restored": 1, "visible": 0, "skipped": 0}
    target_db = sqlite3.connect(target / "state.db")
    assert target_db.execute("SELECT profile_name, hidden, archived FROM sessions WHERE id='s1'").fetchone() == ("target", 0, 0)
    assert target_db.execute("SELECT content FROM messages WHERE session_id='s1'").fetchone() == ("restored",)
