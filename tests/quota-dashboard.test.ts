// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { mountQuotaDashboard } from '../dashboard/src/quota-dashboard';

const entry = (id: string, name: string) => ({
  id, name, service: name.split(' ')[0], plan: 'Test plan', adapter: 'unsupported' as const, preset: null,
  enabled: true, minutes: 300, resetsAt: null, amount: null, limit: null, mode: 'remaining' as const, unit: 'credits', observedAt: null,
});
const provider = (id: string, name: string, windows: { minutes: number; remainingPercent: number; resetsAt: string | null }[], status = 'available') => ({
  id, name, service: name.split(' ')[0], plan: 'Test plan', adapter: 'unsupported' as const, enabled: true, status, reason: 'Fixture reason', source: 'Provider fixture',
  windows, updatedAt: '2030-01-01T00:00:00Z', checkedAt: '2030-01-01T00:00:00Z',
});
const payload = {
  providers: [
    provider('gemini', 'Gemini AI Pro', [{ minutes: 300, remainingPercent: 88, resetsAt: '2030-01-01T00:00:00Z' },
      { minutes: 10080, remainingPercent: 69, resetsAt: '2030-01-07T00:00:00Z' }]),
    provider('zero', 'Zero balance', [{ minutes: 300, remainingPercent: 0, resetsAt: null }]),
    provider('opencode', 'OpenCode Go', [], 'unavailable'),
  ],
  entries: [entry('gemini', 'Gemini AI Pro'), entry('zero', 'Zero balance'), entry('opencode', 'OpenCode Go')],
  revision: 1,
  presets: [],
};
const snapshot = (profile: string, name = 'Cached service') => ({
  profile,
  providers: [provider(`cached-${profile}`, name, [{ minutes: 300, remainingPercent: 42, resetsAt: null }])],
  entries: [entry(`cached-${profile}`, name)], revision: 3, configured: true, presets: [],
  savedAt: new Date().toISOString(),
});
const cacheKey = (profile: string) => `hermes.workbench.quota-cache.v1:${profile}`;
const json = (value: object) => new Response(JSON.stringify(value));

afterEach(() => { document.body.replaceChildren(); window.localStorage.clear(); vi.useRealTimers(); });

test('renders the last successful cache immediately and refreshes in the background', async () => {
  window.localStorage.setItem(cacheKey('default'), JSON.stringify(snapshot('default')));
  const fetcher = vi.fn(() => new Promise<Response>(() => {}));
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, fetcher);
  expect(root.querySelector('.quota-row-name')?.textContent).toBe('Cached service');
  expect(root.querySelector('.quota-row-summary')?.textContent).toBe('5h 42%');
  expect(root.querySelector('.quota-updated')?.textContent).toMatch(/^Updated /);
  expect(root.textContent).toContain('Refreshing in background');
  expect(fetcher).toHaveBeenCalledTimes(1);
  dispose();
});

test('shows structured skeleton rows immediately when there is no cache', () => {
  const fetcher = vi.fn(() => new Promise<Response>(() => {}));
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, fetcher);
  expect(root.querySelectorAll('.quota-skeleton-row')).toHaveLength(3);
  expect(root.textContent).toContain('Loading subscriptions');
  expect(root.querySelector('.quota-statusline')?.textContent).not.toBe('Refreshing…');
  dispose();
});

test('failed refresh keeps cached rows and offers an inline retry', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(json(payload))
    .mockRejectedValueOnce(new Error('PRIVATE network error'))
    .mockResolvedValueOnce(json(payload));
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, fetcher);
  await vi.waitFor(() => expect(root.querySelector('.quota-row-summary')?.textContent).toContain('5h 88%'));
  (root.querySelector('.quota-toolbar button') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(root.textContent).toContain('Refresh failed'));
  expect(root.querySelector('.quota-row-summary')?.textContent).toContain('5h 88%');
  expect(root.textContent).not.toContain('PRIVATE');
  const retry = [...root.querySelectorAll<HTMLButtonElement>('.quota-error button')][0];
  expect(retry.textContent).toBe('Retry');
  retry.click();
  await vi.waitFor(() => expect(root.textContent).toContain('Refresh complete'));
  expect(root.querySelector('.quota-row-summary')?.textContent).toContain('5h 88%');
  dispose();
});

test('cache is scoped by profile and never shows another profile data', async () => {
  window.localStorage.setItem(cacheKey('alpha'), JSON.stringify(snapshot('alpha', 'Alpha service')));
  const fetcher = vi.fn().mockResolvedValue(json({
    providers: [provider('beta', 'Beta service', [{ minutes: 300, remainingPercent: 33, resetsAt: null }])],
    entries: [entry('beta', 'Beta service')], revision: 2, presets: [],
  }));
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, fetcher, { profile: 'beta' });
  expect(root.textContent).not.toContain('Alpha service');
  await vi.waitFor(() => expect(root.querySelector('.quota-row-name')?.textContent).toBe('Beta service'));
  expect(fetcher.mock.calls[0][0]).toContain('profile=beta');
  expect(window.localStorage.getItem(cacheKey('alpha'))).toContain('Alpha service');
  expect(window.localStorage.getItem(cacheKey('beta'))).toContain('Beta service');
  dispose();
});

