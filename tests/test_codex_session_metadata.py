"""Session names and sidebar ordering must survive background updates."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import BridgeStore, CodexBridge, create_router
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


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


class SessionTitleContract(unittest.TestCase):
    """A user rename persists, survives new turns, and never crosses profiles."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'db'
        self.store = BridgeStore(self.path)
        self.create('session')

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def create(self, sid, title=''):
        return self.store.upsert_session('qa', 'default', {
            'session_id': sid, 'thread_id': 'thread-' + sid, 'title': title,
            'workspace_id': 'default', 'workspace_path': self.temp.name,
        })

    def test_rename_persists_and_survives_new_messages_and_restarts(self):
        renamed = self.store.set_title('qa', 'default', 'session', '  重构计划  ')
        self.assertEqual(renamed['title'], '重构计划')
        self.assertEqual(renamed['customTitle'], '重构计划')
        self.assertEqual(renamed['titleSource'], 'user')
        # A later message derives a title only when the user did not set one.
        self.store.set_title_if_empty('qa', 'default', 'session', '新的第一条消息')
        self.store.upsert_session('qa', 'default', {**renamed, 'status': 'running'})
        self.store.close()
        self.store = BridgeStore(self.path)
        session = self.store.session('qa', 'default', 'session')
        self.assertEqual(session['title'], '重构计划')
        self.assertEqual(session['customTitle'], '重构计划')
        self.assertEqual(session['titleSource'], 'user')

    def test_empty_title_restores_the_derived_default(self):
        self.store.set_title('qa', 'default', 'session', '自定义标题')
        cleared = self.store.set_title('qa', 'default', 'session', '   ')
        self.assertIsNone(cleared['customTitle'])
        self.assertIsNone(cleared['titleSource'])
        self.assertEqual(cleared['title'], 'session')
        stored = self.store.connection.execute('select title,title_source from codex_sessions').fetchone()
        self.assertEqual((stored['title'], stored['title_source']), ('', ''))
        self.store.set_title_if_empty('qa', 'default', 'session', '第一条消息')
        session = self.store.session('qa', 'default', 'session')
        self.assertEqual(session['title'], '第一条消息')
        self.assertEqual(session['titleSource'], 'auto')

    def test_rename_rejects_missing_sessions_and_overlong_titles(self):
        with self.assertRaises(HTTPException) as missing:
            self.store.set_title('qa', 'default', 'absent', '标题')
        self.assertEqual(missing.exception.status_code, 404)
        with self.assertRaises(HTTPException) as other_profile:
            self.store.set_title('qa', 'other', 'session', '标题')
        self.assertEqual(other_profile.exception.status_code, 404)
        self.store.set_title('qa', 'default', 'session', 'a' * 200)
        self.assertEqual(self.store.session('qa', 'default', 'session')['titleSource'], 'user')
        with self.assertRaises(HTTPException) as too_long:
            self.store.set_title('qa', 'default', 'session', 'a' * 201)
        self.assertEqual(too_long.exception.status_code, 400)
        self.assertEqual(self.store.session('qa', 'default', 'session')['title'], 'a' * 200)

    def test_session_payloads_expose_created_at_in_the_updated_at_unit(self):
        fresh = self.create('timed')
        self.assertEqual(fresh['createdAt'], fresh['created_at'])
        self.assertEqual(fresh['updatedAt'], fresh['updated_at'])
        self.assertLessEqual(fresh['createdAt'], fresh['updatedAt'])
        listed = {item['session_id']: item for item in self.store.list_sessions('qa', 'default', 100, 0)}
        self.assertEqual(listed['timed']['createdAt'], fresh['createdAt'])
        self.assertEqual(listed['timed']['updatedAt'], fresh['updatedAt'])

    def test_legacy_titles_gain_an_auto_source_and_keep_later_user_renames(self):
        self.create('legacy', '旧标题')
        self.store.close()
        with sqlite3.connect(self.path) as connection:
            connection.execute('alter table codex_sessions drop column title_source')
        self.store = BridgeStore(self.path)
        self.assertEqual(self.store.session('qa', 'default', 'legacy')['titleSource'], 'auto')
        self.store.set_title_if_empty('qa', 'default', 'legacy', '新的第一条消息')
        self.assertEqual(self.store.session('qa', 'default', 'legacy')['title'], '旧标题')
        self.store.set_title('qa', 'default', 'legacy', '用户标题')
        self.store.close()
        self.store = BridgeStore(self.path)
        session = self.store.session('qa', 'default', 'legacy')
        self.assertEqual(session['title'], '用户标题')
        self.assertEqual(session['titleSource'], 'user')


