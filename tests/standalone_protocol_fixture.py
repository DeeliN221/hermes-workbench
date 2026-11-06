"""Deterministic NEUTRAL protocol fixture. This is not DSH or a model runtime.

For localhost browser QA only: python tests/standalone_protocol_fixture.py --port PORT
"""
import asyncio
import json
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse


def create_fixture():
    app = FastAPI()
    app.state.sessions = {}
    app.state.requests = []

    @app.middleware('http')
    async def record(request, next_handler):
        app.state.requests.append((request.method, request.url.path, dict(request.headers), dict(request.query_params)))
        return await next_handler(request)

    def emit(session, kind, data):
        sequence = len(session['events']) + 1
        event = {'type': kind, 'session_id': session['session']['id'], 'cursor': str(sequence), 'sequence': sequence, 'attempt_id': 'attempt-' + str(session['attempt']), 'data': data}
        session['events'].append(event)
        session['cursor'] = str(sequence)

    @app.get('/api/runtime/capabilities')
    async def capabilities():
        return {'runtime': 'dsh', 'status': getattr(app.state, 'runtime_status', 'ready'), 'fixture': True, 'capabilities': {'durable_scheduled_input': True}, 'interactions': True, 'cancel': True}

    @app.get('/api/runtime/models')
    async def models():
        return {'models': [{'id': 'protocol-fixture', 'label': 'Protocol fixture (not DSH)', 'is_default': True}]}

    @app.get('/api/runtime/sessions')
    async def sessions(profile_id: str, project_id: str):
        return [s['session'] for s in app.state.sessions.values() if s['session']['profile_id'] == profile_id and s['session']['project_id'] == project_id]

    @app.post('/api/runtime/sessions')
    async def create(request: Request):
        body = await request.json()
        ident = 'fixture-' + str(len(app.state.sessions) + 1)
        ref = {k: body[k] for k in ('profile_id', 'project_id')}
        ref.update(id=ident, runtime='dsh', title=body.get('title') or 'Protocol fixture conversation')
        app.state.sessions[ident] = {'session': ref, 'messages': [], 'cursor': '0', 'interactions': [], 'inbox': [], 'status': 'idle', 'events': [], 'attempt': 0, 'requests': set(), 'cwd': body['cwd'], 'creation_payload': body}
        return ref

    def get(ident):
        if ident not in app.state.sessions:
            raise HTTPException(404, 'Unknown fixture session')
        return app.state.sessions[ident]

    def snapshot(s):
        return {k: s[k] for k in ('session', 'messages', 'cursor', 'interactions', 'inbox', 'status')} | {'tools': s.get('tools', []), 'deliveries': s.get('deliveries', [])}

    @app.get('/api/runtime/sessions/{ident}/snapshot')
    async def read(ident: str):
        return snapshot(get(ident))

    @app.get('/api/runtime/sessions/{ident}/events')
    async def events(ident: str, request: Request, cursor: str = '0'):
        session = get(ident)
        async def stream():
            at = int(cursor or 0)
            while not await request.is_disconnected():
                if len(session['events']) > at:
                    for event in session['events'][at:]:
                        yield 'data: ' + json.dumps(event) + '\n\n'
                        at += 1
                else:
                    yield ': heartbeat\n\n'
                await asyncio.sleep(.03)
        return StreamingResponse(stream(), media_type='text/event-stream')

    async def finish(s, content, attempt):
        await asyncio.sleep(.12)
        if s['attempt'] != attempt or s['status'] != 'running':
            return
        if content == 'error':
            s['status'] = 'failed'
            emit(s, 'error', {'message': 'Protocol fixture failure'})
            emit(s, 'state', {'status': 'failed'})
            return
        if content == 'interaction':
            interaction = {'id': 'permission-1', 'kind': 'approval', 'prompt': 'Protocol fixture permission', 'command': 'fixture-operation'}
            s['interactions'] = [interaction]
            s['status'] = 'waiting'
            emit(s, 'interaction.requested', interaction)
            return
        if content == 'tool':
            tool = {'type': 'tool/result', 'call_id': 'fixture-call-' + str(attempt), 'name': 'read_file', 'arguments': {'path': 'validation.txt'}, 'status': 'completed', 'content': 'Protocol fixture tool output'}
            s.setdefault('tools', []).append(tool)
            emit(s, 'state', {'status': 'running', 'tool': tool})
            s['messages'].append({'id': 'fixture-tool-message-' + str(attempt), 'role': 'tool', 'content': tool['content'], 'tool': tool})
        if content == 'slow':
            emit(s, 'assistant.delta', {'message_id': 'answer-' + str(attempt), 'delta': 'Protocol fixture running…'})
            return
        ident = 'answer-' + str(attempt)
        emit(s, 'assistant.delta', {'message_id': ident, 'delta': 'Protocol fixture '})
        await asyncio.sleep(.12)
        if s['status'] != 'running':
            return
        message = {'id': ident, 'role': 'assistant', 'content': 'Protocol fixture reply: ' + content}
        s['messages'].append(message)
        emit(s, 'message.committed', {'message': message})
        s['status'] = 'completed'
        emit(s, 'state', {'status': 'completed'})

    @app.post('/api/runtime/sessions/{ident}/messages')
    async def send(ident: str, request: Request):
        s = get(ident)
        body = await request.json()
        s['last_message_payload'] = body
        rid = body.get('request_id', 'request')
        if rid not in s['requests']:
            s['requests'].add(rid)
            s['attempt'] += 1
            message = {'id': rid, 'request_id': rid, 'role': 'user', 'content': body['content']}
            s['messages'].append(message)
            s['status'] = 'running'
            emit(s, 'state', {'status': 'running'})
            emit(s, 'message.committed', {'message': message})
            asyncio.create_task(finish(s, body['content'], s['attempt']))
        return {'request_id': rid, 'session_id': ident, 'accepted': True, 'status': 'accepted'}

    @app.get('/api/runtime/sessions/{ident}/requests/{request_id}')
    async def receipt(ident: str, request_id: str):
        session = get(ident)
        return {'session_id': ident, 'request_id': request_id, 'accepted': True, 'status': 'accepted', 'durable': request_id in session['requests'] and getattr(app.state, 'input_durable', True)}

    @app.post('/api/runtime/sessions/{ident}/deliveries')
    async def notify(ident: str, request: Request):
        session = get(ident)
        payload = await request.json()
        rows = session.setdefault('deliveries', [])
        old = next((row for row in rows if row['idempotency_key'] == payload['idempotency_key']), None)
        if old and any(old.get(k) != v for k,v in payload.items()):
            raise HTTPException(409, 'Notification identity changed')
        if not old:
            old = {**payload, 'delivery_id': 'notification-' + str(len(rows) + 1)}
            rows.append(old)
            emit(session, 'delivery.received', {'delivery': old})
        return {'delivery_id': old['delivery_id'], 'session_id': ident, 'idempotency_key': payload['idempotency_key'], 'accepted': True, 'durable': getattr(app.state, 'notification_durable', True), 'status': 'persisted'}

    @app.post('/api/runtime/sessions/{ident}/cancel')
    async def cancel(ident: str):
        s = get(ident)
        s['status'] = 'cancelled'
        s['interactions'] = []
        emit(s, 'state', {'status': 'cancelled'})
        return {'accepted': True, 'status': 'accepted', 'session_id': ident}

    @app.post('/api/runtime/sessions/{ident}/interactions/{request_id}')
    async def reply(ident: str, request_id: str):
        s = get(ident)
        if not any(i['id'] == request_id for i in s['interactions']):
            raise HTTPException(410, 'Interaction expired')
        s['interactions'] = []
        emit(s, 'interaction.resolved', {'request_id': request_id})
        s['status'] = 'completed'
        emit(s, 'state', {'status': 'completed'})
        return {'accepted': True, 'status': 'accepted'}

    return app


