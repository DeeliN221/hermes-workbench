import { describe, expect, it, vi } from 'vitest';
import { searchWorkbench } from '../dashboard/src/workbench-search-api';
import { clearSessionSearchCaches, searchResultKey, type SearchSnapshot } from '../dashboard/src/session-search-api';

function reader(fleet: (init?: RequestInit) => unknown) {
  clearSessionSearchCaches();
  return vi.fn(async (path: string, init?: RequestInit): Promise<any> => {
    if (path.includes('/fleetd/tasks/search')) return fleet(init);
    if (path === '/api/profiles') return { profiles: [] };
    if (path.includes('/session-organization')) return { items: [] };
    if (path.includes('/codex/search')) return { results: [{ session_id: 'same-id', title: 'Session match' }] };
    return { results: [] };
  });
}

describe('unified workbench search', () => {
  it('searches Fleet once, preserving task identity, summary and archived status', async () => {
    const read = reader(() => ({ tasks: [{ id: 'same-id', title: 'Task match', status: 'archived', repo: 'sample/repo', spec_json: { prompt: 'Task body' } }], has_more: false }));
    const result = await searchWorkbench(read, 'default', 'needle & title');
    expect(result.complete).toBe(true);
    expect(result.failures).toEqual([]);
    expect(new Set(result.results.map(searchResultKey)).size).toBe(2);
    expect(result.results[0]).toMatchObject({ kind: 'task', id: 'same-id', snippet: 'Task body', task: { status: 'archived' } });
    const calls = read.mock.calls.filter(([path]) => path.includes('/fleetd/'));
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0][0], 'http://localhost').searchParams.get('q')).toBe('needle & title');
  });
  it('publishes sessions while Fleet is pending, then preserves them on failure', async () => {
    let fail!: (error: Error) => void;
    const read = reader(() => new Promise((_, reject) => { fail = reject; }));
    const updates: SearchSnapshot[] = [];
    const pending = searchWorkbench(read, 'default', 'needle', { onUpdate: value => updates.push(value) });
    await vi.waitFor(() => expect(updates.some(value => value.results.some(row => row.kind === 'session'))).toBe(true));
    expect(updates.at(-1)?.complete).toBe(false);
    fail(new Error('HTTP 501'));
    const result = await pending;
    expect(result.results).toHaveLength(1);
    expect(result.failures[0]).toMatch(/Fleet search API is unavailable/);
  });
  it('bounds an unresponsive Fleet source even if it ignores cancellation', async () => {
    const read = reader(() => new Promise(() => {}));
    const result = await searchWorkbench(read, 'default', 'needle', { totalTimeoutMs: 30 });
    expect(result.complete).toBe(true);
    expect(result.results[0].kind).toBe('session');
    expect(result.failures.join()).toMatch(/timed out/);
  });
  it('cancels Fleet and does not publish stale results after cancellation', async () => {
    let signal: AbortSignal | null | undefined;
    const read = reader(init => { signal = init?.signal; return new Promise(() => {}); });
    const controller = new AbortController();
    const update = vi.fn();
    const pending = searchWorkbench(read, 'default', 'needle', { signal: controller.signal, onUpdate: update });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal?.aborted).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
  it('does not issue requests for an empty query', async () => {
    const read = reader(() => ({}));
    expect((await searchWorkbench(read, 'default', '  ')).results).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
