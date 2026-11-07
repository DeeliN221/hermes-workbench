import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Projection} from '../projection.mjs';
const ref = {id: 's', runtime: 'dsh', profile_id: 'p', project_id: 'j'};
const event = (seq, type, data, extra = {}) => ({seq, type, data, time: 100, ...extra});

test('transient chunks reconcile with one durable message and native cursor', () => {
  const p = new Projection(ref); p.baseline([], -1, 2);
  p.live({type: 'start', attemptId: 'a', revision: 1}, 2);
  const frame = {type: 'chunk', attemptId: 'a', revision: 2, index: 0, chunk: {type: 'text-delta', text: 'hello', index: 0}};
  const [delta] = p.live(frame, 2); assert.equal(delta.cursor, undefined); assert.equal(p.cursor, -1);
  assert.equal(p.snapshot().messages.length, 0); assert.equal(p.snapshot().streaming.content, 'hello');
  assert.deepEqual(p.live(frame, 2), []);
  const e = event(0, 'assistant/message', {message: {id: 'm', role: 'assistant', content: [{type: 'text', text: 'hello'}]}});
  assert.equal(p.durable(e).find(x => x.type === 'message.committed').cursor, 0);
  assert.deepEqual(p.durable(e), []);
  p.live({type: 'end', attemptId: 'a', revision: 3, outcome: {kind: 'committed'}}, 2);
  assert.equal(p.snapshot().messages.length, 1); assert.equal(p.snapshot().streaming, undefined);
});

test('stale generations, attempts, duplicate positions and gaps never enter the projection', () => {
  const p = new Projection(ref); p.baseline([], -1, 3);
  assert.deepEqual(p.live({type: 'start', attemptId: 'old', revision: 1}, 2), []);
  p.live({type: 'start', attemptId: 'a', revision: 1}, 3);
  for (const f of [
    {attemptId: 'old', revision: 2, index: 0}, {attemptId: 'a', revision: 2, index: 2},
  ]) assert.deepEqual(p.live({type: 'chunk', ...f, chunk: {type: 'text-delta', index: 0, text: 'bad'}}, 3), []);
  assert.equal(p.snapshot().streaming.content, '');
});

test('error-bearing committed messages, attempts and finish frames cannot become completed', () => {
  for (const type of ['assistant/message', 'assistant/attempt']) {
    const p = new Projection(ref); p.baseline([], -1, 1);
    const changes = p.durable(event(0, type, {turn: 1, stream: [{type: 'chunk', chunk: {type: 'finish', reason: {kind: 'error', error: {code: '401'}}}}]}));
    assert.ok(changes.some(e => e.type === 'error'));
    p.durable(event(1, 'turn/end', {turn: 1, reason: {kind: 'completed'}}));
    assert.equal(p.snapshot().status, 'error');
  }
  const p = new Projection(ref); p.baseline([], -1, 1); p.live({type: 'start', attemptId: 'a', revision: 1}, 1);
  assert.equal(p.live({type: 'chunk', attemptId: 'a', revision: 2, index: 0,
    chunk: {type: 'finish', reason: {kind: 'error', error: {code: '401'}}}}, 1)[0].type, 'error');
});

test('native baseline restores history, ownership, failure and replacement surface order', () => {
  const p = new Projection(ref);
  p.baseline([
    {event: event(0, 'user/message', {id: 'human', role: 'user', content: [{type: 'text', text: 'hi'}], source: {kind: 'user', rpcId: 'r'}})},
    {event: event(1, 'user/message', {id: 'internal', content: [{type: 'text', text: 'internal prompt'}], source: {kind: 'time-context'}})},
    {event: event(2, 'assistant/message', {message: {id: 'old', content: [{type: 'text', text: 'old'}]}})},
    {event: event(3, 'assistant/message', {message: {id: 'new', content: [{type: 'text', text: 'new'}]}}, {surfaceOp: {op: 'replace', startSeq: 2, endSeq: 2}})},
  ], 3, 7);
  assert.deepEqual(p.snapshot().session, ref); assert.deepEqual(p.snapshot().messages.map(m => m.id), ['human', 'new']);
  assert.ok(p.requests.has('r')); assert.equal(p.cursor, 3);
});

test('reconnect restores transient prefix without promoting it to durable history', () => {
  const p = new Projection(ref); p.baseline([], 5, 9, {revision: 8, activeAttempt: {
    attemptId: 'a', nextIndex: 3, stream: [{type: 'text-chunks', index: 0, texts: ['a', 'b']}],
  }});
  assert.equal(p.snapshot().streaming.content, 'ab'); assert.equal(p.snapshot().messages.length, 0);
  p.live({type: 'chunk', attemptId: 'a', revision: 9, index: 3, chunk: {type: 'text-delta', index: 0, text: 'c'}}, 9);
  assert.equal(p.snapshot().streaming.content, 'abc'); assert.equal(p.cursor, 5);
});

test('live and rebuilt snapshots agree; commit correlation stays outside durable messages',()=>{
  const ref={id:'s',runtime:'dsh',profile_id:'p',project_id:'j'};const p=new Projection(ref);p.baseline([],-1,1);
  p.live({type:'start',attemptId:'a',revision:1},1);
  const e={type:'assistant/message',seq:0,time:100,data:{message:{id:'native-message',role:'assistant',content:[{type:'text',text:'hi'}]}}};
  const committed=p.durable(e).find(x=>x.type==='message.committed');assert.equal(committed.attempt_id,'a');assert.equal(committed.data.stream_message_id,'a');
  const restored=new Projection(ref);restored.baseline([{event:e}],0,2);assert.deepEqual(restored.snapshot().messages,p.snapshot().messages);
  assert.throws(()=>p.durable({seq:2,type:'turn/end',data:{reason:{kind:'completed'}}}),{code:'dsh/journal-gap'});assert.equal(p.cursor,0);
});
