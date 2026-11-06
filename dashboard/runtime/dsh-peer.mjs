import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {EventEmitter} from 'node:events';
import {RuntimeError, httpFailure} from './errors.mjs';
export const DSH_VERSION = '0.2.2-rc.1';

// Use published, version-pinned Connection and Gateway Mux implementations.
// stream-client.js is shipped by this release but has no package subpath export.
export async function loadDsh(moduleRoot) {
  const require = createRequire(moduleRoot ? join(moduleRoot, 'package.json') : import.meta.url);
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  for (const name of ['dsh', 'dsh-client-connection', 'dsh-api-gateway']) {
    if (require(`@deepseek-ai/${name}/package.json`).version !== DSH_VERSION)
      throw new RuntimeError(503, 'dsh/version-mismatch', `Requires DSH ${DSH_VERSION}`);
  }
  const [{Context}, connection, {default: WebSocket}, mux] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-client-connection/client'), load('ws'),
    import(pathToFileURL(join(dirname(require.resolve('@deepseek-ai/dsh-api-gateway/package.json')),
      'lib/types/client/stream-client.js')).href),
  ]);
  return {require, Context, ...connection, WebSocket, ...mux, cli: require.resolve('@deepseek-ai/dsh/lib/bin.js')};
}

export class DshPeer extends EventEmitter {
  constructor({url, readToken, modules}) {
    super(); this.url = new URL(url); this.readToken = readToken; this.modules = modules;
    if (this.url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(this.url.hostname)
      || this.url.username || this.url.password || this.url.search || this.url.pathname !== '/')
      throw new RuntimeError(400, 'dsh/local-only', 'DSH host must be a localhost HTTP origin');
    this.generation = 0; this.connected = false; this.closed = false;
  }
  async connect() {
    if (this.closed) throw new RuntimeError(503, 'dsh/peer-closed', 'DSH Peer is closed');
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  async open() {
    if (this.authFailure) throw this.authFailure; // Do not retry failed credentials.
    if (this.connected) return;
    await this.drop();
    const token = await this.readToken();
    const url = new URL('/connect', this.url);
    url.searchParams.set('token', token); url.searchParams.set('interactions', 'answer');
    const response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(10000)});
    if (response.status !== 302) {
      const error = httpFailure(response.status);
      if ([401, 403].includes(response.status)) this.authFailure = error;
      throw error;
    }
    // This cookie never leaves the server-side closure.
    const destination = new URL(response.headers.get('location') ?? '', this.url);
    if (destination.origin !== this.url.origin || destination.pathname !== '/api/remote.mux')
      throw new RuntimeError(502, 'dsh/redirect-rejected', 'Unexpected DSH Peer destination');
    const cookie = response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    if (!cookie) throw new RuntimeError(502, 'dsh/protocol', 'DSH did not establish an API Peer');
    const {Context, installConnection, WebSocket, RemoteStreamMuxClient} = this.modules;
    const ctx = this.ctx = new Context();
    this.fetchHost = async (input, init = {}) => {
      const url = new URL(input, this.url);
      if (url.origin !== this.url.origin) throw new RuntimeError(502, 'dsh/origin-rejected', 'DSH request changed origin');
      const headers = new Headers(init.headers); headers.set('Cookie', cookie);
      const res = await fetch(url, {...init, headers, redirect: 'manual'});
      if (!res.ok) {
        const e = httpFailure(res.status);
        this.lastHttpError = e;
        if (res.status === 403) this.authFailure = e;
        if (res.status === 401 && this.connected) {
          this.connected = false; this.emit('disconnected', this.generation);
        }
        throw e;
      }
      return res;
    };
    installConnection(ctx, {interactions: 'answer', transport: {
      fetch: (input, init) => this.fetchHost(input, init),
      streamBaseUrl: this.url.href,
      createWebSocket: value => {
        const url = new URL(value); const expected = new URL(this.url); expected.protocol = 'ws:';
        if (url.origin !== expected.origin || url.pathname !== '/api/remote.mux')
          throw new RuntimeError(502, 'dsh/origin-rejected', 'DSH socket changed origin');
        return new WebSocket(url, {headers: {Cookie: cookie}, followRedirects: false});
      },
    }});
    this.mux = new RemoteStreamMuxClient(path => ctx.connection.openWebSocket(path));
    this.mux.start(); this.control = new AbortController();
    const stream = this.mux.open('$events', {args: {}}, this.control.signal);
    const ready = await stream.next();
    if (ready.done || ready.value?.type !== 'ready')
      throw new RuntimeError(502, 'dsh/protocol', 'Missing DSH Peer readiness');
    this.clientId = ready.value.clientId; this.generation++; this.connected = true;
    const generation = this.generation;
    this.pump = this.pumpEvents(stream, generation);
    this.emit('connected', generation);
  }
  async pumpEvents(stream, generation) {
    try {
      for await (const frame of stream) {
        if (!this.connected || this.generation !== generation) break;
        // clientId is only used for server-side result correlation.
        this.emit('remote-event', frame, generation);
      }
    } catch { /* Surface only a nonsecret transport failure below. */ }
    if (!this.closed && this.generation === generation && this.connected) {
      this.connected = false;
      this.emit('disconnected', generation);
    }
  }
  async call(method, request) {
    await this.connect();
    return this.rpc(`session/${method}`, request === undefined ? {} : method === 'list' ? {_request: request} : {request});
  }
  async rpc(endpoint, args) {
    this.lastHttpError = undefined;
    const result = await this.ctx.connection.rpc.call('/api', endpoint, {args}, AbortSignal.timeout(30000));
    if (!result.ok) {
      if (this.authFailure) throw this.authFailure;
      if (this.lastHttpError) throw this.lastHttpError;
      throw new RuntimeError(502, 'dsh/remote-error', 'DSH Remote request failed');
    }
    return result.value;
  }
  async ensureContextService() {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const res = await this.fetchHost('/api/workbench/context/status', {signal: AbortSignal.timeout(3000)});
        if ((await res.json()).status === 'ready') return;
      } catch (error) { if (![404, 503].includes(error.upstreamStatus)) throw error; }
      await delay(100);
    }
    throw new RuntimeError(503, 'dsh/context-service-unavailable', 'DSH context extension is unavailable');
  }
  async confirmRequest(sessionId,requestId) {
    await this.connect();
    const response=await this.fetchHost('/api/workbench/requests/confirm',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({session_id:sessionId,request_id:requestId}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    return result.session_id===sessionId&&result.request_id===requestId&&result.durable===true&&result.accepted===true?
      {durable:true,cursor:result.cursor,source:result.source}:false;
  }
  async registerContext(meta) {
    await this.connect(); await this.ensureContextService();
    const response = await this.fetchHost('/api/workbench/context', {method: 'POST',
      headers: {'content-type': 'application/json'}, body: JSON.stringify(meta), signal: AbortSignal.timeout(30000)});
    const result = await response.json();
    if (result.preset_id !== meta.preset_id || result.status !== 'ready')
      throw new RuntimeError(502, 'dsh/context-not-ready', 'DSH context preset did not activate');
  }
  follow(sessionId, signal) {
    return this.mux.open('session/follow', {args: {request: {
      address: {kind: 'session', sessionId}, assistantStream: true, activate: true,
    }}}, signal);
  }
  async answer(eventId, value, generation, next = false) {
    if (!this.connected || generation !== this.generation)
      throw new RuntimeError(409, 'runtime/stale-interaction', 'Interaction connection expired');
    return this.rpc('$events/result', {clientId: this.clientId, eventId,
      outcome: next ? {kind: 'next'} : {kind: 'result', value}});
  }
  async drop() {
    this.connected = false; this.control?.abort();
    await this.mux?.close(); await this.pump;
    await this.ctx?.fiber.dispose();
    this.mux = undefined; this.ctx = undefined;
  }
  async close() { this.closed = true; await this.drop(); }
}
