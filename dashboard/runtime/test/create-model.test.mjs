import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setup, FakePeer, tick} from './fixtures.mjs';
import {Store} from '../store.mjs';
import {Runtime} from '../runtime.mjs';
import {RuntimeError} from '../errors.mjs';
const input = {user_id:'user',profile_id:'profile',project_id:'project',cwd:tmpdir(),request_id:'schedule-session-job'};

async function reopen(f) {
  await f.runtime.close();
  const store=new Store(f.directory);await store.init();const peer=new FakePeer(f.peer.native);
  const runtime=new Runtime({peer,store,provider:'local',model:'test-model'});await runtime.init();
  return {runtime,peer,store};
}

test('concurrent equal create requests share one durable ownership intent and provision operation',async t=>{
  const f=await setup();t.after(()=>f.close());
  const original=f.peer.call.bind(f.peer);
  f.peer.call=async(method,request)=>{
    if(method==='create') {
      const disk=JSON.parse(await readFile(join(f.directory,'metadata.json'),'utf8'));
      assert.ok(disk.sessions.some(s=>s.id===request.sessionId));
      const intent=disk.sessions.find(s=>s.id===request.sessionId).creation;if(intent)assert.equal(intent.status,'intended');
      await tick();
    }
    return original(method,request);
  };
  const refs=await Promise.all(Array.from({length:8},()=>f.runtime.create(input)));
  assert.equal(new Set(refs.map(x=>x.id)).size,1);assert.equal(f.peer.createCalls,1);assert.equal(f.peer.selectionCalls.length,1);
  const alias=await f.runtime.create({...input,request_id:undefined,client_request_id:input.request_id});assert.equal(alias.id,refs[0].id);
  assert.equal(f.store.sessions.size,1);assert.equal(f.store.sessions.get(refs[0].id).creation.status,'ready');
  const a=await f.runtime.create({...input,request_id:undefined});const b=await f.runtime.create({...input,request_id:undefined});assert.notEqual(a.id,b.id);
});

test('create fingerprints normalize key order/defaults/workspace and reject changed payloads',async t=>{
  const f=await setup();t.after(()=>f.close());
  const context={memory:{'SOUL.md':'soul','MEMORY.md':'memory'},skills:[],mcpServers:{},workspace:tmpdir()};
  const first=await f.runtime.create({...input,runtime_context:context});
  const again=await f.runtime.create({...input,cwd:undefined,workspace:tmpdir(),model:'test-model',agent_preset:'standard',runtime_context:{...context,memory:{'MEMORY.md':'memory','SOUL.md':'soul'}}});
  assert.equal(first.id,again.id);
  for(const change of [{title:'changed'},{reasoning_effort:'high'},{runtime_context:{memory:{'MEMORY.md':'changed'}}},{agent_preset:'minimal'}])
    await assert.rejects(f.runtime.create({...input,runtime_context:context,...change}),{status:409});
  assert.equal(f.peer.createCalls,1);
});

test('creation request identity is isolated by trusted user, profile and project',async t=>{
  const f=await setup();t.after(()=>f.close());
  const refs=await Promise.all([input,{...input,user_id:'other-user'},{...input,profile_id:'other-profile'},{...input,project_id:'other-project'}].map(x=>f.runtime.create(x)));
  assert.equal(new Set(refs.map(x=>x.id)).size,4);
  await assert.rejects(f.runtime.create({...input,user_id:undefined}),{status:400});
  assert.throws(()=>f.runtime.get(refs[0].id,{user_id:'other-user'}),{status:404});
});

test('lost native create acknowledgement recovers the same nonblank identity after restart',async t=>{
  const f=await setup();const original=f.peer.call.bind(f.peer);let lost=true;
  f.peer.call=async(method,request)=>{
    const result=await original(method,request);
    if(method==='create'&&lost){lost=false;f.peer.append(request.sessionId,'assistant/message',{message:{id:'native',role:'assistant',content:[{type:'text',text:'already nonblank'}]}});throw new RuntimeError(502,'test/lost-ack');}
    return result;
  };
  await assert.rejects(f.runtime.create(input),{status:502});const owned=[...f.store.sessions.values()][0];
  assert.equal(owned.provisioned,false);assert.equal(f.peer.native.size,1);
  const next=await reopen(f);t.after(async()=>{await next.runtime.close();await f.close();});
  const recovered=await next.runtime.create(input);assert.equal(recovered.id,owned.id);assert.equal(next.peer.createCalls,0);assert.equal(next.peer.native.size,1);
  assert.equal((await next.runtime.snapshot(recovered.id)).messages[0].content,'already nonblank');
});

