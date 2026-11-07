"""Native child discovery is bounded, scoped, restartable and does not re-report."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import CodexBridge
from supervisor_native import NativeSupervisor


class Inbox:
    def __init__(self):
        self.rows = {}

    def enqueue(self, key, identity, text):
        value = (identity, text)
        if key in self.rows and self.rows[key] != value:
            raise ValueError('changed idempotency payload')
        self.rows[key] = value


class NativeSupervisorContract(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.native = self.root / 'state_5.sqlite'
        with closing(sqlite3.connect(self.native)) as db, db:
            db.executescript('''CREATE TABLE threads(id TEXT PRIMARY KEY, created_at_ms INTEGER,
                updated_at_ms INTEGER, source TEXT); CREATE INDEX idx_created ON threads(created_at_ms DESC,id DESC);''')
        self.bridge = CodexBridge(db_path=self.root / 'bridge.sqlite', workspace_map={})
        self.bridge.store.upsert_session('owner', 'work', {
            'session_id': 'supervisor', 'thread_id': 'parent', 'workspace_id': 'w',
            'workspace_path': str(self.root), 'status': 'completed',
        })
        self.inbox = Inbox()
        self.turns = {'parent': self.turn('parent-turn', 10), 'child': self.turn('child-turn', 20, text='Result ready')}
        self.calls = []
        owner = self

        class Peer:
            async def request(self, method, params):
                owner.calls.append((method, params))
                owner.assertEqual(method, 'thread/turns/list')
                owner.assertEqual(params['limit'], 1)
                owner.assertEqual(params['sortDirection'], 'desc')
                return {'data': [owner.turns[params['threadId']]]}

        async def connection(user, profile):
            self.assertEqual((user, profile), ('owner', 'work'))
            return Peer()
        self.bridge._connection = connection
        self.monitor = NativeSupervisor(self.bridge, self.inbox, self.native)
        await self.monitor.poll()  # Explicit first-activation watermark.

    async def asyncTearDown(self):
        await self.bridge.close()
        self.temp.cleanup()

    def turn(self, identifier, end=None, status='completed', text=''):
        return {'id': identifier, 'status': status, 'completedAt': end,
                'items': [{'id': 'answer', 'type': 'agentMessage', 'text': text}]}

    def add(self, identifier='child', parent='parent', created=100, updated=None):
        with closing(sqlite3.connect(self.native)) as db, db:
            db.execute('INSERT INTO threads VALUES(?,?,?,?)', (identifier, created, updated or created,
                json.dumps({'subagent': {'thread_spawn': {'parent_thread_id': parent}}})))

    def state(self, identifier='child'):
        return dict(self.bridge.store.connection.execute('SELECT * FROM supervisor_native_children WHERE child_id=?', (identifier,)).fetchone())

    async def test_idle_parent_receives_one_queued_result_and_restarts_do_not_duplicate(self):
        self.add()
        self.assertEqual(await self.monitor.poll(), 1)
        self.assertEqual(len(self.inbox.rows), 1)
        identity, text = next(iter(self.inbox.rows.values()))
        self.assertEqual(identity, ('owner', 'work', 'supervisor'))
        self.assertIn('Result ready', text)
        self.assertEqual(self.state()['state'], 'queued')
        call_count = len(self.calls)
        self.assertEqual(await self.monitor.poll(), 0)
        restarted = NativeSupervisor(self.bridge, self.inbox, self.native)
        self.assertEqual(await restarted.poll(), 0)
        self.assertEqual(len(self.calls), call_count)
        self.assertEqual(len(self.inbox.rows), 1)

    async def test_child_finished_inside_active_parent_turn_is_not_reported_again(self):
        self.add()
        self.turns['parent'] = self.turn('active', None, 'inProgress')
        self.assertEqual(await self.monitor.poll(), 0)
        self.assertEqual(self.state()['state'], 'pending')
        self.turns['parent'] = self.turn('active', 30)
        self.turns['parent']['items'] = [{'type': 'collabAgentToolCall', 'status': 'completed', 'tool': 'wait',
            'agentsStates': {'child': {'status': 'completed', 'message': 'Result ready'}}}]
        self.assertEqual(await self.monitor.poll(), 0)
        self.assertEqual(self.state()['state'], 'handled')
        self.assertEqual(self.inbox.rows, {})

    async def test_restart_during_child_work_preserves_enrollment(self):
        self.add()
        self.turns['child'] = self.turn('child-turn', None, 'inProgress')
        await self.monitor.poll()
        restarted = NativeSupervisor(self.bridge, self.inbox, self.native)
        self.turns['child'] = self.turn('child-turn', 20, text='Finished while offline')
        self.assertEqual(await restarted.poll(), 1)
        self.assertIn('Finished while offline', next(iter(self.inbox.rows.values()))[1])

    async def test_first_activation_does_not_replay_historical_children(self):
        other_path = self.root / 'old.sqlite'
        with closing(sqlite3.connect(other_path)) as db, db:
            db.executescript('''CREATE TABLE threads(id TEXT PRIMARY KEY,created_at_ms INTEGER,updated_at_ms INTEGER,source TEXT);
                CREATE INDEX idx_created ON threads(created_at_ms DESC,id DESC);''')
            db.execute('INSERT INTO threads VALUES(?,?,?,?)', ('historical', 500, 500,
                json.dumps({'subagent': {'thread_spawn': {'parent_thread_id': 'parent'}}})))
        monitor = NativeSupervisor(self.bridge, self.inbox, other_path)
        self.assertEqual(await monitor.poll(), 0)
        self.assertEqual(self.bridge.store.connection.execute('SELECT count(*) FROM supervisor_native_children WHERE path=?', (str(other_path),)).fetchone()[0], 0)

    async def test_unknown_or_ambiguous_owner_cannot_receive_result(self):
        self.add('foreign', parent='unmapped')
        self.add('child', created=200)
        self.bridge.store.upsert_session('other', 'work', {
            'session_id': 'duplicate', 'thread_id': 'parent', 'workspace_id': 'w',
            'workspace_path': str(self.root), 'status': 'completed',
        })
        self.assertEqual(await self.monitor.poll(), 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.inbox.rows, {})

    async def test_missing_or_equal_timestamps_do_not_lose_results(self):
        self.add()
        self.turns['child']['completedAt'] = None
        self.assertEqual(await self.monitor.poll(), 1)
        self.assertEqual(self.state()['state'], 'queued')
        self.add('same-second', created=200)
        self.turns['same-second'] = self.turn('same-turn', 10, text='same second result')
        self.assertEqual(await self.monitor.poll(), 1)
        self.assertEqual(len(self.inbox.rows), 2)

    async def test_deleted_parent_does_not_receive_result(self):
        self.add()
        self.bridge.store.update_organization('owner', 'work', 'supervisor', {'deleted': True})
        await self.monitor.poll()
        self.assertEqual(self.state()['state'], 'unavailable')
        self.assertEqual(self.inbox.rows, {})

    async def test_later_unrelated_parent_turn_does_not_discard_result(self):
        self.add()
        self.turns['parent'] = self.turn('unrelated', 30, text='An unrelated answer')
        self.assertEqual(await self.monitor.poll(), 1)
        self.assertEqual(self.state()['state'], 'queued')

    async def test_stale_wait_message_is_not_proof_of_handling_new_result(self):
        self.add()
        self.turns['parent'] = self.turn('later', 30)
        self.turns['parent']['items'] = [{'type': 'collabAgentToolCall', 'status': 'completed', 'tool': 'wait',
            'agentsStates': {'child': {'status': 'completed', 'message': 'Old result'}}}]
        self.assertEqual(await self.monitor.poll(), 1)

    async def test_failed_enqueue_retries_without_losing_child_result(self):
        self.add()
        original = self.inbox.enqueue
        def failed(*args):
            raise OSError('disk temporarily unavailable')
        self.inbox.enqueue = failed
        self.assertEqual(await self.monitor.poll(), 0)
        self.assertEqual(self.state()['state'], 'unknown')
        self.inbox.enqueue = original
        self.assertEqual(await self.monitor.poll(), 1)

    async def test_followup_turn_on_same_child_is_seen_after_native_update(self):
        self.add()
        await self.monitor.poll()
        self.turns['child'] = self.turn('followup', 40, text='Followup ready')
        self.turns['parent'] = self.turn('supervisor-second', 30)
        with closing(sqlite3.connect(self.native)) as db, db:
            db.execute('UPDATE threads SET updated_at_ms=200 WHERE id=?', ('child',))
        self.assertEqual(await self.monitor.poll(), 0)  # Terminal rows back off for 60 seconds.
        self.bridge.store.connection.execute('UPDATE supervisor_native_children SET next_check=0')
        self.bridge.store.connection.commit()
        self.assertEqual(await self.monitor.poll(), 1)
        self.assertEqual(len(self.inbox.rows), 2)

    async def test_batch_limit_round_robins_and_excludes_remote_runtime(self):
        for index in range(20):
            identifier = 'child-' + str(index)
            self.add(identifier, created=100 + index)
            self.turns[identifier] = self.turn(identifier + '-turn', 20, text='done')
        self.assertEqual(await self.monitor.poll(limit=1000), 16)
        self.assertEqual(await self.monitor.poll(), 4)
        self.assertEqual(len(self.inbox.rows), 20)
        with patch.dict('os.environ', {'CODEX_HOME': str(self.root)}):
            self.bridge.endpoint = 'wss://remote.example/runtime'
            self.assertFalse(NativeSupervisor(self.bridge, self.inbox).enabled)


if __name__ == '__main__':
    unittest.main()
