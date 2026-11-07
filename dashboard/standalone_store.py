"""Durable, user-scoped metadata for the standalone host."""
from __future__ import annotations

import json
import hashlib
import sqlite3
import uuid
from pathlib import Path


class Store:
    def __init__(self, home: Path, workspace_root: Path, *, isolate_users: bool = False):
        self.isolate_users = isolate_users
        self.home = home.resolve()
        self.workspace_root = workspace_root.resolve()
        self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.home / "workbench.sqlite3", check_same_thread=False)
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS profiles (user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
          PRIMARY KEY(user_id,id));
        CREATE TABLE IF NOT EXISTS projects (user_id TEXT NOT NULL, profile_id TEXT NOT NULL, id TEXT NOT NULL,
          name TEXT NOT NULL, relative_path TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY(user_id,profile_id,id));
        CREATE TABLE IF NOT EXISTS preferences (user_id TEXT NOT NULL, profile_id TEXT NOT NULL, data TEXT NOT NULL,
          PRIMARY KEY(user_id,profile_id));
        CREATE TABLE IF NOT EXISTS sessions (user_id TEXT NOT NULL, profile_id TEXT NOT NULL, project_id TEXT NOT NULL,
          id TEXT NOT NULL, PRIMARY KEY(user_id,id));
        """)
        self.db.execute("CREATE TABLE IF NOT EXISTS documents (user_id TEXT NOT NULL, profile_id TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id,profile_id,key))")
        self.db.execute('CREATE TABLE IF NOT EXISTS host_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        layout = json.dumps({'workspace_root': str(self.workspace_root), 'isolate_users': self.isolate_users}, sort_keys=True)
        existing = self.db.execute("SELECT value FROM host_metadata WHERE key='workspace-layout'").fetchone()
        if existing and existing[0] != layout:
            self.db.close()
            raise ValueError('Workspace layout changed; use a separate standalone home or migrate explicitly')
        self.db.execute("INSERT OR IGNORE INTO host_metadata VALUES ('workspace-layout', ?)", (layout,))
        self.db.commit()

    def user_workspace(self, user_id: str) -> Path:
        if not self.isolate_users:
            return self.workspace_root
        path = self.workspace_root / hashlib.sha256(user_id.encode()).hexdigest()
        path.mkdir(mode=0o700, exist_ok=True)
        if path.is_symlink() or not path.resolve().is_relative_to(self.workspace_root):
            raise ValueError("Unsafe user workspace")
        return path.resolve()

    def bootstrap(self, user_id: str) -> None:
        self.user_workspace(user_id)
        self.db.execute("INSERT OR IGNORE INTO profiles VALUES (?, 'default', 'Default')", (user_id,))
        self.db.execute("INSERT OR IGNORE INTO projects (user_id,profile_id,id,name,relative_path) VALUES (?, 'default','default','Default','.')", (user_id,))
        self.db.commit()

    def profiles(self, user_id: str) -> list[dict]:
        return [dict(id=r[0], name=r[1]) for r in self.db.execute("SELECT id,name FROM profiles WHERE user_id=? ORDER BY name", (user_id,))]

    def create_profile(self, user_id: str, name: str) -> dict:
        if not isinstance(name, str) or not name.strip() or len(name) > 100:
            raise ValueError('Name must contain 1 to 100 characters')
        ident = uuid.uuid4().hex
        self.db.execute("INSERT INTO profiles VALUES (?,?,?)", (user_id, ident, name))
        self.db.execute("INSERT INTO projects (user_id,profile_id,id,name,relative_path) VALUES (?,?,'default','Default','.')", (user_id, ident))
        self.db.commit()
        return {"id": ident, "name": name}

    def projects(self, user_id: str, profile_id: str) -> list[dict]:
        self.profile(user_id, profile_id)
        return [dict(id=r[0], name=r[1], relative_path=r[2], settings=json.loads(r[3])) for r in self.db.execute("SELECT id,name,relative_path,settings FROM projects WHERE user_id=? AND profile_id=? ORDER BY name", (user_id, profile_id))]

    def profile(self, user_id: str, profile_id: str) -> None:
        if not self.db.execute("SELECT 1 FROM profiles WHERE user_id=? AND id=?", (user_id, profile_id)).fetchone():
            raise KeyError("Unknown profile")

    def create_project(self, user_id: str, profile_id: str, name: str, relative_path: str) -> dict:
        self.profile(user_id, profile_id)
        root = self.user_workspace(user_id)
        path = (root / relative_path).resolve()
        if not path.is_relative_to(root) or not path.is_dir():
            raise ValueError("Project must be an existing directory within the workspace root")
        if not isinstance(name, str) or not name.strip() or len(name) > 100:
            raise ValueError('Name must contain 1 to 100 characters')
        ident = uuid.uuid4().hex
        relative = str(path.relative_to(root))
        self.db.execute("INSERT INTO projects (user_id,profile_id,id,name,relative_path) VALUES (?,?,?,?,?)", (user_id, profile_id, ident, name, relative))
        self.db.commit()
        return {"id": ident, "name": name, "relative_path": relative, "settings": {}}

    def context(self, user_id: str, profile_id: str, project_id: str) -> dict:
        self.profile(user_id, profile_id)
        row = self.db.execute("SELECT relative_path FROM projects WHERE user_id=? AND profile_id=? AND id=?", (user_id, profile_id, project_id)).fetchone()
        if not row:
            raise KeyError("Unknown project")
        root = self.user_workspace(user_id)
        path = (root / row[0]).resolve()
        if not path.is_relative_to(root):
            raise ValueError("Project directory escaped workspace root")
        return dict(user_id=user_id, profile_id=profile_id, project_id=project_id, workspace=str(path))

    def preferences(self, user_id: str, profile_id: str, data: dict | None = None) -> dict:
        self.profile(user_id, profile_id)
        if data is not None:
            self.db.execute("INSERT INTO preferences VALUES (?,?,?) ON CONFLICT(user_id,profile_id) DO UPDATE SET data=excluded.data", (user_id, profile_id, json.dumps(data)))
            self.db.commit()
        row = self.db.execute("SELECT data FROM preferences WHERE user_id=? AND profile_id=?", (user_id, profile_id)).fetchone()
        return json.loads(row[0]) if row else {}

    def bind_session(self, context: dict, session_id: str) -> None:
        self.db.execute("INSERT INTO sessions VALUES (?,?,?,?)", (context['user_id'], context['profile_id'], context['project_id'], session_id))
        self.db.commit()

    def owns_session(self, context: dict, session_id: str) -> bool:
        return bool(self.db.execute("SELECT 1 FROM sessions WHERE user_id=? AND profile_id=? AND project_id=? AND id=?", (context['user_id'], context['profile_id'], context['project_id'], session_id)).fetchone())

    def document(self, user_id: str, profile_id: str, key: str, data: dict | None = None) -> dict:
        self.profile(user_id, profile_id)
        if data is not None:
            self.db.execute('INSERT INTO documents VALUES (?,?,?,?) ON CONFLICT(user_id,profile_id,key) DO UPDATE SET data=excluded.data', (user_id, profile_id, key, json.dumps(data)))
            self.db.commit()
        row = self.db.execute('SELECT data FROM documents WHERE user_id=? AND profile_id=? AND key=?', (user_id, profile_id, key)).fetchone()
        return json.loads(row[0]) if row else {}

    def session_context(self, user_id: str, profile_id: str, session_id: str) -> dict:
        self.profile(user_id, profile_id)
        row = self.db.execute('SELECT project_id FROM sessions WHERE user_id=? AND profile_id=? AND id=?', (user_id, profile_id, session_id)).fetchone()
        if not row:
            raise KeyError('Unknown session')
        return self.context(user_id, profile_id, row[0])

    def update_project(self, user_id: str, profile_id: str, project_id: str, changes: dict) -> dict:
        self.context(user_id, profile_id, project_id)
        row = next(p for p in self.projects(user_id, profile_id) if p['id'] == project_id)
        settings = {**row['settings'], **{k: v for k, v in changes.items() if k in ('color', 'icon', 'model', 'description')}}
        self.db.execute('UPDATE projects SET name=?,settings=? WHERE user_id=? AND profile_id=? AND id=?', (str(changes.get('name', row['name'])), json.dumps(settings), user_id, profile_id, project_id))
        self.db.commit()
        return next(p for p in self.projects(user_id, profile_id) if p['id'] == project_id)

    def delete_project(self, user_id: str, profile_id: str, project_id: str) -> None:
        self.context(user_id, profile_id, project_id)
        if project_id == 'default' or self.db.execute('SELECT 1 FROM sessions WHERE user_id=? AND profile_id=? AND project_id=?', (user_id, profile_id, project_id)).fetchone():
            raise ValueError('Cannot delete the default project or a project with sessions')
        self.db.execute('DELETE FROM projects WHERE user_id=? AND profile_id=? AND id=?', (user_id, profile_id, project_id))
        self.db.commit()

    def close(self) -> None:
        self.db.close()
