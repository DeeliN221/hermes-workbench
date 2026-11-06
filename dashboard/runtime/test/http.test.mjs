import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {setup, tick} from './fixtures.mjs';
import {startHttp} from '../http.mjs';

async function fixture(t) {
  const f = await setup(); const token = 'synthetic-runtime-test-token';
  const headers = {authorization: `Bearer ${token}`};
  const server = await startHttp(f.runtime, {port: 0, authenticate: value => value === headers.authorization});
  t.after(async () => { await server.close(); await f.close(); });
  const call = async (path, value, options = {}) => {
    const response = await fetch(`${server.url}/api/runtime${path}`, value === undefined ? {...options, headers: {...headers, ...options.headers}} : {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(value), ...options, headers: {...headers, 'content-type': 'application/json', ...options.headers},
    });
    return {status: response.status, value: await response.json()};
  };
  const created = await call('/sessions', {profile_id: 'p', project_id: 'j', cwd: tmpdir()});
  return {...f, ...server, headers, call, session: created.value};
}
async function nextEvent(reader, state) {
  for (;;) {
    const index = state.text.indexOf('\n\n');
    if (index >= 0) {
      const frame = state.text.slice(0, index); state.text = state.text.slice(index + 2);
      const line = frame.split('\n').find(x => x.startsWith('data: '));
      if (line) return {frame, event: JSON.parse(line.slice(6))};
      continue;
    }
    const {value, done} = await reader.read(); if (done) throw Error('Unexpected SSE end');
    state.text += new TextDecoder().decode(value);
  }
}

test('HTTP contracts include models, ownership, filtered lists and accepted receipts', async t => {
  const f = await fixture(t); const id = f.session.id;
  assert.equal((await f.call('/capabilities')).value.status, 'ready');
  assert.deepEqual((await f.call('/models')).value.models.map(x => x.id), ['test-model']);
  assert.equal((await f.call('/sessions?profile_id=p&project_id=j')).value.sessions.length, 1);
  assert.equal((await f.call('/sessions?project_id=other')).value.sessions.length, 0);
  assert.deepEqual((await f.call(`/sessions/${id}/snapshot`)).value.session, f.session);
  assert.equal((await f.call(`/sessions/${id}/snapshot?project_id=other`)).status, 404);
  const receipt = await f.call(`/sessions/${id}/messages`, {content: 'hello', request_id: 'r'});
  assert.equal(receipt.status, 202); assert.equal(receipt.value.status, 'accepted');
  assert.equal((await f.call(`/sessions/${id}/snapshot`)).value.messages.length, 0);
  assert.equal((await f.call(`/sessions/${id}/messages`, {content: 'hi', attachments: [{type: 'image'}]})).status, 400);
});

test('SSE snapshots rebuild durable history; live deltas are cursorless; reconnect deduplicates', async t => {
  const f = await fixture(t); const id = f.session.id;
  const control = new AbortController(); t.after(() => control.abort());
  const response = await fetch(`${f.url}/api/runtime/sessions/${id}/events?cursor=-1`, {signal: control.signal, headers: f.headers});
  const reader = response.body.getReader(); const state = {text: ''};
  const first = await nextEvent(reader, state); assert.equal(first.event.type, 'snapshot'); assert.equal(first.event.data.session.project_id, 'j');
  const monitor = f.runtime.monitors.get(id); monitor.projection.live({type: 'start', attemptId: 'a', revision: 1}, 1);
  for (const event of monitor.projection.live({type: 'chunk', attemptId: 'a', revision: 2, index: 0,
    chunk: {type: 'text-delta', index: 0, text: 'hello'}}, 1)) f.runtime.publish(id, event);
  const delta = await nextEvent(reader, state); assert.equal(delta.event.type, 'assistant.delta'); assert.ok(!delta.frame.includes('id: ')); assert.equal(delta.event.cursor, undefined);
  f.peer.append(id, 'assistant/message', {message: {id: 'm', role: 'assistant', content: [{type: 'text', text: 'hello'}]}});
  const committed = await nextEvent(reader, state); assert.equal(committed.event.type, 'message.committed'); assert.equal(committed.event.cursor, 0); assert.ok(committed.frame.includes(`id: ${id}:0`));
  control.abort();
  const second = new AbortController();
  const resumed = await fetch(`${f.url}/api/runtime/sessions/${id}/events`, {headers: {...f.headers, 'Last-Event-ID': `${id}:0`}, signal: second.signal});
  const baseline = await nextEvent(resumed.body.getReader(), {text: ''});
  assert.equal(baseline.event.data.messages.length, 1); assert.equal(baseline.event.cursor, 0); second.abort();
  assert.equal((await f.call(`/sessions/${id}/events?cursor=999`)).status, 409);
  assert.equal((await f.call(`/sessions/${id}/events?cursor=other:0`)).status, 400);
});

test('HTTP rejects malformed requests and cross-site access; unexpected failures never expose raw errors', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/sessions', {profile_id: 'p', project_id: 'j', cwd: 'relative'})).status, 400);
  assert.equal((await f.call('/sessions', undefined, {headers: {Origin: 'http://untrusted.invalid'}})).status, 403);
  const raw = headers => new Promise((resolve, reject) => {
    const req = http.get(`${f.url}/api/runtime/sessions`, {headers: {...f.headers, ...headers}}, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(await raw({Host: 'untrusted.invalid'}), 403);
  assert.equal(await raw({'sec-fetch-site': 'cross-site'}), 403);
  f.runtime.models = async () => { throw Error('DO_NOT_EXPOSE_TOKEN_OR_PERSONAL_PATH'); };
  const failure = await f.call('/models'); assert.equal(failure.status, 503);
  assert.ok(!JSON.stringify(failure).includes('DO_NOT_EXPOSE'));
});

test('HTTP body accepts bounded image payloads above 1 MiB; receipts stay scoped',async t=>{
  const f=await fixture(t);const id=f.session.id;
  // A complete PNG signature plus fixture payload exercises transport bounds;
  // native decoding is separately covered by the opt-in vision probe.
  const bytes=Buffer.alloc(900000,1);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const receipt=await f.call(`/sessions/${id}/messages`,{attachments:[{type:'image',media_type:'image/png',data:bytes.toString('base64')}],client_request_id:'large-image'});
  assert.equal(receipt.status,202);assert.equal(receipt.value.request_id,'large-image');
  const lookup=await f.call(`/sessions/${id}/requests/large-image`);assert.equal(lookup.value.status,'accepted');
  assert.equal((await f.call(`/sessions/${id}/requests/large-image?project_id=other`)).status,404);
  assert.equal((await f.call(`/sessions/${id}/requests/missing`)).status,404);
});
