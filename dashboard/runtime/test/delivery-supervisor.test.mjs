import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setup, FakePeer} from './fixtures.mjs';
import {Store} from '../store.mjs';
import {Runtime} from '../runtime.mjs';

const owner = {user_id: 'owner', profile_id: 'profile', project_id: 'project'};
const delivery = {source: 'fleet', epoch: 1, idempotency_key: 'task:attempt:result', task_id: 'task',
  attempt_id: 'attempt', kind: 'result', content: 'The requested checks passed.', wake_supervisor: true};
async function fixture(t) {
  const f = await setup();
  f.session = await f.runtime.create({...owner, cwd: f.directory});
  await f.runtime.snapshot(f.session.id);
  t.after(() => f.close());
  return f;
}
const stored = f => f.store.sessions.get(f.session.id).deliveries[0];
async function submit(f, input = delivery) {
  const receipt = await f.runtime.delivery(f.session.id, input, owner);
  await f.runtime.supervisor.poll();
  return receipt;
}
function consume(f, turn = 1) {
  const requestId = stored(f).supervisor.request_id;
  const queued = f.peer.native.get(f.session.id).queue.find(x => x.rpcId === requestId);
  f.peer.append(f.session.id, 'turn/start', {turn});
  f.peer.append(f.session.id, 'user/message', {id: 'internal-' + turn, role: 'user', source: {kind: 'user', rpcId: requestId}, content: queued.content});
}
function finish(f, {turn = 1, content = 'The checks passed. No action is needed.', kind = 'completed', error} = {}) {
  f.peer.append(f.session.id, 'assistant/message', {turn, ...(error ? {error} : {}),
    message: {id: 'answer-' + turn, role: 'assistant', content: [{type: 'text', text: content}]}});
  f.peer.append(f.session.id, 'turn/end', {turn, reason: {kind}});
}
async function settle(f) {
  // Drain the asynchronous follow iterator before inspecting durable outcomes.
  await new Promise(r => setImmediate(r));
  await f.runtime.supervisor.poll();
}
async function reopen(f) {
  await f.runtime.close();
  const store = new Store(f.directory); await store.init();
  const peer = new FakePeer(f.peer.native);
  const runtime = new Runtime({store, peer, provider: 'local', model: 'test-model'});
  await runtime.init();
  Object.assign(f, {runtime, store, peer});
  // The fixture cleanup closes the original runtime, so close this one too.
  const original = f.close;
  f.close = async () => { await runtime.close(); await original(); };
  await runtime.supervisor.poll();
}

test('verified delivery wakes the native session without a browser or a follow-up; only committed output completes it', async t => {
  const f = await fixture(t); const events = []; f.runtime.on('event', e => events.push(e));
  const receipt = await submit(f);
  assert.equal(receipt.status, 'persisted'); assert.equal(receipt.durable, true);
  assert.equal(f.peer.promptCalls, 1); assert.equal(stored(f).supervisor.status, 'queued');
  assert.deepEqual((await f.runtime.snapshot(f.session.id)).inbox, []);
  consume(f);
  await settle(f); assert.equal(stored(f).supervisor.status, 'running');
  finish(f); await settle(f);
  assert.equal(stored(f).supervisor.status, 'delivered'); assert.equal(stored(f).supervisor.message_id, 'answer-1');
  const snapshot = await f.runtime.snapshot(f.session.id);
  assert.deepEqual(snapshot.messages.map(x => x.role), ['assistant']);
  assert.ok(!JSON.stringify(events.filter(e => e.type === 'message.committed')).includes('untrusted task data'));
  assert.equal(events.filter(e => e.type === 'delivery.updated').at(-1).data.delivery.supervisor.status, 'delivered');
});

test('busy native sessions receive queue mode and an unrelated completed turn cannot acknowledge a callback', async t => {
  const f = await fixture(t); f.peer.native.get(f.session.id).running = true;
  f.peer.append(f.session.id, 'turn/start', {turn: 1});
  await submit(f);
  assert.equal(f.peer.native.get(f.session.id).queue[0].placement, 'queue');
  f.peer.append(f.session.id, 'agent/inbox/spliced', {inserted: [{source: {rpcId: stored(f).supervisor.request_id}}]});
  finish(f); await settle(f); assert.equal(stored(f).supervisor.status, 'queued');
  consume(f, 2); finish(f, {turn: 2}); await settle(f);
  assert.equal(stored(f).supervisor.turn, 2); assert.equal(stored(f).supervisor.status, 'delivered');
});

