import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('retains a stable trigger identity across ambiguous delivery and surfaces unavailable history', async () => {
  vi.resetModules(); vi.stubGlobal('__WORKBENCH_STANDALONE__', true);
  const api = await import('../dashboard/src/cron-api');
  const calls: RequestInit[] = [];
  const read = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push(init!);
    if (calls.length === 1) throw new Error('connection lost');
    return { job: { id: 'job' } };
  });
  await expect(api.changeCronJobState(read as any, 'p', 'job', 'trigger')).rejects.toThrow('connection lost');
  await api.changeCronJobState(read as any, 'p', 'job', 'trigger');
  expect(calls[0].headers).toEqual(calls[1].headers);
  await api.changeCronJobState(read as any, 'p', 'job', 'trigger');
  expect(calls[2].headers).not.toEqual(calls[1].headers);
  await expect(api.listCronExecutions((async () => { throw new Error('journal unavailable'); }) as any, 'p', 'job')).rejects.toThrow('journal unavailable');
});

it('lists only authenticated profiles and presents each scheduled occurrence once', async () => {
  vi.resetModules(); vi.stubGlobal('__WORKBENCH_STANDALONE__', true);
  const api = await import('../dashboard/src/cron-api');
  const read = vi.fn(async (url: string) => url === '/api/profiles' ? { profiles: [{ name: 'owned' }] } : { jobs: [{ id: 'j' }] });
  expect(await api.listCronJobs(read as any, 'all')).toEqual([{ id: 'j', profile: 'owned' }]);
  expect(read.mock.calls.map(call => call[0])).toEqual(['/api/profiles', '/api/cron/jobs?profile=owned']);
  const runs = [{ id: 'one', session_id: 's' }, { id: 'two', session_id: 's' }];
  const history = api.mergeCronHistory(runs, [...runs, { id: 'pending' }]);
  expect(history).toHaveLength(3);
  expect(new Set(history.map(row => row.key)).size).toBe(3);
  expect(api.cronSessionId({ id: 'pending' })).toBe('');
});
