"""Fleet completion reaches its idle supervisor without a browser or user turn."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from codex_bridge import CodexBridge
from supervisor_inbox import SupervisorInbox
from supervisor_fleet import FleetSupervisor
from test_supervisor_inbox import RuntimePeer


class FleetPeer:
    def __init__(self):
        self.events = []
        self.details = {}
        self.fail = False

    def get(self, path):
        if self.fail:
            raise OSError('offline')
        if path == 'events/head':
            return {'id': max((e['id'] for e in self.events), default=0)}
        if path.startswith('events?'):
            after = int(path.split('after=')[1].split('&')[0])
            return {'events': [e for e in self.events if e['id'] > after]}
        return self.details[path.split('/')[-1]]

    def complete(self, task='T-one', thread='thread', *, origin=None):
        number = max((e['id'] for e in self.events), default=0) + 1
        self.events.append({'id': number, 'task_id': task, 'type': 'task.completed'})
        self.details[task] = {'task': {'id': task, 'title': 'Build report', 'status': 'done',
            'spec_json': json.dumps({'source_thread_id': thread, 'source_runtime': 'codex'})},
            'attempts': [{'result': 'The report passed all checks.'}]}
        if origin:
            self.details[task]['task']['origin'] = origin


class FleetCallbackContract(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.peer, self.fleet = RuntimePeer(), FleetPeer()
        self.open_bridge()
        self.identity = ('qa', 'default', 'supervisor')
        self.bridge.store.upsert_session('qa', 'default', dict(session_id='supervisor',
            thread_id='thread', workspace_id='workspace', workspace_path=self.temp.name, status='completed'))

    def open_bridge(self):
        self.bridge = CodexBridge(db_path=Path(self.temp.name) / 'bridge.db', workspace_map={},
                                  transport_factory=lambda _: self.peer, request_timeout=.1)
        self.inbox = SupervisorInbox(self.bridge)
        self.consumer = FleetSupervisor(self.bridge, self.inbox, self.fleet)

    async def asyncTearDown(self):
        await self.bridge.close()
        self.temp.cleanup()

    async def test_completion_returns_to_original_idle_conversation(self):
        await self.consumer.poll()
        self.fleet.complete()
        self.assertEqual(await self.consumer.poll(), 1)
        self.assertEqual(await self.inbox.drain(), {'accepted': 1})
        self.assertEqual(self.peer.starts()[0]['threadId'], 'thread')
        self.assertIn('The report passed all checks.', self.peer.starts()[0]['input'][0]['text'])
        await self.peer.finish('thread', 'The report is ready; all checks passed.')
        history = await self.bridge.history(*self.identity, 0, 100)
        self.assertEqual(history['turns'][0]['items'][-1]['text'], 'The report is ready; all checks passed.')
        self.assertEqual(await self.consumer.poll(), 0)
        self.assertEqual(await self.inbox.drain(), {'delivered': 1})
        self.assertEqual(await self.inbox.drain(), {})
        self.assertEqual(len(self.peer.starts()), 1)

    async def test_restart_replays_offline_events_but_not_preinstall_history(self):
        self.fleet.complete('old')
        self.assertEqual(await self.consumer.poll(), 0)
        await self.bridge.close()
        self.fleet.complete('during-downtime')
        self.open_bridge()
        self.assertEqual(await self.consumer.poll(), 1)
        self.assertIsNone(self.inbox.get('fleet-event:1'))
        self.assertIsNotNone(self.inbox.get('fleet-event:2'))

    async def test_snapshot_is_not_rewritten_after_enqueue_cursor_crash(self):
        await self.consumer.poll()
        self.fleet.complete()
        original = self.consumer._advance
        self.consumer._advance = lambda _: (_ for _ in ()).throw(OSError('disk full'))
        with self.assertRaises(OSError):
            await self.consumer.poll()
        self.fleet.details['T-one']['attempts'][0]['result'] = 'Later different result'
        self.consumer._advance = original
        await self.consumer.poll()
        self.assertIn('The report passed all checks.', self.inbox.get('fleet-event:1')['text'])
        await self.inbox.drain()
        self.assertEqual(len(self.peer.starts()), 1)

    async def test_wrong_or_ambiguous_identity_never_falls_back(self):
        await self.consumer.poll()
        self.fleet.complete('foreign', origin={'runtime': 'codex', 'user_id': 'other',
            'profile_id': 'default', 'session_id': 'supervisor', 'project_id': 'workspace'})
        self.fleet.complete('dsh', origin={'runtime': 'dsh'})
        self.fleet.complete('unmapped', thread='other-thread')
        self.bridge.store.upsert_session('other', 'default', dict(session_id='other', thread_id='thread',
            workspace_id='workspace', workspace_path=self.temp.name, status='idle'))
        self.fleet.complete('ambiguous')
        self.assertEqual(await self.consumer.poll(), 0)
        self.assertEqual(await self.inbox.drain(), {})
        self.assertEqual(self.peer.starts(), [])

    async def test_legacy_unbound_and_manual_success_do_not_wake(self):
        await self.consumer.poll()
        self.fleet.complete('legacy')
        self.fleet.details['legacy']['task']['spec_json'] = '{}'
        self.fleet.complete('manual')
        self.fleet.details['manual']['task'].update(machine='main', capability='subagent')
        self.assertEqual(await self.consumer.poll(), 0)

    async def test_network_failure_does_not_advance_cursor(self):
        await self.consumer.poll()
        self.fleet.complete()
        self.fleet.fail = True
        with self.assertRaises(OSError):
            await self.consumer.poll()
        self.assertEqual(self.consumer._cursor(), 0)
        self.fleet.fail = False
        self.assertEqual(await self.consumer.poll(), 1)


if __name__ == '__main__':
    unittest.main()
