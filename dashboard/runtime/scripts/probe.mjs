#!/usr/bin/env node
// Explicitly opt in to real inference through the running loopback bridge.
// No credentials, tokenized URL, native transcript, or personal path is emitted.
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {mkdir, writeFile, chmod, readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
if (!process.argv.includes('--real-local-inference')) throw Error('Pass --real-local-inference to opt in');
process.umask(0o077);
const base = new URL(process.env.WORKBENCH_RUNTIME_URL ?? 'http://127.0.0.1:38472');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw Error('Probe is local-only');
const state = resolve(process.env.WORKBENCH_DSH_STATE ?? join(homedir(), '.local/state/workbench-dsh-mac/runtime'));
const scratch = join(state, 'probe-workspace'); await mkdir(scratch, {recursive: true, mode: 0o700}); await chmod(scratch, 0o700);
const token = (await readFile(process.env.WORKBENCH_DSH_BRIDGE_TOKEN_FILE ?? join(state, 'bridge.token'), 'utf8')).trim();
const authHeaders = {authorization: `Bearer ${token}`};
const result = {dsh_version: '0.2.2-rc.1', node: process.version, provider: 'magpie-responses', model: 'codex/gpt-6.1-sol', checks: {}};
const call = async (path, input, expected = 200) => {
  const response = await fetch(new URL(`/api/runtime${path}`, base), input === undefined ? {headers: authHeaders} : {
    method: 'POST', headers: {...authHeaders, 'content-type': 'application/json'}, body: JSON.stringify(input),
  });
  if (response.status !== expected) throw Error(`Bridge ${path.split('/').at(-1)} HTTP ${response.status}`);
  return response.json();
};
let abort; let pump;
try {
  const capabilities = await call('/capabilities'); assert.equal(capabilities.status, 'ready');
  const models = await call('/models'); assert.ok(models.models.some(x => x.id === result.model && x.provider === result.provider));
  result.checks.models = true;
  const session = await call('/sessions', {profile_id: 'integration-probe', project_id: `local-${randomUUID()}`,
    cwd: scratch, model: result.model, title: 'Private runtime integration probe'}, 201);
  const id = session.id; result.session_id = id;
  const events = []; const interactionAnswers = [];
  abort = new AbortController();
  const response = await fetch(new URL(`/api/runtime/sessions/${id}/events`, base), {signal: abort.signal, headers: authHeaders});
  assert.equal(response.status, 200);
  pump = (async () => {
    const reader = response.body.getReader(); let buffer = '';
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      buffer += new TextDecoder().decode(value);
      for (let index; (index = buffer.indexOf('\n\n')) >= 0;) {
        const part = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const line = part.split('\n').find(x => x.startsWith('data: ')); if (!line) continue;
        const event = JSON.parse(line.slice(6)); assert.equal(event.sequence, events.length + 1); events.push(event);
        if (event.type === 'interaction.requested') {
          const input = event.data.type === 'approval' ? {decision: 'rejected'} : {answer: {answers: event.data.questions.map(q => ({
            id: q.id, selected: [], custom: 'DSH_ANSWER_OK',
          }))}};
          await call(`/sessions/${id}/interactions/${encodeURIComponent(event.data.request_id)}`, input, 202);
          interactionAnswers.push(event.data.type);
        }
      }
    }
  })().catch(e => { if (!abort.signal.aborted) throw e; });
  async function turn(text, marker, name) {
    const cursor = (await call(`/sessions/${id}/snapshot`)).cursor; const start = events.length;
    const request_id = randomUUID();
    const receipt = await call(`/sessions/${id}/messages`, {content: text, request_id}, 202);
    assert.equal(receipt.status, 'accepted');
    await call(`/sessions/${id}/messages`, {content: text, request_id}, 202);
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const snapshot = await call(`/sessions/${id}/snapshot`);
      const observed = events.slice(start);
      if (observed.some(e => e.type === 'error') || snapshot.status === 'error') throw Error(`Real ${name} failed (see private native journal)`);
      if (snapshot.cursor > cursor && snapshot.status === 'completed') {
        assert.ok(snapshot.messages.some(x => x.role === 'assistant' && x.content.includes(marker)), `Missing ${name} marker`);
        assert.equal(snapshot.messages.filter(m => m.request_id === request_id).length, 1);
        assert.deepEqual(snapshot.session, session); result.checks[name] = true; return {snapshot, observed};
      }
      await new Promise(r => setTimeout(r, 150));
    }
    throw Error(`Real ${name} timed out`);
  }
  const reply = await turn('Reply with exactly DSH_BRIDGE_OK. Do not use tools.', 'DSH_BRIDGE_OK', 'assistant_reply');
  assert.ok(reply.observed.some(e => e.type === 'assistant.delta' && e.cursor === undefined));
  assert.ok(reply.observed.some(e => e.type === 'message.committed' && Number.isInteger(e.cursor)));
  result.checks.sse_transient_and_durable = true;
  const tools = await turn('Use the bash tool to run exactly `printf DSH_TOOL_OK` in the current directory. Then reply DSH_TOOL_OK after checking the result.', 'DSH_TOOL_OK', 'tool_turn');
  result.checks.tool_call = tools.observed.some(e => e.data?.tool?.type === 'tool/call');
  result.checks.tool_result = tools.observed.some(e => e.data?.tool?.type === 'tool/result');
  await turn('Use ask_user_question exactly once. Ask a single question with id probe-question and question "Runtime probe answer?". Wait for its answer. After receiving DSH_ANSWER_OK, reply with exactly DSH_INTERACTION_OK.', 'DSH_INTERACTION_OK', 'question_turn');
  result.checks.question_answered = interactionAnswers.includes('question');
  const cancelStart = events.length;
  const activeId = randomUUID(); const queuedId = randomUUID();
  await call(`/sessions/${id}/messages`, {content: 'Use bash to run exactly `sleep 4` once. After it exits, reply DSH_CANCEL_TASK.', request_id: activeId}, 202);
  const toolDeadline = Date.now() + 30000;
  while (!events.slice(cancelStart).some(e => e.data?.tool?.type === 'tool/call')) {
    if (Date.now() > toolDeadline) throw Error('Cancellation probe did not enter a tool call');
    await new Promise(r => setTimeout(r, 50));
  }
  await call(`/sessions/${id}/messages`, {content: 'Reply with exactly DSH_QUEUED_OK. Do not use tools.', request_id: queuedId}, 202);
  await call(`/sessions/${id}/cancel`, {}, 202);
  const cancelDeadline = Date.now() + 10000;
  while (Date.now() < cancelDeadline) {
    const snapshot = await call(`/sessions/${id}/snapshot`);
    if (snapshot.status === 'error') throw Error('Cancellation probe reached an inference error');
    if (snapshot.status === 'cancelled') {
      assert.ok(snapshot.inbox.some(item => item.rpcId === queuedId));
      result.checks.cancel_preserves_queue = true; break;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!result.checks.cancel_preserves_queue) throw Error('Cancellation did not retain queued input');
  const resumedTurn = await turn('Resume processing the retained inbox, then reply with exactly DSH_QUEUED_OK. Do not use tools.', 'DSH_QUEUED_OK', 'cancel_queue_resumed');
  assert.equal(resumedTurn.snapshot.messages.filter(m => m.request_id === queuedId).length, 1);
  const bad = await fetch(new URL(`/api/runtime/sessions/${id}/messages`, base), {
    method: 'POST', headers: {...authHeaders, 'content-type': 'application/json'}, body: JSON.stringify({content: 'image', attachments: [{type: 'file'}]}),
  }); assert.equal(bad.status, 415); result.checks.files_explicitly_unsupported = true;
  const snapshot = await call(`/sessions/${id}/snapshot`);
  const reconnect = new AbortController();
  const resumed = await fetch(new URL(`/api/runtime/sessions/${id}/events?cursor=${snapshot.cursor}`, base), {signal: reconnect.signal, headers: authHeaders});
  const chunk = await resumed.body.getReader().read();
  const line = new TextDecoder().decode(chunk.value).split('\n').find(x => x.startsWith('data: '));
  const baseline = JSON.parse(line.slice(6)); assert.deepEqual(baseline.data.messages, snapshot.messages); reconnect.abort();
  result.checks.sse_reconnect = true;
  result.unsupported = capabilities.capabilities.attachments;
  result.status = 'passed';
} catch (error) { result.status = 'failed'; result.error = error.message; process.exitCode = 1; }
finally {
  abort?.abort(); await pump;
  await writeFile(join(state, 'probe-results.json'), JSON.stringify(result, null, 2), {mode: 0o600});
  console.log(JSON.stringify({status: result.status, checks: result.checks, ...(result.error ? {error: result.error} : {})}));
}
