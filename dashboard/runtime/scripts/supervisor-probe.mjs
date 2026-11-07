#!/usr/bin/env node
// Real, pinned DSH Host + bridge; inference is an owned localhost Responses
// fixture. No existing home, credential file, gateway, or service is touched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, open, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {bridgeToken} from '../auth.mjs';
import {loadDsh, DshPeer} from '../dsh-peer.mjs';
import {tokenFromLog} from '../host.mjs';
import {supervisorInput} from '../delivery-supervisor.mjs';

if (!process.argv.includes('--local-fake-inference')) throw Error('Pass --local-fake-inference');
if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Requires Node >= 24.9');
process.umask(0o077);
const runtimeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const modules = await loadDsh(runtimeRoot);
const require = createRequire(modules.cli);
const yaml = require('js-yaml');
const state = await mkdtemp(join(tmpdir(), 'workbench-dsh-supervisor-'));
const home = join(state, 'dsh-home');
await mkdir(home, {mode: 0o700});
const report = {status: 'running', dsh_version: '0.2.2-rc.1', node: process.version, checks: {}};
const calls = [];
const gates = new Map();
let bridge, bridgeLog, native, failure;

async function listening(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function availablePort() {
  const server = createServer(); const port = await listening(server);
  await new Promise(resolve => server.close(resolve)); return port;
}
const fake = createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/v1/responses');
    assert.equal(request.headers.authorization, 'Bearer local-probe-only');
    let body = ''; for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.model, 'local-probe');
    const marker = [...JSON.stringify(input.input).matchAll(/DSH_PROBE_[A-Z_]+/g)].at(-1)?.[0];
    if (!marker) throw Error('Unexpected model request without a probe marker');
    calls.push(marker);
    if (gates.has(marker)) await gates.get(marker).promise;
    if (marker === 'DSH_PROBE_FAILURE') {
      response.writeHead(503, {'content-type': 'application/json'});
      response.end(JSON.stringify({error: {type: 'server_error', message: 'Deliberate localhost probe failure'}}));
      return;
    }
    const text = marker === 'DSH_PROBE_EMPTY' ? '' : `${marker}: supervisor reply`;
    const id = `resp_${randomUUID().replaceAll('-', '')}`;
    const item = {id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant',
      status: 'completed', content: [{type: 'output_text', text, annotations: []}]};
    const result = {id, object: 'response', created_at: Math.floor(Date.now() / 1000), model: 'local-probe',
      status: 'completed', output: [item], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2,
        input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 0}}};
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
    let sequence = 0;
    const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({type, sequence_number: sequence++, ...data})}\n\n`);
    event('response.created', {response: {...result, status: 'in_progress', output: []}});
    event('response.output_item.added', {output_index: 0, item: {...item, status: 'in_progress', content: []}});
    if (text) event('response.output_text.delta', {item_id: item.id, output_index: 0, content_index: 0, delta: text});
    event('response.output_item.done', {output_index: 0, item});
    event('response.completed', {response: result});
    response.end();
  } catch (error) {
    failure = error;
    response.writeHead(500, {'content-type': 'application/json'});
    response.end(JSON.stringify({error: {message: 'Local fixture rejected an unexpected request'}}));
  }
});
const modelPort = await listening(fake);
const bridgePort = await availablePort();
let hostPort = await availablePort();
while (hostPort === bridgePort) hostPort = await availablePort();
await writeFile(join(home, '.env'), 'WORKBENCH_SUPERVISOR_PROBE_KEY=local-probe-only\n', {mode: 0o600});
await writeFile(join(home, 'settings.yaml'), yaml.dump({
  'llm-pi-ai': {providers: {'supervisor-probe': {api: 'openai-responses', apiKeyEnv: 'WORKBENCH_SUPERVISOR_PROBE_KEY',
    baseURL: `http://127.0.0.1:${modelPort}/v1`, models: [{id: 'local-probe', name: 'Local fixture',
      contextWindow: 32768, maxTokens: 256, input: ['text'], reasoningEfforts: false}],
    retryPolicy: {mode: 'normal', maxRetries: 0}}}},
  'agent-default-model': {provider: 'supervisor-probe', model: 'local-probe'},
}), {mode: 0o600});
const tokenPath = join(state, 'bridge.token');
await bridgeToken(tokenPath);
const headers = {authorization: `Bearer ${(await readFile(tokenPath, 'utf8')).trim()}`, 'content-type': 'application/json'};
// A whitelist prevents inherited API keys, proxy routes, and other DSH settings
// from entering the probe-owned bridge or its Host process.
const env = {PATH: process.env.PATH, LANG: 'C.UTF-8',
  WORKBENCH_DSH_STATE: state, DSH_HOME: home, DSH_MODULE_ROOT: runtimeRoot,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_PROVIDER: 'supervisor-probe', DSH_MODEL: 'local-probe',
  PORT: String(bridgePort), DSH_HOST_PORT: String(hostPort), WORKBENCH_DSH_BRIDGE_TOKEN_FILE: tokenPath,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost'};
const base = `http://127.0.0.1:${bridgePort}/api/runtime`;

async function call(path, input, expected = 200) {
  const response = await fetch(base + path, {headers, signal: AbortSignal.timeout(20000),
    ...(input === undefined ? {} : {method: 'POST', body: JSON.stringify(input)})});
  if (response.status !== expected) throw Error(`Probe ${path.split('/').at(-1)} HTTP ${response.status}`);
  return response.json();
}
async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    const value = await check(); if (value) return value;
    await delay(100);
  }
  throw Error(`Timed out: ${label}`);
}
async function start() {
  bridgeLog = await open(join(state, 'bridge.log'), 'a', 0o600);
  bridge = spawn(process.execPath, [join(runtimeRoot, 'bridge.mjs')], {env, stdio: ['ignore', bridgeLog.fd, bridgeLog.fd]});
  await until(async () => {
    if (bridge.exitCode !== null) throw Error('Probe-owned bridge exited; inspect private probe logs');
    try { return (await call('/capabilities')).status === 'ready'; } catch { return false; }
  }, 'bridge readiness');
  native = new DshPeer({url: `http://127.0.0.1:${hostPort}`, modules,
    readToken: () => tokenFromLog(join(state, 'host.log'))});
  await native.connect();
}
async function stop() {
  await native?.close(); native = undefined;
  if (bridge && bridge.exitCode === null && bridge.signalCode === null) {
    bridge.kill('SIGTERM');
    await until(() => bridge.exitCode !== null || bridge.signalCode !== null, 'probe-owned bridge shutdown', 10000);
  }
  await bridgeLog?.close(); bridgeLog = undefined; bridge = undefined;
}
async function session(name) {
  return call('/sessions', {user_id: 'probe-user', profile_id: 'supervisor-probe', project_id: randomUUID(), cwd: state,
    model: 'local-probe', title: `Isolated ${name}`}, 201);
}
function deliveryPath(owner) {
  return `/sessions/${owner.id}/deliveries?${new URLSearchParams({user_id: 'probe-user',
    profile_id: 'supervisor-probe', project_id: owner.project_id})}`;
}
const snapshot = id => call(`/sessions/${id}/snapshot`);
async function journal(id) {
  const abort = new AbortController();
  const stream = native.follow(id, abort.signal);
  try {
    const frame = (await stream.next()).value;
    assert.equal(frame.type, 'snapshot'); assert.equal(frame.hasMore, false);
    return frame.records.map(record => record.event);
  } finally { abort.abort(); await stream.return?.(); }
}
function hold(marker) {
  let release; const promise = new Promise(resolve => { release = resolve; });
  gates.set(marker, {promise, release}); return release;
}
function delivery(marker) {
  return {source: 'fleet', epoch: 1, task_id: `probe-${randomUUID()}`, attempt_id: randomUUID(),
    idempotency_key: randomUUID(), kind: 'result', content: marker, wake_supervisor: true};
}
async function terminal(id, key, expected = 'delivered') {
  return until(async () => {
    const value = await snapshot(id);
    const item = value.deliveries.find(d => d.idempotency_key === key);
    if (item && ['delivered', 'failed', 'cancelled', 'empty'].includes(item.supervisor?.status)) {
      assert.equal(item.supervisor.status, expected); return {snapshot: value, delivery: item};
    }
    return false;
  }, `supervisor ${expected}`);
}
function assertOnePrompt(events, requestId) {
  const matches = events.filter(event => event.type === 'user/message' && event.data.source?.rpcId === requestId);
  assert.equal(matches.length, 1); return matches[0];
}

