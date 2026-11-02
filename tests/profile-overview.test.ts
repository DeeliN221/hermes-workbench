import { describe, it, expect } from 'vitest';
import { FRESHNESS, freshnessRank, timeHint, sortSessions, loadProfileOverview, overviewRoute } from '../dashboard/src/profile-overview';
import type { RecentSession } from '../dashboard/src/recent-home';
import type { FetchJSON } from '../dashboard/src/workbench-api';
const now = new Date('2026-10-28T12:00:00Z').getTime();
const row = (id: string, updated = now, lastOpened = 0): RecentSession => ({ id, updated, lastOpened, title: id, source: 'Codex', profile: 'default', status: 'idle', workspace: '', completedSeq: 0, messageCount: 0 });
describe('profile overview', () => {
  it('sorts by opened time before activity, without modifying activity or unread', () => {
    const recent = row('opened', now - FRESHNESS.weekMs, now - 1000), active = row('active', now - 2000);
    expect(sortSessions([active, recent]).map(row => row.id)).toEqual(['opened', 'active']);
    expect(recent.updated).toBe(now - FRESHNESS.weekMs);
  });
  it('bounds the three gradients and time labels, excluding old, missing and future times', () => {
    expect([0, 1, 2, 3].map(i => freshnessRank(row('x'), i, now))).toEqual([1, 2, 3, 0]);
    expect(freshnessRank(row('x', now - FRESHNESS.weekMs + 1), 0, now)).toBe(1);
    for (const time of [0, now + 1, now - FRESHNESS.weekMs]) expect(freshnessRank(row('x', time), 0, now)).toBe(0);
    expect(timeHint(now - FRESHNESS.justNowMs + 1, now)).toBe('Just now');
    expect(timeHint(now - FRESHNESS.justNowMs, now)).toBe('Today');
    expect(timeHint(now - FRESHNESS.dayMs, now)).toBe('Past week');
    expect(timeHint(now - FRESHNESS.weekMs, now)).not.toBe('Past week');
    expect(timeHint(0, now)).toBe('Time unknown');
  });
  it('preserves roster order, empty profiles, all sessions and partial errors with aggregate reads', async () => {
    const requests: string[] = [];
    const read: FetchJSON = async <T>(url: string) => {
      requests.push(url);
      if (url.endsWith('/profile-overview')) return { profiles: [
        { name: 'writer', projects: [{ id: 'book', name: 'Book' }], sessions: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, groupId: 'book' })), failed: [] },
        { name: 'empty', projects: [], sessions: [], failed: [] },
        { name: 'default', projects: [], sessions: [], failed: ['projects'] },
      ] } as T;
      return { sessions: [{ id: 's0', profile: 'default', title: 'History' }], total: 1, errors: [{ profile: 'writer' }] } as T;
    };
    const columns = await loadProfileOverview(read, new AbortController().signal, () => {});
    expect(columns.map(p => p.name)).toEqual(['writer', 'empty', 'default']);
    expect(columns[0].rows).toHaveLength(30);
    expect(columns[0].projects[0].name).toBe('Book');
    expect(columns[0].failed).toEqual(['history']);
    expect(columns[1].rows).toEqual([]);
    expect(columns[2].rows[0].source).toBe('Hermes');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain('profile=all');
  });
  it('publishes ready profiles before a slow history source and retains them on failure', async () => {
    let fail!: () => void;
    const pending = new Promise<void>(resolve => { fail = resolve; });
    const snapshots: string[][] = [];
    const read: FetchJSON = async <T>(url: string) => {
      if (url.endsWith('/profile-overview')) return { profiles: [{ name: 'default', projects: [], sessions: [{ id: 'ready' }], failed: [] }] } as T;
      await pending; throw new Error('offline');
    };
    const loading = loadProfileOverview(read, new AbortController().signal, c => snapshots.push(c.flatMap(p => p.rows.map(r => r.id))));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(snapshots).toContainEqual(['ready']);
    fail();
    const result = await loading;
    expect(result[0].rows[0].id).toBe('ready');
    expect(result[0].failed).toEqual(['history']);
  });
  it('paginates aggregated history without losing sessions beyond the first page', async () => {
    const read: FetchJSON = async <T>(url: string) => {
      if (url.endsWith('/profile-overview')) return { profiles: [{ name: 'default', projects: [], sessions: [], failed: [] }] } as T;
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
      return { sessions: Array.from({ length: offset ? 1 : 500 }, (_, i) => ({ id: String(offset + i), profile: 'default' })), total: 501 } as T;
    };
    const result = await loadProfileOverview(read, new AbortController().signal, () => {});
    expect(result[0].rows).toHaveLength(501);
    const midnight = new Date(2026, 9, 28, 0, 0).getTime();
    expect(timeHint(midnight - 120_000, midnight)).toBe('Past week');
  });
  it('propagates a failed roster instead of claiming there are no profiles', async () => {
    const read: FetchJSON = async () => { throw new Error('offline'); };
    await expect(loadProfileOverview(read, new AbortController().signal, () => {})).rejects.toThrow('offline');
  });
  it.each([
    ['/sessions?view=recent&profile=writer', '/?profile=writer'], ['/home', '/'],
    ['/?view=board&profile=writer', '/kanban?profile=writer'], ['/?board=one#saved', '/kanban?board=one#saved'],
    ['/?workbench=kanban', '/kanban'], ['/kanban?view=legacy&board=one', '/kanban?board=one'],
    ['/chat?session=one', '/chat?session=one'],
  ])('canonicalizes %s', (input, expected) => expect(overviewRoute(input)).toBe(expected));
});
