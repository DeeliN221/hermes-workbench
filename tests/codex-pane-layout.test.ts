import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropPaneIds,
  normalizePaneLayout,
  paneLayoutSnapshot,
  paneLayoutStorageKey,
  readPaneLayout,
  resolvePaneLayout,
  savePaneLayout,
  splitViewSessionIds,
  verifyPaneTargets,
  type LayoutStorage,
  type PaneSpec,
  type PaneTarget,
} from '../dashboard/src/codex-pane-layout';

function memoryStorage(): LayoutStorage & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (key: string) => dump.get(key) ?? null,
    setItem: (key: string, value: string) => { dump.set(key, value); },
    removeItem: (key: string) => { dump.delete(key); },
  };
}

const pane = (id: string, sessionId = '', hermesSessionId = ''): PaneSpec =>
  ({ id, initialSessionId: sessionId, initialHermesSessionId: hermesSessionId });

const target = (sessionId = '', hermesSessionId = ''): PaneTarget => ({ sessionId, hermesSessionId });

describe('pane layout storage', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => { storage = memoryStorage(); });

  it('keeps one storage record per profile', () => {
    expect(paneLayoutStorageKey('writer')).toBe('workbench.codex.pane-layout.v1:writer');
    expect(paneLayoutStorageKey('')).toBe('workbench.codex.pane-layout.v1:default');
    expect(paneLayoutStorageKey('writer')).not.toBe(paneLayoutStorageKey('reviewer'));
  });

  it('round-trips pane order, sessions and the active pane', () => {
    savePaneLayout('writer',
      [pane('pane-1', 'run-a'), pane('pane-2', 'run-b'), pane('pane-3', '', 'hermes-c')],
      { 'pane-1': target('run-a'), 'pane-2': target('run-b'), 'pane-3': target('', 'hermes-c') },
      'pane-2', storage);
    const saved = readPaneLayout('writer', storage);
    expect(saved).not.toBeNull();
    expect(saved!.panes.map(item => [item.id, item.sessionId, item.hermesSessionId]))
      .toEqual([['pane-1', 'run-a', ''], ['pane-2', 'run-b', ''], ['pane-3', '', 'hermes-c']]);
    expect(saved!.activePaneId).toBe('pane-2');
    expect(readPaneLayout('reviewer', storage)).toBeNull();
  });

  it('keeps an explicitly empty pane empty instead of restoring a session', () => {
    savePaneLayout('writer', [pane('pane-1'), pane('pane-2', 'run-b')],
      { 'pane-1': target(), 'pane-2': target('run-b') }, 'pane-1', storage);
    const restored = resolvePaneLayout({
      profile: 'writer', storage, startEmpty: false, routeTarget: target(),
    });
    expect(restored.panes.map(item => item.initialSessionId)).toEqual(['', 'run-b']);
    expect(restored.activePaneId).toBe('pane-1');
  });

  it('falls back to one pane without touching storage when nothing was saved', () => {
    const restored = resolvePaneLayout({
      profile: 'writer', storage, startEmpty: false, routeTarget: target('run-a'),
    });
    expect(restored.restored).toBe(false);
    expect(restored.panes).toEqual([pane('pane-1', 'run-a')]);
    expect(restored.activePaneId).toBe('pane-1');
  });
});

