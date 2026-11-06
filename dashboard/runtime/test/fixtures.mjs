import {EventEmitter} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../runtime.mjs';
import {Store} from '../store.mjs';

export class Queue {
  constructor(signal) { this.items = []; this.waiters = []; this.done = false; signal?.addEventListener('abort', () => this.close(), {once: true}); }
  push(value) { const w = this.waiters.shift(); if (w) w({value, done: false}); else this.items.push(value); }
  close() { this.done = true; for (const w of this.waiters) w({done: true}); this.waiters = []; }
  [Symbol.asyncIterator]() { return this; }
  async next() { if (this.items.length) return {value: this.items.shift(), done: false}; if (this.done) return {done: true}; return new Promise(r => this.waiters.push(r)); }
  async return() { this.close(); return {done: true}; }
}
export class FakePeer extends EventEmitter {
  constructor(native = new Map()) { super(); this.native = native; this.generation = 0; this.connected = false; this.promptCalls = 0; this.answers = []; }
  async connect() { if (!this.connected) { this.connected = true; this.generation++; } }
  async call(method, request) {
    if (method === 'modelCatalog') return {groups: [{id: 'local', models: [{id: 'test-model', name: 'Test'}]}]};
    if (method === 'create') { if (!this.native.has(request.sessionId)) this.native.set(request.sessionId, {events: [], streams: [], queue: [], requests: new Set()}); return {sessionId: request.sessionId}; }
    const session = this.native.get(request.sessionId ?? request.address?.sessionId);
    if (['selectModel', 'rename'].includes(method)) return {};
    if (method === 'state') return {queue: session.queue, running: session.running ?? false};
    if (method === 'events') return {records: session.events.filter(e => e.seq < request.beforeSeq && e.seq <= request.throughSeq).map(event => ({type: 'event', event})), hasMore: false};
    if (method === 'prompt') {
      this.promptCalls++;
      if (!session.requests.has(request.requestId)) {
        session.requests.add(request.requestId); session.queue.push({id: request.requestId, rpcId: request.requestId, placement: request.mode, content: request.content});
      }
      return {accepted: true};
    }
    if (method === 'cancel') { session.running = false; return {accepted: true}; }
    throw Error(`Unexpected method ${method}`);
  }
  follow(id, signal) {
    const session = this.native.get(id); const q = new Queue(signal); session.streams.push(q);
    q.push({type: 'snapshot', cursor: session.events.at(-1)?.seq ?? -1, records: session.events.map(event => ({type: 'event', event})), hasMore: false});
    return q;
  }
  append(id, type, data, extra = {}) {
    const session = this.native.get(id); const event = {type, data, seq: session.events.length, time: 100, ...extra};
    session.events.push(event); for (const q of session.streams) if (!q.done) q.push({type: 'event', event}); return event;
  }
  async answer(eventId, value, generation, next) { this.answers.push({eventId, value, generation, next}); }
  async close() { this.connected = false; for (const s of this.native.values()) for (const q of s.streams) q.close(); }
}
export async function setup(native) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-runtime-test-'));
  const peer = new FakePeer(native); const store = new Store(directory); await store.init();
  const runtime = new Runtime({peer, store, provider: 'local', model: 'test-model'}); await runtime.init();
  return {directory, peer, store, runtime, async close() { await runtime.close(); await rm(directory, {recursive: true, force: true}); }};
}
export async function tick() { await new Promise(r => setImmediate(r)); }
