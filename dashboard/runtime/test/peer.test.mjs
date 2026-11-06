import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {DshPeer} from '../dsh-peer.mjs';

test('API Peer 401 is an error with exact status; credential requests stop after rejection', async t => {
  let calls = 0;
  const server = http.createServer((req, res) => { calls++; res.writeHead(401); res.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(r => server.close(r)));
  const peer = new DshPeer({url: `http://127.0.0.1:${server.address().port}`, readToken: async () => 'synthetic-test-value', modules: {}});
  await assert.rejects(peer.connect(), e => e.upstreamStatus === 401 && e.status === 502 && e.message === 'DSH HTTP 401');
  await assert.rejects(peer.connect(), e => e.upstreamStatus === 401);
  assert.equal(calls, 1); assert.equal(peer.connected, false); await peer.close();
});

test('Peer transport permits only loopback origin with no bearer in URL configuration', () => {
  for (const url of ['https://127.0.0.1', 'http://example.invalid', 'http://127.0.0.1/?token=x', 'http://user:pass@127.0.0.1'])
    assert.throws(() => new DshPeer({url}), {code: 'dsh/local-only'});
});

test('native API redirect destinations are checked before any authenticated carrier opens', async t => {
  let targetRequests=0;const target=http.createServer((req,res)=>{targetRequests++;res.end();});
  target.listen(0,'127.0.0.1');await once(target,'listening');
  const server=http.createServer((req,res)=>{res.writeHead(302,{Location:`http://127.0.0.1:${target.address().port}/api/remote.mux`,'Set-Cookie':'fixture=value'});res.end();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>target.close(r));});
  const peer=new DshPeer({url:`http://127.0.0.1:${server.address().port}`,readToken:async()=>'synthetic-test-value',modules:{}});
  await assert.rejects(peer.connect(),{code:'dsh/redirect-rejected'});assert.equal(targetRequests,0);await peer.close();
});

test('unary redirects fail closed and authenticated sockets remain on the configured origin',async t=>{
  let targetRequests=0;const target=http.createServer((req,res)=>{targetRequests++;res.end();});target.listen(0,'127.0.0.1');await once(target,'listening');
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/connect?'))res.writeHead(302,{Location:'/api/remote.mux','Set-Cookie':'fixture=value'});
    else res.writeHead(302,{Location:`http://127.0.0.1:${target.address().port}/redirected`});res.end();
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>target.close(r));});
  let hooks;let socketOptions;
  class Context{constructor(){this.fiber={dispose:async()=>{}};}}
  class Mux{start(){}async close(){}async *open(endpoint,payload,signal){yield{type:'ready',clientId:'fixture-client'};await new Promise(r=>signal.addEventListener('abort',r,{once:true}));}}
  const peer=new DshPeer({url:`http://127.0.0.1:${server.address().port}`,readToken:async()=>'synthetic-test-value',modules:{Context,
    installConnection(ctx,options){hooks=options.transport;ctx.connection={};},RemoteStreamMuxClient:Mux,
    WebSocket:class{constructor(url,options){socketOptions=options;}}}});
  await peer.connect();await assert.rejects(peer.fetchHost('/redirect'),e=>e.upstreamStatus===302);
  assert.equal(targetRequests,0);assert.throws(()=>hooks.createWebSocket(`ws://127.0.0.1:${target.address().port}/api/remote.mux`),{code:'dsh/origin-rejected'});
  hooks.createWebSocket(`ws://127.0.0.1:${server.address().port}/api/remote.mux`);assert.equal(socketOptions.followRedirects,false);await peer.close();
});

test('pinned native list request uses its generated _request wire argument',async()=>{
  const calls=[];const peer=new DshPeer({url:'http://127.0.0.1:9001',readToken:async()=>'',modules:{}});
  peer.connect=async()=>{};peer.ctx={connection:{rpc:{call:async(...args)=>{calls.push(args);return {ok:true,value:{items:[]}};}}}};
  assert.deepEqual(await peer.call('list',{}),{items:[]});assert.deepEqual(calls[0].slice(0,3),['/api','session/list',{args:{_request:{}}}]);
});