class SessionTitleHTTPContract(unittest.TestCase):
    """The PATCH route renames, clears, and rejects invalid requests."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.bridge = CodexBridge(db_path=root / 'db', workspace_root=root, workspace_map={})
        self.bridge.store.upsert_session('qa', 'writer', {
            'session_id': 'session', 'thread_id': 'thread', 'workspace_id': 'main',
            'workspace_path': str(root), 'status': 'idle',
        })
        app = FastAPI()
        app.include_router(create_router(self.bridge), prefix='/codex')
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.bridge.store.close()
        self.temp.cleanup()

    def rename(self, title, profile='writer', session='session'):
        return self.client.patch(
            f'/codex/sessions/{session}/title?profile={profile}',
            headers={'remote-user': 'qa'}, json={'title': title},
        )

    def test_rename_updates_the_list_payload_and_clears_back_to_default(self):
        response = self.rename('  重命名会话  ')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['session_id'], 'session')
        self.assertEqual(body['title'], '重命名会话')
        self.assertEqual(body['session']['customTitle'], '重命名会话')
        self.assertEqual(body['session']['titleSource'], 'user')
        self.assertGreater(body['session']['createdAt'], 0)

        listed = self.client.get('/codex/sessions?profile=writer', headers={'remote-user': 'qa'}).json()['items'][0]
        self.assertEqual(listed['title'], '重命名会话')
        self.assertEqual(listed['createdAt'], body['session']['createdAt'])
        self.assertIn('updatedAt', listed)

        cleared = self.rename('   ')
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.json()['title'])
        self.assertIsNone(cleared.json()['session']['customTitle'])
        listed = self.client.get('/codex/sessions?profile=writer', headers={'remote-user': 'qa'}).json()['items'][0]
        self.assertEqual(listed['title'], 'session')

    def test_rename_rejects_unknown_sessions_other_profiles_and_invalid_titles(self):
        self.assertEqual(self.rename('x', session='absent').status_code, 404)
        self.assertEqual(self.rename('x', profile='default').status_code, 404)
        self.assertEqual(self.rename('a' * 201).status_code, 400)
        self.assertEqual(self.rename(42).status_code, 422)
        self.assertEqual(self.rename(None).status_code, 200)


class SessionTitleSubmitContract(unittest.IsolatedAsyncioTestCase):
    """Submitting a turn must never replace a title the user chose."""

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.bridge = CodexBridge(db_path=root / 'db', workspace_root=root, workspace_map={})
        for sid in ('named', 'blank'):
            self.bridge.store.upsert_session('qa', 'default', {
                'session_id': sid, 'thread_id': 'thread-' + sid, 'workspace_id': 'main',
                'workspace_path': str(root), 'status': 'idle',
            })
        owner = self

        class Peer:
            async def request(self, method, params):
                owner.assertIn(method, {'turn/start', 'turn/steer'})
                return {'turn': {'id': 'turn', 'status': 'completed'}}

        async def connection(*args):
            return Peer()
        self.bridge._connection = connection

    async def asyncTearDown(self):
        self.bridge.store.close()
        self.temp.cleanup()

    async def test_new_turns_fill_only_unnamed_sessions(self):
        self.bridge.store.set_title('qa', 'default', 'named', '用户标题')
        await self.bridge.submit('qa', 'default', 'named', {'clientRequestId': 'c1', 'text': '新的消息'})
        named = self.bridge.store.session('qa', 'default', 'named')
        self.assertEqual(named['title'], '用户标题')
        self.assertEqual(named['titleSource'], 'user')
        await self.bridge.submit('qa', 'default', 'blank', {'clientRequestId': 'c2', 'text': '第一条消息'})
        blank = self.bridge.store.session('qa', 'default', 'blank')
        self.assertEqual(blank['title'], '第一条消息')
        self.assertEqual(blank['titleSource'], 'auto')

