// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { mountQuotaDashboard } from '../dashboard/src/quota-dashboard';
const payload = { providers: ['opencode', 'gemini', 'openai'].map(id => ({
  id, status: id === 'openai' ? 'available' : 'unavailable', reason: 'Verified fixture',
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
