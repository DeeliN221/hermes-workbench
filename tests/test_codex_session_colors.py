"""Session accent colours persist and migrate with organization metadata."""
from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import BridgeStore


class SessionColorStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'db'
        self.store = BridgeStore(self.path)
        self.store.upsert_session('qa', 'default', {
            'session_id': 'session', 'thread_id': 'thread-session', 'title': '',
            'workspace_id': 'default', 'workspace_path': self.temp.name,
        })

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_new_sessions_default_to_no_explicit_color(self):
        session = self.store.session('qa', 'default', 'session')
        self.assertEqual(session['color'], '')
        self.assertEqual(self.store.list_sessions('qa', 'default', 10, 0)[0]['color'], '')

    def test_color_is_normalized_and_survives_other_organization_updates(self):
        saved = self.store.update_organization('qa', 'default', 'session', {'color': '#3B82F6'})
        self.assertEqual(saved['color'], '#3b82f6')
        self.store.update_organization('qa', 'default', 'session', {'favorite': True})
        session = self.store.session('qa', 'default', 'session')
        self.assertEqual(session['color'], '#3b82f6')
        self.assertTrue(session['favorite'])
        self.assertEqual(self.store.list_sessions('qa', 'default', 10, 0)[0]['color'], '#3b82f6')

    def test_empty_string_restores_the_explicit_color(self):
        self.store.update_organization('qa', 'default', 'session', {'color': '#14b8a6'})
        cleared = self.store.update_organization('qa', 'default', 'session', {'color': ''})
        self.assertEqual(cleared['color'], '')

    def test_invalid_colors_are_rejected_without_writing(self):
        self.store.update_organization('qa', 'default', 'session', {'color': '#f43f5e'})
        for value in ('#fff', 'red', '#12345', '#1234567', '#12345g', None):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException) as raised:
                    self.store.update_organization('qa', 'default', 'session', {'color': value})
                self.assertEqual(raised.exception.status_code, 400)
                self.assertEqual(self.store.session('qa', 'default', 'session')['color'], '#f43f5e')

    def test_legacy_database_gains_the_column_on_startup(self):
        self.store.update_organization('qa', 'default', 'session', {'favorite': True, 'color': '#22c55e'})
        self.store.close()
        with sqlite3.connect(self.path) as connection:
            connection.execute('ALTER TABLE codex_session_organization DROP COLUMN color')
        self.store = BridgeStore(self.path)
        columns = {row[1] for row in self.store.connection.execute('PRAGMA table_info(codex_session_organization)')}
        self.assertIn('color', columns)
        session = self.store.session('qa', 'default', 'session')
        self.assertEqual(session['color'], '')
        self.assertTrue(session['favorite'])


if __name__ == '__main__':
    unittest.main()
