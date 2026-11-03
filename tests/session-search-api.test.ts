import { beforeEach, describe, expect, it } from 'vitest';

import type { FetchJSON } from '../dashboard/src/workbench-api';
import {
  clearSessionSearchCaches,
  searchAllProfiles,
  type SearchSnapshot,
} from '../dashboard/src/session-search-api';

type Call = { url: string; init?: RequestInit };

function codexHit(id: string, title: string, snippet = '') {
  return { session_id: id, thread_id: `thread-${id}`, title, snippet, matched: snippet ? 'content' : 'title' };
}

function readFor(routes: (url: URL, call: Call) => unknown): { read: FetchJSON; calls: Call[] } {
  const calls: Call[] = [];
  const read: FetchJSON = async <T,>(url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return await routes(new URL(url, 'http://localhost'), { url, init }) as T;
  };
  return { read, calls };
}

async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for test condition');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('cross-profile session search', () => {
  beforeEach(() => clearSessionSearchCaches());

  it('publishes the current profile first and appends other profiles before all finish', async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>(resolve => { releaseSlow = resolve; });
    const { read } = readFor(async (url, call) => {
      if (url.pathname === '/api/profiles') return { profiles: [{ name: 'writer' }, { name: 'slow' }] };
      if (url.pathname === '/api/sessions/search') return { results: [] };
      if (url.pathname === '/api/plugins/workbench/session-organization') return { items: [] };
      if (url.pathname === '/api/plugins/workbench/codex/search') {
        const profile = url.searchParams.get('profile');
        if (profile === 'slow') await slow;
        if (profile === 'default') return { results: [codexHit('current-session', 'Current profile hit')] };
        if (profile === 'writer') return {
          results: [codexHit('writer-session', 'Writer title match'), codexHit('writer-session', 'Writer title match', 'content snippet')],
        };
        return { results: [] };
      }
      throw new Error(`Unexpected request ${call.url}`);
    });

    const updates: SearchSnapshot[] = [];
    const pending = searchAllProfiles(read, 'default', 'needle', {
      onUpdate: snapshot => updates.push(snapshot),
      sourceTimeoutMs: 500,
      totalTimeoutMs: 2000,
    });

    await until(() => updates.some(update => update.results.some(row => row.profile === 'writer')));
    expect(updates[0].results[0]).toMatchObject({ profile: 'default', id: 'current-session' });
    expect(updates.at(-1)?.complete).toBe(false);
    const writer = updates.flatMap(update => update.results).find(row => row.profile === 'writer');
    expect(writer).toMatchObject({ title: 'Writer title match', snippet: 'content snippet' });

    releaseSlow();
    const final = await pending;
    expect(final.complete).toBe(true);
    expect(final.timedOut).toBe(false);
    expect(final.results.map(row => row.id)).toEqual(['current-session', 'writer-session']);
  });

  it('returns partial results and a timeout notice when one source never settles', async () => {
    const { read } = readFor(async url => {
      if (url.pathname === '/api/profiles') return { profiles: [{ name: 'default' }] };
      if (url.pathname === '/api/sessions/search') return { results: [] };
      if (url.pathname === '/api/plugins/workbench/session-organization') return { items: [] };
      if (url.pathname === '/api/plugins/workbench/codex/search') {
        return url.searchParams.get('content') === 'false'
          ? { results: [codexHit('metadata-hit', 'Title remains searchable')] }
          : await new Promise(() => {});
      }
      throw new Error('Unexpected request');
    });

    const final = await searchAllProfiles(read, 'default', 'needle', {
      sourceTimeoutMs: 20,
      totalTimeoutMs: 250,
    });

    expect(final.complete).toBe(true);
    expect(final.results).toEqual([expect.objectContaining({ id: 'metadata-hit', title: 'Title remains searchable' })]);
    expect(final.failures.join(' ')).toMatch(/Codex content search.*timed out/i);
  });

  it('aborts in-flight requests when the caller cancels the search', async () => {
    let profileSignal: AbortSignal | undefined;
    const { read } = readFor(async (url, call) => {
      if (url.pathname === '/api/profiles') {
        profileSignal = call.init?.signal || undefined;
        return await new Promise((_, reject) => {
          profileSignal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
      }
      if (url.pathname === '/api/sessions/search') return { results: [] };
      if (url.pathname === '/api/plugins/workbench/session-organization') return { items: [] };
      if (url.pathname === '/api/plugins/workbench/codex/search') return { results: [] };
      throw new Error('Unexpected request');
    });

    const controller = new AbortController();
    const pending = searchAllProfiles(read, 'default', 'needle', {
      signal: controller.signal,
      sourceTimeoutMs: 500,
      totalTimeoutMs: 2000,
    });

    await until(() => Boolean(profileSignal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(profileSignal?.aborted).toBe(true);
  });

  it('caches the profile roster and project metadata across searches', async () => {
    const { read, calls } = readFor(async url => {
      if (url.pathname === '/api/profiles') return { profiles: [{ name: 'default' }] };
      if (url.pathname === '/api/sessions/search') return { results: [] };
      if (url.pathname === '/api/plugins/workbench/session-organization') return { items: [] };
      if (url.pathname === '/api/plugins/workbench/codex/search') return { results: [] };
      throw new Error('Unexpected request');
    });

    await searchAllProfiles(read, 'default', 'first', { sourceTimeoutMs: 100, totalTimeoutMs: 500 });
    await searchAllProfiles(read, 'default', 'second', { sourceTimeoutMs: 100, totalTimeoutMs: 500 });

    const count = (path: string) => calls.filter(call => new URL(call.url, 'http://localhost').pathname === path).length;
    expect(count('/api/profiles')).toBe(1);
    expect(count('/api/plugins/workbench/session-organization')).toBe(1);
    expect(count('/api/plugins/workbench/codex/search')).toBe(4);
  });
});
