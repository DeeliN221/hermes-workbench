"""Session names and sidebar ordering must survive background updates."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import BridgeStore, CodexBridge


class SessionMetadataContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'db'
        self.store = BridgeStore(self.path)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def create(self, sid, title=''):
        return self.store.upsert_session('qa', 'default', {
            'session_id': sid, 'thread_id': 'thread-' + sid, 'title': title,
            'workspace_id': 'default', 'workspace_path': self.temp.name,
        })

    def test_display_fallback_never_becomes_a_persisted_title(self):
        session = self.create('session')
        self.assertEqual(session['title'], 'session')
        self.store.upsert_session('qa', 'default', session)
        self.assertEqual(self.store.connection.execute('select title from codex_sessions').fetchone()[0], '')
        self.store.set_title_if_empty('qa', 'default', 'session', '第一条消息')
        self.store.upsert_session('qa', 'default', {**session, 'status': 'running'})
        self.assertEqual(self.store.session('qa', 'default', 'session')['title'], '第一条消息')

    def test_old_fallback_titles_backfill_without_overwriting_named_sessions(self):
        for sid, title in [('missing', ''), ('named', '用户指定标题')]:
            self.create(sid, title)
            self.store.save_request('qa', 'default', sid, 'first', status='accepted',
                payload=json.dumps({'input': [{'type': 'text', 'text': '实际会话名称'}]}))
        self.store.connection.execute("update codex_sessions set title=session_id where session_id='missing'")
        self.store.connection.commit()
        self.store.close()
        self.store = BridgeStore(self.path)
        sessions = {s['session_id']: s['title'] for s in self.store.list_sessions('qa', 'default', 100, 0)}
        self.assertEqual(sessions, {'missing': '实际会话名称', 'named': '用户指定标题'})

    def test_creation_order_does_not_change_on_reply_rename_or_restart(self):
        with patch('codex_bridge.time.time', return_value=100):
            old = self.create('old')
        with patch('codex_bridge.time.time', return_value=200):
            self.create('new')
        with patch('codex_bridge.time.time', return_value=300):
            self.store.upsert_session('qa', 'default', {**old, 'title': '改名', 'created_at': 9999, 'status': 'completed'})
        self.store.close()
        self.store = BridgeStore(self.path)
        sessions = self.store.list_sessions('qa', 'default', 100, 0)
        self.assertEqual([s['session_id'] for s in sessions], ['new', 'old'])
        self.assertEqual([s['created_at'] for s in sessions], [200, 100])
        self.assertEqual(sessions[1]['updated_at'], 300)

    def test_legacy_creation_timestamp_uses_earliest_evidence_once(self):
        with patch('codex_bridge.time.time', return_value=100):
            session = self.create('old')
            self.store.save_request('qa', 'default', 'old', 'first', status='accepted', payload='{}')
        with patch('codex_bridge.time.time', return_value=300):
            self.store.upsert_session('qa', 'default', session)
        self.store.close()
        with sqlite3.connect(self.path) as connection:
            connection.execute('alter table codex_sessions drop column created_at')
        self.store = BridgeStore(self.path)
        self.assertEqual(self.store.session('qa', 'default', 'old')['created_at'], 100)

    def test_transfer_moves_all_profile_keyed_history_and_clears_group(self):
        session = self.create('transfer', '跨 profile 会话')
        self.store.create_group('qa', 'default', '', '', '临时项目')
        self.store.append_event('qa', 'default', 'transfer', 'history/turn', {'params': {'turn': {'id': 't1', 'status': 'completed'}}})
        self.store.save_request('qa', 'default', 'transfer', 'request', status='completed', payload='{}')
        moved = self.store.transfer_session('qa', 'default', 'learning-mentor', 'transfer')
        self.assertEqual(moved['profile'], 'learning-mentor')
        self.assertIsNone(self.store.session('qa', 'default', 'transfer'))
        self.assertEqual(self.store.session('qa', 'learning-mentor', 'transfer')['title'], '跨 profile 会话')
        self.assertEqual(self.store.connection.execute(
            "select count(*) from codex_events where user_id='qa' and profile='learning-mentor' and session_id='transfer'"
        ).fetchone()[0], 1)
        self.assertEqual(self.store.connection.execute(
            "select count(*) from codex_requests where user_id='qa' and profile='learning-mentor' and session_id='transfer'"
        ).fetchone()[0], 1)


class EmptyThreadContract(unittest.TestCase):
    def test_startup_metadata_does_not_make_a_fresh_thread_nonempty(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = CodexBridge(db_path=Path(directory) / 'db', workspace_map={})
            try:
                session = bridge.store.upsert_session('qa', 'default', {
                    'session_id': 'empty', 'thread_id': 'thread', 'workspace_id': 'default',
                    'workspace_path': directory, 'status': 'idle',
                })
                bridge.store.append_event('qa', 'default', 'empty', 'mcpServer/startupStatus/updated', {'params': {'status': 'ready'}})
                metadata = {'preview': '', 'status': {'type': 'idle'}, 'createdAt': 100, 'updatedAt': 101, 'recencyAt': 101}
                self.assertTrue(bridge._native_thread_is_known_empty(session, metadata))
                bridge.store.append_event('qa', 'default', 'empty', 'item/started', {'params': {'item': {'id': 'real'}}})
                self.assertFalse(bridge._native_thread_is_known_empty(session, metadata))
            finally:
                bridge.store.close()

class ConcurrentListContract(unittest.TestCase):
    def test_home_reads_committed_rows_while_writer_lock_is_held(self):
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as directory:
            store = BridgeStore(Path(directory) / 'db')
            try:
                for sid, created, updated in [('older', 1, 5), ('newer', 2, 3)]:
                    store.upsert_session('qa', 'default', {'session_id': sid, 'thread_id': sid, 'workspace_id': 'default', 'workspace_path': directory})
                    store.connection.execute('UPDATE codex_sessions SET created_at=?,updated_at=? WHERE session_id=?', (created, updated, sid))
                store.connection.commit()
                with ThreadPoolExecutor() as executor:
                    with store.lock:
                        future = executor.submit(store.list_sessions, 'qa', 'default', 1, 0, False, True)
                        rows = future.result(timeout=2)
                        self.assertEqual([row['id'] for row in rows], ['older'])
                self.assertEqual(store.list_sessions('other', 'default', 24, 0), [])
                self.assertEqual(store.list_sessions('qa', 'other', 24, 0), [])
                self.assertEqual(store.list_sessions('qa', 'default', 1, 0)[0]['id'], 'newer')
            finally:
                store.close()
