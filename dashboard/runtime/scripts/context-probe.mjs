#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {solidPng} from '../test/png.mjs';
if (!process.argv.includes('--real-local-inference')) throw Error('Explicit opt-in required');
process.umask(0o077);
const state = resolve(process.env.WORKBENCH_DSH_STATE ?? join(homedir(), '.local/state/workbench-dsh-mac/runtime'));
const tokenPath = process.env.WORKBENCH_DSH_BRIDGE_TOKEN_FILE ?? join(state, 'bridge.token');
const token = (await readFile(tokenPath, 'utf8')).trim();
const base = process.env.WORKBENCH_RUNTIME_URL ?? 'http://127.0.0.1:38472';
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)) throw Error('Local probe only');
const headers = {'content-type': 'application/json', authorization: `Bearer ${token}`};
async function call(path, input, expected = 200) {
  const res = await fetch(base + '/api/runtime' + path, {headers, ...(input === undefined ? {} : {method: 'POST', body: JSON.stringify(input)})});
  if (res.status !== expected) throw Error(`Bridge ${path.split('/').at(-1)} HTTP ${res.status}`);
  return res.json();
}
const report = {checks: {}, sessions: [], status: 'running'};
let controls = []; let pumps = [];
async function observe(session) {
  const control = new AbortController(); controls.push(control); const events = [];
  const res = await fetch(base + `/api/runtime/sessions/${session.id}/events`, {headers, signal: control.signal});
  assert.equal(res.status, 200);
  const task = (async () => {
    let buffer = ''; let sequence = 0;
    for await (const bytes of res.body) {
      buffer += new TextDecoder().decode(bytes);
      for (let at; (at = buffer.indexOf('\n\n')) >= 0;) {
        const part = buffer.slice(0,at); buffer = buffer.slice(at+2); const line = part.split('\n').find(x => x.startsWith('data: '));
        if (!line) continue; const e = JSON.parse(line.slice(6)); assert.equal(e.sequence, ++sequence); events.push(e);
        if (e.type === 'interaction.requested') {
          const value = e.data.kind === 'approval' ? {decision: e.data.command === 'mcp__probe__scope_marker' ? 'allowed-once' : 'rejected'}
            : {answer: {answers: e.data.questions.map(q => ({id:q.id,selected:[],custom:'PROBE_ANSWER'}))}};
          await call(`/sessions/${session.id}/interactions/${encodeURIComponent(e.data.id)}`, value, 202);
        }
      }
    }
  })().catch(e => { if (!control.signal.aborted) throw e; }); pumps.push(task); return events;
}
async function turn(session, input, events) {
  const start = events.length; const request_id = input.request_id ?? randomUUID();
  const old = await call(`/sessions/${session.id}/snapshot`);
  await call(`/sessions/${session.id}/messages`, {...input, request_id}, 202);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const snapshot = await call(`/sessions/${session.id}/snapshot`);
    if (snapshot.status === 'error') throw Error('Native turn failed; inspect private Host log/journal');
    if (snapshot.cursor > old.cursor && snapshot.status === 'completed') return {snapshot, events: events.slice(start), request_id};
    await new Promise(r => setTimeout(r,150));
  }
  throw Error('Native turn timed out');
}
try {
  const fixture = fileURLToPath(new URL('../test/mcp-fixture.py', import.meta.url));
  for (const side of ['a','b']) {
    const suffix = randomUUID().slice(0,8); const cwd = join(state,'scope-probe',side+'-'+suffix); await mkdir(cwd,{recursive:true,mode:0o700});
    const marker = `MEMORY_${side.toUpperCase()}_${suffix}`; const skillMarker = `SKILL_${side.toUpperCase()}_${suffix}`;
    const mcpMarker = `MCP_${side.toUpperCase()}_${suffix}`;
    const session = await call('/sessions', {user_id: 'probe-user-'+side, profile_id:'probe-profile-'+side, project_id:'probe-project', cwd,
      runtime_context: {workspace:cwd, memory:{'MEMORY.md':`Remember marker ${marker}. The literal placeholder is {{profile_literal}}.`, 'SOUL.md':'Be concise.'},
        skills:[{name:'probe-skill-'+side,content:`When loaded, report exactly ${skillMarker}.`,version:'1'}],
        mcpServers:{probe:{transport:'stdio',command:'python3',args:[fixture],env:{PROBE_MARKER:mcpMarker},enabled:true}}}}, 201);
    report.sessions.push({id:session.id,side,marker,skillMarker,mcpMarker}); const events = await observe(session);
    const done = await turn(session,{content:`State the remembered marker and literal placeholder. Load skill probe-skill-${side} using the skill tool and report its marker. Call mcp__probe__scope_marker once and report its result. Do not read files or use bash. Then list the names of your available skills and MCP tools.`},events);
    const text = done.snapshot.messages.filter(m=>m.role==='assistant').map(m=>m.content).join('\n');
    assert.ok(text.includes(marker),'Memory marker absent'); assert.ok(text.includes('{{profile_literal}}'),'Memory literal was interpolated');
    assert.ok(text.includes(skillMarker),'Selected skill content absent');
    assert.ok(done.snapshot.tools.some(x=>x.name==='skill'&&x.content?.includes(skillMarker)),'Native selected skill load absent'); assert.ok(text.includes(mcpMarker),'MCP result absent');
    assert.ok(done.events.some(e=>e.data?.tool?.name==='mcp__probe__scope_marker'),'Native MCP tool call absent');
    assert.ok(done.snapshot.tools.some(x=>x.name==='mcp__probe__scope_marker'&&x.status==='completed'),'Restored tool card absent');
    if(side==='b') {
      const other = report.sessions[0]; for(const forbidden of [other.marker,other.skillMarker,other.mcpMarker,'probe-skill-a']) assert.ok(!text.includes(forbidden),'Scope content leaked');
      report.checks.two_profile_isolation = true;
    }
    report.checks['context_'+side] = true;
    if(side==='a') {
      const image = await turn(session,{content:'What color fills this image? Reply with exactly VISION_RED if it is red, or VISION_OTHER otherwise. Do not use tools.',
        attachments:[{type:'image',media_type:'image/png',data:solidPng().toString('base64'),name:'red.png'}]},events);
      assert.ok(image.snapshot.messages.some(m=>m.role==='assistant'&&m.content==='VISION_RED'),'Vision inference failed');
      const user = image.snapshot.messages.find(m=>m.request_id===image.request_id); assert.ok(user.attachments?.[0]?.attachmentId,'Native image reference absent');
      assert.ok(!JSON.stringify(user.attachments).includes('base64')); report.checks.real_vision = true;
      const tool = done.snapshot.tools.find(x=>x.name==='mcp__probe__scope_marker');
      report.sanitized_tool_sample = {...tool, content:'MCP_PROFILE_MARKER', arguments:'{}', call_id:'native-call-id'};
      await writeFile(join(state,'tool-sample.json'),JSON.stringify(report.sanitized_tool_sample,null,2),{mode:0o600});
    }
  }
  report.status='passed';
} catch(e) { report.status='failed'; report.error=e.message; process.exitCode=1; }
finally { for(const c of controls)c.abort(); await Promise.allSettled(pumps); await writeFile(join(state,'context-probe-results.json'),JSON.stringify(report,null,2),{mode:0o600}); console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error})); }
