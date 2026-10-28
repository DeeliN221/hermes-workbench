"""Session search must cover metadata, native thread content, and archive scope."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import BridgeStore, CodexBridge, RpcFailure


class StoreSearchContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = BridgeStore(Path(self.temp.name) / 'db')
        self.store.upsert_session('qa', 'default', {
            'session_id': 'session-a', 'thread_id': 'thread-a', 'workspace_id': 'w',
            'workspace_path': self.temp.name, 'title': 'Fix 100% search_ bug',
        })
        self.store.upsert_session('qa', 'default', {
            'session_id': 'session-b', 'thread_id': 'thread-b', 'workspace_id': 'w',
            'workspace_path': self.temp.name, 'title': 'Other chat',
        })
        self.store.upsert_session('qa', 'writer', {
            'session_id': 'session-c', 'thread_id': 'thread-c', 'workspace_id': 'w',
            'workspace_path': self.temp.name, 'title': 'Foreign 100% search',
        })

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_matches_title_id_and_thread_with_literal_wildcards(self):
        self.assertEqual([row['session_id'] for row in self.store.search_sessions('qa', 'default', '100%')], ['session-a'])
        self.assertEqual([row['session_id'] for row in self.store.search_sessions('qa', 'default', 'search_')], ['session-a'])
        self.assertEqual([row['session_id'] for row in self.store.search_sessions('qa', 'default', 'thread-b')], ['session-b'])

    def test_returns_archive_and_group_scope_for_the_sidebar(self):
        group = self.store.create_group('qa', 'default', 'w', self.temp.name, 'Metals')
        self.store.update_organization('qa', 'default', 'session-a', {'deleted': True, 'groupId': group['id']})
        hit = self.store.search_sessions('qa', 'default', 'search')[0]
        self.assertTrue(hit['deleted'])
        self.assertEqual(hit['groupName'], 'Metals')
        self.assertEqual(hit['id'], 'session-a')


class BridgeSearchContract(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.bridge = CodexBridge(db_path=Path(self.temp.name) / 'db', workspace_map={})
        for sid, thread, title in [
            ('session-a', 'thread-a', 'Metals screening'),
            ('session-b', 'thread-b', 'Other chat'),
        ]:
            self.bridge.store.upsert_session('qa', 'project-manager', {
                'session_id': sid, 'thread_id': thread, 'workspace_id': 'w',
                'workspace_path': self.temp.name, 'title': title,
            })
        self.bridge.store.upsert_session('qa', 'writer', {
            'session_id': 'session-c', 'thread_id': 'thread-c', 'workspace_id': 'w',
            'workspace_path': self.temp.name, 'title': 'Foreign needle',
        })
        self.calls = []
        owner = self

        class Peer:
            async def request(self, method, params):
                owner.calls.append((method, params))
                if params.get('cursor'):
                    return {'data': [{'thread': {'id': 'thread-a'}, 'snippet': 'later content needle'}], 'nextCursor': None}
                return {'data': [
                    {'thread': {'id': 'thread-c'}, 'snippet': 'foreign needle'},
                    {'thread': {'id': 'thread-b'}, 'snippet': 'first content needle'},
                ], 'nextCursor': 'cursor-1'}

        self.peer = Peer()
        async def connection(*args):
            return self.peer
        self.bridge._connection = connection

    async def asyncTearDown(self):
        await self.bridge.close()
        self.temp.cleanup()

    async def test_merges_metadata_and_content_without_leaking_profiles(self):
        result = await self.bridge.search_sessions('qa', 'project-manager', 'needle', 20)
        self.assertTrue(result['contentSearch'])
        self.assertEqual([hit['session_id'] for hit in result['results']], ['session-b', 'session-a'])
        self.assertEqual(result['results'][0]['snippet'], 'first content needle')
        self.assertEqual(result['results'][1]['snippet'], 'later content needle')
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[1][1], {'searchTerm': 'needle', 'cursor': 'cursor-1'})

    async def test_metadata_hit_stays_available_when_native_search_is_unsupported(self):
        class Unsupported:
            async def request(self, method, params):
                raise RpcFailure({'code': -32601, 'message': 'thread/search is unavailable'})
        async def connection(*args):
            return Unsupported()
        self.bridge._connection = connection
        result = await self.bridge.search_sessions('qa', 'project-manager', 'metals', 20)
        self.assertEqual([hit['session_id'] for hit in result['results']], ['session-a'])
        self.assertEqual(result['results'][0]['matched'], 'title')
        self.assertFalse(result['contentSearch'])
        self.assertIn('thread/search', result['contentError'])


if __name__ == '__main__':
    unittest.main()
