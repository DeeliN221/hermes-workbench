#!/usr/bin/env node
// Owns every process it signals. Run after stopping an existing test bridge.
import {spawn} from 'node:child_process';
import {readFile, writeFile, open} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
if (!process.argv.includes('--real-local-inference')) throw Error('Explicit opt-in required');
process.umask(0o077);
const state=resolve(process.env.WORKBENCH_DSH_STATE??join(homedir(),'.local/state/workbench-dsh-mac/runtime'));
const token=(await readFile(process.env.WORKBENCH_DSH_BRIDGE_TOKEN_FILE??join(state,'bridge.token'),'utf8')).trim();
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
const base='http://127.0.0.1:'+(process.env.PORT??38472); const report={checks:{},status:'running'};let child;let handle;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,input,expected=200){
 const response=await fetch(base+'/api/runtime'+path,{headers,...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});
 if(response.status!==expected)throw Error(`Bridge ${path.split('/').at(-1)} HTTP ${response.status}`);return response.json();
}
async function start(){
 handle=await open(join(state,'restart-probe-bridge.log'),'a',0o600);
 child=spawn(process.execPath,[fileURLToPath(new URL('../bridge.mjs',import.meta.url))],{env:process.env,stdio:['ignore',handle.fd,handle.fd]});
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Probe-owned bridge exited');try{await call('/capabilities');return;}catch{}await wait(100);}
 throw Error('Probe-owned bridge readiness timed out');
}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');for(let i=0;i<100&&child.exitCode===null&&child.signalCode===null;i++)await wait(100);if(child.exitCode===null&&child.signalCode===null)throw Error('Probe-owned bridge did not stop cleanly');}await handle?.close();child=undefined;handle=undefined;}
async function completed(id,requestId){const deadline=Date.now()+60000;while(Date.now()<deadline){const s=await call(`/sessions/${id}/snapshot`);if(s.status==='error')throw Error('Native recovery turn failed');if(s.status==='completed'&&s.messages.some(m=>m.request_id===requestId))return s;await wait(100);}throw Error('Native recovery turn timed out');}
try{
 try{await fetch(base+'/api/runtime/capabilities');throw Error('Stop existing test bridge before restart probe');}catch(e){if(e.message.startsWith('Stop existing'))throw e;}
 await start();const session=await call('/sessions',{profile_id:'restart-probe',project_id:randomUUID(),cwd:state},201);
 const request_id=randomUUID(); const content='Reply with exactly DSH_RESTART_OK. Do not use tools.';
 await call(`/sessions/${session.id}/messages`,{content,client_request_id:request_id},202);
 const before=await completed(session.id,request_id);assert.equal(before.messages.filter(m=>m.request_id===request_id).length,1);
 report.session_id=session.id;report.request_id=request_id;report.checks.initial_native_reply=true;
 await stop();report.checks.bridge_and_host_stopped=true;
 // Deliberately simulate a lost native acceptance acknowledgement on this
 // probe-owned request. The durable native log already has this requestId.
 const metadataPath=join(state,'bridge-state','metadata.json');const metadata=JSON.parse(await readFile(metadataPath,'utf8'));
 const record=metadata.sessions.find(s=>s.id===session.id).requests[request_id];record.status='intended';record.input={content,mode:'queue'};
 await writeFile(metadataPath,JSON.stringify(metadata),{mode:0o600});
 await start();let receipt;
 for(let i=0;i<150;i++){receipt=await call(`/sessions/${session.id}/requests/${request_id}`);if(receipt.accepted)break;await wait(100);}
 assert.equal(receipt.status,'accepted');await call(`/sessions/${session.id}/messages`,{content,request_id},202);
 const after=await completed(session.id,request_id);assert.equal(after.messages.filter(m=>m.request_id===request_id).length,1);
 assert.deepEqual(after.messages,before.messages);report.checks.native_dedup_after_bridge_and_host_restart=true;
 const oldProcess=JSON.parse(await readFile(join(state,'bridge-process.json'),'utf8'));
 assert.equal(oldProcess.pid,child.pid);assert.equal(oldProcess.owner,'workbench-dsh-runtime');
 process.kill(oldProcess.host_pid,'SIGKILL');
 let newProcess;
 for(let i=0;i<200;i++){await wait(100);try{newProcess=JSON.parse(await readFile(join(state,'bridge-process.json'),'utf8'));if(newProcess.host_pid!==oldProcess.host_pid){const restored=await call(`/sessions/${session.id}/snapshot`);if(restored.status==='completed')break;}}catch{}}
 assert.notEqual(newProcess.host_pid,oldProcess.host_pid);assert.equal(newProcess.pid,child.pid);
 const nativeRecovered=await call(`/sessions/${session.id}/snapshot`);assert.deepEqual(nativeRecovered.messages,before.messages);
 report.checks.native_host_restart_without_bridge_restart=true;
 const contexts=JSON.parse(await readFile(join(state,'context-probe-results.json'),'utf8'));
 const a=contexts.sessions.find(s=>s.side==='a');
 const markerReq=randomUUID();await call(`/sessions/${a.id}/messages`,{content:'State your remembered MEMORY marker and literal placeholder only. Do not use tools.',request_id:markerReq},202);
 const recovered=await completed(a.id,markerReq);const text=recovered.messages.filter(m=>m.role==='assistant').at(-1).content;
 assert.ok(text.includes(a.marker));assert.ok(text.includes('{{profile_literal}}'));assert.ok(recovered.tools.some(x=>x.name==='mcp__probe__scope_marker'));
 report.checks.scoped_context_and_tool_cards_after_host_restart=true;report.status='passed';
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
finally{await stop();await writeFile(join(state,'restart-probe-results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));}
