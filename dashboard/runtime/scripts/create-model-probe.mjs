#!/usr/bin/env node
// Runs only in a fresh private child state/ports; never signals the parent bridge.
import {spawn} from 'node:child_process';
import {mkdir, copyFile, readFile, writeFile, open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {bridgeToken} from '../auth.mjs';
import {loadDsh, DshPeer} from '../dsh-peer.mjs';
import {tokenFromLog} from '../host.mjs';
if (!process.argv.includes('--real-local-inference')) throw Error('Explicit opt-in required');
process.umask(0o077);
const parentState=resolve(process.env.WORKBENCH_DSH_PROBE_PARENT_STATE??join(homedir(),'.local/state/workbench-dsh-mac/runtime'));
const state=join(parentState,'create-model-probe-'+randomUUID());const home=join(state,'dsh-home');
const source=resolve(process.env.DSH_PROBE_HOME_SOURCE??join(parentState,'dsh-home'));
const moduleRoot=process.env.DSH_MODULE_ROOT??join(parentState,'install');const modules=await loadDsh(moduleRoot);
const require=createRequire(modules.cli);const yaml=require('js-yaml');const {entryListSchema}=require('@deepseek-ai/cordis-plugin-include');
const port=Number(process.env.WORKBENCH_DSH_PROBE_PORT??38572);const hostPort=Number(process.env.WORKBENCH_DSH_PROBE_HOST_PORT??38571);
if ([38471,38472].includes(port)||[38471,38472].includes(hostPort)||port===hostPort)throw Error('Use separate probe ports');
const base=`http://127.0.0.1:${port}`;const profile=join(home,'profiles','web');await mkdir(profile,{recursive:true,mode:0o700});
// Clone only the existing local route and opaque credential file. Never inspect
// credential contents, copy native stores, or mutate the source home.
const patch=yaml.load(await readFile(join(source,'profiles/web/cordis.patch.yml'),'utf8'),{schema:entryListSchema});
const rows=[];for(const op of patch){if(op.id==='llm-pi-ai'||op.id==='agent-default-model')rows.push(op);for(const row of Array.isArray(op.insert)?op.insert:[])if(['llm-pi-ai','agent-default-model'].includes(row.id))rows.push({insert:[row]});}
if(!rows.some(r=>r.id==='llm-pi-ai'||r.insert?.[0]?.id==='llm-pi-ai'))throw Error('Prepared native route is unavailable');
await writeFile(join(profile,'cordis.patch.yml'),yaml.dump(rows,{schema:entryListSchema,noRefs:true}),{mode:0o600});
await copyFile(join(source,'profiles/web/package.json'),join(profile,'package.json'));
await copyFile(join(source,'.env'),join(home,'.env'));
const tokenPath=join(state,'bridge.token');await bridgeToken(tokenPath);const token=(await readFile(tokenPath,'utf8')).trim();
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
const env={...process.env,WORKBENCH_DSH_STATE:state,DSH_HOME:home,DSH_MODULE_ROOT:moduleRoot,PORT:String(port),DSH_HOST_PORT:String(hostPort),WORKBENCH_DSH_BRIDGE_TOKEN_FILE:tokenPath};
delete env.DSH_HOST_URL;delete env.DSH_HOST_LOG;delete env.DSH_HOST_TOKEN_FILE;
const report={status:'running',state,bridge_port:port,host_port:hostPort,checks:{}};let child,log,native;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,input,status=200){const r=await fetch(base+'/api/runtime'+path,{headers,...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});if(r.status!==status)throw Error(`Probe ${path.split('/').at(-1)} HTTP ${r.status}`);return r.json();}
async function start(){
 log=await open(join(state,'bridge.log'),'a',0o600);child=spawn(process.execPath,[fileURLToPath(new URL('../bridge.mjs',import.meta.url))],{env,stdio:['ignore',log.fd,log.fd]});
 for(let i=0;i<300;i++){if(child.exitCode!==null)throw Error('Probe-owned bridge exited');try{const c=await call('/capabilities');if(c.status==='ready')return;}catch{}await wait(100);}throw Error('Probe-owned bridge did not become ready');
}
async function stop(){await native?.close();native=undefined;if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');for(let i=0;i<100&&child.exitCode===null&&child.signalCode===null;i++)await wait(100);if(child.exitCode===null&&child.signalCode===null)throw Error('Probe-owned bridge did not stop');}await log?.close();log=undefined;child=undefined;}
async function nativeIds(){native??=new DshPeer({url:`http://127.0.0.1:${hostPort}`,readToken:()=>tokenFromLog(join(state,'host.log')),modules});const rows=await native.call('list',{});return rows.items.map(x=>x.sessionId).sort();}
async function completed(id,requestId){for(let i=0;i<600;i++){const s=await call(`/sessions/${id}/snapshot`);if(s.status==='error')throw Error('Native inference failed');if(s.status==='completed'&&s.messages.some(x=>x.request_id===requestId))return s;await wait(100);}throw Error('Native inference timed out');}
try{
 try{await fetch(base+'/api/runtime/capabilities');throw Error('Probe port is in use');}catch(e){if(e.message==='Probe port is in use')throw e;}
 await start();const catalog=await call('/models');const model=process.env.DSH_MODEL??'codex/gpt-6.1-sol';const route=catalog.models.find(x=>x.id===model&&x.provider==='magpie-responses');
 report.model=model;report.provider=route?.provider;report.inference_reasoning_effort='medium';
 assert.ok(route?.reasoning?.efforts.some(x=>x.id==='low'));assert.ok(route.reasoning.efforts.some(x=>x.id==='medium'));report.checks.catalog_reasoning_metadata=true;
 const input={user_id:'schedule-user',profile_id:'schedule-profile',project_id:'schedule-project',request_id:'schedule-session-'+randomUUID(),cwd:state,model,reasoning_effort:'low',title:'Isolated scheduler creation probe'};
 const refs=await Promise.all(Array.from({length:4},()=>call('/sessions',input,201)));const id=refs[0].id;assert.ok(refs.every(x=>x.id===id));report.session_id=id;report.checks.concurrent_create_dedup=true;
 await call('/sessions',{...input,title:'different payload'},409);report.checks.creation_payload_conflict=true;
 for(const owner of [{user_id:'other-user'},{profile_id:'other-profile'},{project_id:'other-project'}]){const ref=await call('/sessions',{...input,...owner},201);assert.notEqual(ref.id,id);}report.checks.scope_isolation=true;
 const beforeIds=await nativeIds();assert.equal(beforeIds.length,4);report.native_session_count=beforeIds.length;
 await call(`/sessions/${id}/model?project_id=wrong`,{model,reasoning_effort:'medium'},404);
 await call(`/sessions/${id}/model`,{model,reasoning_effort:'unsupported'},400);
 await call(`/sessions/${id}/model`,{model,service_tier:'priority'},422);report.checks.invalid_controls_rejected=true;
 const selected=await call(`/sessions/${id}/model`,{model,reasoning_effort:'medium'});assert.equal(selected.selected.reasoningEffort,'medium');
 const requestId=randomUUID();await call(`/sessions/${id}/messages`,{request_id:requestId,content:'Reply with exactly DSH_INCREMENT_OK. Do not use tools.'},202);
 const before=await completed(id,requestId);assert.equal(before.session.reasoning_effort,'medium');assert.ok(before.messages.some(x=>x.role==='assistant'&&x.content==='DSH_INCREMENT_OK'));report.checks.real_model_effort_inference=true;
 await call(`/sessions/${id}/model`,{model,reasoning_effort:'low'});await stop();
 const path=join(state,'bridge-state','metadata.json');const data=JSON.parse(await readFile(path,'utf8'));const owned=data.sessions.find(x=>x.id===id);
 owned.provisioned=false;owned.creation.status='intended';owned.reasoning_effort='medium';await writeFile(path,JSON.stringify(data),{mode:0o600});
 await start();const recovered=await Promise.all(Array.from({length:3},()=>call('/sessions',input,201)));assert.ok(recovered.every(x=>x.id===id));
 const after=await call(`/sessions/${id}/snapshot`);assert.equal(after.session.reasoning_effort,'low');assert.deepEqual(after.messages,before.messages);assert.equal(after.messages.filter(x=>x.request_id===requestId).length,1);
 assert.deepEqual(await nativeIds(),beforeIds);report.checks.nonblank_create_recovery_after_bridge_host_restart=true;report.checks.no_duplicate_native_sessions=true;report.checks.native_model_reconciles_lost_store_ack=true;
 const finalId=randomUUID();await call(`/sessions/${id}/messages`,{request_id:finalId,content:'Reply with exactly DSH_INCREMENT_RESTART_OK. Do not use tools.'},202);const final=await completed(id,finalId);assert.ok(final.messages.some(x=>x.role==='assistant'&&x.content==='DSH_INCREMENT_RESTART_OK'));report.checks.recovered_native_session_usable=true;report.status='passed';
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
finally{await stop();await writeFile(join(state,'RESULTS.json'),JSON.stringify(report,null,2),{mode:0o600});await writeFile(join(parentState,'create-model-probe-results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,state}));}