describe('refresh restore', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => { storage = memoryStorage(); });

  function saveThreePanes(profile = 'writer') {
    savePaneLayout(profile,
      [pane('pane-1', 'run-a'), pane('pane-2', 'run-b'), pane('pane-3', 'run-c')],
      { 'pane-1': target('run-a'), 'pane-2': target('run-b'), 'pane-3': target('run-c') },
      'pane-2', storage);
  }

  it('restores every pane in its original order and focus', () => {
    saveThreePanes();
    const restored = resolvePaneLayout({
      profile: 'writer', storage, startEmpty: false, routeTarget: target('run-b'),
    });
    expect(restored.restored).toBe(true);
    expect(restored.panes.map(item => item.initialSessionId)).toEqual(['run-a', 'run-b', 'run-c']);
    expect(restored.activePaneId).toBe('pane-2');
  });

  it('restores a saved layout when the route names no session', () => {
    saveThreePanes();
    const restored = resolvePaneLayout({ profile: 'writer', storage, startEmpty: false, routeTarget: target() });
    expect(restored.panes).toHaveLength(3);
    expect(restored.activePaneId).toBe('pane-2');
  });

  it('ignores the saved layout for an explicit new-chat route', () => {
    saveThreePanes();
    const restored = resolvePaneLayout({ profile: 'writer', storage, startEmpty: true, routeTarget: target('run-a') });
    expect(restored.startEmpty).toBe(true);
    expect(restored.restored).toBe(false);
    expect(restored.panes).toEqual([pane('pane-1')]);
  });

  it('never mixes another profile layout into the current profile', () => {
    saveThreePanes('reviewer');
    const restored = resolvePaneLayout({ profile: 'writer', storage, startEmpty: false, routeTarget: target() });
    expect(restored.restored).toBe(false);
    expect(restored.panes).toEqual([pane('pane-1')]);
  });

  it('opens a route target that is not in the saved panes beside them', () => {
    savePaneLayout('writer',
      [pane('pane-1', 'run-a'), pane('pane-2', 'run-b')],
      { 'pane-1': target('run-a'), 'pane-2': target('run-b') }, 'pane-1', storage);
    const restored = resolvePaneLayout({
      profile: 'writer', storage, startEmpty: false, routeTarget: target('run-new'),
    });
    expect(restored.panes.map(item => item.initialSessionId)).toEqual(['run-a', 'run-b', 'run-new']);
    expect(restored.activePaneId).toBe('pane-3');
    expect(restored.targets['pane-3']).toEqual(target('run-new'));
  });

  it('replaces the rightmost pane when a full workspace gets an unknown route target', () => {
    saveThreePanes();
    const restored = resolvePaneLayout({
      profile: 'writer', storage, startEmpty: false, routeTarget: target('run-new'),
    });
    expect(restored.panes.map(item => item.initialSessionId)).toEqual(['run-a', 'run-b', 'run-new']);
    expect(restored.activePaneId).toBe('pane-4');
    expect(restored.targets['pane-3']).toBeUndefined();
  });
});

describe('stored data validation', () => {
  it('rejects corrupt, oversized or duplicated records', () => {
    expect(normalizePaneLayout(null)).toBeNull();
    expect(normalizePaneLayout('nope')).toBeNull();
    expect(normalizePaneLayout({ panes: [] })).toBeNull();
    expect(normalizePaneLayout({ panes: [{ id: 'pane-1' }, { id: 'pane-1' }] })).toBeNull();
    expect(normalizePaneLayout({
      panes: ['1', '2', '3', '4'].map(index => ({ id: `pane-${index}` })),
    })).toBeNull();
    expect(normalizePaneLayout({ panes: [{ id: 'not-a-pane' }] })).toBeNull();
  });

  it('repairs an unknown active pane to the first pane', () => {
    const layout = normalizePaneLayout({
      panes: [{ id: 'pane-1', sessionId: 'run-a' }, { id: 'pane-3', sessionId: 'run-b' }],
      activePaneId: 'pane-9',
    });
    expect(layout?.activePaneId).toBe('pane-1');
  });

  it('keeps one session identity per pane', () => {
    const layout = normalizePaneLayout({
      panes: [{ id: 'pane-1', sessionId: 'run-a', hermesSessionId: 'hermes-b' }],
      activePaneId: 'pane-1',
    });
    expect(layout?.panes[0]).toEqual({ id: 'pane-1', sessionId: 'run-a', hermesSessionId: '' });
  });

  it('drops a corrupt record instead of rendering it', () => {
    const storage = memoryStorage();
    storage.setItem(paneLayoutStorageKey('writer'), '{"panes": "broken"}');
    const restored = resolvePaneLayout({
      profile: 'writer', storage, startEmpty: false, routeTarget: target('run-a'),
    });
    expect(restored.restored).toBe(false);
    expect(restored.panes).toEqual([pane('pane-1', 'run-a')]);
  });

  it('survives unavailable storage', () => {
    const restored = resolvePaneLayout({
      profile: 'writer', storage: null, startEmpty: false, routeTarget: target('run-a'),
    });
    expect(restored.panes).toEqual([pane('pane-1', 'run-a')]);
    expect(paneLayoutSnapshot([], {}, 'pane-1')).toBeNull();
    expect(() => savePaneLayout('writer', [pane('pane-1')], {}, 'pane-1', null)).not.toThrow();
  });
});

