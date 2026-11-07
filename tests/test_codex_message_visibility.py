"""Attachment hints survive agent delivery but never become display messages."""
import asyncio
import io
import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard'))
from codex_bridge import CodexBridge, RpcFailure, UnknownAcceptance
from codex_attachments import AttachmentStore, create_router
from codex_message_visibility import MessageProjection, wire_payload, split_payload

PNG = bytes.fromhex('89504e470d0a1a0a') + b'image-data'

class Upload:
    def __init__(self, name, content):
        self.filename, self.file, self.content_type = name, io.BytesIO(content), 'application/octet-stream'

class Peer:
    epoch = 'test'
    def __init__(self):
        self.calls, self.turns = [], []
        self.error = None
    async def request(self, method, payload):
        if method in {'turn/start', 'turn/steer'}:
            self.calls.append((method, payload))
            if self.error:
                raise self.error
            # Simulate Codex joining blocks and omitting clientId after reload.
            text = '\n\n'.join(part['text'] for part in payload['input'])
            turn = {'id': f'turn-{len(self.calls)}', 'status': 'completed', 'itemsView': 'full', 'items': [
                {'id': f'user-{len(self.calls)}', 'type': 'userMessage', 'content': [{'type': 'text', 'text': text}]},
                {'id': 'answer', 'type': 'agentMessage', 'text': 'Ready.'},
            ]}
            self.turns.append(turn)
            return {'turn': turn, 'turnId': turn['id']}
        if method == 'thread/read':
            return {'thread': {'turns': self.turns}}
        if method == 'thread/search':
            return {'data': [{'thread': {'id': 'thread'}, 'snippet': 'private path fragment'}]}
        return {}
    async def drain_notifications(self):
        pass

@pytest.mark.parametrize('kinds', [('image',), ('file',), ('folder',), ('image', 'file', 'folder')])
@pytest.mark.parametrize('steer', [False, True])
def test_agent_display_history_search_and_retries(tmp_path, kinds, steer):
    async def run():
        bridge = CodexBridge(db_path=tmp_path / 'db', workspace_map={})
        bridge.store.upsert_session('qa', 'default', dict(session_id='session', thread_id='thread', workspace_id='w', workspace_path=str(tmp_path)))
        peer = Peer()
        async def connection(*_):
            return peer
        bridge._connection = connection
        try:
            ids = []
            for kind in kinds:
                if kind == 'folder':
                    attachment = await bridge.attachments.save_folder(tmp_path, 'qa', 'default', 'session', 'project', [('sub/a.txt', Upload('a.txt', b'alpha'))])
                else:
                    attachment = await bridge.attachments.save_upload(tmp_path, 'qa', 'default', 'session', Upload('image.png' if kind == 'image' else 'notes.txt', PNG if kind == 'image' else b'notes'))
                ids.append(attachment['id'])
            text = '  Please inspect these attachments.\nKeep my spacing.  '
            values = {'clientRequestId': 'request', 'text': text, 'attachmentIds': ids}
            if steer:
                values['expectedTurnId'] = 'active'
            public = await bridge.submit('qa', 'default', 'session', values)
            assert '.workbench-attachments' not in json.dumps(public)
            assert peer.calls[0][0] == ('turn/steer' if steer else 'turn/start')
            stored = bridge.store.request('qa', 'default', 'session', 'request')
            private = json.loads(stored['payload'])
            assert private['input'] == [{'type': 'text', 'text': text}]
            assert private['_attachmentContext']['hidden'] is True
            assert len(private['_attachmentContext']['content']) == len(kinds)
            for block in peer.calls[0][1]['input'][1:1 + len(kinds)]:
                path = Path(next(line[6:] for line in block['text'].splitlines() if line.startswith('Path: ')))
                assert path.exists()
                assert path.is_dir() or path.read_bytes() in (PNG, b'notes')
            assert await bridge.submit('qa', 'default', 'session', values) == public
            assert len(peer.calls) == 1
            snapshot = await bridge.history('qa', 'default', 'session', 0, 100)
            assert '.workbench-attachments' not in json.dumps(snapshot)
            user = snapshot['turns'][0]['items'][0]
            assert user['content'] == private['input']
            assert len(user['attachments']) == len(kinds)
            preview = await bridge.history_preview('qa', 'default', 'session')
            assert preview['turns'][0]['items'][0]['content'] == private['input']
            assert '.workbench-attachments' not in json.dumps(preview)
            # Live event publication also projects before reaching subscribers.
            queue = asyncio.Queue()
            bridge._subscribers[('qa', 'default', 'session')] = {queue}
            native = peer.turns[0]['items'][0]
            await bridge._notification('qa', 'default', 'test', {'method': 'item/completed', 'params': {'threadId': 'thread', 'turnId': 'turn-1', 'item': native}})
            assert '.workbench-attachments' not in json.dumps(await queue.get())
            assert (await bridge.search_sessions('qa', 'default', '.workbench-attachments'))['results'] == []
            results = (await bridge.search_sessions('qa', 'default', 'Keep my spacing'))['results']
            assert len(results) == 1 and results[0]['snippet'] == text
            # Reopen the database to prove there is no in-memory-only mapping.
            await bridge.close()
            bridge = CodexBridge(db_path=tmp_path / 'db', workspace_map={})
            restored = await bridge.history_preview('qa', 'default', 'session')
            assert restored['turns'][0]['items'][0]['content'] == private['input']
        finally:
            await bridge.close()
    asyncio.run(run())

