import { describe, expect, it, vi } from 'vitest';
import { createProjectNavigation, partitionProjectSessions, projectDropSession } from '../dashboard/src/project-navigation';

describe('manual project membership', () => {
  const projects = [{ id: 'one', name: 'Research' }, { id: 'empty', name: 'Empty' }];
  const sessions = [
    { id: 'assigned', groupId: 'one', favorite: true, workspacePath: '/same' },
    { id: 'temporary', groupId: null, workspacePath: '/same' },
    { id: 'orphan', groupId: 'removed' },
    { id: 'archived', groupId: 'one', deleted: true },
  ];
  it('keeps explicit membership and empty projects, pinning favorites within each section', () => {
    const result = partitionProjectSessions([
      { id: 'later-favorite', groupId: 'one', favorite: true },
      ...sessions,
    ], projects);
    expect(result.groups.map(group => group.sessions.map(session => session.id))).toEqual([['later-favorite', 'assigned'], []]);
    expect(result.temporary.map(session => session.id)).toEqual(['temporary', 'orphan']);
    expect(partitionProjectSessions(sessions, []).temporary.map(session => session.id)).toEqual(['assigned', 'temporary', 'orphan']);
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
