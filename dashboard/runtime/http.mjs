import http from 'node:http';
import {once} from 'node:events';
import {RuntimeError, publicError} from './errors.mjs';

import {MAX_HTTP_BYTES} from './images.mjs';
const MAX_BODY = MAX_HTTP_BYTES;
async function body(req) {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
    throw new RuntimeError(415, 'runtime/json-required', 'Content-Type must be application/json');
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { req.resume(); throw new RuntimeError(413, 'runtime/body-too-large', 'Request is too large'); }
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > MAX_BODY) { req.resume(); throw new RuntimeError(413, 'runtime/body-too-large', 'Request is too large'); }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw new RuntimeError(400, 'runtime/invalid-json', 'Expected a JSON object'); }
}
function json(res, status, value) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(value));
}
function cursorOf(value, id) {
  if (value === null || value === undefined || value === '') return undefined;
  const text = value.startsWith(`${id}:`) ? value.slice(id.length + 1) : value;
  if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < -1)
    throw new RuntimeError(400, 'runtime/invalid-cursor', 'Invalid Session cursor');
  return Number(text);
}
async function sse(req, res, runtime, id, scope, url) {
  const cursor = cursorOf(url.searchParams.get('cursor') ?? req.headers['last-event-id'], id);
  let sequence = 0;
  let opening = true; let closed = false; const buffered = [];
  const write = event => {
    if (closed) return;
    if (res.writableLength > 1024 * 1024) { res.destroy(); return; }
    const durable = Number.isInteger(event.cursor);
    res.write(`${durable ? `id: ${id}:${event.cursor}\n` : ''}data: ${JSON.stringify({...event, sequence: ++sequence})}\n\n`);
  };
  const listener = event => {
    if (event.session_id !== id) return;
    if (opening) {
      buffered.push(event);
      if (buffered.length > 1000) res.destroy();
    } else write(event);
  };
  const cleanup = () => { closed = true; runtime.off('event', listener); clearInterval(heartbeat); };
  let heartbeat;
  res.on('close', cleanup); runtime.on('event', listener);
  try {
    const snapshot = await runtime.snapshot(id, scope);
    if (closed) return;
    if (cursor !== undefined && cursor > snapshot.cursor)
      throw new RuntimeError(409, 'runtime/cursor-ahead', 'Cursor is ahead of the native Session journal');
    res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store',
      connection: 'keep-alive', 'x-accel-buffering': 'no'});
    res.flushHeaders();
    // Every reconnect sends a full native baseline. Its cursor supersedes all
    // buffered events and transient chunks already represented by this snapshot.
    write({type: 'snapshot', session_id: id, cursor: snapshot.cursor, data: snapshot});
    opening = false;
    for (const event of buffered) if (Number.isInteger(event.cursor) && event.cursor > snapshot.cursor) write(event);
    heartbeat = setInterval(() => { if (!closed) res.write(': heartbeat\n\n'); }, 15000);
    heartbeat.unref();
  } catch (e) { cleanup(); throw e; }
}
export async function startHttp(runtime, {port = 38472, allowedOrigins = [], authenticate} = {}) {
  if (typeof authenticate !== 'function') throw new RuntimeError(503, 'runtime/auth-required', 'Bridge authentication must be configured');
  const server = http.createServer(async (req, res) => {
    try {
      if (!authenticate(req.headers.authorization))
        throw new RuntimeError(401, 'runtime/unauthorized', 'Bridge authentication required');
      const ownPort = server.address().port;
      const expected = new Set([`127.0.0.1:${ownPort}`, `localhost:${ownPort}`, `[::1]:${ownPort}`]);
      if (!expected.has(req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site')
        throw new RuntimeError(403, 'runtime/untrusted-host', 'Untrusted request authority');
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)
        && ![...expected].map(x => `http://${x}`).includes(req.headers.origin))
        throw new RuntimeError(403, 'runtime/untrusted-origin', 'Untrusted request origin');
      const url = new URL(req.url, `http://127.0.0.1:${ownPort}`);
      const scope = Object.fromEntries(['profile_id', 'project_id', 'user_id'].filter(k => url.searchParams.has(k)).map(k => [k, url.searchParams.get(k)]));
      for (const value of Object.values(scope)) if (!value) throw new RuntimeError(400, 'runtime/invalid-scope', 'Scope filters must be nonempty');
      if (req.method === 'GET' && url.pathname === '/api/runtime/capabilities') return json(res, 200, runtime.capabilities());
      if (req.method === 'GET' && url.pathname === '/api/runtime/models') return json(res, 200, await runtime.models());
      if (url.pathname === '/api/runtime/sessions') {
        if (req.method === 'GET') return json(res, 200, runtime.list(scope));
        if (req.method === 'POST') return json(res, 201, await runtime.create(await body(req)));
      }
      const receipt = url.pathname.match(/^\/api\/runtime\/sessions\/([^/]+)\/requests\/([^/]+)$/);
      if (req.method === 'GET' && receipt) return json(res, 200, runtime.receipt(decodeURIComponent(receipt[1]), decodeURIComponent(receipt[2]), scope));
      const match = url.pathname.match(/^\/api\/runtime\/sessions\/([^/]+)\/(snapshot|events|messages|cancel|interactions\/([^/]+))$/);
      if (match) {
        const id = decodeURIComponent(match[1]); runtime.get(id, scope);
        if (req.method === 'GET' && match[2] === 'snapshot') return json(res, 200, await runtime.snapshot(id, scope));
        if (req.method === 'GET' && match[2] === 'events') return await sse(req, res, runtime, id, scope, url);
        if (req.method === 'POST' && match[2] === 'messages') return json(res, 202, await runtime.message(id, await body(req), scope));
        if (req.method === 'POST' && match[2] === 'cancel') return json(res, 202, await runtime.cancel(id, scope));
        if (req.method === 'POST' && match[3]) return json(res, 202, await runtime.answer(id, decodeURIComponent(match[3]), await body(req), scope));
      }
      throw new RuntimeError(404, 'runtime/not-found', 'Route not found');
    } catch (error) {
      if (res.headersSent) res.destroy();
      else json(res, error instanceof RuntimeError ? error.status : 503, {error: publicError(error)});
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  return {server, url: `http://127.0.0.1:${server.address().port}`,
    async close() { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }};
}
