import { describe, it, expect } from 'vitest';
import { homeSessionsPath, mergeHomeSessions, requestedHomeLayout, openedHomeSessions, sessionKey } from '../dashboard/src/home-session-selection';
import { savePaneLayout, resolvePaneLayout } from '../dashboard/src/codex-pane-layout';
const session = (profile: string, sessionId = 'same') => ({ profile, sessionId, hermesSessionId: '' });
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
describe('home session selection', () => {
  it('keeps profile identity, selection order, and deduplicates already open sessions', () => {
    const selected = [session('writer'), session('default')];
    expect(mergeHomeSessions(selected, [session('writer')])).toEqual(selected);
    expect(sessionKey(selected[0])).not.toBe(sessionKey(selected[1]));
  });
  it('blocks more than three selected/open sessions without dropping any', () => {
    expect(mergeHomeSessions([session('a'), session('b')], [session('c')])).toHaveLength(3);
    expect(mergeHomeSessions([session('a'), session('b')], [session('c'), session('d')])).toBeNull();
  });
  it('restores mixed profiles in order after reload and preserves them after closing', () => {
    const storage = memory();
    const sessions = [session('writer'), session('default'), { profile: 'writer', sessionId: '', hermesSessionId: 'history' }];
    const layout = requestedHomeLayout(homeSessionsPath(sessions), storage)!;
    expect(openedHomeSessions(storage)).toEqual(sessions);
    savePaneLayout('writer', layout.panes.slice(1), layout.targets, 'pane-2', storage);
    const restored = resolvePaneLayout({ profile: 'writer', storage, startEmpty: false, routeTarget: session('default') });
    expect(restored.panes.map(pane => pane.profile)).toEqual(['default', 'writer']);
    expect(restored.activePaneId).toBe('pane-2');
    expect(openedHomeSessions(storage)).toEqual(sessions.slice(1));
  });
  it('keeps existing pane ids and focuses an already open target without duplicates', () => {
    const storage = memory();
    const original = [session('writer'), session('default')];
    const first = requestedHomeLayout(homeSessionsPath(original), storage)!;
    savePaneLayout('writer', first.panes.slice(1), first.targets, 'pane-2', storage);
    const reopened = requestedHomeLayout(homeSessionsPath([session('writer'), session('default')], session('default')), storage)!;
    expect(reopened.panes[1].id).toBe('pane-2');
    expect(reopened.activePaneId).toBe('pane-2');
    expect(new Set(reopened.panes.map(pane => pane.id)).size).toBe(2);
  });
  it('rejects invalid or oversized route requests', () => {
    const storage = memory();
    for (const raw of [[], [session('a'), session('a')], Array.from({ length: 4 }, (_, i) => session(String(i))), [{ profile: 'x', sessionId: 'a', hermesSessionId: 'b' }], [{}]]) {
      expect(requestedHomeLayout(`/chat?homeOpen=${encodeURIComponent(JSON.stringify(raw))}`, storage)).toBeNull();
    }
  });
});
