import { expect, it } from 'vitest';
import { loadHomeProfiles } from '../dashboard/src/home-profiles';
it('aggregates same-name projects without writes and keeps memberships within each profile', async () => {
  const read = async <T>(url: string, init?: RequestInit): Promise<T> => {
    expect(init?.method || 'GET').toBe('GET');
    if (url.endsWith('/profile-names')) return { profiles: [{ name: 'default' }, { name: 'writer' }] } as T;
    if (url.includes('/groups')) return { items: [{ id: 'same', name: 'Project' }] } as T;
    if (url.includes('/codex/sessions')) return { items: [{ id: 'same', groupId: 'same', updatedAt: url.includes('writer') ? 200 : 100 }] } as T;
    return { sessions: [], total: 0 } as T;
  };
  const result = await loadHomeProfiles(read, new AbortController().signal);
  expect(result.projects.map(p => [p.profile, p.id, p.updated])).toEqual([['writer', 'same', 200000], ['default', 'same', 100000]]);
  expect(result.rows.map(p => p.profile)).toEqual(['writer', 'default']);
});
it('removes stale cached rows when access is denied', async () => {
  const read = async <T>(url: string): Promise<T> => {
    if (url.endsWith('/profile-names')) return { profiles: [{ name: 'writer' }] } as T;
    throw Error('403 forbidden');
  };
  const result = await loadHomeProfiles(read, new AbortController().signal, {
    initialRows: [{ id: 'secret', profile: 'writer', source: 'Codex', title: 'Secret', updated: 0, status: '', workspace: '', completedSeq: 0, messageCount: 0 }],
  });
  expect(result.rows).toEqual([]); expect(result.projects).toEqual([]); expect(result.failed).toEqual(['writer']);
});
it('an empty authorized roster removes early default results', async () => {
  const read = async <T>(url: string): Promise<T> => {
    if (url.endsWith('/profile-names')) return { profiles: [] } as T;
    if (url.includes('/groups')) return { items: [{ id: 'hidden', name: 'Hidden' }] } as T;
    if (url.includes('/codex/sessions')) return { items: [{ id: 'hidden' }] } as T;
    return { sessions: [], total: 0 } as T;
  };
  const result = await loadHomeProfiles(read, new AbortController().signal, { initialProfile: 'default' });
  expect(result.rows).toEqual([]); expect(result.projects).toEqual([]);
});
