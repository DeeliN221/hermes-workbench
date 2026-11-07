"""Task completion wakes only its idle supervisor, without duplicate turns."""
import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from fastapi import HTTPException
from codex_bridge import CodexBridge
from supervisor_inbox import SupervisorInbox


class RuntimePeer:
    """Deterministic JSON-RPC transport; all bridge persistence remains real."""
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.calls = []
        self.turns = {}
        self.mode = 'accept'
        self.paused_thread = None
        self.paused_started = asyncio.Event()
        self.release = asyncio.Event()

    async def send(self, message):
        method, params = message['method'], message.get('params', {})
        self.calls.append((method, params))
        if 'id' not in message:
            return
        result = {}
        if method == 'turn/start':
            if params['threadId'] == self.paused_thread:
                self.paused_started.set()
                await self.release.wait()
            if self.mode == 'reject':
                await self.incoming.put({'id': message['id'], 'error': {'code': -32600, 'message': 'Explicit rejection'}})
                return
            if self.mode != 'lost-unaccepted':
                turn = {'id': 'turn-' + params['clientUserMessageId'], 'status': 'inProgress', 'itemsView': 'full', 'items': [
                    {'id': 'user-' + params['clientUserMessageId'], 'type': 'userMessage',
                     'clientId': params['clientUserMessageId'], 'content': params['input']},
                ]}
                self.turns.setdefault(params['threadId'], []).append(turn)
                result = {'turn': turn}
            if self.mode.startswith('lost'):
                return
        elif method == 'thread/read':
            result = {'thread': {'id': params['threadId'], 'turns': self.turns.get(params['threadId'], [])}}
        elif method == 'thread/turns/list':
            result = {'data': self.turns.get(params['threadId'], []), 'nextCursor': None}
        await self.incoming.put({'id': message['id'], 'result': result})

    async def receive(self):
        return await self.incoming.get()

    async def close(self):
        await self.incoming.put(None)

    async def finish(self, thread, text='The task is complete; the verified result is ready.'):
        turn = self.turns[thread][-1]
        item = {'id': 'answer-' + turn['id'], 'type': 'agentMessage', 'phase': 'final', 'text': text}
        turn['items'].append(item)
        turn['status'] = 'completed'
        await self.incoming.put({'method': 'item/completed', 'params': {'threadId': thread, 'turnId': turn['id'], 'item': item}})
        await self.incoming.put({'method': 'turn/completed', 'params': {'threadId': thread, 'turn': turn}})

    def starts(self):
        return [params for method, params in self.calls if method == 'turn/start']