test('renders one compact text row per subscription and keeps truthful zero and unknown values', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, vi.fn().mockResolvedValue(json(payload)));
  await vi.waitFor(() => expect(root.querySelectorAll('.quota-row')).toHaveLength(3));
  const rows = [...root.querySelectorAll('.quota-row')];
  expect(rows.map(row => row.querySelector('.quota-row-name')?.textContent)).toEqual(['Gemini AI Pro', 'Zero balance', 'OpenCode Go']);
  expect(rows[0].querySelector('.quota-row-summary')?.textContent).toBe('5h 88% · Weekly 69%');
  expect(rows[1].querySelector('.quota-row-summary')?.textContent).toBe('5h 0%');
  expect(rows[2].querySelector('.quota-row-summary')?.textContent).toBe('Unavailable');
  expect(root.querySelectorAll('meter, progress')).toHaveLength(0);
  expect(root.querySelector('.quota-card')).toBeNull();
  expect(root.textContent).not.toContain('Source:');
  expect(root.textContent).not.toContain('Available');
  expect(root.textContent).not.toContain('Edit');
  expect(root.textContent).not.toContain('Move up');
  expect(root.textContent).not.toContain('Last checked');
  expect(root.querySelectorAll('.quota-updated')).toHaveLength(1);
  dispose();
});

test('row menu and detail drawer hold edit, disable, delete and ordering actions', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, vi.fn().mockResolvedValue(json(payload)));
  await vi.waitFor(() => expect(root.querySelectorAll('.quota-row')).toHaveLength(3));
  const firstRow = root.querySelector('.quota-row') as HTMLElement;
  (firstRow.querySelector('.quota-row-menu-button') as HTMLButtonElement).click();
  const menu = firstRow.querySelector('.quota-menu') as HTMLElement;
  expect(menu.hidden).toBe(false);
  expect(menu.textContent).toContain('Edit');
  expect(menu.textContent).toContain('Disable');
  expect(menu.textContent).toContain('Move up');
  expect(menu.textContent).toContain('Move down');
  expect(menu.textContent).toContain('Delete');
  (firstRow.querySelector('.quota-row-open') as HTMLButtonElement).click();
  const drawer = root.querySelector('[role=dialog]') as HTMLElement;
  expect(drawer).not.toBeNull();
  expect(drawer.textContent).toContain('Gemini AI Pro');
  expect(drawer.textContent).toContain('Source:');
  expect(drawer.textContent).toContain('Reset:');
  (drawer.querySelector('[aria-label="Close details"]') as HTMLButtonElement).click();
  expect(root.querySelector('[role=dialog]')).toBeNull();
  dispose();
});

test('delete requires explicit confirmation before writing', async () => {
  const fetcher = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return Promise.resolve(json({ entries: payload.entries.slice(1), revision: 2 }));
    return Promise.resolve(json(payload));
  });
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, fetcher as typeof fetch);
  await vi.waitFor(() => expect(root.querySelectorAll('.quota-row')).toHaveLength(3));
  const firstRow = root.querySelector('.quota-row') as HTMLElement;
  (firstRow.querySelector('.quota-row-menu-button') as HTMLButtonElement).click();
  const deleteItem = [...firstRow.querySelectorAll<HTMLButtonElement>('.quota-menu-item')].find(item => item.textContent === 'Delete…')!;
  deleteItem.click();
  const confirm = root.querySelector('[role=dialog]') as HTMLElement;
  expect(confirm.textContent).toContain('This cannot be undone');
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  const confirmButton = [...confirm.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Confirm delete')!;
  confirmButton.click();
  await vi.waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
  const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse((put[1] as RequestInit).body as string).entries.map((item: Entry) => item.id)).toEqual(['zero', 'opencode']);
  dispose();
});

test('a save conflict keeps the editor and does not claim a successful write', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const fetcher = vi.fn().mockResolvedValueOnce(json({ providers: [], entries: [], revision: 7 }))
    .mockResolvedValueOnce(new Response('{}', { status: 409 }));
  const dispose = mountQuotaDashboard(root, fetcher);
  const findButton = (text: string) => [...root.querySelectorAll('button')].find(item => item.textContent === text)!;
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

test.each(['gemini', 'opencode'])('%s shows provider failure in the compact row and recovers', async id => {
  const first = provider(id, id, [{ minutes: 300, remainingPercent: 85, resetsAt: '2030-01-01T00:00:00Z' }]);
  const reply = (value: object) => json({ providers: [value], entries: [entry(id, id)], revision: 1 });
  const fetcher = vi.fn().mockResolvedValueOnce(reply(first)).mockResolvedValueOnce(reply({ ...first,
    status: id === 'gemini' ? 'timeout' : 'login_required', reason: 'Configure the server connection then Refresh.',
    windows: [], updatedAt: null })).mockResolvedValueOnce(reply(first));
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountQuotaDashboard(root, fetcher);
  await vi.waitFor(() => expect(root.querySelector('.quota-row-summary')?.textContent).toBe('5h 85%'));
  const refresh = root.querySelector('.quota-toolbar button') as HTMLButtonElement;
  refresh.click();
  expect(refresh.disabled).toBe(true);
  await vi.waitFor(() => expect(root.querySelector('.quota-row-summary')?.textContent).toBe(id === 'gemini' ? 'Timed out' : 'Login required'));
  expect(root.textContent).not.toContain('0%');
  refresh.click();
  await vi.waitFor(() => expect(root.querySelector('.quota-row-summary')?.textContent).toBe('5h 85%'));
  dispose();
});

type Entry = ReturnType<typeof entry>;