test('lost final creation metadata acknowledgement recovers without selecting or creating again',async t=>{
  const f=await setup();const s=await f.runtime.create({...input,reasoning_effort:'high'});
  f.peer.append(s.id,'assistant/message',{message:{id:'reply',role:'assistant',content:[{type:'text',text:'durable'}]}});await tick();
  const meta=f.store.sessions.get(s.id);meta.provisioned=false;meta.creation.status='intended';meta.reasoning_effort='low';await f.store.save();
  const next=await reopen(f);t.after(async()=>{await next.runtime.close();await f.close();});
  const result=await next.runtime.create({...input,reasoning_effort:'high'});
  assert.equal(result.id,s.id);assert.equal(result.reasoning_effort,'high');assert.equal(next.peer.createCalls,0);assert.equal(next.peer.selectionCalls.length,0);
});

test('model catalog and actual selections expose reasoning metadata; invalid effort/tier/scope fail',async t=>{
  const f=await setup();t.after(()=>f.close());
  const catalog=await f.runtime.models();assert.equal(catalog.models[0].reasoning.defaultEffort,'low');assert.equal(catalog.models[0].reasoning.efforts[1].description,'More reasoning');
  await assert.rejects(f.runtime.create({...input,reasoning_effort:'invalid'}),{status:400});assert.equal(f.peer.createCalls,0);
  const s=await f.runtime.create({...input,reasoning_effort:'low'});assert.equal(s.reasoning_effort,'low');
  await assert.rejects(f.runtime.selectModel(s.id,{model:'test-model',reasoning_effort:'invalid'}),{status:400});
  await assert.rejects(f.runtime.selectModel(s.id,{model:'test-model'},{project_id:'other'}),{status:404});
  for(const effort of [null,1,''])await assert.rejects(f.runtime.selectModel(s.id,{model:'test-model',reasoning_effort:effort}),{status:400});
  await assert.rejects(f.runtime.create({...input,service_tier:'priority'}),{status:422});
  await assert.rejects(f.runtime.selectModel(s.id,{model:'test-model',service_tier:'priority'}),{status:422});
  await assert.rejects(f.runtime.message(s.id,{content:'x',service_tier:'priority'}),{status:422});
  const selected=await f.runtime.selectModel(s.id,{model:'test-model',reasoning_effort:'high'});
  assert.equal(selected.selected.reasoningEffort,'high');assert.equal((await f.runtime.snapshot(s.id)).session.reasoning_effort,'high');
  const retry=await f.runtime.create({...input,reasoning_effort:'low'});assert.equal(retry.id,s.id);assert.equal(retry.reasoning_effort,'high');
});

test('native model error does not change persisted or displayed selection',async t=>{
  const f=await setup();t.after(()=>f.close());const s=await f.runtime.create({...input,reasoning_effort:'low'});
  const original=f.peer.call.bind(f.peer);f.peer.call=async(method,request)=>{if(method==='selectModel')throw new RuntimeError(502,'test/native-failure');return original(method,request);};
  await assert.rejects(f.runtime.selectModel(s.id,{model:'test-model',reasoning_effort:'high'}),{status:502});
  assert.equal((await f.runtime.snapshot(s.id)).session.reasoning_effort,'low');
  const disk=JSON.parse(await readFile(join(f.directory,'metadata.json'),'utf8'));assert.equal(disk.sessions[0].reasoning_effort,'low');
});

test('native model selection reconciles a lost store acknowledgement on restart',async t=>{
  const f=await setup();const s=await f.runtime.create({...input,reasoning_effort:'low'});
  await f.peer.call('selectModel',{sessionId:s.id,provider:'local',model:'test-model',reasoningEffort:'high'});
  const next=await reopen(f);t.after(async()=>{await next.runtime.close();await f.close();});
  const snapshot=await next.runtime.snapshot(s.id);assert.equal(snapshot.session.reasoning_effort,'high');
  const retry=await next.runtime.create({...input,reasoning_effort:'low'});assert.equal(retry.id,s.id);assert.equal(retry.reasoning_effort,'high');
});