class SupervisorInboxContract(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='supervisor-inbox-')
        self.peer = RuntimePeer()
        self.open_bridge()
        self.identity = ('qa', 'default', 'supervisor')
        self.session(self.identity, 'thread')

    def open_bridge(self):
        connected = False
        def transport(_):
            nonlocal connected
            if not connected:
                connected = True
                return self.peer
            # Each authenticated bridge connection needs its own receive
            # queue, even when both connections reach the same test runtime.
            peer = RuntimePeer()
            peer.calls, peer.turns = self.peer.calls, self.peer.turns
            return peer
        self.bridge = CodexBridge(db_path=Path(self.temp.name) / 'bridge.db',
                                  workspace_map={}, transport_factory=transport,
                                  request_timeout=.1, fallback_models=())
        self.inbox = SupervisorInbox(self.bridge)

    def session(self, identity, thread, status='completed'):
        self.bridge.store.upsert_session(*identity[:2], {
            'session_id': identity[2], 'thread_id': thread, 'workspace_id': 'workspace',
            'workspace_path': self.temp.name, 'status': status,
        })

    def due(self):
        with self.bridge.store.lock:
            self.bridge.store.connection.execute('UPDATE supervisor_inbox SET next_check_at=0')
            self.bridge.store.connection.commit()

    async def asyncTearDown(self):
        await self.bridge.close()
        self.temp.cleanup()

    async def test_idle_supervisor_wakes_and_result_is_visible_without_user_input(self):
        self.inbox.enqueue('task:event-1', self.identity, 'A delegated task completed. Verify the result and notify the user.')
        self.assertEqual(await self.inbox.drain(), {'accepted': 1})
        self.assertEqual(len(self.peer.starts()), 1)
        self.assertEqual(self.peer.starts()[0]['threadId'], 'thread')
        self.assertNotIn('expectedTurnId', self.peer.starts()[0])
        await self.peer.finish('thread')
        history = await self.bridge.history(*self.identity, 0, 100)
        self.assertEqual(history['turns'][0]['items'][-1]['text'], 'The task is complete; the verified result is ready.')
        self.assertEqual(self.bridge.store.list_sessions('qa', 'default', 10, 0)[0]['unread'], True)
        self.inbox.enqueue('task:event-1', self.identity, 'A delegated task completed. Verify the result and notify the user.')
        self.assertEqual(await self.inbox.drain(), {'delivered': 1})
        self.assertEqual(await self.inbox.drain(), {})
        self.assertEqual(len(self.peer.starts()), 1)

    async def test_busy_supervisor_queues_while_other_conversation_runs(self):
        self.session(self.identity, 'thread', status='running')
        other = ('qa', 'default', 'other')
        self.session(other, 'other-thread')
        self.inbox.enqueue('busy', self.identity, 'First result')
        self.inbox.enqueue('other', other, 'Second result')
        self.assertEqual(await self.inbox.drain(), {'busy': 1, 'accepted': 1})
        self.assertEqual([p['threadId'] for p in self.peer.starts()], ['other-thread'])
        self.session(self.identity, 'thread', status='completed')
        self.assertEqual(await self.inbox.drain(), {'accepted': 2})
        self.assertEqual([p['threadId'] for p in self.peer.starts()], ['other-thread', 'thread'])

    async def test_pending_input_and_approval_are_not_interrupted(self):
        row = self.inbox.enqueue('waiting', self.identity, 'Task result')
        self.bridge.store.save_request(*self.identity, 'human-request', status='pending', payload='{}')
        self.assertEqual(await self.inbox.drain(), {'busy': 1})
        self.bridge.store.save_request(*self.identity, 'human-request', status='accepted', payload='{}')
        self.bridge.store.save_approval(*self.identity, 'approval', 'item/tool/requestApproval',
                                        {'params': {'turnId': 'active'}}, 'epoch')
        self.assertEqual(await self.inbox.drain(), {'busy': 1})
        self.assertEqual(self.peer.starts(), [])
        self.assertEqual(self.inbox.get(row['delivery_key'])['status'], 'pending')

    async def test_pending_delivery_survives_restart(self):
        row = self.inbox.enqueue('restart', self.identity, 'Ready after restart')
        await self.bridge.close()
        self.peer = RuntimePeer()
        self.open_bridge()
        self.assertEqual(await self.inbox.drain(), {'accepted': 1})
        self.assertEqual(self.peer.starts()[0]['clientUserMessageId'], row['client_request_id'])

    async def test_restart_after_upstream_acceptance_does_not_duplicate(self):
        self.inbox.enqueue('crash-window', self.identity, 'Task done')
        await self.inbox.drain()
        with self.bridge.store.lock:
            self.bridge.store.connection.execute("UPDATE supervisor_inbox SET status='pending'")
            self.bridge.store.connection.commit()
        await self.bridge.close()
        self.peer = RuntimePeer()
        self.open_bridge()
        self.assertEqual(await self.inbox.drain(), {'accepted': 1})
        self.assertEqual(self.peer.starts(), [])

    async def test_lost_acceptance_reconciles_from_history_without_replaying(self):
        self.peer.mode = 'lost-accepted'
        self.inbox.enqueue('timeout', self.identity, 'Task complete')
        self.assertEqual(await self.inbox.drain(), {'unknown': 1})
        self.assertEqual(len(self.peer.starts()), 1)
        self.due()
        self.assertEqual(await self.inbox.drain(), {'accepted': 1})
        self.assertEqual(len(self.peer.starts()), 1)

    async def test_empty_history_is_not_proof_an_uncertain_send_can_be_replayed(self):
        self.peer.mode = 'lost-unaccepted'
        self.inbox.enqueue('unknown', self.identity, 'Task complete')
        self.assertEqual(await self.inbox.drain(), {'unknown': 1})
        for _ in range(2):
            self.due()
            self.assertEqual(await self.inbox.drain(), {'unknown': 1})
        self.assertEqual(len(self.peer.starts()), 1)
        self.assertEqual(self.inbox.get('unknown')['status'], 'unknown')

    async def test_rejection_is_retained_and_not_blindly_replayed(self):
        self.peer.mode = 'reject'
        self.inbox.enqueue('rejected', self.identity, 'Task complete')
        self.assertEqual(await self.inbox.drain(), {'failed': 1})
        self.due()
        self.assertEqual(await self.inbox.drain(), {})
        self.assertEqual(len(self.peer.starts()), 1)
        self.assertTrue(self.inbox.get('rejected')['last_error'])
        receipts = self.inbox.receipts(self.identity)
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]['source'], 'workbench-system')
        self.assertIn('Automatic task notification (system)', receipts[0]['items'][0]['text'])

    async def test_scope_conflict_and_missing_session_cannot_redirect_delivery(self):
        self.inbox.enqueue('scope', self.identity, 'Task complete')
        other = ('someone-else', 'default', 'supervisor')
        self.session(other, 'foreign-thread')
        for identity, text in [(other, 'Task complete'), (self.identity, 'Different result')]:
            with self.assertRaises(HTTPException) as raised:
                self.inbox.enqueue('scope', identity, text)
            self.assertEqual(raised.exception.status_code, 409)
        with self.assertRaises(HTTPException) as raised:
            self.inbox.enqueue('missing', ('qa', 'other-profile', 'supervisor'), 'Task complete')
        self.assertEqual(raised.exception.status_code, 404)
        self.inbox.enqueue('foreign', other, 'Own task complete')
        self.assertEqual(await self.inbox.drain(), {'accepted': 2})
        self.assertEqual({p['threadId'] for p in self.peer.starts()}, {'thread', 'foreign-thread'})

    async def test_archived_session_waits_for_restore_and_does_not_pick_another(self):
        self.inbox.enqueue('archived', self.identity, 'Task complete')
        self.bridge.store.update_organization(*self.identity, {'deleted': True})
        self.assertEqual(await self.inbox.drain(), {'unavailable': 1})
        self.assertEqual(self.peer.starts(), [])
        self.bridge.store.update_organization(*self.identity, {'deleted': False})
        self.due()
        self.assertEqual(await self.inbox.drain(), {'accepted': 1})

    async def test_concurrent_drain_and_user_lock_do_not_double_start(self):
        self.inbox.enqueue('concurrent', self.identity, 'Task complete')
        lock = self.bridge._session_locks.setdefault(self.identity, asyncio.Lock())
        async with lock:
            self.assertEqual(await self.inbox.drain(), {'busy': 1})
        await asyncio.gather(self.inbox.drain(), self.inbox.drain())
        self.assertEqual(len(self.peer.starts()), 1)

    async def test_busy_head_cannot_starve_another_session_when_batch_is_full(self):
        self.session(self.identity, 'thread', status='running')
        other = ('qa', 'default', 'other')
        self.session(other, 'other-thread')
        self.inbox.enqueue('busy-first', self.identity, 'First result')
        self.inbox.enqueue('busy-second', self.identity, 'Later result')
        self.inbox.enqueue('ready', other, 'Ready result')
        self.assertEqual(await self.inbox.drain(limit=1), {'busy': 1})
        self.assertEqual(await self.inbox.drain(limit=1), {'accepted': 1})
        self.assertEqual(self.peer.starts()[0]['threadId'], 'other-thread')

    async def test_failure_before_request_persistence_can_retry(self):
        self.inbox.enqueue('retryable', self.identity, 'Task complete')
        submit = self.bridge._submit_once
        async def fail_before_request(*args):
            raise OSError('temporary local failure')
        self.bridge._submit_once = fail_before_request
        self.assertEqual(await self.inbox.drain(), {'pending': 1})
        self.assertEqual(self.inbox.get('retryable')['last_error'], 'OSError')
        self.bridge._submit_once = submit
        self.due()
        self.assertEqual(await self.inbox.drain(), {'accepted': 1})
        self.assertEqual(len(self.peer.starts()), 1)

    async def test_accepted_turn_failure_keeps_a_readable_system_receipt(self):
        self.inbox.enqueue('turn-failure', self.identity, 'Saved worker result')
        await self.inbox.drain()
        turn = self.peer.turns['thread'][-1]
        turn['status'] = 'failed'
        turn['error'] = {'message': 'No model available'}
        self.assertEqual(await self.inbox.drain(), {'failed': 1})
        self.assertEqual(self.inbox.get('turn-failure')['status'], 'failed')
        receipts = self.inbox.receipts(self.identity)
        self.assertIn('Saved worker result', receipts[0]['items'][0]['text'])
        self.assertIn('could not finish', receipts[0]['items'][0]['text'])
        self.assertEqual(await self.inbox.drain(), {})
        self.assertEqual(len(self.peer.starts()), 1)

    async def test_completed_without_assistant_body_is_not_claimed_delivered(self):
        self.inbox.enqueue('empty-answer', self.identity, 'Saved worker result')
        await self.inbox.drain()
        self.peer.turns['thread'][-1]['status'] = 'completed'
        self.assertEqual(await self.inbox.drain(), {'failed': 1})
        self.assertEqual(len(self.inbox.receipts(self.identity)), 1)

    async def test_uncertain_acceptance_has_one_receipt_without_replay(self):
        self.peer.mode = 'lost-unaccepted'
        self.inbox.enqueue('delayed-unknown', self.identity, 'Saved worker result')
        await self.inbox.drain()
        with self.bridge.store.lock:
            self.bridge.store.connection.execute('UPDATE supervisor_inbox SET created_at=created_at-60,next_check_at=0')
            self.bridge.store.connection.commit()
        await self.inbox.drain()
        self.due()
        await self.inbox.drain()
        self.assertEqual(len(self.inbox.receipts(self.identity)), 1)
        self.assertEqual(len(self.peer.starts()), 1)


if __name__ == '__main__':
    unittest.main()
