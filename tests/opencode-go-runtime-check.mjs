/** Optional OpenCodex 2.88.0 contract check, using its installed source with Bun.
 * OPENCODEX_SOURCE=/path/to/opencodex bun tests/opencode-go-runtime-check.mjs
 * No running proxy, real credential or external inference is used.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const source = process.env.OPENCODEX_SOURCE;
assert.ok(source, 'Set OPENCODEX_SOURCE to the installed OpenCodex source directory');
const sandbox = mkdtempSync(join(tmpdir(), 'workbench-go-contract-'));
process.env.OPENCODEX_HOME = sandbox;
process.env.OPENCODEX_CONFIG_DIR = sandbox;
process.env.OPENCODE_GO_API_KEY = 'local-synthetic-credential';
let sink;
try {
  const load = file => import(pathToFileURL(join(resolve(source), 'src', file)).href);
  const { routeModel } = await load('router.ts');
  const { resolveOpenCodeGoTransport } = await load('providers/opencode-go-transport.ts');
  const { createOpenAIChatAdapter } = await load('adapters/openai-chat.ts');
  execFileSync('python3', ['scripts/configure-opencode-go.py', '--opencodex-home', sandbox], { stdio: 'pipe' });
  const config = JSON.parse(readFileSync(join(sandbox, 'config.json'), 'utf8'));
  config.defaultProvider = 'openai';
  config.providers.openai = { adapter: 'openai-responses', baseUrl: 'https://chatgpt.com/backend-api/codex', authMode: 'forward' };
  config.providers.deepseek = { adapter: 'openai-chat', baseUrl: 'https://api.deepseek.com', apiKey: 'local-other-placeholder' };
  const go = routeModel(config, 'opencode-go/kimi-k3');
  assert.equal(go.providerName, 'opencode-go');
  assert.equal(go.modelId, 'kimi-k3');
  assert.equal(go.provider.apiKey, process.env.OPENCODE_GO_API_KEY);
  assert.equal(routeModel(config, 'gpt-6.1-sol').providerName, 'openai');
  assert.equal(routeModel(config, 'deepseek/deepseek-flash').providerName, 'deepseek');
  const transport = lane => resolveOpenCodeGoTransport(go.provider, lane, config.providers['opencode-go']);
  const first = transport('conversation-one');
  const session = first.headers['x-opencode-session'];
  assert.ok(session);
  assert.equal(transport('conversation-one').headers['x-opencode-session'], session);
  assert.notEqual(transport('conversation-two').headers['x-opencode-session'], session);
  const request = await createOpenAIChatAdapter(first).buildRequest({
    modelId: go.modelId, stream: false, options: {},
    context: { messages: [{ role: 'user', content: 'Explain this coding test.', timestamp: 0 }], tools: [] },
  });
  assert.equal(request.url, 'https://opencode.ai/zen/go/v1/chat/completions');
  let received = false;
  sink = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    assert.equal(req.headers.get('Authorization'), 'Bearer local-synthetic-credential');
    assert.equal(req.headers.get('User-Agent'), 'Hermes-Workbench/1.0');
    assert.equal(req.headers.get('x-opencode-session'), session);
    const body = await req.json();
    assert.equal(body.model, 'kimi-k3');
    received = true;
    return Response.json({ ok: true });
  } });
  // Only send the constructed request to localhost, never to request.url.
  const response = await fetch(`http://127.0.0.1:${sink.port}/v1/chat/completions`, {
    method: 'POST', headers: request.headers,
    body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body),
  });
  assert.equal(response.status, 200);
  assert.ok(received);
  console.log('PASS: OpenCodex Go route, credential reference, stable session headers, localhost request; GPT and DeepSeek routes preserved');
} finally {
  sink?.stop(true);
  rmSync(sandbox, { recursive: true, force: true });
}
