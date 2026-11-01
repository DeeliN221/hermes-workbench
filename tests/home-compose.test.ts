import { expect, it } from 'vitest';
import { homeSubmission } from '../dashboard/src/home-compose';
it('creates and sends only in default, retaining the idempotency key after failure', async () => {
  const calls: { url: string; body: any }[] = [];
  let fail = true;
  const read = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const body = JSON.parse(String(init?.body)); calls.push({ url, body });
    if (url.endsWith('/sessions')) return { session: { id: 'created', title: 'New' } } as T;
    if (fail) { fail = false; throw Error('offline'); }
    return { request: { status: 'accepted' } } as T;
  };
  const send = homeSubmission(read, 'Hello');
  await expect(send()).rejects.toThrow('offline');
  expect(await send()).toBe('created');
  expect(calls).toHaveLength(3);
  expect(calls.every(call => call.body.profile === 'default')).toBe(true);
  expect(calls[1].url).toContain('profile=default');
  expect(calls[1].body.clientRequestId).toBe(calls[2].body.clientRequestId);
});
