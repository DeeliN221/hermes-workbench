"""Capacity failures retry the original turn without adding another user message."""
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import CodexBridge, RpcFailure


CAPACITY_ERROR = {
    'message': 'Selected model is at capacity. Please try a different model.',
    'codexErrorInfo': 'serverOverloaded',
}


class CapacityRetryContract(unittest.IsolatedAsyncioTestCase):
    def test_capacity_marker_accepts_native_and_underscored_spellings(self):
        from codex_bridge import _is_capacity_error

        self.assertTrue(_is_capacity_error(CAPACITY_ERROR))
        self.assertTrue(_is_capacity_error({'codexErrorInfo': 'server_overloaded'}))

    async def bridge_with_peer(self, responses):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        bridge = CodexBridge(
            db_path=Path(directory.name) / 'db',
            workspace_map={},
            capacity_retry_delays=(0.01,),
        )
        self.addAsyncCleanup(bridge.close)
        bridge.store.upsert_session('qa', 'default', {
            'session_id': 'session',
            'thread_id': 'thread',
            'workspace_id': 'workspace',
            'workspace_path': directory.name,
            'status': 'idle',
        })
        calls = []

        class Peer:
            async def request(self, method, payload):
                calls.append((method, dict(payload)))
                response = responses.pop(0)
                if isinstance(response, Exception):
                    raise response
                return response

        async def connection(user, profile):
            return Peer()

        bridge._connection = connection
        return bridge, calls

    async def wait_for_request_status(self, bridge, status):
        for _ in range(100):
            request = bridge.store.request('qa', 'default', 'session', 'request')
            if request and request.get('status') == status:
                return request
            await asyncio.sleep(0.01)
        self.fail(f'request did not reach {status}')

    async def test_pre_acceptance_capacity_failure_replays_the_same_user_turn(self):
        bridge, calls = await self.bridge_with_peer([
            RpcFailure(CAPACITY_ERROR),
            {'turn': {'id': 'turn', 'status': 'inProgress'}},
        ])
        pending = await bridge.submit('qa', 'default', 'session', {
            'clientRequestId': 'request',
            'text': 'Implement the requested change',
        })
        self.assertEqual(pending['status'], 'pending')
        self.assertEqual(pending['capacity_retry_count'], 1)

        accepted = await self.wait_for_request_status(bridge, 'accepted')
        self.assertEqual(accepted['turn_id'], 'turn')
        self.assertEqual([method for method, _ in calls], ['turn/start', 'turn/start'])
        self.assertEqual(calls[0][1], calls[1][1])
        self.assertEqual(calls[1][1]['clientUserMessageId'], 'request')
        self.assertEqual(calls[1][1]['input'], [{'type': 'text', 'text': 'Implement the requested change'}])

    async def test_post_acceptance_capacity_failure_retries_from_the_same_turn(self):
        bridge, calls = await self.bridge_with_peer([
            {'turn': {'id': 'retried', 'status': 'inProgress'}},
        ])
        payload = {
            'threadId': 'thread',
            'clientUserMessageId': 'request',
            'input': [{'type': 'text', 'text': 'Keep working on this task'}],
        }
        bridge.store.save_request(
            'qa', 'default', 'session', 'request',
            status='accepted', turn_id='capacity-turn', payload=json.dumps(payload),
        )
        await bridge._notification('qa', 'default', 'epoch', {
            'method': 'turn/completed',
            'params': {
                'threadId': 'thread',
                'turn': {'id': 'capacity-turn', 'status': 'failed', 'error': CAPACITY_ERROR},
            },
        })

        accepted = await self.wait_for_request_status(bridge, 'accepted')
        self.assertEqual(accepted['turn_id'], 'retried')
        self.assertEqual(calls, [('turn/start', payload)])
        self.assertEqual(calls[0][1]['clientUserMessageId'], 'request')

    async def test_immediate_failed_turn_response_is_retried(self):
        bridge, calls = await self.bridge_with_peer([
            {'turn': {'id': 'capacity-turn', 'status': 'failed', 'error': CAPACITY_ERROR}},
            {'turn': {'id': 'retried', 'status': 'inProgress'}},
        ])
        pending = await bridge.submit('qa', 'default', 'session', {
            'clientRequestId': 'request',
            'text': 'Retry this failed turn',
        })
        self.assertEqual(pending['status'], 'pending')

        accepted = await self.wait_for_request_status(bridge, 'accepted')
        self.assertEqual(accepted['turn_id'], 'retried')
        self.assertEqual([method for method, _ in calls], ['turn/start', 'turn/start'])
        self.assertEqual(calls[0][1], calls[1][1])

    async def test_capacity_retry_stops_after_the_bounded_schedule(self):
        bridge, calls = await self.bridge_with_peer([RpcFailure(CAPACITY_ERROR), RpcFailure(CAPACITY_ERROR)])
        pending = await bridge.submit('qa', 'default', 'session', {
            'clientRequestId': 'request',
            'text': 'Try once more',
        })
        self.assertEqual(pending['status'], 'pending')
        failed = await self.wait_for_request_status(bridge, 'failed')
        self.assertEqual(failed['capacity_retry_count'], 1)
        self.assertEqual(len(calls), 2)


if __name__ == '__main__':
    unittest.main()
