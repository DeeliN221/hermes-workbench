import { describe, expect, it, vi } from 'vitest';
import {
  PROJECT_SPLIT_DEFAULT, PROJECT_SPLIT_MAX, PROJECT_SPLIT_MIN,
  clampProjectSplit, compareSessions, createProjectNavigation, partitionProjectSessions, projectDropSession,
} from '../dashboard/src/project-navigation';

describe('manual project membership', () => {
  const projects = [{ id: 'one', name: 'Research' }, { id: 'empty', name: 'Empty' }];
  const sessions = [
    { id: 'assigned', groupId: 'one', favorite: true, createdAt: 100, updatedAtEpoch: 100, workspacePath: '/same' },
    { id: 'temporary', groupId: null, createdAt: 300, updatedAtEpoch: 300, workspacePath: '/same' },
    { id: 'orphan', groupId: 'removed', createdAt: 200, updatedAtEpoch: 200 },
    { id: 'archived', groupId: 'one', deleted: true },
  ];
  it('keeps explicit membership and empty projects, ordering sessions by creation time', () => {
    const result = partitionProjectSessions([
      { id: 'later-favorite', groupId: 'one', favorite: true, createdAt: 50 },
      ...sessions,
    ], projects);
    expect(result.groups.map(group => group.sessions.map(session => session.id))).toEqual([['assigned', 'later-favorite'], []]);
    expect(result.temporary.map(session => session.id)).toEqual(['temporary', 'orphan']);
    // Unassigned folders put every session in temporary; the favorite still pins to the top.
    expect(partitionProjectSessions(sessions, []).temporary.map(session => session.id)).toEqual(['assigned', 'temporary', 'orphan']);
  });
  it('sorts projects by their newest created session, with older projects below', () => {
    const result = partitionProjectSessions([
      { id: 'old', groupId: 'one', createdAt: 100 },
      { id: 'new', groupId: 'two', createdAt: 300 },
    ], [{ id: 'one', name: 'Old' }, { id: 'two', name: 'New' }]);
    expect(result.groups.map(group => group.project.id)).toEqual(['two', 'one']);
  });
  it('moves only known sessions within their profile, and allows moving back to temporary', () => {
    const drag = (sessionId: string, profile = 'default') => JSON.stringify({ sessionId, profile });
    expect(projectDropSession(drag('temporary'), 'default', 'one', sessions, projects)).toBe(sessions[1]);
    expect(projectDropSession(drag('assigned'), 'default', null, sessions, projects)).toBe(sessions[0]);
    expect(projectDropSession(drag('assigned'), 'default', 'empty', sessions, projects)).toBe(sessions[0]);
    for (const [payload, target] of [
      [drag('temporary', 'other'), 'one'], [drag('missing'), 'one'], [drag('archived'), 'one'],
      [drag('assigned'), 'one'], [drag('temporary'), 'removed'], ['external text', 'one'],
    ]) expect(projectDropSession(payload, 'default', target, sessions, projects)).toBeNull();
  });
});

describe('fixed creation-time ordering', () => {
  const ids = (list: { id: string }[]) => list.map(session => session.id);
  const sorted = (list: any[]) => ids([...list].sort(compareSessions));

  it('pins favorite sessions above newer unstarred ones', () => {
    expect(sorted([
      { id: 'newest', createdAt: 300 },
      { id: 'older-favorite', createdAt: 100, favorite: true },
      { id: 'favorite', createdAt: 10, favorite: true },
    ])).toEqual(['older-favorite', 'favorite', 'newest']);
  });

  it('orders newest created first and compares seconds against milliseconds', () => {
    expect(sorted([
      { id: 'seconds', createdAt: 1_700_000_000 },
      { id: 'milliseconds', createdAt: 1_700_000_500_000 },
      { id: 'oldest-seconds', createdAt: '1600000000' },
    ])).toEqual(['milliseconds', 'seconds', 'oldest-seconds']);
  });

  it('falls back to the session id when createdAt is missing or invalid', () => {
    expect(sorted([
      { id: 'b-stale' },
      { id: 'a-stale', createdAt: 0 },
      { id: 'c-invalid', createdAt: Number.NaN },
      { id: 'dated', createdAt: 42 },
    ])).toEqual(['dated', 'a-stale', 'b-stale', 'c-invalid']);
  });

  it('ignores updatedAt so sending or receiving messages never reorders a row', () => {
    expect(sorted([
      { id: 'one', createdAt: 100, updatedAtEpoch: 9_000_000, updatedAt: 'later' },
      { id: 'two', createdAt: 200, updatedAtEpoch: 10, updatedAt: 10 },
    ])).toEqual(['two', 'one']);
  });

  it('is a pure comparator that stays stable for identical timestamps', () => {
    const a = { id: 'a', createdAt: 100 };
    const b = { id: 'b', createdAt: 100 };
    expect([compareSessions(a, b), compareSessions(b, a)]).toEqual([-1, 1]);
    expect(compareSessions(a, { ...a })).toBe(0);
    expect(sorted([a, b])).toEqual(['a', 'b']);
    expect(sorted([b, a])).toEqual(['a', 'b']);
  });

  it('applies the same rule to temporary and project lists, unaffected by message activity', () => {
    const projects = [{ id: 'p', name: 'P' }];
    const base = [
      { id: 'temp-old', groupId: null, createdAt: 10 },
      { id: 'temp-new', groupId: null, createdAt: 30 },
      { id: 'folder-old', groupId: 'p', createdAt: 20 },
      { id: 'folder-new', groupId: 'p', createdAt: 40 },
    ];
    const active = base.map(session => ({ ...session, updatedAtEpoch: 5_000_000 - session.createdAt * 1000 }));
    for (const list of [base, active]) {
      const result = partitionProjectSessions(list, projects);
      expect(result.temporary.map(session => session.id)).toEqual(['temp-new', 'temp-old']);
      expect(result.groups[0].sessions.map(session => session.id)).toEqual(['folder-new', 'folder-old']);
    }
  });
});


