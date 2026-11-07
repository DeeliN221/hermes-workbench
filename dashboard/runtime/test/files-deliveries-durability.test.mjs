import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {setup,FakePeer,tick} from './fixtures.mjs';
import {Runtime} from '../runtime.mjs';
import {Store} from '../store.mjs';
const owner={user_id:'u',profile_id:'p',project_id:'j'};
async function fixture(t){const f=await setup();const cwd=join(f.directory,'workspace');await mkdir(cwd);const s=await f.runtime.create({...owner,cwd});f.reopened=[];t.after(async()=>{for(const next of f.reopened)await next.runtime.close();await f.close();});return {...f,cwd,s};}
async function reopen(f){await f.runtime.close();const store=new Store(f.directory);await store.init();const peer=new FakePeer(f.peer.native);const runtime=new Runtime({peer,store,provider:'local',model:'test-model'});await runtime.init();const next={store,peer,runtime};f.reopened.push(next);return next;}
const delivery={source:'fleet',epoch:2,idempotency_key:'task:attempt:new',task_id:'task',attempt_id:'new',kind:'result',content:'Finished',metadata:{count:1}};

test('workspace references use relative metadata and attributed native text without embedding file bytes',async t=>{
 const f=await fixture(t);await writeFile(join(f.cwd,'note.txt'),'PRIVATE_FILE_MARKER');await mkdir(join(f.cwd,'folder'));await writeFile(join(f.cwd,'folder','inside.txt'),'FOLDER_MARKER');
 const input={request_id:'refs',attachments:[{type:'file',path:join(f.cwd,'note.txt'),name:'note.txt',mimeType:'text/plain'},{type:'folder',path:'folder',name:'folder'}]};
 const receipt=await f.runtime.message(f.s.id,input);assert.equal(receipt.durable,true);
 const queued=(await f.runtime.snapshot(f.s.id)).inbox[0];assert.ok(queued.content[0].text.includes('User-supplied workspace references'));assert.ok(!queued.content[0].text.includes('PRIVATE_FILE_MARKER'));
 assert.ok(!JSON.stringify(queued.attachments).includes(f.cwd));assert.equal(queued.attachments[0].path,'note.txt');
 f.peer.append(f.s.id,'user/message',{id:'native-user',role:'user',source:{kind:'user',rpcId:'refs'},content:queued.content});await tick();
 const next=await reopen(f);const snapshot=await next.runtime.snapshot(f.s.id);
 assert.equal(snapshot.messages[0].attachments[1].type,'folder');assert.equal(snapshot.messages[0].attachments[0].path,'note.txt');assert.equal(next.peer.promptCalls,0);
});

test('invalid paths, escaping symlinks, nested escapes and mismatched types fail before native prompt',async t=>{
 const f=await fixture(t);await writeFile(join(f.cwd,'file'),'x');await mkdir(join(f.cwd,'dir'));const outside=join(f.directory,'outside');await writeFile(outside,'outside');
 await symlink(outside,join(f.cwd,'escape'));await symlink(outside,join(f.cwd,'dir','nested-escape'));
 for(const attachment of [
  {type:'file',path:'https://example.invalid/x'},{type:'file',path:'file:///x'},{type:'file',path:'bad\0path'},
  {type:'file',path:1},{type:'file',path:'/'},{type:'folder',path:f.cwd},{type:'file',path:outside},
  {type:'file',path:'escape'},{type:'folder',path:'file'},{type:'file',path:'dir'},{type:'folder',path:'dir'},
 ])await assert.rejects(f.runtime.message(f.s.id,{attachments:[attachment]}),e=>e.status===400);
 assert.equal(f.peer.promptCalls,0);
 await unlink(join(f.cwd,'dir','nested-escape'));for(let i=0;i<5;i++)await writeFile(join(f.cwd,'dir','f'+i),'x');f.runtime.referenceMaxEntries=3;
 await assert.rejects(f.runtime.message(f.s.id,{attachments:[{type:'folder',path:'dir'}]}),{status:413});assert.equal(f.peer.promptCalls,0);
});

