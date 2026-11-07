"""The real ASGI lifespan delivers callbacks without browser polling or input."""
import asyncio
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi.testclient import TestClient
from codex_integration import IntegratedCodexBridge
with patch.dict(os.environ, {'CODEX_APP_SERVER_ENDPOINT': ''}):
    from sidecar_app import create_app
from supervisor_fleet import FleetSupervisor
from supervisor_inbox import SupervisorInbox
from test_supervisor_fleet import FleetPeer
from test_supervisor_inbox import RuntimePeer


class ObservedFleet(FleetPeer):
    def __init__(self):
        super().__init__()
        self.initialized = threading.Event()

    def get(self, path):
        result = super().get(path)
        if path == 'events/head':
            self.initialized.set()
        return result


class AutomaticRuntime(RuntimePeer):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()

    async def send(self, message):
        await super().send(message)
        if message['method'] == 'turn/start':
            if self.mode == 'accept':
                await self.finish(message['params']['threadId'], 'The report is ready; all checks passed.')
            self.started.set()


class DisabledNative:
    """Never inspect a developer's local native database in lifecycle tests."""
    def __init__(self, bridge, inbox):
        self.calls = 0

    async def poll(self):
        self.calls += 1


class StalledNative(DisabledNative):
    def __init__(self, bridge, inbox):
        super().__init__(bridge, inbox)
        self.entered = threading.Event()
        self.cancelled = threading.Event()

    async def poll(self):
        self.entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise


class SupervisorRuntimeContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='supervisor-runtime-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime, self.fleet = AutomaticRuntime(), ObservedFleet()
        self.environment = patch.dict(os.environ, {
            'CODEX_APP_SERVER_ENDPOINT': '',
            'CODEX_HOME': str(self.root / 'empty-native-home'),
            'HERMES_HOME': str(self.root),
            'FLEET_TOKEN': 'fixture-token',
            'FLEET_TOKEN_FILE': str(self.root / 'no-token'),
            'HERMES_WORKBENCH_REVIEW_ENABLED': '0',
            'HERMES_DASHBOARD_TRUSTED_PROXY_SECRET': 'test-proxy-secret',
            'HERMES_WORKBENCH_ALLOWED_USERS': 'qa',
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.bridge = IntegratedCodexBridge(db_path=self.root / 'bridge.db',
            workspace_map={}, transport_factory=lambda _: self.runtime, request_timeout=1)
        self.bridge.configure_reviews(None)
        self.identity = ('qa', 'default', 'supervisor')
        self.bridge.store.upsert_session('qa', 'default', {
            'session_id': 'supervisor', 'thread_id': 'thread', 'workspace_id': 'workspace',
            'workspace_path': str(self.root), 'status': 'completed',
        })
        self.headers = {'X-Hermes-Proxy-Secret': 'test-proxy-secret', 'Remote-User': 'qa'}
        self.fleet_patch = patch('supervisor_fleet.FleetSupervisor',
            side_effect=lambda bridge, inbox: FleetSupervisor(bridge, inbox, self.fleet))
        self.fleet_patch.start()
        self.addCleanup(self.fleet_patch.stop)

    def wait_for(self, predicate, *, timeout=13):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(.02)
        self.fail('Background lifecycle did not reach the expected state')

    def test_lifespan_consumes_later_fleet_completion_before_any_browser_connects(self):
        with patch('supervisor_native.NativeSupervisor', DisabledNative):
            with TestClient(create_app(self.root, codex_service=self.bridge)) as client:
                self.assertTrue(self.fleet.initialized.wait(2))
                self.assertEqual(self.runtime.starts(), [])
                # Only the external worker finishes. No request, browser,
                # poll(), or drain() call wakes the supervisor in this test.
                self.fleet.complete()
                self.assertTrue(self.runtime.started.wait(13))
                self.wait_for(lambda: self.bridge.store.session(*self.identity)['status'] == 'completed')
                self.assertEqual(len(self.runtime.starts()), 1)
                self.assertEqual(self.runtime.starts()[0]['threadId'], 'thread')
                self.assertIn('The report passed all checks.', self.runtime.starts()[0]['input'][0]['text'])
                with client.websocket_connect(
                    '/api/plugins/workbench/codex/events?profile=default&session_id=supervisor',
                    headers=self.headers,
                ) as socket:
                    snapshot = socket.receive_json()
                    self.assertEqual(snapshot['type'], 'snapshot')
                    self.assertEqual(snapshot['turns'][-1]['items'][-1]['text'],
                                     'The report is ready; all checks passed.')
                self.assertEqual(len(self.bridge.supervisor_tasks), 3)
                tasks = list(self.bridge.supervisor_tasks)
            self.assertTrue(all(task.done() for task in tasks))

    def test_startup_recovers_persisted_inbox_while_native_loop_is_stalled_and_close_cancels(self):
        SupervisorInbox(self.bridge).enqueue('saved-before-shutdown', self.identity, 'A delegated task completed.')
        with patch('supervisor_native.NativeSupervisor', StalledNative):
            with TestClient(create_app(self.root, codex_service=self.bridge)):
                self.assertTrue(self.bridge.supervisor_native.entered.wait(2))
                self.assertTrue(self.runtime.started.wait(2))
                self.assertEqual(len(self.runtime.starts()), 1)
                self.wait_for(lambda: self.bridge.supervisor_inbox.get('saved-before-shutdown')['status'] in {'accepted', 'delivered'})
                tasks = list(self.bridge.supervisor_tasks)
                native = self.bridge.supervisor_native
            self.assertTrue(native.cancelled.is_set())
            self.assertTrue(all(task.done() for task in tasks))

    def test_busy_original_conversation_waits_for_completion_without_user_send(self):
        self.bridge.store.upsert_session('qa', 'default', {
            'session_id': 'supervisor', 'thread_id': 'thread', 'workspace_id': 'workspace',
            'workspace_path': str(self.root), 'status': 'running',
        })
        SupervisorInbox(self.bridge).enqueue('queued-result', self.identity, 'Task result ready')
        with patch('supervisor_native.NativeSupervisor', DisabledNative):
            with TestClient(create_app(self.root, codex_service=self.bridge)) as client:
                self.assertTrue(self.fleet.initialized.wait(2))
                self.assertFalse(self.runtime.started.wait(.1))
                # The user's existing turn completes; no new user input is sent.
                async def complete_existing_turn():
                    await self.bridge._notification('qa', 'default', 'test-epoch', {
                        'method': 'turn/completed', 'params': {'threadId': 'thread',
                            'turn': {'id': 'previous-turn', 'status': 'completed'}},
                    })
                client.portal.call(complete_existing_turn)
                self.assertTrue(self.runtime.started.wait(7))
                self.assertEqual(len(self.runtime.starts()), 1)
                self.assertEqual(self.runtime.starts()[0]['threadId'], 'thread')

    def test_rejected_wakeup_keeps_one_system_receipt_in_reopened_websocket_snapshot(self):
        self.runtime.mode = 'reject'
        SupervisorInbox(self.bridge).enqueue('rejected-wakeup', self.identity, 'Saved worker result ready')
        with patch('supervisor_native.NativeSupervisor', DisabledNative):
            with TestClient(create_app(self.root, codex_service=self.bridge)) as client:
                self.wait_for(lambda: self.bridge.supervisor_inbox.get('rejected-wakeup')['status'] == 'failed')
                for _ in range(2):
                    with client.websocket_connect(
                        '/api/plugins/workbench/codex/events?profile=default&session_id=supervisor',
                        headers=self.headers,
                    ) as socket:
                        snapshot = socket.receive_json()
                        notices = [turn for turn in snapshot['turns'] if turn.get('source') == 'workbench-system']
                        self.assertEqual(len(notices), 1)
                        self.assertIn('Automatic task notification (system)', notices[0]['items'][0]['text'])
                        self.assertIn('Saved worker result ready', notices[0]['items'][0]['text'])
                self.assertEqual(len(self.runtime.starts()), 1)


if __name__ == '__main__':
    unittest.main()
