import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {setup, tick, FakePeer} from './fixtures.mjs';
import {Runtime} from '../runtime.mjs';
import {Store} from '../store.mjs';
const input = {profile_id: 'profile', project_id: 'project', cwd: tmpdir()};

test('scope filters and all snapshots preserve ownership; native unrelated sessions stay private', async t => {
  const f = await setup(); t.after(() => f.close());
  const a = await f.runtime.create(input); await f.runtime.create({...input, project_id: 'other'});
  assert.equal(f.runtime.list({project_id: 'project', profile_id: 'profile'}).sessions.length, 1);
  assert.throws(() => f.runtime.get(a.id, {project_id: 'other'}), {status: 404});
  assert.deepEqual((await f.runtime.snapshot(a.id)).session, a);
  assert.equal(f.runtime.list({profile_id: 'missing'}).sessions.length, 0);
});

test('accepted means queued; simultaneous retry deduplicates; changed content conflicts', async t => {
  const f = await setup(); t.after(() => f.close()); const s = await f.runtime.create(input);
  const results = await Promise.all(Array.from({length: 4}, () => f.runtime.message(s.id, {content: 'hello', request_id: 'r'})));
  assert.ok(results.every(x => x.accepted && x.status === 'accepted')); assert.equal(f.peer.promptCalls, 1);
  const snapshot = await f.runtime.snapshot(s.id); assert.equal(snapshot.messages.length, 0); assert.equal(snapshot.inbox.length, 1);
  await assert.rejects(f.runtime.message(s.id, {content: 'different', request_id: 'r'}), {status: 409});
});

test('cancel preserves queue and later idempotent requests; steer is passed through', async t => {
  const f = await setup(); t.after(() => f.close()); const s = await f.runtime.create(input);
  await f.runtime.message(s.id, {content: 'queued', request_id: 'r'});
  await f.runtime.message(s.id, {content: 'steering', request_id: 's', mode: 'steer'});
  await f.runtime.cancel(s.id);
  const snap = await f.runtime.snapshot(s.id); assert.equal(snap.inbox.length, 2); assert.equal(snap.inbox[1].placement, 'steer');
  await f.runtime.message(s.id, {content: 'queued', request_id: 'r'}); assert.equal(f.peer.promptCalls, 2);
});

test('interaction IDs correlate exact session, connection, event and question IDs', async t => {
  const f = await setup(); t.after(() => f.close()); const a = await f.runtime.create(input); const b = await f.runtime.create(input);
  const frame = {type: 'waterfall', event: 'user-questions/request', eventId: 'e', agentId: a.id,
    request: {questions: [{id: 'q', question: 'Choose'}]}};
  f.peer.emit('remote-event', frame, f.peer.generation);
  const pending = (await f.runtime.snapshot(a.id)).interactions[0]; assert.ok(pending.request_id.endsWith(':1:e'));
  await assert.rejects(f.runtime.answer(b.id, pending.request_id, {answer: 'no'}), {status: 409});
  await assert.rejects(f.runtime.answer(a.id, pending.request_id, {answer: {answers: [{id: 'wrong', selected: []}]}}), {status: 400});
  await f.runtime.answer(a.id, pending.request_id, {answer: 'yes'});
  assert.deepEqual(f.peer.answers[0].value, {answers: [{id: 'q', selected: [], custom: 'yes'}]});
  await assert.rejects(f.runtime.answer(a.id, pending.request_id, {answer: 'yes'}), {status: 409});
  f.peer.emit('remote-event', {...frame, eventId: 'stale'}, f.peer.generation - 1);
  assert.equal((await f.runtime.snapshot(a.id)).interactions.length, 0);
});

test('approvals fail closed and timed/unknown interactions are explicitly unsupported', async t => {
  const f = await setup(); t.after(() => f.close()); const s = await f.runtime.create(input); const events = [];
  f.runtime.on('event', e => events.push(e));
  f.peer.emit('remote-event', {type: 'waterfall', event: 'approval/request', eventId: 'a', agentId: s.id, request: {toolName: 'bash'}}, 1);
  await assert.rejects(f.runtime.answer(s.id, `${f.runtime.epoch}:1:a`, {decision: 'always'}), {status: 400});
  await f.runtime.answer(s.id, `${f.runtime.epoch}:1:a`, {decision: 'rejected'}); assert.equal(f.peer.answers[0].value, 'rejected');
  f.peer.emit('remote-event', {type: 'waterfall', event: 'user-questions/request', eventId: 't', agentId: s.id, request: {wait: {timed: true}}}, 1);
  await tick(); assert.ok(events.some(e => e.data.code === 'runtime/interaction-unsupported')); assert.equal(f.peer.answers.at(-1).next, true);
  assert.equal(f.runtime.capabilities().capabilities.interactions.timed_questions, false);
});

test('disconnect expires pending interaction and stale answers cannot use a new Peer', async t => {
  const f = await setup(); t.after(() => f.close()); const s = await f.runtime.create(input); await f.runtime.snapshot(s.id);
  f.peer.emit('remote-event', {type: 'waterfall', event: 'approval/request', eventId: 'e', agentId: s.id, request: {}}, 1);
  f.peer.connected = false; f.peer.emit('disconnected', 1); await tick();
  await assert.rejects(f.runtime.answer(s.id, `${f.runtime.epoch}:1:e`, {decision: 'allowed-once'}), {status: 409});
});

test('restart rebuilds native content and recovers durable request identity and queued input', async t => {
  const f = await setup(); const s = await f.runtime.create(input);
  await f.runtime.message(s.id, {content: 'queued', request_id: 'accepted'});
  f.peer.append(s.id, 'assistant/message', {message: {id: 'native', role: 'assistant', content: [{type: 'text', text: 'from native journal'}]}});
  await tick();
  f.store.sessions.get(s.id).requests.uncertain = {status: 'pending', hash: 'unused', input: {content: 'recover me', mode: 'queue'}};
  await f.store.save(); await f.runtime.close();
  const store = new Store(f.directory); await store.init(); const peer = new FakePeer(f.peer.native);
  const runtime = new Runtime({peer, store, provider: 'local', model: 'test-model'}); await runtime.init();
  t.after(async () => { await runtime.close(); await f.close(); });
  await runtime.recovery;
  assert.equal((await runtime.snapshot(s.id)).messages[0].content, 'from native journal');
  assert.equal((await runtime.snapshot(s.id)).inbox.length, 2);
  await runtime.message(s.id, {content: 'queued', request_id: 'accepted'}); assert.equal(peer.promptCalls, 1);
  assert.equal(store.sessions.get(s.id).requests.uncertain.status, 'accepted');
});

test('unsupported attachments fail before admission; no silent success', async t => {
  const f = await setup(); t.after(() => f.close()); const s = await f.runtime.create(input);
  await assert.rejects(f.runtime.message(s.id, {content: 'hi', attachments: [{type: 'file'}]}), {status: 415});
  for (const attachments of [[{type: 'image', data: 'unused'}], {}])
    await assert.rejects(f.runtime.message(s.id, {content: 'hi', attachments}), {status: 400});
  assert.equal(f.peer.promptCalls, 0); assert.equal(f.runtime.capabilities().capabilities.attachments.images, true);
});
