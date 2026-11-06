#!/usr/bin/env node
import {readFile,writeFile,mkdir,stat,unlink}from'node:fs/promises';
import {homedir}from'node:os';import{join}from'node:path';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';
if(!process.argv.includes('--real-local-inference'))throw Error('Explicit opt-in required');process.umask(0o077);
const state=process.env.WORKBENCH_DSH_STATE??join(homedir(),'.local/state/workbench-dsh-mac/runtime');
const token=(await readFile(process.env.WORKBENCH_DSH_BRIDGE_TOKEN_FILE??join(state,'bridge.token'),'utf8')).trim();
const base=process.env.WORKBENCH_RUNTIME_URL??'http://127.0.0.1:38472';const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
async function call(path,value,status=200){const r=await fetch(base+'/api/runtime'+path,{headers,...(value===undefined?{}:{method:'POST',body:JSON.stringify(value)})});if(r.status!==status)throw Error(`Bridge HTTP ${r.status}`);return r.json();}
const report={checks:{},status:'running'};const abort=new AbortController();let pump;
const target=join(state,'deny-probe-'+randomUUID()+'.txt');
try{
 const cwd=join(state,'deny-probe-workspace');await mkdir(cwd,{recursive:true,mode:0o700});
 const session=await call('/sessions',{profile_id:'deny-probe',project_id:randomUUID(),cwd},201);report.session_id=session.id;
 const response=await fetch(base+`/api/runtime/sessions/${session.id}/events`,{headers,signal:abort.signal});assert.equal(response.status,200);
 pump=(async()=>{let buffer='';for await(const bytes of response.body){buffer+=new TextDecoder().decode(bytes);for(let at;(at=buffer.indexOf('\n\n'))>=0;){const part=buffer.slice(0,at);buffer=buffer.slice(at+2);const line=part.split('\n').find(l=>l.startsWith('data: '));if(!line)continue;const e=JSON.parse(line.slice(6));if(e.type==='interaction.requested'&&e.data.kind==='approval'){
  report.checks.native_approval_requested=true;await call(`/sessions/${session.id}/interactions/${encodeURIComponent(e.data.id)}`,{decision:'rejected'},202);report.checks.native_approval_denied=true;
 }}}})().catch(e=>{if(!abort.signal.aborted)throw e;});
 await call(`/sessions/${session.id}/messages`,{request_id:randomUUID(),content:`Use bash exactly once to run this command: printf DSH_DENY_WRITE > '${target}'. In that same tool call explicitly set sandbox_permissions to danger-full-access and justification to Private bridge approval denial probe. The human will reject this permission request. After rejection do not retry or switch tools; reply DSH_DENY_OK. If the command is allowed, reply DSH_APPROVAL_NOT_REQUESTED.`},202);
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){const s=await call(`/sessions/${session.id}/snapshot`);if(s.status==='error')throw Error('Native denial turn failed');if(s.status==='completed'){
  assert.ok(report.checks.native_approval_denied,'Native Host did not ask for approval');assert.ok(s.messages.filter(m=>m.role==='assistant').some(m=>m.content.includes('DSH_DENY_OK')));
  assert.ok(!(await stat(target).catch(()=>null)),'Denied tool still wrote its target');report.checks.denied_action_not_executed=true;report.status='passed';break;
 }await new Promise(r=>setTimeout(r,150));}
 if(report.status!=='passed')throw Error('Native approval probe timed out');
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
finally{abort.abort();await pump;await unlink(target).catch(()=>{});await writeFile(join(state,'deny-probe-results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));}
