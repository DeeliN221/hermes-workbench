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
const state=join(parentState,'files-deliveries-probe-'+randomUUID());const home=join(state,'dsh-home');
const source=resolve(process.env.DSH_PROBE_HOME_SOURCE??join(parentState,'dsh-home'));
const moduleRoot=process.env.DSH_MODULE_ROOT??join(parentState,'install');const modules=await loadDsh(moduleRoot);
const require=createRequire(modules.cli);const yaml=require('js-yaml');const {entryListSchema}=require('@deepseek-ai/cordis-plugin-include');
const port=Number(process.env.WORKBENCH_DSH_PROBE_PORT??38672);const hostPort=Number(process.env.WORKBENCH_DSH_PROBE_HOST_PORT??38671);
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
let eventControl,eventPump;
try{
 try{await fetch(base+'/api/runtime/capabilities');throw Error('Probe port is in use');}catch(e){if(e.message==='Probe port is in use')throw e;}
 await start();const cwd=join(state,'workspace');await mkdir(cwd,{mode:0o700});await mkdir(join(cwd,'folder'));
 const fileMarker='FILE_'+randomUUID();const folderMarker='FOLDER_'+randomUUID();
 await writeFile(join(cwd,'upload.txt'),fileMarker,{mode:0o600});await writeFile(join(cwd,'folder','marker.txt'),folderMarker,{mode:0o600});
 const owner={user_id:'file-delivery-user',profile_id:'file-delivery-profile',project_id:'file-delivery-project'};
 const query='?'+new URLSearchParams(owner);
 const session=await call('/sessions',{...owner,cwd,title:'Isolated reference and Fleet probe',reasoning_effort:'low'},201);const id=session.id;report.session_id=id;
 const events=[];eventControl=new AbortController();const stream=await fetch(base+`/api/runtime/sessions/${id}/events`,{headers,signal:eventControl.signal});assert.equal(stream.status,200);
 eventPump=(async()=>{let buffer='';for await(const bytes of stream.body){buffer+=new TextDecoder().decode(bytes);for(let at;(at=buffer.indexOf('\n\n'))>=0;){const part=buffer.slice(0,at);buffer=buffer.slice(at+2);const line=part.split('\n').find(l=>l.startsWith('data: '));if(line)events.push(JSON.parse(line.slice(6)));}}})().catch(e=>{if(!eventControl.signal.aborted)throw e;});
 const requestId='schedule-ref-'+randomUUID();const content='Read the referenced file and marker.txt inside the referenced folder with normal read tools. Return both exact file contents. Do not guess.';
 const message={request_id:requestId,content,attachments:[{type:'file',path:join(cwd,'upload.txt'),name:'upload.txt',mimeType:'text/plain'},{type:'folder',path:'folder',name:'folder'}]};
 const receipt=await call(`/sessions/${id}/messages`,message,202);assert.equal(receipt.accepted,true);assert.equal(receipt.durable,true);assert.ok(receipt.native_evidence?.event_type);
 const early=await call(`/sessions/${id}/snapshot`);assert.notEqual(early.status,'completed');report.checks.native_durable_receipt_before_inference_completion=true;
 const queried=await call(`/sessions/${id}/requests/${requestId}`);assert.equal(queried.durable,true);report.checks.receipt_get_native_evidence=true;
 const before=await completed(id,requestId);const answers=before.messages.filter(x=>x.role==='assistant').map(x=>x.content).join('\n');
 assert.ok(answers.includes(fileMarker)&&answers.includes(folderMarker));
 assert.ok(before.tools.some(x=>x.type==='tool/result'&&x.name==='read'&&x.content.includes(fileMarker)));
 assert.ok(before.tools.some(x=>x.type==='tool/result'&&x.name==='read'&&x.content.includes(folderMarker)));
 const user=before.messages.find(x=>x.request_id===requestId);assert.ok(!user.content.includes(fileMarker)&&!user.content.includes(folderMarker));
 assert.equal(user.attachments[0].path,'upload.txt');assert.equal(user.attachments[1].path,'folder');assert.ok(!JSON.stringify(user.attachments).includes(cwd));
 report.checks.real_file_folder_reads_and_answer=true;report.checks.relative_reference_metadata=true;
 const delivery={source:'fleet',epoch:2,idempotency_key:'fleet-task-new',task_id:'fleet-task',attempt_id:'new-attempt',kind:'result',content:'Background task finished without another model turn.',metadata:{scope:'probe'}};
 const receipts=await Promise.all(Array.from({length:4},()=>call(`/sessions/${id}/deliveries${query}`,delivery,202)));assert.ok(receipts.every(x=>x.delivery_id===receipts[0].delivery_id&&x.durable));
 await call(`/sessions/${id}/deliveries`,delivery,400);await call(`/sessions/${id}/deliveries?`+new URLSearchParams({...owner,user_id:'wrong'}),delivery,404);
 await call(`/sessions/${id}/deliveries${query}`,{...delivery,epoch:1},409);await call(`/sessions/${id}/deliveries${query}`,{...delivery,source:'application'},409);
 await call(`/sessions/${id}/deliveries${query}`,{...delivery,idempotency_key:'fleet-task-old',attempt_id:'old-attempt',epoch:1,kind:'notice',content:'Late old attempt notification'},202);
 await wait(150);const notified=await call(`/sessions/${id}/snapshot`);assert.deepEqual(notified.messages,before.messages);assert.equal(notified.status,'completed');assert.equal(notified.deliveries.length,2);
 assert.equal(notified.deliveries[0].source,'fleet');assert.equal(notified.deliveries[0].epoch,2);assert.equal(notified.deliveries[1].attempt_id,'old-attempt');
 const deliveredEvents=events.filter(x=>x.type==='delivery.received');assert.equal(deliveredEvents.length,2);assert.ok(deliveredEvents.every(x=>x.cursor===undefined&&x.data.delivery.source==='fleet'));
 report.checks.fleet_delivery_without_model_loop=true;report.checks.delivery_sse_dedup_epoch_and_scope=true;
 eventControl.abort();await eventPump;await stop();
 const metadataPath=join(state,'bridge-state','metadata.json');const metadata=JSON.parse(await readFile(metadataPath,'utf8'));
 metadata.sessions.find(x=>x.id===id).requests[requestId].durable=false;await writeFile(metadataPath,JSON.stringify(metadata),{mode:0o600});
 await start();const confirmedByGet=await call(`/sessions/${id}/requests/${requestId}`);assert.equal(confirmedByGet.durable,true);assert.ok(confirmedByGet.native_evidence);report.checks.active_receipt_get_confirms_without_prompt=true;
 await call(`/sessions/${id}/messages`,message,202);const restored=await call(`/sessions/${id}/snapshot`);
 assert.deepEqual(restored.messages,before.messages);assert.equal(restored.messages.filter(x=>x.request_id===requestId).length,1);assert.equal(restored.deliveries.length,2);assert.equal(restored.deliveries[0].id,receipts[0].delivery_id);
 const stable=await call(`/sessions/${id}/deliveries${query}`,delivery,202);assert.equal(stable.delivery_id,receipts[0].delivery_id);
 assert.equal((await call(`/sessions/${id}/requests/${requestId}`)).durable,true);
 assert.equal((await call(`/sessions/${id}/deliveries/fleet-task-new${query}`)).epoch,2);
 report.checks.references_deliveries_and_schedule_receipt_survive_restart=true;report.checks.exactly_one_scheduled_native_message=true;report.status='passed';
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
finally{eventControl?.abort();await eventPump;await stop();await writeFile(join(state,'RESULTS.json'),JSON.stringify(report,null,2),{mode:0o600});await writeFile(join(parentState,'files-deliveries-probe-results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,state}));}
