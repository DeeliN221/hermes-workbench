import { expect, it, vi } from 'vitest';
import { loadChatSetup } from '../dashboard/src/chat-setup';

it('shares simultaneous reads, reuses models, and re-reads defaults on navigation', async () => {
  let effort = 'medium';
  const read = vi.fn(async (url: string): Promise<any> => url.includes('/models?') ? { data: [] } : { agent: { reasoning_effort: effort } });
  await Promise.all([loadChatSetup(read, 'default'), loadChatSetup(read, 'default')]);
  expect(read).toHaveBeenCalledTimes(2);
  effort = 'high';
  expect((await loadChatSetup(read, 'default'))[1]).toEqual({ agent: { reasoning_effort: 'high' } });
  expect(read).toHaveBeenCalledTimes(3);
  await loadChatSetup(read, 'writer');
  expect(read).toHaveBeenCalledTimes(5);
});
it('does not retain failed model reads or share results between clients', async () => {
  const read = vi.fn(async (): Promise<any> => { throw new Error('offline'); });
  await expect(loadChatSetup(read, 'default')).rejects.toThrow('offline');
  read.mockResolvedValue({ data: [] });
  await loadChatSetup(read, 'default');
  expect(read).toHaveBeenCalledTimes(4);
  const other = vi.fn(async (): Promise<any> => ({}));
  await loadChatSetup(other, 'default');
  expect(other).toHaveBeenCalledTimes(2);
});
