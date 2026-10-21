"""Preview seeks recent turns without decoding older transcripts or losing state."""
import asyncio
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import CodexBridge, create_router
from fastapi import FastAPI, HTTPException
import httpx


class PreviewLoadingContract(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.bridge = CodexBridge(db_path=Path(self.temp.name) / 'db', workspace_map={})
        self.store = self.bridge.store
        self.store.upsert_session('qa', 'default', {
            'session_id': 'session', 'thread_id': 'thread', 'workspace_id': 'workspace',
            'workspace_path': self.temp.name, 'status': 'completed',
        })

    async def asyncTearDown(self):
        await self.bridge.close()
        self.temp.cleanup()

    def append(self, method, params):
        return self.store.append_event('qa', 'default', 'session', method, {'method': method, 'params': params})

    async def test_empty_cache_is_normal_but_wrong_identity_still_returns_404(self):
        result = await self.bridge.history_preview('qa', 'default', 'session')
        self.assertFalse(result['cached'])
        self.assertEqual(result['turns'], [])
        self.assertEqual(result['lastError'], '')
        with self.assertRaises(HTTPException) as raised:
            await self.bridge.history_preview('other', 'default', 'session')
        self.assertEqual(raised.exception.status_code, 404)

    async def test_empty_preview_returns_the_terminal_turn_error(self):
        self.append('turn/completed', {'turn': {
            'id': 'failed-turn', 'status': 'failed',
            'error': {'message': 'Selected model is at capacity. Please try a different model.'},
        }})
        result = await self.bridge.history_preview('qa', 'default', 'session')
        self.assertFalse(result['cached'])
        self.assertEqual(result['turns'], [])
        self.assertEqual(result['lastError'], 'Selected model is at capacity. Please try a different model.')

    async def test_empty_preview_clears_an_older_error_after_a_successful_turn(self):
        self.append('turn/completed', {'turn': {
            'id': 'failed-turn', 'status': 'failed',
            'error': {'message': 'Selected model is at capacity. Please try a different model.'},
        }})
        self.append('turn/completed', {'turn': {'id': 'successful-turn', 'status': 'completed'}})
        result = await self.bridge.history_preview('qa', 'default', 'session')
        self.assertFalse(result['cached'])
        self.assertEqual(result['lastError'], '')

    async def test_recent_turns_use_index_and_do_not_decode_older_items(self):
        for n in range(12):
            self.append('history/item', {'turnId': str(n), 'item': {
                'id': f'item-{n}', 'type': 'commandExecution', 'aggregatedOutput': 'x' * 10000,
            }})
            self.append('history/turn', {'turn': {'id': str(n), 'status': 'completed'}})
        # A status revision must select the same turn once, preserving its items.
        self.append('history/turn-status', {'turn': {'id': '11', 'status': 'interrupted'}})
        original = json.loads
        decoded = []
        def decode(value, *args, **kwargs):
            data = original(value, *args, **kwargs)
            if data.get('method') == 'history/item': decoded.append(data['params']['turnId'])
            return data
        with patch('codex_bridge.json.loads', side_effect=decode):
            result = self.store.cached_history_preview('qa', 'default', 'session', 2)
        self.assertEqual(set(decoded), {'10', '11'})
        self.assertEqual([turn['id'] for turn in result['turns']], ['10', '11'])
        self.assertEqual(result['turns'][-1]['status'], 'interrupted')
        self.assertEqual(result['turns'][-1]['items'][0]['id'], 'item-11')
        self.assertNotIn('aggregatedOutput', result['turns'][-1]['items'][0])
        plan = self.store.connection.execute("""EXPLAIN QUERY PLAN SELECT payload FROM codex_events
            WHERE user_id=? AND profile=? AND session_id=? AND method='history/item'
            AND json_valid(payload) AND json_extract(payload,'$.params.turnId')=? ORDER BY seq""",
            ('qa', 'default', 'session', '11')).fetchall()
        self.assertIn('codex_preview_items', str([tuple(row) for row in plan]))

    async def test_completion_lookup_skips_failure_and_progress_and_never_regresses_read(self):
        completed = self.append('turn/completed', {'turn': {'id': 'one', 'status': 'completed'}})
        self.append('turn/completed', {'turn': {'id': 'two', 'status': 'failed'}})
        self.append('history/turn-status', {'turn': {'id': 'two', 'status': 'inProgress'}})
        seq = completed['seq'] if isinstance(completed, dict) else completed
        self.assertEqual(self.store._last_completed_seq('qa', 'default', 'session'), seq)
        self.assertEqual(self.store.mark_read('qa', 'default', 'session', seq + 100), seq)
        self.assertEqual(self.store.mark_read('qa', 'default', 'session', 0), seq)

    async def test_read_write_does_not_block_unrelated_api_requests(self):
        started, release = threading.Event(), threading.Event()
        original = self.store.mark_read
        def slow_read(*args):
            started.set()
            if not release.wait(2):
                raise AssertionError('write blocked the API event loop')
            return original(*args)
        self.store.mark_read = slow_read
        app = FastAPI()
        app.include_router(create_router(self.bridge))
        @app.get('/health')
        async def health():
            return {'ok': True}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                                    headers={'remote-user': 'qa'}) as client:
            task = asyncio.create_task(client.post('/session/read?profile=default&session_id=session', json={'readSeq': 0}))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                result = await asyncio.wait_for(client.get('/health'), .5)
                self.assertEqual(result.status_code, 200)
            finally:
                release.set()
            self.assertEqual((await task).status_code, 200)


if __name__ == '__main__':
    unittest.main()