test('reference target is revalidated immediately before dispatch and on intended replay',async t=>{
 const f=await fixture(t);const path=join(f.cwd,'file');const outside=join(f.directory,'outside');await writeFile(path,'safe');await writeFile(outside,'outside');
 const original=f.runtime.ensure.bind(f.runtime);f.runtime.ensure=async meta=>{const result=await original(meta);await unlink(path);await symlink(outside,path);return result;};
 await assert.rejects(f.runtime.message(f.s.id,{request_id:'replace',attachments:[{type:'file',path:'file'}]}),{status:400});assert.equal(f.peer.promptCalls,0);
 const next=await reopen(f);const recovered=await next.runtime.recovery;
 assert.ok(recovered.some(x=>x.status==='rejected'));assert.equal(next.peer.promptCalls,0);assert.equal(next.runtime.receipt(f.s.id,'replace').durable,false);
});

test('deliveries atomically deduplicate, retain attempts and never call native prompt',async t=>{
 const f=await fixture(t);const events=[];f.runtime.on('event',e=>events.push(e));
 const before=f.peer.promptCalls;const receipts=await Promise.all(Array.from({length:8},()=>f.runtime.delivery(f.s.id,delivery,owner)));
 assert.equal(new Set(receipts.map(x=>x.delivery_id)).size,1);assert.ok(receipts.every(x=>x.durable));assert.equal(f.peer.promptCalls,before);
 assert.equal(events.filter(e=>e.type==='delivery.received').length,1);assert.equal(f.runtime.listDeliveries(f.s.id,owner).deliveries.length,1);
 for(const patch of [{attempt_id:'old'},{epoch:1},{task_id:'other'},{source:'application'},{content:'changed'}])await assert.rejects(f.runtime.delivery(f.s.id,{...delivery,...patch},owner),{status:409});
 await f.runtime.delivery(f.s.id,{...delivery,idempotency_key:'task:attempt:old',attempt_id:'old',epoch:1,content:'Late old result'},owner);
 const records=f.runtime.listDeliveries(f.s.id,owner).deliveries;assert.deepEqual(records.map(x=>x.attempt_id),['new','old']);assert.equal(records[0].content,'Finished');assert.equal(records[0].epoch,2);assert.equal(records[0].source,'fleet');
 await assert.rejects(f.runtime.delivery(f.s.id,delivery,{}),{status:400});await assert.rejects(f.runtime.delivery(f.s.id,delivery,{...owner,user_id:'other'}),{status:404});
 const snapshot=await f.runtime.snapshot(f.s.id);assert.equal(snapshot.messages.length,0);assert.equal(snapshot.deliveries.length,2);assert.equal(f.peer.promptCalls,before);
 const next=await reopen(f);assert.equal((await next.runtime.snapshot(f.s.id)).deliveries.length,2);assert.equal(next.peer.promptCalls,0);
 assert.equal((await next.runtime.delivery(f.s.id,delivery,owner)).delivery_id,receipts[0].delivery_id);
});

test('delivery fsync failure emits no SSE, publishes no record, and a later save cannot erase an acknowledged delivery',async t=>{
 const f=await fixture(t);const events=[];f.runtime.on('event',e=>events.push(e));const write=f.store.writeSnapshot.bind(f.store);let fail=true;
 f.store.writeSnapshot=async data=>{if(fail)throw Error('synthetic fsync failure');return write(data);};
 await assert.rejects(f.runtime.delivery(f.s.id,delivery,owner));assert.equal(f.runtime.listDeliveries(f.s.id,owner).deliveries.length,0);assert.equal(events.length,0);
 fail=false;await Promise.all([f.runtime.delivery(f.s.id,delivery,owner),f.store.save()]);
 const disk=JSON.parse(await readFile(join(f.directory,'metadata.json'),'utf8'));assert.equal(disk.sessions[0].deliveries.length,1);
});

test('delivery metadata is bounded plain JSON and cannot inject native expressions',async t=>{
 const f=await fixture(t);
 for(const metadata of [[],{__jsExpr:'doNotEvaluate()'},{deep:[[[[[[[[[['too deep']]]]]]]]]]},{big:'x'.repeat(5000)}])await assert.rejects(f.runtime.delivery(f.s.id,{...delivery,metadata},owner));
 assert.equal(f.peer.promptCalls,0);
});