test('concurrent duplicates produce one wake and conflict on changing wake policy or scope', async t => {
  const f = await fixture(t);
  const receipts = await Promise.all(Array.from({length: 8}, () => f.runtime.delivery(f.session.id, delivery, owner)));
  await f.runtime.supervisor.poll();
  assert.equal(new Set(receipts.map(x => x.delivery_id)).size, 1); assert.equal(f.peer.promptCalls, 1);
  await assert.rejects(f.runtime.delivery(f.session.id, {...delivery, wake_supervisor: false}, owner), {status: 409});
  await assert.rejects(f.runtime.delivery(f.session.id, delivery, {...owner, project_id: 'other'}), {status: 404});
  await assert.rejects(f.runtime.message(f.session.id, {request_id: stored(f).supervisor.request_id, content: 'spoof'}), {status: 400});
});

test('wake intent and notification share one fsync barrier; failed persistence never dispatches', async t => {
  const f = await fixture(t); const save = f.store.writeSnapshot.bind(f.store);
  f.store.writeSnapshot = async () => { throw Error('disk failure'); };
  await assert.rejects(f.runtime.delivery(f.session.id, delivery, owner));
  assert.equal(f.peer.promptCalls, 0); assert.equal(f.store.sessions.get(f.session.id).deliveries, undefined);
  f.store.writeSnapshot = save; await submit(f);
  const disk = JSON.parse(await readFile(join(f.directory, 'metadata.json'), 'utf8')).sessions[0];
  assert.equal(disk.requests[disk.deliveries[0].supervisor.request_id].delivery_id, disk.deliveries[0].id);
});

test('restart before dispatch recovers intent without requiring browser or delivery replay', async t => {
  const f = await fixture(t); await f.runtime.supervisor.close();
  await f.runtime.delivery(f.session.id, delivery, owner); assert.equal(f.peer.promptCalls, 0);
  await reopen(f); assert.equal(f.peer.promptCalls, 1); assert.equal(stored(f).supervisor.status, 'queued');
});

test('lost native acknowledgement reuses the same request after restart without double queueing', async t => {
  const f = await fixture(t); const call = f.peer.call.bind(f.peer); let lost = true;
  f.peer.call = async (method, input) => { const result = await call(method, input); if (method === 'prompt' && lost) { lost = false; throw Error('lost ACK'); } return result; };
  await submit(f); assert.equal(stored(f).supervisor.fallback, true);
  await reopen(f);
  assert.equal(f.peer.native.get(f.session.id).queue.length, 1); assert.equal(stored(f).supervisor.status, 'queued');
});

test('native completion during downtime is recovered from baseline without starting a second turn', async t => {
  const f = await fixture(t); await submit(f); await f.runtime.close();
  consume(f); finish(f); await reopen(f);
  assert.equal(stored(f).supervisor.status, 'delivered'); assert.equal(f.peer.promptCalls, 0);
});

test('a failed local completion fsync is retried, never published as success prematurely', async t => {
  const f = await fixture(t); await submit(f); const save = f.store.writeSnapshot.bind(f.store);
  f.store.writeSnapshot = async data => { if (data.sessions[0].deliveries[0].supervisor.status === 'delivered') throw Error('disk failure'); return save(data); };
  consume(f); finish(f); await settle(f);
  assert.notEqual(stored(f).supervisor.status, 'delivered');
  f.store.writeSnapshot = save; await f.runtime.supervisor.poll();
  assert.equal(stored(f).supervisor.status, 'delivered'); assert.equal(f.peer.promptCalls, 1);
});

for (const [name, result, status] of [
  ['model failure', {error: {status: 503}, kind: 'failed'}, 'failed'],
  ['empty reply', {content: ''}, 'empty'],
  ['cancellation', {kind: 'cancelled'}, 'cancelled'],
]) test(`${name} retains a visible task receipt and does not automatically execute again`, async t => {
  const f = await fixture(t); await submit(f); consume(f); finish(f, result); await settle(f);
  assert.equal(stored(f).supervisor.status, status); assert.equal(stored(f).supervisor.fallback, true);
  assert.equal((await f.runtime.snapshot(f.session.id)).deliveries[0].content, delivery.content);
  await reopen(f); assert.equal(f.peer.promptCalls, 0); assert.equal(stored(f).supervisor.status, status);
});

test('legacy notification-only records remain passive after upgrade', async t => {
  const f = await fixture(t); await submit(f, {...delivery, wake_supervisor: false});
  assert.equal(f.peer.promptCalls, 0); await reopen(f); assert.equal(f.peer.promptCalls, 0);
});
