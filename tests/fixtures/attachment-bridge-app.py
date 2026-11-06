"""Local browser harness: real upload/SQLite/HTTP paths, deterministic Codex peer."""
import io
import json
import re
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'dashboard'))
from fastapi import FastAPI
from codex_bridge import CodexBridge, create_router
from codex_attachments import create_router as attachment_router
from sidecar_app import TrustedProxyGate
import plugin_api

PNG = Path(__file__).with_name('attachment-diagram.png').read_bytes()
temporary = tempfile.TemporaryDirectory(prefix='attachment-browser-')
root = Path(temporary.name)
# Exercise the real preference reader against fixture-owned state, never the
# running developer instance. The empty store deliberately defaults to chat.
plugin_api._workspace_root = lambda: root
bridge = CodexBridge(db_path=root / 'bridge.db', workspace_map={})
turns = {'codex-preview': [], 'codex-regression': []}
read_attachments = []
execution_modes = []

class Peer:
    epoch = 'browser'
    async def request(self, method, payload):
        thread = payload.get('threadId', 'codex-preview')
        if method == 'thread/read':
            return {'thread': {'turns': turns[thread]}}
        if method == 'thread/search':
            return {'data': [{'thread': {'id': key}, 'snippet': 'private native search fragment'} for key in turns]}
        if method in {'turn/start', 'turn/steer'}:
            for part in payload['input'][1:]:
                mode = re.fullmatch(r'<workbench_execution_mode mode="(foreground|background)">\n.+\n</workbench_execution_mode>', part['text'], re.DOTALL)
                if mode:
                    execution_modes.append(mode.group(1))
                    continue
                target = Path(next(line[6:] for line in part['text'].splitlines() if line.startswith('Path: ')))
                if target.is_dir():
                    for child in target.rglob('*'):
                        if child.is_file():
                            assert child.read_bytes() == b'Folder content', 'Folder upload bytes must reach the agent intact'
                else:
                    target.read_bytes()
                read_attachments.append(target.name)
            number = len(turns[thread]) + 1
            turn = {'id': f'turn-{number}', 'status': 'completed', 'itemsView': 'full', 'items': [
                {'id': f'user-{number}', 'type': 'userMessage', 'content': [{'type': 'text', 'text': '\n\n'.join(part['text'] for part in payload['input'])}]},
                {'id': f'answer-{number}', 'type': 'agentMessage', 'text': 'Attachments are available for inspection.'},
            ]}
            turns[thread].append(turn)
            return {'turn': turn}
        return {}
    async def drain_notifications(self): pass

async def connection(*_): return Peer()
bridge._connection = connection

@asynccontextmanager
async def lifespan(_):
    for sid in turns:
        bridge.store.upsert_session('preview', 'default', dict(session_id=sid, thread_id=sid,
            workspace_id='preview-workspace', workspace_path=str(root), title='Attachment validation' if sid == 'codex-preview' else 'Legacy attachment conversation'))
    upload = type('Upload', (), {'filename': 'legacy.png', 'file': io.BytesIO(PNG), 'content_type': 'image/png'})()
    saved = await bridge.attachments.save_upload(root, 'preview', 'default', 'codex-regression', upload)
    hints = bridge.attachments.resolve_inputs(root, 'preview', 'default', 'codex-regression', [saved['id']])
    payload = {'threadId': 'codex-regression', 'input': [{'type': 'text', 'text': 'Original legacy message.'}] + hints}
    bridge.store.save_request('preview', 'default', 'codex-regression', 'legacy', status='accepted', payload=json.dumps(payload))
    await Peer().request('turn/start', payload)
    read_attachments.clear()
    yield
    await bridge.close()
    temporary.cleanup()

app = FastAPI(lifespan=lifespan)
app.add_middleware(TrustedProxyGate)
app.include_router(create_router(bridge), prefix='/api/plugins/workbench/codex')
app.include_router(attachment_router(bridge), prefix='/api/plugins/workbench/codex')

@app.get('/api/plugins/workbench/qa/attachments')
async def evidence():
    requests = bridge.store.connection.execute('SELECT payload FROM codex_requests WHERE session_id=?', ('codex-preview',)).fetchall()
    payloads = [json.loads(row['payload']) for row in requests]
    return {'readAttachments': read_attachments, 'requests': len(payloads),
            'hiddenContexts': sum(p.get('_attachmentContext', {}).get('hidden') is True for p in payloads),
            'hiddenExecutionContexts': sum(p.get('_executionContext', {}).get('hidden') is True for p in payloads),
            'executionModes': execution_modes,
            'visibleTexts': [p['input'][0]['text'] for p in payloads]}