test('message durability requires native persisted evidence and local fsync; transient acceptance stays retryable',async t=>{
 const f=await fixture(t);f.peer.confirmRequest=async()=>false;
 const receipt=await f.runtime.message(f.s.id,{request_id:'schedule',content:'scheduled'});assert.equal(receipt.accepted,true);assert.equal(receipt.durable,false);assert.equal(receipt.retryable,true);
 assert.ok(f.store.sessions.get(f.s.id).requests.schedule.input);
 const calls=f.peer.promptCalls;f.peer.confirmRequest=async()=>({durable:true,cursor:7,source:'agent/inbox/spliced'});const retry=await f.runtime.refreshReceipt(f.s.id,'schedule');assert.equal(f.peer.promptCalls,calls);assert.equal(retry.native_evidence.cursor,7);assert.equal(retry.durable,true);assert.equal(f.peer.native.get(f.s.id).queue.length,1);
 const next=await reopen(f);assert.equal(next.runtime.receipt(f.s.id,'schedule').durable,true);assert.equal(next.peer.promptCalls,0);
});

test('receipt cannot claim local durability when its fsync fails after native acceptance',async t=>{
 const f=await fixture(t);const write=f.store.writeSnapshot.bind(f.store);
 f.store.writeSnapshot=async data=>{if(data.sessions[0].requests.schedule?.durable)throw Error('synthetic fsync failure');return write(data);};
 await assert.rejects(f.runtime.message(f.s.id,{request_id:'schedule',content:'scheduled'}));assert.equal(f.runtime.receipt(f.s.id,'schedule').durable,false);
});

test('unsupported timed interactions delegate visibly; cancel/timeout/new Peer expire every late reply',async t=>{
 const f=await fixture(t);await f.runtime.snapshot(f.s.id);const events=[];f.runtime.on('event',e=>events.push(e));
 const frame={type:'waterfall',event:'user-questions/request',agentId:f.s.id,eventId:'timed',request:{wait:{timed:true,callId:'call'},questions:[{id:'q',question:'Q'}]}};
 f.peer.emit('remote-event',frame,1);await tick();assert.equal(f.peer.answers.at(-1).next,true);assert.ok(events.some(e=>e.data.code==='runtime/interaction-unsupported'));
 await assert.rejects(f.runtime.answer(f.s.id,`${f.runtime.epoch}:1:timed`,{answer:'late'}),{status:409});
 for(const eventId of ['cancelled','timeout']){
  f.peer.emit('remote-event',{...frame,eventId,request:{questions:[{id:'q',question:'Q'}]}},1);
  const id=`${f.runtime.epoch}:1:${eventId}`;assert.ok(f.runtime.interactions.has(id));f.peer.emit('remote-event',{type:'cancel',eventId},1);
  await assert.rejects(f.runtime.answer(f.s.id,id,{answer:'late'}),{status:409});
 }
 f.peer.emit('remote-event',{...frame,eventId:'peer',request:{questions:[{id:'q',question:'Q'}]}},1);f.peer.connected=false;f.peer.emit('disconnected',1);await f.peer.connect();
 await assert.rejects(f.runtime.answer(f.s.id,`${f.runtime.epoch}:1:peer`,{answer:'late'}),{status:409});assert.equal(f.runtime.capabilities().capabilities.interactions.timed_questions,false);
});

test('poll-only confirmation cannot claim durability when its local receipt fsync fails',async t=>{
 const f=await fixture(t);f.peer.confirmRequest=async()=>false;await f.runtime.message(f.s.id,{request_id:'poll',content:'scheduled'});
 f.peer.confirmRequest=async()=>({durable:true,cursor:2,source:'user/message'});const calls=f.peer.promptCalls;
 f.store.writeSnapshot=async()=>{throw Error('synthetic fsync failure');};await assert.rejects(f.runtime.refreshReceipt(f.s.id,'poll'));
 assert.equal(f.runtime.receipt(f.s.id,'poll').durable,false);assert.equal(f.peer.promptCalls,calls);
});


test('accepted cancellation immediately expires pending interaction ids before delayed native cancellation events',async t=>{
 const f=await fixture(t);await f.runtime.snapshot(f.s.id);
 f.peer.emit('remote-event',{type:'waterfall',event:'user-questions/request',eventId:'pending',agentId:f.s.id,request:{questions:[{id:'q',question:'Q'}]}},1);
 const id=`${f.runtime.epoch}:1:pending`;assert.ok(f.runtime.interactions.has(id));await f.runtime.cancel(f.s.id,owner);
 await assert.rejects(f.runtime.answer(f.s.id,id,{answer:'late'},owner),{status:409});assert.equal(f.peer.answers.length,0);
});