@pytest.mark.parametrize('error', [RpcFailure({'message': 'rejected'}), UnknownAcceptance('timeout')])
def test_failed_and_uncertain_requests_keep_private_context_for_recovery(tmp_path, error):
    async def run():
        bridge = CodexBridge(db_path=tmp_path / 'db', workspace_map={})
        bridge.store.upsert_session('qa', 'default', dict(session_id='session', thread_id='thread', workspace_id='w', workspace_path=str(tmp_path)))
        peer = Peer()
        peer.error = error
        async def connection(*_): return peer
        bridge._connection = connection
        try:
            attachment = await bridge.attachments.save_upload(tmp_path, 'qa', 'default', 'session', Upload('notes.txt', b'notes'))
            values = {'clientRequestId': 'request', 'text': '', 'attachmentIds': [attachment['id']]}
            public = await bridge.submit('qa', 'default', 'session', values)
            assert '.workbench-attachments' not in json.dumps(public)
            pending = bridge.store.public_messages('qa', 'default', 'session', bridge.store.pending_requests('qa', 'default', 'session'))
            assert pending[0]['payload']['input'] == [{'type': 'text', 'text': ''}]
            assert pending[0]['payload']['attachments'][0]['name'] == 'notes.txt'
            assert '.workbench-attachments' not in json.dumps(pending)
            assert await bridge.submit('qa', 'default', 'session', values) == public
            assert len(peer.calls) == 1
        finally:
            await bridge.close()
    asyncio.run(run())

def test_legacy_projection_preserves_user_text_and_does_not_modify_storage(tmp_path):
    store = AttachmentStore()
    saved = asyncio.run(store.save_upload(tmp_path, 'qa', 'default', 'session', Upload('notes.txt', b'notes')))
    hints = store.resolve_inputs(tmp_path, 'qa', 'default', 'session', [saved['id']])
    literal = 'My notes include Path: /work/project and User attachment: example.'
    payload = {'input': [{'type': 'text', 'text': literal}] + hints}
    original = json.dumps(payload)
    projection = MessageProjection([{'client_request_id': 'r', 'payload': original}])
    native = {'type': 'userMessage', 'content': [{'type': 'text', 'text': '\n'.join(part['text'] for part in payload['input'])}]}
    assert projection.public(native)['content'] == payload['input'][:1]
    assert json.dumps(payload) == original
    # New authored structured input cannot be mistaken for legacy generated text.
    assert split_payload({**payload, '_messageVisibility': 1}) == (payload['input'], [])
    # The same grammar in the user's FIRST block is never treated as generated.
    user_only = {'input': hints}
    assert wire_payload(user_only) == user_only
    unrelated = {'type': 'userMessage', 'content': literal + '\nPath: /other'}
    assert projection.public(unrelated) == unrelated
    assert projection.public([{'role': 'user', 'hidden': True, 'content': 'secret'}, unrelated]) == [unrelated]


def test_image_preview_is_scoped_and_rejects_links_and_nonimages(tmp_path):
    bridge = CodexBridge(db_path=tmp_path / 'db', workspace_map={})
    for profile, session in [('default', 'session'), ('other', 'session'), ('default', 'other')]:
        bridge.store.upsert_session('qa', profile, dict(session_id=session, thread_id=session, workspace_id='w', workspace_path=str(tmp_path)))
    app = FastAPI()
    app.include_router(create_router(bridge), prefix='/api/codex')
    client = TestClient(app, headers={'remote-user': 'qa'})
    try:
        saved = asyncio.run(bridge.attachments.save_upload(tmp_path, 'qa', 'default', 'session', Upload('image.png', PNG)))
        url = f"/api/codex/attachments/{saved['id']}/preview"
        response = client.get(url, params={'profile': 'default', 'session_id': 'session'})
        assert response.status_code == 200 and response.content == PNG
        assert response.headers['content-type'] == 'image/png'
        assert response.headers['x-content-type-options'] == 'nosniff'
        document = asyncio.run(bridge.attachments.save_upload(tmp_path, 'qa', 'default', 'session', Upload('unsafe.svg', b'<svg><script>alert(1)</script></svg>')))
        assert client.get(f"/api/codex/attachments/{document['id']}/preview", params={'profile': 'default', 'session_id': 'session'}).status_code == 404
        assert client.get(url, params={'profile': 'default', 'session_id': 'session'}, headers={'remote-user': 'other'}).status_code == 404
        for profile, session in [('other', 'session'), ('default', 'other')]:
            assert client.get(url, params={'profile': profile, 'session_id': session}).status_code == 404
        hints = bridge.attachments.resolve_inputs(tmp_path, 'qa', 'default', 'session', [saved['id']])
        target = Path(hints[0]['text'].splitlines()[1][6:])
        outside = tmp_path / 'outside.png'
        target.rename(outside)
        target.symlink_to(outside)
        assert client.get(url, params={'profile': 'default', 'session_id': 'session'}).status_code == 404
    finally:
        asyncio.run(bridge.close())