if __name__ == '__main__':
    import argparse
    import uvicorn
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    uvicorn.run(create_fixture(), host='127.0.0.1', port=args.port, log_level='warning')


def create_services_fixture():
    """Explicit service fixture for host callbacks; never a product service fallback."""
    from types import SimpleNamespace
    from fastapi import APIRouter
    from pathlib import Path

    class FixtureServices:
        def __init__(self, resolver, storage_root, runtime):
            self.resolver, self.runtime = resolver, runtime
            self.root = Path(storage_root)
            self.root.mkdir(parents=True, exist_ok=True)
            self.path = self.root / 'fixture-services.json'
            self.data = json.loads(self.path.read_text()) if self.path.exists() else {'memory': {}, 'tasks': {}}
            self.bindings = []
            self.submissions = 0
            async def task(ctx, ident):
                return next(({'id': receipt['task_id'], 'status': receipt['status'], 'origin': receipt['origin']} for receipt in self.data['tasks'].values() if receipt['task_id'] == ident), {})
            self.fleet = SimpleNamespace(task=task)
            self.archives = SimpleNamespace(list=lambda *args, **kwargs: [])
        def save(self):
            self.path.write_text(json.dumps(self.data))
        def key(self, ctx):
            return ':'.join(ctx[k] for k in ('user_id', 'profile_id'))
        def memory(self, ctx):
            return self.data['memory'].get(self.key(ctx), {'files': {'MEMORY.md': '', 'SOUL.md': ''}, 'version': 0})
        def build_runtime_context(self, ctx):
            return {'memory': self.memory(ctx)['files'], 'skills': [{'name': 'fixture-skill', 'root': str(self.root), 'content': 'fixture skill instruction', 'version': 'fixture'}], 'mcpServers': {}, 'workspace': ctx['workspace']}
        def bind_session(self, ctx, ref):
            self.bindings.append((ctx, ref))
        async def submit_background(self, ctx, message, request_id, session_id):
            await self.runtime['get_session'](ctx, session_id)
            self.submissions += 1
            key = self.key(ctx) + ':' + request_id
            if key not in self.data['tasks']:
                self.data['tasks'][key] = {'task_id': 'fixture-task-' + str(len(self.data['tasks']) + 1), 'status': 'queued', 'origin': {k: ctx[k] for k in ('user_id', 'profile_id', 'project_id')} | {'session_id': session_id, 'runtime': 'dsh'}}
                self.save()
            return self.data['tasks'][key]

    def create_services_router(resolve_context, storage_root, runtime):
        service = FixtureServices(resolve_context, storage_root, runtime)
        router = APIRouter()
        router.services = service
        @router.get('/memory')
        async def memory(request: Request):
            return service.memory(resolve_context(request))
        @router.put('/memory')
        async def save_memory(request: Request):
            ctx = resolve_context(request)
            body = await request.json()
            old = service.memory(ctx)
            if body['version'] != old['version']:
                raise HTTPException(409, 'Memory changed')
            value = {'files': {**old['files'], **body['files']}, 'version': old['version'] + 1}
            service.data['memory'][service.key(ctx)] = value
            service.save()
            return value
        return router

    def extra_router(*, services, **options):
        router = APIRouter()
        @router.get('/api/cron/jobs')
        async def jobs():
            return {'jobs': []}
        return router

    return SimpleNamespace(create_services_router=create_services_router, create_extra_router=extra_router)