describe('pruning panes whose session disappeared', () => {
  const panes = [pane('pane-1', 'run-a'), pane('pane-2', 'run-b'), pane('pane-3', 'run-c')];
  const targets = { 'pane-1': target('run-a'), 'pane-2': target('run-b'), 'pane-3': target('run-c') };

  it('removes only the missing pane', () => {
    const next = dropPaneIds(panes, targets, 'pane-1', ['pane-2']);
    expect(next.panes.map(item => item.id)).toEqual(['pane-1', 'pane-3']);
    expect(next.targets['pane-2']).toBeUndefined();
    expect(next.activePaneId).toBe('pane-1');
  });

  it('moves focus to the neighbour when the active pane disappears', () => {
    const next = dropPaneIds(panes, targets, 'pane-2', ['pane-2']);
    expect(next.activePaneId).toBe('pane-3');
  });

  it('keeps one empty pane when every saved session is gone', () => {
    const next = dropPaneIds(panes, targets, 'pane-1', ['pane-1', 'pane-2', 'pane-3']);
    expect(next.panes).toHaveLength(1);
    expect(next.panes[0].initialSessionId).toBe('');
    expect(next.activePaneId).toBe(next.panes[0].id);
  });

  it('leaves the layout untouched when nothing is missing', () => {
    const next = dropPaneIds(panes, targets, 'pane-2', []);
    expect(next.panes).toBe(panes);
    expect(next.activePaneId).toBe('pane-2');
  });
});

describe('split view session accents', () => {
  it('hides bars in a single pane and lists only Codex sessions when split', () => {
    expect(splitViewSessionIds(
      [pane('pane-1', 'run-a')],
      { 'pane-1': target('run-a') },
    )).toEqual([]);
    expect(splitViewSessionIds(
      [pane('pane-1', 'run-a'), pane('pane-2', 'run-b'), pane('pane-3', '', 'hermes-c')],
      { 'pane-1': target('run-a'), 'pane-2': target('run-b'), 'pane-3': target('', 'hermes-c') },
    )).toEqual(['run-a', 'run-b']);
  });

  it('skips empty, missing, and duplicate pane targets', () => {
    expect(splitViewSessionIds(
      [pane('pane-1', 'run-a'), pane('pane-2', 'run-a'), pane('pane-3')],
      { 'pane-1': target('run-a'), 'pane-2': target('run-a'), 'pane-3': target() },
    )).toEqual(['run-a']);
    expect(splitViewSessionIds(
      [pane('pane-1', 'run-a'), pane('pane-2', 'run-b')],
      { 'pane-1': target('run-a') },
    )).toEqual(['run-a']);
  });
});

describe('session availability check', () => {
  function reader(responses: Record<string, unknown>, failed: string[] = []) {
    const calls: string[] = [];
    const read = async <T,>(url: string): Promise<T> => {
      calls.push(url);
      if (failed.some(prefix => url.startsWith(prefix))) throw new Error('offline');
      for (const [prefix, body] of Object.entries(responses)) {
        if (url.startsWith(prefix)) return body as T;
      }
      return { items: [] } as T;
    };
    return { read, calls };
  }

  const codexItem = (id: string) => ({ id, session_id: id, title: id, deleted: false });

  it('reports only panes whose Codex session is gone', async () => {
    const { read, calls } = reader({
      '/api/plugins/workbench/codex/sessions?profile=writer&limit=100&offset=0': { items: [codexItem('run-a')] },
    });
    const missing = await verifyPaneTargets(read, 'writer', [
      { paneId: 'pane-1', ...target('run-a') },
      { paneId: 'pane-2', ...target('run-gone') },
    ]);
    expect(missing).toEqual(['pane-2']);
    expect(calls[0]).toContain('profile=writer');
  });

  it('keeps every pane when the listing fails', async () => {
    const { read } = reader({}, ['/api/plugins/workbench/codex/sessions']);
    const missing = await verifyPaneTargets(read, 'writer', [{ paneId: 'pane-1', ...target('run-a') }]);
    expect(missing).toEqual([]);
  });

  it('checks Hermes history ids only against a complete first page', async () => {
    const complete = reader({
      '/api/profiles/sessions': { sessions: [{ id: 'hermes-a' }], total: 1 },
    });
    await expect(verifyPaneTargets(complete.read, 'writer', [
      { paneId: 'pane-1', ...target('', 'hermes-a') },
      { paneId: 'pane-2', ...target('', 'hermes-gone') },
    ])).resolves.toEqual(['pane-2']);

    const partial = reader({
      '/api/profiles/sessions': { sessions: [{ id: 'hermes-a' }], total: 250 },
    });
    await expect(verifyPaneTargets(partial.read, 'writer', [
      { paneId: 'pane-2', ...target('', 'hermes-gone') },
    ])).resolves.toEqual([]);
    expect(partial.calls[0]).toContain('profile=writer');
  });

  it('never asks the backend about empty panes', async () => {
    const { read, calls } = reader({});
    await expect(verifyPaneTargets(read, 'writer', [])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
