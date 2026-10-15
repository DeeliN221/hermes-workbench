import { describe, expect, it, vi } from 'vitest';
import { loadHomeProfiles } from '../dashboard/src/home-profiles';

describe('cross-profile home', () => {
  it('keeps identical session IDs separated and sorts by activity across profiles', async () => {
    const read = async <T>(url: string): Promise<T> => {
      const u = new URL(url, 'http://localhost');
      if (u.pathname === '/api/plugins/workbench/profile-names') return { profiles: [{ name: 'default' }, { name: 'writer' }] } as T;
      if (u.pathname.endsWith('/codex/sessions')) return { items: [{ id: 'same', updatedAt: u.searchParams.get('profile') === 'writer' ? 300 : 100 }] } as T;
      return { sessions: [], total: 0 } as T;
    };
    const result = await loadHomeProfiles(read, new AbortController().signal);
    expect(result.rows.map(row => [row.profile, row.id])).toEqual([['writer', 'same'], ['default', 'same']]);
    expect(result.failed).toEqual([]);
  });
  it('retains successful profiles when another profile fails', async () => {
    const read = async <T>(url: string): Promise<T> => {
      const u = new URL(url, 'http://localhost');
      if (u.pathname === '/api/plugins/workbench/profile-names') return { profiles: [{ name: 'default' }, { name: 'writer' }] } as T;
      if (u.searchParams.get('profile') === 'writer') throw new Error('offline');
      if (u.pathname.endsWith('/codex/sessions')) return { items: [{ id: 'one' }] } as T;
      return { sessions: [], total: 0 } as T;
    };
    const result = await loadHomeProfiles(read, new AbortController().signal);
    expect(result.rows).toHaveLength(1);
    expect(result.failed).toEqual(['writer']);
  });
  it('renders the current profile before a delayed roster or archive and still finds active old sessions', async () => {
    let releaseRoster!: () => void, releaseArchive!: () => void;
    const roster = new Promise<void>(resolve => { releaseRoster = resolve; });
    const archive = new Promise<void>(resolve => { releaseArchive = resolve; });
    const progress: string[][] = [];
    const read = async <T>(url: string): Promise<T> => {
      const u = new URL(url, 'http://localhost');
      if (u.pathname === '/api/plugins/workbench/profile-names') {
        await roster;
        return { profiles: [{ name: 'default' }, { name: 'writer' }] } as T;
      }
      const profile = u.searchParams.get('profile');
      if (u.pathname.endsWith('/codex/sessions')) {
        if (profile === 'writer') return { items: [] } as T;
        expect(u.searchParams.get('recent')).toBe('true');
        expect(u.searchParams.get('limit')).toBe('24');
        return { items: [{ id: 'old-but-active', updatedAt: 999 }, ...Array.from({ length: 23 }, (_, i) => ({ id: `new-${i}`, updatedAt: i + 1 }))] } as T;
      }
      await archive;
      return { sessions: [{ id: `${profile}-history`, updated_at: 500 }], total: 1 } as T;
    };
    const loading = loadHomeProfiles(read, new AbortController().signal, {
      initialProfile: 'default', onProgress: value => progress.push(value.rows.map(row => row.id)),
    });
    await vi.waitFor(() => expect(progress.some(rows => rows.includes('old-but-active'))).toBe(true));
    expect(progress[0]).toHaveLength(24);
    releaseRoster(); releaseArchive();
    const result = await loading;
    expect(result.rows[0].id).toBe('old-but-active');
    expect(result.rows.some(row => row.id === 'writer-history')).toBe(true);
  });
  it('keeps ready Codex cards when the archive times out', async () => {
    const controller = new AbortController();
    const progress: string[][] = [];
    const read = async <T>(url: string, init?: RequestInit): Promise<T> => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url === '/api/plugins/workbench/profile-names') return { profiles: [{ name: 'default' }] } as T;
      if (url.includes('/codex/sessions')) return { items: [{ id: 'ready' }] } as T;
      throw new DOMException('timeout', 'TimeoutError');
    };
    const result = await loadHomeProfiles(read, controller.signal, { initialProfile: 'default', onProgress: value => progress.push(value.rows.map(row => row.id)) });
    expect(result.rows.map(row => row.id)).toEqual(['ready']);
    expect(result.failed).toEqual(['default']);
    expect(progress.some(rows => rows.includes('ready'))).toBe(true);
  });

  it('retains cached profiles until their own response arrives, then removes deleted cards', async () => {
    let release!: () => void;
    const slow = new Promise<void>(resolve => { release = resolve; });
    const cached = { id: 'cached', title: 'Cached', source: 'Codex' as const, updated: 1, status: '', workspace: '', profile: 'writer', completedSeq: 1, messageCount: 0 };
    const progress: string[][] = [];
    const read = async <T>(url: string): Promise<T> => {
      if (url === '/api/plugins/workbench/profile-names') return { profiles: [{ name: 'default' }, { name: 'writer' }] } as T;
      if (url.includes('profile=writer')) await slow;
      return (url.includes('/codex/sessions') ? { items: [] } : { sessions: [], total: 0 }) as T;
    };
    const loading = loadHomeProfiles(read, new AbortController().signal, { initialProfile: 'default', initialRows: [cached], onProgress: value => progress.push(value.rows.map(row => row.id)) });
    await vi.waitFor(() => expect(progress.length).toBeGreaterThan(0));
    expect(progress.every(rows => rows.includes('cached'))).toBe(true);
    release();
    expect((await loading).rows).toEqual([]);
  });

});
