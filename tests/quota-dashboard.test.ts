// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { mountQuotaDashboard } from '../dashboard/src/quota-dashboard';
const payload = { providers: ['opencode', 'gemini', 'openai'].map(id => ({
  id, description: 'Plan unverified', name: id, service: id, plan: 'Test plan', adapter: id === 'openai' ? 'codex' : 'unsupported', enabled: true, status: id === 'openai' ? 'available' : 'unavailable', reason: 'Verified fixture',
  windows: id === 'openai' ? [{ minutes: 300, remainingPercent: 75, resetsAt: '2030-01-01T00:00:00Z' }] : [],
  updatedAt: id === 'openai' ? '2030-01-01T00:00:00Z' : null, checkedAt: '2030-01-01T00:00:00Z',
})) };
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
test('shows three providers, actual windows, missing weekly data and refresh status', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, fetcher);
  await vi.waitFor(() => expect(root.textContent).toContain('1 of 3 providers available'));
  expect(root.querySelectorAll('article')).toHaveLength(3);
  expect(root.textContent).toContain('75% remaining');
  expect(root.textContent).toContain('Weekly windowUnavailable');
  expect(root.textContent).toContain('Plan unverified');
  dispose();
});
test('coalesces clicks and sends explicit refresh after completion', async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
  const root = document.createElement('div');
  const dispose = mountQuotaDashboard(root, fetcher);
  const button = root.querySelector('button')!;
  button.click(); button.click();
  expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(new Response(JSON.stringify(payload)));
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  button.click();
  expect(fetcher.mock.calls[1][0]).toContain('refresh=true');
  resolve(new Response(JSON.stringify(payload)));
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  dispose();
});
test('failed refresh removes stale numbers and exposes retry without upstream secrets', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload))).mockRejectedValueOnce(new Error('PRIVATE'));
  const root = document.createElement('div');
  const dispose = mountQuotaDashboard(root, fetcher);
  await vi.waitFor(() => expect(root.textContent).toContain('75% remaining'));
  root.querySelector('button')!.click();
  await vi.waitFor(() => expect(root.textContent).toContain('Refresh failed'));
  expect(root.textContent).not.toContain('75% remaining');
  expect(root.textContent).not.toContain('PRIVATE');
  expect(root.querySelector('button')!.disabled).toBe(false);
  dispose();
});

test('arbitrary providers and an empty list need no built-in IDs', async () => {
  const root = document.createElement('div');
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ providers: [{
    id: 'independent-account', name: 'Fourth service', service: 'Example', plan: 'Team', adapter: 'manual', enabled: true,
    status: 'available', reason: 'Manual', windows: [], updatedAt: null, checkedAt: null,
    manual: { amount: 8, limit: null, unit: 'requests', mode: 'used', minutes: 43200, resetsAt: null },
  }], entries: [], revision: 0 }))).mockResolvedValueOnce(new Response(JSON.stringify({ providers: [], entries: [], revision: 1 })));
  const dispose = mountQuotaDashboard(root, fetcher);
  await vi.waitFor(() => expect(root.textContent).toContain('1 of 1 providers available'));
  expect(root.textContent).toContain('Fourth service');
  expect(root.textContent).toContain('8 requests used');
  root.querySelector('button')!.click();
  await vi.waitFor(() => expect(root.textContent).toContain('0 of 0 providers available'));
  expect(root.textContent).toContain('No subscriptions');
  expect(root.querySelectorAll('article')).toHaveLength(0);
  dispose();
});

test('save conflicts keep the editor and do not claim a successful write', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ providers: [], entries: [], revision: 7 })))
    .mockResolvedValueOnce(new Response('{}', { status: 409 }));
  const dispose = mountQuotaDashboard(root, fetcher);
  const findButton = (text: string) => [...root.querySelectorAll('button')].find(b => b.textContent === text)!;
  await vi.waitFor(() => expect(findButton('Add subscription').disabled).toBe(false));
  findButton('Add subscription').click();
  const inputs = root.querySelectorAll<HTMLInputElement>('input');
  inputs[0].value = 'Fourth provider'; inputs[1].value = 'Example';
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.textContent).toContain('changed in another tab'));
  const [url, options] = fetcher.mock.calls[1];
  expect(url).toContain('/quotas/entries');
  expect(options.method).toBe('PUT');
  const body = JSON.parse(options.body);
  expect(body.revision).toBe(7);
  expect(body.entries[0]).toMatchObject({ name: 'Fourth provider', service: 'Example', adapter: 'manual' });
  expect(root.querySelector('form')).not.toBeNull();
  expect(inputs[0].value).toBe('Fourth provider');
  expect(findButton('Save subscription').disabled).toBe(false);
  dispose();
});

test.each(['gemini', 'opencode'])('%s shows source, provider error and refresh recovery', async id => {
  const provider = { id, name: id, service: id, plan: '', adapter: 'unsupported', enabled: true,
    status: 'available', source: id === 'gemini' ? "agy -p '/usage' · Gemini Models" : 'OpenCode Go · GET /zen/go/v1/usage',
    reason: 'Provider fixture', windows: [{ minutes: 300, remainingPercent: 85, resetsAt: '2030-01-01T00:00:00Z' }],
    updatedAt: '2030-01-01T00:00:00Z', checkedAt: '2030-01-01T00:00:00Z' };
  const reply = (value: object) => new Response(JSON.stringify({ providers: [value] }));
  const fetcher = vi.fn().mockResolvedValueOnce(reply(provider)).mockResolvedValueOnce(reply({ ...provider,
    status: id === 'gemini' ? 'timeout' : 'login_required', reason: 'Configure the server connection then Refresh.',
    windows: [], updatedAt: null })).mockResolvedValueOnce(reply(provider));
  const root = document.createElement('div');
  const dispose = mountQuotaDashboard(root, fetcher);
  await vi.waitFor(() => expect(root.textContent).toContain('85% remaining'));
  expect(root.textContent).toContain(`Source: ${provider.source}`);
  if (id === 'opencode') expect(root.textContent).toContain('Monthly window');
  const refresh = root.querySelector('button')!;
  refresh.click();
  expect(refresh.disabled).toBe(true);
  expect(root.textContent).toContain('Refreshing…');
  await vi.waitFor(() => expect(root.textContent).toContain(id === 'gemini' ? 'Timed out' : 'Login required'));
  expect(root.textContent).not.toContain('85% remaining');
  refresh.click();
  await vi.waitFor(() => expect(root.textContent).toContain('85% remaining'));
  dispose();
});
