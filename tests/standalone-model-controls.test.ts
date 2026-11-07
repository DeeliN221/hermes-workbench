import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());

it('uses native reasoning capabilities and forwards selected controls without unsupported tiers', async () => {
  vi.resetModules(); vi.stubGlobal('__WORKBENCH_STANDALONE__', true);
  const api = await import('../dashboard/src/codex-api');
  const native = { id: 'm', provider: 'p', name: 'Native model', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } };
  const read = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/runtime/models') return { models: [native], default: { model: 'm', provider: 'p' } };
    if (url.startsWith('/api/config')) return {};
    if (url === '/api/runtime/sessions') return { id: 'owned', model: 'm', provider: 'p', reasoning_effort: 'high' };
    return { accepted: true, status: 'accepted' };
  });
  expect((await api.loadCodexModelCatalog(read as any, 'default'))[0]).toMatchObject({ efforts: ['low', 'high'], supportsFast: false });
  const session = await api.createCodexSession(read as any, 'default', { model: 'm', effort: 'high', serviceTier: 'fast', sessionId: 'once' });
  expect(session).toMatchObject({ model: 'm', provider: 'p', reasoningEffort: 'high' });
  await api.sendCodexMessage(read as any, 'default', 'owned', 'message', 'message-once', { model: 'm', effort: 'low', serviceTier: 'fast' });
  const writes = read.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)));
  expect(writes[0]).toMatchObject({ model: 'm', reasoning_effort: 'high', request_id: 'once' });
  expect(writes[1]).toMatchObject({ model: 'm', reasoning_effort: 'low', request_id: 'message-once' });
  for (const body of writes) { expect(body).not.toHaveProperty('serviceTier'); expect(body).not.toHaveProperty('service_tier'); }
});