def test_visibility_projection_preserves_tool_arguments_and_unrelated_text():
    projection = MessageProjection([])
    tool = {'type': 'mcpToolCall', 'input': {'path': '/user/specified', 'query': 'hello'}, 'result': 'result text'}
    assert projection.public(tool) == tool
    assert projection.public({'input': 'a command', 'role': 'tool'}) == {'input': 'a command', 'role': 'tool'}


def test_streaming_deltas_do_not_scan_history_and_preserve_raw_tool_json(tmp_path, monkeypatch):
    bridge = CodexBridge(db_path=tmp_path / 'db', workspace_map={})
    try:
        def unexpected(*_): raise AssertionError('ordinary deltas must not query all request history')
        monkeypatch.setattr(bridge.store, 'message_projection', unexpected)
        for event in [
            {'method': 'item/agentMessage/delta', 'params': {'delta': 'Hello'}},
            {'method': 'item/completed', 'params': {'item': {'type': 'mcpToolCall', 'input': {'path': '/file'}, 'result': '{ "formatted": "text" }'}}},
        ]:
            assert bridge.store.public_messages('qa', 'default', 'session', event) == event
    finally:
        bridge.store.close()


def test_reusing_attachments_never_merges_authored_spacing_between_turns():
    hint = {'type': 'text', 'text': 'private image context'}
    originals = ['a b', 'ab', 'a b\n', '  a b  ']
    requests = [{'client_request_id': f'r-{index}', 'turn_id': f't-{index}', 'payload': json.dumps({
        'input': [{'type': 'text', 'text': original}],
        '_attachmentContext': {'hidden': True, 'content': [hint]},
    })} for index, original in enumerate(originals)]
    projection = MessageProjection(requests)
    for index, original in enumerate(originals):
        turn = {'id': f't-{index}', 'items': [{'type': 'userMessage', 'content': [{'type': 'text', 'text': original + '\n\n' + hint['text']}]}]}
        assert projection.public(turn)['items'][0]['content'] == [{'type': 'text', 'text': original}]
    unrelated = {'id': 'other-turn', 'items': [{'type': 'userMessage', 'content': 'a b\n\nprivate image context'}]}
    assert projection.public(unrelated) == unrelated


def test_hermes_completion_mirror_receives_visible_transcript_only(tmp_path, monkeypatch):
    import codex_integration
    import codex_hermes
    actual_bridge = codex_integration.IntegratedCodexBridge
    monkeypatch.setenv('HERMES_WORKBENCH_HERMES_HOME', str(tmp_path))
    monkeypatch.setenv('HERMES_WORKBENCH_REVIEW_ENABLED', '0')
    monkeypatch.setattr(codex_integration, 'IntegratedCodexBridge',
                        lambda **kwargs: actual_bridge(db_path=tmp_path / 'db', workspace_map={}, **kwargs))
    imported = []
    monkeypatch.setattr(codex_hermes, 'import_completed', lambda home, sid, cwd, thread: imported.append(thread) or {'status': 'completed'})

    async def run():
        bridge = codex_integration.build_bridge()
        try:
            session = bridge.store.upsert_session('qa', 'default', dict(session_id='s', thread_id='thread', workspace_id='w', workspace_path=str(tmp_path)))
            bridge.store.save_request('qa', 'default', 's', 'r', turn_id='t', payload=json.dumps({
                'input': [{'type': 'text', 'text': 'Visible input'}],
                '_attachmentContext': {'hidden': True, 'content': [{'type': 'text', 'text': 'Private path hint'}]},
            }))
            class Peer:
                async def request(self, method, payload):
                    return {'data': [{'id': 't', 'status': 'completed', 'items': [
                        {'type': 'userMessage', 'content': [{'type': 'text', 'text': 'Visible input\n\nPrivate path hint'}]},
                    ]}]}
            async def connection(*_): return Peer()
            bridge._connection = connection
            await bridge.on_completed(session)
            assert 'Private path hint' not in json.dumps(imported)
            assert imported[0]['turns'][0]['items'][0]['content'] == [{'type': 'text', 'text': 'Visible input'}]
        finally:
            await bridge.close()
    asyncio.run(run())
