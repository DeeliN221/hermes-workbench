"""Question answers retain identity, survive reload, and reach the RPC peer once."""
import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import CodexBridge, UnknownAcceptance, create_router
from fastapi import FastAPI
from fastapi.testclient import TestClient


class UserInputContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.bridge = CodexBridge(db_path=root / 'db', workspace_root=root, workspace_map={})
        self.bridge.store.upsert_session('qa', 'writer', {'session_id': 'session', 'thread_id': 'thread', 'workspace_path': str(root), 'workspace_id': 'main', 'status': 'running'})
        self.responses = []
        self.fail = False
        owner = self
        class Peer:
            epoch = 'current'
            async def respond(self, request_id, result):
                owner.responses.append((request_id, result))
                if owner.fail: raise UnknownAcceptance('disconnected after write')
        async def connection(*args): return Peer()
        self.bridge._connection = connection
        app = FastAPI()
        app.include_router(create_router(self.bridge), prefix='/codex')
        self.client = TestClient(app)
        self.questions = [
            {'id': 'online', 'header': '设备', 'question': '示例设备能上线吗？', 'isOther': True, 'options': [{'label': '现在上线', 'description': '继续核验'}, {'label': '暂时不能', 'description': '保留待办'}]},
            {'id': 'time', 'header': '时间', 'question': '什么时候方便？', 'options': None},
        ]
        self.message = {'id': 42, 'method': 'item/tool/requestUserInput', 'params': {'threadId': 'thread', 'turnId': 'turn', 'itemId': 'tool', 'questions': self.questions}}
        asyncio.run(self.bridge._notification('qa', 'writer', 'current', self.message))
        self.url = '/codex/session/approval?profile=writer&session_id=session'
        self.body = {'approvalId': 'current:42', 'answers': {'online': {'answers': ['暂时不能']}, 'time': {'answers': ['明天下午']}}}

    def tearDown(self):
        self.client.close()
        self.bridge.store.close()
        self.temp.cleanup()

    def post(self, body=None, url=None, user='qa'):
        return self.client.post(url or self.url, headers={'remote-user': user}, json=body if body is not None else self.body)

    def test_roundtrip_and_reload_recovery(self):
        pending = self.bridge.store.pending_approvals('qa', 'writer', 'session')
        self.assertEqual(pending[0]['params']['questions'], self.questions)
        self.assertEqual(pending[0]['params']['approvalId'], 'current:42')
        self.assertEqual(self.post().json()['status'], 'accepted')
        self.assertEqual(self.responses, [(42, {'answers': self.body['answers']})])
        self.assertEqual(self.bridge.store.pending_approvals('qa', 'writer', 'session'), [])
        self.assertEqual(self.post().status_code, 404)
        self.assertEqual(len(self.responses), 1)

    def test_free_text_and_question_identity_validation(self):
        self.assertEqual(self.post({'approvalId': 'current:42', 'answers': {'wrong': {'answers': ['x']}}}).status_code, 400)
        self.body['answers']['online']['answers'] = ['设备明天才能上线']
        self.assertEqual(self.post().status_code, 200)

    def test_scope_expiration_and_unknown_delivery(self):
        self.assertEqual(self.post(user='other').status_code, 404)
        self.assertEqual(self.post(url=self.url.replace('writer', 'default')).status_code, 404)
        self.assertEqual(self.responses, [])
        self.fail = True
        self.assertEqual(self.post().json()['status'], 'unknown')
        self.assertEqual(self.post().status_code, 409)
        self.assertEqual(len(self.responses), 1)

    def test_resolved_request_is_removed(self):
        asyncio.run(self.bridge._notification('qa', 'writer', 'current', {'method': 'serverRequest/resolved', 'params': {'threadId': 'thread', 'requestId': 42}}))
        self.assertEqual(self.post().status_code, 404)
        self.assertEqual(self.responses, [])

    def test_expired_connection_rejected(self):
        self.bridge.store.connection.execute("UPDATE codex_approvals SET epoch='old'")
        self.bridge.store.connection.commit()
        self.assertEqual(self.post().status_code, 409)
        self.assertEqual(self.responses, [])

    def test_approval_protocol_unchanged(self):
        self.message['method'] = 'item/commandExecution/requestApproval'
        self.bridge.store.save_approval('qa', 'writer', 'session', 'current:42', self.message['method'], self.message, 'current')
        self.assertEqual(self.post({'approvalId': 'current:42', 'decision': 'accept'}).status_code, 200)
        self.assertEqual(self.responses, [(42, {'decision': 'accept'})])