try {
  await start();
  const direct = await session('native protocol');
  const requestId = randomUUID();
  await call(`/sessions/${direct.id}/messages`, {request_id: requestId, content: 'DSH_PROBE_DIRECT'}, 202);
  await until(async () => (await snapshot(direct.id)).messages.some(m => m.role === 'assistant' && m.content.includes('DSH_PROBE_DIRECT')), 'native reply');
  let events = await journal(direct.id);
  const user = assertOnePrompt(events, requestId);
  assert.equal(user.data.turn, undefined);
  const turn = events.filter(e => e.seq < user.seq && e.type === 'turn/start').at(-1).data.turn;
  assert.ok(events.some(e => e.type === 'turn/end' && e.data.turn === turn && e.data.reason.kind === 'completed'));
  report.native_event_sample = events.filter(e => ['turn/start', 'user/message', 'assistant/message', 'turn/end'].includes(e.type))
    .filter(e => e.type !== 'user/message' || e.data.source?.rpcId)
    .map(e => ({seq: e.seq, type: e.type, ...(e.data.turn === undefined ? {} : {turn: e.data.turn}),
      ...(e.type === 'user/message' ? {source: {kind: e.data.source.kind, rpcId: '<request-id>'}} : {}),
      ...(e.type === 'turn/end' ? {reason: e.data.reason} : {})}));
  report.checks.native_turn_mapping = true;
  const nativePrompt = {sessionId: direct.id, requestId, mode: 'queue', content: [{type: 'text', text: 'DSH_PROBE_DIRECT'}]};
  await native.call('prompt', nativePrompt); assert.ok((await native.confirmRequest(direct.id, requestId)).durable);
  assertOnePrompt(await journal(direct.id), requestId);
  assert.equal(calls.filter(x => x === 'DSH_PROBE_DIRECT').length, 1);
  await stop(); await start();
  await native.call('prompt', nativePrompt); assert.ok((await native.confirmRequest(direct.id, requestId)).durable);
  assertOnePrompt(await journal(direct.id), requestId);
  assert.equal(calls.filter(x => x === 'DSH_PROBE_DIRECT').length, 1);
  report.checks.completed_native_request_dedup_after_restart = true;

  const target = await session('supervisor callbacks');
  const first = delivery('DSH_PROBE_CALLBACK');
  await Promise.all(Array.from({length: 3}, () => call(deliveryPath(target), first, 202)));
  const result = await terminal(target.id, first.idempotency_key);
  assert.equal(result.snapshot.deliveries.length, 1);
  assert.ok(result.snapshot.messages.some(m => m.role === 'assistant' && m.content.includes(first.content)));
  assert.ok(result.snapshot.messages.every(m => m.request_id !== result.delivery.supervisor.request_id));
  assertOnePrompt(await journal(target.id), result.delivery.supervisor.request_id);
  assert.equal(calls.filter(x => x === first.content).length, 1);
  report.checks.callback_without_browser = true;
  report.checks.duplicate_delivery_one_native_prompt = true;
  report.checks.internal_prompt_hidden = true;

  const release = hold('DSH_PROBE_BUSY');
  await call(`/sessions/${target.id}/messages`, {content: 'DSH_PROBE_BUSY'}, 202);
  await until(() => calls.includes('DSH_PROBE_BUSY'), 'busy model request');
  const queued = delivery('DSH_PROBE_QUEUED');
  await call(deliveryPath(target), queued, 202);
  const pending = await until(async () => {
    const item = (await snapshot(target.id)).deliveries.find(d => d.idempotency_key === queued.idempotency_key);
    return item?.supervisor?.status === 'queued' && item;
  }, 'queued callback while user turn is running');
  assert.ok(!calls.includes(queued.content));
  release();
  await terminal(target.id, queued.idempotency_key);
  assertOnePrompt(await journal(target.id), pending.supervisor.request_id);
  assert.equal(calls.filter(x => x === queued.content).length, 1);
  report.checks.busy_user_turn_preserved = true;
  report.checks.queued_callback_runs_after_user_turn = true;

  // Rewind only this probe-owned bridge acknowledgement. Native history is
  // already durable. Recovery must observe it without executing the task twice.
  await stop();
  const metadataPath = join(state, 'bridge-state', 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const saved = metadata.sessions.find(s => s.id === target.id);
  const record = saved.deliveries.find(d => d.idempotency_key === queued.idempotency_key);
  record.supervisor.status = 'pending';
  const receipt = saved.requests[record.supervisor.request_id];
  receipt.status = 'intended'; receipt.durable = false; receipt.input = supervisorInput(record);
  await writeFile(metadataPath, JSON.stringify(metadata), {mode: 0o600});
  await start(); await terminal(target.id, queued.idempotency_key);
  assertOnePrompt(await journal(target.id), record.supervisor.request_id);
  assert.equal(calls.filter(x => x === queued.content).length, 1);
  report.checks.lost_callback_ack_recovered_without_reexecution = true;

  for (const [marker, expected] of [['DSH_PROBE_FAILURE', 'failed'], ['DSH_PROBE_EMPTY', 'empty']]) {
    const owner = await session(expected);
    const update = delivery(marker);
    await call(deliveryPath(owner), update, 202);
    const ended = await terminal(owner.id, update.idempotency_key, expected);
    assert.equal(ended.delivery.supervisor.fallback, true);
    assert.equal(ended.delivery.content, marker);
    report.checks[`${expected}_callback_keeps_visible_result`] = true;
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
} finally {
  for (const gate of gates.values()) gate.release();
  try { await stop(); } catch (error) { report.cleanup_error = error.message; process.exitCode = 1; }
  fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve));
  report.model_calls = calls;
  await writeFile(join(state, 'RESULTS.json'), JSON.stringify(report, null, 2), {mode: 0o600});
  console.log(JSON.stringify({...report, state}));
}
