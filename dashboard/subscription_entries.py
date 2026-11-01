"""Non-secret subscription configuration, scoped by authenticated user/profile."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from typing import Literal
from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator


class Entry(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    name: str = Field(min_length=1, max_length=120)
    service: str = Field(min_length=1, max_length=120)
    plan: str = Field(max_length=120)
    adapter: Literal['manual', 'codex', 'unsupported'] = 'manual'
    preset: Literal['opencode', 'gemini', 'openai'] | None = None
    enabled: bool = True
    minutes: Literal[300, 10080, 43200] = 300
    resetsAt: str | None = None
    amount: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    limit: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    mode: Literal['remaining', 'used'] = 'remaining'
    unit: str = Field(default='credits', min_length=1, max_length=40)
    observedAt: str | None = None

    @field_validator('name', 'service', 'unit')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Empty label')
        return value.strip()

    @field_validator('resetsAt', 'observedAt')
    @classmethod
    def timestamp(cls, value):
        if value is not None:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                raise ValueError('Timezone required')
        return value


PRESETS = [
    dict(id='opencode', name='OpenCode Go', service='OpenCode', plan='Go', adapter='unsupported', preset='opencode'),
    dict(id='gemini', name='Gemini AI Pro', service='Gemini', plan='AI Pro', adapter='unsupported', preset='gemini'),
    dict(id='openai', name='OpenAI ChatGPT Pro', service='OpenAI', plan='ChatGPT Pro', adapter='codex', preset='openai'),
]


def defaults():
    return [Entry(**p).model_dump() for p in PRESETS]


class SubscriptionStore:
    """Atomic list replacement with optimistic concurrency; list order is display order."""
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get('HERMES_WORKBENCH_SUBSCRIPTIONS_DB') or
                         Path.home() / '.local/share/hermes-workbench/subscriptions.sqlite3')

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        db = sqlite3.connect(self.path, timeout=5)
        self.path.chmod(0o600)
        db.execute('CREATE TABLE IF NOT EXISTS subscriptions (user TEXT, profile TEXT, revision INTEGER NOT NULL, entries TEXT NOT NULL, PRIMARY KEY(user, profile))')
        try:
            with db:
                yield db
        finally:
            db.close()

    def read(self, user, profile):
        with self.connect() as db:
            row = db.execute('SELECT revision, entries FROM subscriptions WHERE user=? AND profile=?', (user, profile)).fetchone()
        return {'revision': row[0], 'entries': json.loads(row[1])} if row else {'revision': 0, 'entries': defaults()}

    def save(self, user, profile, revision, entries):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision FROM subscriptions WHERE user=? AND profile=?', (user, profile)).fetchone()
            if (row[0] if row else 0) != revision:
                raise HTTPException(409, 'Subscriptions changed in another tab. Reload before saving.')
            db.execute('INSERT OR REPLACE INTO subscriptions VALUES (?, ?, ?, ?)',
                       (user, profile, revision + 1, json.dumps(entries, allow_nan=False)))
        return {'revision': revision + 1, 'entries': entries}
