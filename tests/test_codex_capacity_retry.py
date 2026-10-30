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

    async def bridge_with_peer(self, responses, fallback_models=(), catalog=None):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        bridge = CodexBridge(
            db_path=Path(directory.name) / 'db',
            workspace_map={},
            capacity_retry_delays=(0.01,),
            fallback_models=fallback_models,
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
        catalog = catalog if catalog is not None else {'data': {'models': []}}

        class Peer:
            async def request(self, method, payload):
                if method == 'model/list':
                    return catalog
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

    async def test_retry_switches_to_the_configured_backup_model(self):
        bridge, calls = await self.bridge_with_peer(
            [RpcFailure(CAPACITY_ERROR), {'turn': {'id': 'backup-turn', 'status': 'inProgress'}}],
            fallback_models=('backup-model',),
        )
        pending = await bridge.submit('qa', 'default', 'session', {
            'clientRequestId': 'request',
            'text': 'Keep the session responsive',
            'model': 'primary-model',
        })
        self.assertEqual(pending['status'], 'pending')

        accepted = await self.wait_for_request_status(bridge, 'accepted')
        self.assertEqual(accepted['turn_id'], 'backup-turn')
        self.assertEqual(calls[0][1]['model'], 'primary-model')
        self.assertEqual(calls[1][1]['model'], 'backup-model')
        self.assertEqual(calls[1][1]['input'], [{'type': 'text', 'text': 'Keep the session responsive'}])

        events = bridge.store.events('qa', 'default', 'session', 0)
        fallback_events = [event for event in events if event['method'] == 'workbench/modelFallback']
        self.assertEqual(len(fallback_events), 1)
        params = fallback_events[0]['payload']['params']
        self.assertEqual(params['fromModel'], 'primary-model')
        self.assertEqual(params['toModel'], 'backup-model')
        self.assertEqual(params['attempt'], 1)
        self.assertEqual(params['turnId'], 'backup-turn')

    async def test_retry_discovers_a_backup_model_from_the_catalog(self):
        bridge, calls = await self.bridge_with_peer(
            [RpcFailure(CAPACITY_ERROR), {'turn': {'id': 'catalog-turn', 'status': 'inProgress'}}],
            catalog={'data': {'models': [
                {'model': 'primary-model'},
                {'model': 'hidden-model', 'hidden': True},
                {'id': 'catalog-backup'},
            ]}},
        )
        await bridge.submit('qa', 'default', 'session', {
            'clientRequestId': 'request',
            'text': 'Switch away from the overloaded model',
            'model': 'primary-model',
        })

        accepted = await self.wait_for_request_status(bridge, 'accepted')
        self.assertEqual(accepted['turn_id'], 'catalog-turn')
        self.assertEqual([method for method, _ in calls], ['turn/start', 'turn/start'])
        self.assertEqual(calls[1][1]['model'], 'catalog-backup')
        events = bridge.store.events('qa', 'default', 'session', 0)
        params = [event for event in events if event['method'] == 'workbench/modelFallback'][0]['payload']['params']
        self.assertEqual((params['fromModel'], params['toModel']), ('primary-model', 'catalog-backup'))

    async def test_a_steer_request_never_changes_its_model(self):
        bridge, calls = await self.bridge_with_peer(
            [{'turn': {'id': 'steered', 'status': 'inProgress'}}],
            fallback_models=('backup-model',),
        )
        payload = {
            'threadId': 'thread',
            'clientUserMessageId': 'request',
            'expectedTurnId': 'active-turn',
            'model': 'primary-model',
            'input': [{'type': 'text', 'text': 'Add context'}],
        }
        bridge.store.save_request(
            'qa', 'default', 'session', 'request',
            status='pending', payload=json.dumps(payload), capacity_retry_count=1,
        )
        await bridge._run_capacity_retry('qa', 'default', 'session', 'request', 1)

        self.assertEqual(calls, [('turn/steer', payload)])
        self.assertEqual(bridge.store.events('qa', 'default', 'session', 0), [])


if __name__ == '__main__':
    unittest.main()
