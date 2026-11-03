import { expect, it, vi } from 'vitest';
import { loadChatSetup } from '../dashboard/src/chat-setup';

function mockRead(values: Record<string, any> = {}) {
  return vi.fn(async (url: string): Promise<any> => {
    if (url.includes('/codex/models?')) return { data: values.codex ?? [] };
    if (url.includes('/opencode/models?')) return { data: values.opencode ?? [] };
    return values.config ?? { agent: { reasoning_effort: 'medium' } };
  });
}

it('shares simultaneous reads, reuses models, and re-reads defaults on navigation', async () => {
  let effort = 'medium';
  const read = vi.fn(async (url: string): Promise<any> =>
    url.includes('/models?') ? { data: [] } : { agent: { reasoning_effort: effort } });
  await Promise.all([loadChatSetup(read, 'default'), loadChatSetup(read, 'default')]);
  expect(read).toHaveBeenCalledTimes(3);
  effort = 'high';
  expect((await loadChatSetup(read, 'default'))[1]).toEqual({ agent: { reasoning_effort: 'high' } });
  expect(read).toHaveBeenCalledTimes(4);
  await loadChatSetup(read, 'writer');
  expect(read).toHaveBeenCalledTimes(7);
});

it('does not retain failed model reads or share results between clients', async () => {
  const read = vi.fn(async (): Promise<any> => { throw new Error('offline'); });
  await expect(loadChatSetup(read, 'default')).rejects.toThrow('offline');
  read.mockResolvedValue({ data: [] });
  await loadChatSetup(read, 'default');
  expect(read).toHaveBeenCalledTimes(6);
  const other = vi.fn(async (): Promise<any> => ({}));
  await loadChatSetup(other, 'default');
  expect(other).toHaveBeenCalledTimes(3);
});

it('merges OpenCode Go models into the Codex catalog', async () => {
  const read = mockRead({
    codex: [{ id: 'gpt-6-astra', displayName: 'Astra' }],
    opencode: [{ id: 'opencode-go/kimi-k3', displayName: 'kimi-k3' }],
  });
  const [catalog] = await loadChatSetup(read, 'default');
  expect(read).toHaveBeenCalledWith(expect.stringContaining('/codex/models?profile=default'));
  expect(read).toHaveBeenCalledWith(expect.stringContaining('/opencode/models?profile=default'), expect.anything());
  expect((catalog as any).data.map((m: any) => m.id)).toEqual(['gpt-6-astra', 'opencode-go/kimi-k3']);
});

it('keeps the catalog usable when the OpenCode Go adapter is absent', async () => {
  const read = vi.fn(async (url: string): Promise<any> => {
    if (url.includes('/codex/models?')) return { data: [{ id: 'gpt-6-astra', displayName: 'Astra' }] };
    if (url.includes('/opencode/models?')) throw new Error('not found');
    return { agent: { reasoning_effort: 'medium' } };
  });
  const [catalog] = await loadChatSetup(read, 'default');
  expect((catalog as any).data.map((m: any) => m.id)).toEqual(['gpt-6-astra']);
});

it('keeps Codex metadata when OpenCode also advertises the same model id', async () => {
  const read = mockRead({
    codex: [{ model: 'opencode-go/kimi-k3', displayName: 'Kimi K3', defaultReasoningEffort: 'max' }],
    opencode: [{ model: 'opencode-go/kimi-k3', displayName: 'Kimi K3 (Go)' }, { id: 'opencode-go/glm-5.3' }],
  });
  const [catalog] = await loadChatSetup(read, 'default');
  expect((catalog as any).data).toHaveLength(2);
  expect((catalog as any).data[0].displayName).toBe('Kimi K3');
  expect((catalog as any).data.map((m: any) => m.model ?? m.id)).toEqual(['opencode-go/kimi-k3', 'opencode-go/glm-5.3']);
});
