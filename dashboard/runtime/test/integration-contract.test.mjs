import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, chmod, rm, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bridgeToken} from '../auth.mjs';
import {imageParts, MAX_IMAGE_BYTES} from '../images.mjs';
import {normalizeContext, contextIdentity} from '../context.mjs';
import {solidPng} from './png.mjs';
import {setup, tick} from './fixtures.mjs';
import {startHttp} from '../http.mjs';
import {Projection} from '../projection.mjs';

test('bridge token is owner-only, stable across restart and never included in HTTP errors', async t => {
  const f = await setup(); const path = join(f.directory,'token'); const auth = await bridgeToken(path);
  const token = (await readFile(path,'utf8')).trim(); const again = await bridgeToken(path);
  assert.ok(again.authenticate(`Bearer ${token}`)); assert.ok(!auth.authenticate('Bearer wrong'));
  const http = await startHttp(f.runtime,{port:0,authenticate:auth.authenticate});
  t.after(async()=>{await http.close();await f.close();});
  for(const headers of [{},{authorization:'Bearer wrong'}]) {
    const r = await fetch(http.url+'/api/runtime/capabilities',{headers}); assert.equal(r.status,401);
    assert.ok(!(await r.text()).includes(token));
  }
  const ready = await fetch(http.url+'/api/runtime/capabilities',{headers:{authorization:`Bearer ${token}`}});assert.equal(ready.status,200);
  assert.ok(!(await ready.text()).includes(token)); await chmod(path,0o644);await assert.rejects(bridgeToken(path),{code:'runtime/private-file-required'});
});

test('image intake accepts textless canonical PNGs and rejects invalid type, base64, signature and size', async t => {
  const png = solidPng().toString('base64'); const parts = imageParts([{type:'image',media_type:'image/png',data:png,name:'red.png'}]);
  assert.equal(parts[0].mediaType,'image/png');
  for(const a of [
    {type:'file',data:png}, {type:'image',media_type:'text/plain',data:png},
    {type:'image',media_type:'image/png',data:'not base64'}, {type:'image',media_type:'image/jpeg',data:png},
    {type:'image',media_type:'image/png',data:png,name:'../bad'},
  ]) assert.throws(()=>imageParts([a]));
  const huge = Buffer.alloc(MAX_IMAGE_BYTES+1);solidPng().copy(huge);
  assert.throws(()=>imageParts([{type:'image',media_type:'image/png',data:huge.toString('base64')}]),{status:413});
  const f=await setup();t.after(()=>f.close());const s=await f.runtime.create({profile_id:'p',project_id:'j',cwd:tmpdir()});
  await f.runtime.message(s.id,{attachments:[{type:'image',media_type:'image/png',data:png}],request_id:'image'});
  const queue=(await f.runtime.snapshot(s.id)).inbox;assert.equal(queue[0].content[0].type,'image');assert.equal(queue[0].content[0].data,png);
});

test('receipt alias is canonical and intended records never claim acceptance on native error',async t=>{
  const f=await setup();t.after(()=>f.close());const s=await f.runtime.create({profile_id:'p',project_id:'j',cwd:tmpdir()});
  await f.runtime.message(s.id,{content:'hello',client_request_id:'alias'});assert.equal(f.runtime.receipt(s.id,'alias').status,'accepted');
  await f.runtime.message(s.id,{content:'hello',request_id:'alias'});assert.equal(f.peer.promptCalls,1);
  assert.throws(()=>f.runtime.receipt(s.id,'alias',{project_id:'other'}),{status:404});
  await assert.rejects(f.runtime.message(s.id,{content:'hello',request_id:'a',client_request_id:'b'}),{status:400});
  const call=f.peer.call.bind(f.peer);f.peer.call=async(method,request)=>method==='prompt'?{accepted:false}:call(method,request);
  await assert.rejects(f.runtime.message(s.id,{content:'failed',request_id:'failed'}),{status:502});
  assert.deepEqual(f.runtime.receipt(s.id,'failed'),{request_id:'failed',session_id:s.id,status:'intended',accepted:false,durable:false,retryable:true});
});

test('context data is validated, owner-scoped, literal and maps HTTP MCP without executing expressions',()=>{
  const context=normalizeContext({memory:{'MEMORY.md':'Literal {{unknown}} and !!js doNotExecute()'},skills:[{name:'selected',content:'body',version:'1'}],
    mcpServers:{one:{transport:'http',url:'http://127.0.0.1:9001/mcp'},two:{transport:'stdio',command:'python3',args:['fixture.py'],env:{SCOPE:'a'}}}},tmpdir());
  assert.equal(context.mcpServers.one.transport,'streamable-http');assert.ok(context.memory['MEMORY.md'].includes('{{unknown}}'));
  const a={user_id:'a',profile_id:'profile',project_id:'project',runtime_context:context};
  assert.notEqual(contextIdentity(a),contextIdentity({...a,user_id:'b'}));assert.notEqual(contextIdentity(a),contextIdentity({...a,profile_id:'other'}));
  for(const invalid of [
    {mcpServers:{bad:{transport:'sse',url:'http://127.0.0.1'}}}, {plugins:[{name:'arbitrary-js'}]}, {mcpServers:{bad:{transport:'stdio',command:'python3',env:{__jsExpr:'doNotExecute()'}}}},
    {memory:{'../MEMORY.md':'bad'}}, {skills:[{name:'../skill',content:'x'}]}, {mcpServers:{bad:{transport:'unknown'}}},
  ])assert.throws(()=>normalizeContext(invalid,tmpdir()),{status:422});
  assert.throws(()=>contextIdentity({...a,agent_preset:'arbitrary'}),{status:422});
});

test('tool/state derived events use one durable cursor and snapshot preserves tool card and safe image ref',()=>{
  const p=new Projection({id:'s',runtime:'dsh',profile_id:'p',project_id:'j'});p.baseline([],-1,1);
  const changes=p.durable({type:'tool/call',seq:0,data:{callId:'c',name:'bash',arguments:'{"command":"printf OK"}'}});
  assert.equal(changes.filter(e=>e.cursor!==undefined).length,1);assert.equal(changes[0].data.tool.call_id,'c');
  const result=p.durable({type:'tool/result',seq:1,data:{message:{id:'tool-message',role:'tool',toolCallId:'c',content:[{type:'text',text:'OK'}]}}});
  assert.equal(result.filter(e=>e.cursor!==undefined).length,1);assert.equal(result.at(-1).data.tool.status,'completed');
  assert.equal(p.snapshot().tools[0].name,'bash');assert.equal(p.snapshot().tools[0].content,'OK');
  p.durable({type:'user/message',seq:2,data:{id:'u',source:{kind:'user'},content:[{type:'image',attachment:{attachmentId:'opaque',mediaType:'image/png',bytes:100,width:32,height:32}}]}});
  assert.equal(p.snapshot().messages.at(-1).attachments[0].attachmentId,'opaque');
});

test('native memory sections are literal contributions in the supplied preset scope',async()=>{
  const {apply}=await import('../native-memory-plugin.mjs');const a=[];const b=[];
  apply({systemPrompt:{section:x=>a.push(x)}},{memory:{'MEMORY.md':'A {{literal}}'}});
  apply({systemPrompt:{section:x=>b.push(x)}},{memory:{'MEMORY.md':'B'}});
  assert.equal(a[0].interpolate,false);assert.ok(a[0].text.includes('{{literal}}'));assert.ok(!b[0].text.includes('A'));
});