it('keeps independent project actions outside disclosure summaries', () => {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  const sdk = {
    React: {
      Fragment: 'fragment', useId: () => 'project-history-test',
      createElement: (type: string, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat() }),
    },
    hooks: { useState: (value: any) => [value, vi.fn()], useRef: (value: any) => ({ current: value }), useEffect: vi.fn() },
  };
  const project = { id: 'one', name: 'Research' };
  const tree = createProjectNavigation(sdk)({
    profile: 'default', sessions: [], projects: [project], activeSessionId: '',
    renderSession: vi.fn(), onCreate: vi.fn(), onNewSession: vi.fn(), onRename, onDelete, onMove: vi.fn(),
  });
  function descendants(node: any): any[] {
    /** Inspect the emitted semantic tree, including closed folder controls. */
    return node && typeof node === 'object' ? [node, ...node.children.flatMap(descendants)] : [];
  }
  const nodes = descendants(tree);
  const summary = nodes.find(node => node.type === 'summary');
  expect(summary).toBeDefined();
  expect(descendants(summary).some(node => ['button', 'input', 'select', 'textarea', 'a'].includes(node.type))).toBe(false);
  const actions = nodes.find(node => node.props.className === 'project-actions');
  expect(nodes.find(node => node.type === 'details').children).not.toContain(actions);
  const [rename, remove] = actions.children;
  const trigger = {} as HTMLElement;
  rename.props.onClick({ preventDefault: vi.fn(), currentTarget: trigger });
  remove.props.onClick({ preventDefault: vi.fn(), currentTarget: trigger });
  expect(onRename).toHaveBeenCalledWith(project, trigger);
  expect(onDelete).toHaveBeenCalledWith(project);
});

describe('project and temporary session split', () => {
  it('keeps both panes usable and falls back to the default for invalid values', () => {
    expect(clampProjectSplit(PROJECT_SPLIT_MIN - 0.1)).toBe(PROJECT_SPLIT_MIN);
    expect(clampProjectSplit(PROJECT_SPLIT_MAX + 0.1)).toBe(PROJECT_SPLIT_MAX);
    expect(clampProjectSplit(Number.NaN)).toBe(PROJECT_SPLIT_DEFAULT);
    expect(clampProjectSplit(0.5)).toBe(0.5);
  });

  it('renders an accessible horizontal separator between the two sections', () => {
    const sdk = {
      React: {
        Fragment: 'fragment', useId: () => 'project-split-test',
        createElement: (type: string, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat() }),
      },
      hooks: { useState: (value: any) => [value, vi.fn()], useRef: (value: any) => ({ current: value }), useEffect: vi.fn() },
    };
    const tree = createProjectNavigation(sdk)({
      profile: 'default', sessions: [], projects: [], activeSessionId: '',
      renderSession: vi.fn(), onCreate: vi.fn(), onNewSession: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(),
    });
    const split = tree.children[0];
    expect(split.props.className).toContain('project-navigation-split');
    expect(split.children.map((child: any) => child.props.className)).toEqual([
      'project-navigation', 'project-navigation-resizer', 'project-temporary',
    ]);
    const separator = split.children[1];
    expect(separator.props.role).toBe('separator');
    expect(separator.props['aria-orientation']).toBe('horizontal');
    expect(separator.props['aria-valuenow']).toBe(Math.round(PROJECT_SPLIT_DEFAULT * 100));
    expect(separator.props.tabIndex).toBe(0);
  });
});
