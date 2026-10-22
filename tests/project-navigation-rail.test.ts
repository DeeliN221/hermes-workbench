// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createProjectNavigation } from '../dashboard/src/project-navigation';

afterEach(() => {
  delete document.documentElement.dataset.workbenchNavCollapsed;
});

it('renders folders for projects and bubbles for temporary sessions in the collapsed rail', () => {
  document.documentElement.dataset.workbenchNavCollapsed = 'true';
  const sdk = {
    React: {
      Fragment: 'fragment', useId: () => 'project-rail-test',
      createElement: (type: string, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat() }),
    },
    hooks: {
      useState: (value: any) => [typeof value === 'function' ? value() : value, vi.fn()],
      useRef: (value: any) => ({ current: value }),
      useEffect: vi.fn(),
    },
  };
  const project = { id: 'research', name: 'Research' };
  const renderSession = vi.fn((session: { id: string }) => ({ type: 'session-row', props: { 'data-session': session.id }, children: [] }));
  const tree = createProjectNavigation(sdk)({
    profile: 'default',
    sessions: [
      { id: 'project-session', groupId: 'research' },
      { id: 'temporary-session', groupId: null },
    ],
    projects: [project],
    activeSessionId: '',
    renderSession,
    onCreate: vi.fn(), onNewSession: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(),
  });
  const descendants = (node: any): any[] => node && typeof node === 'object'
    ? [node, ...node.children.flatMap(descendants)]
    : [];
  const nodes = descendants(tree);
  const folder = nodes.find(node => node.props?.className === 'project-rail-folder');
  expect(folder).toBeDefined();
  expect(folder.props['data-project-rail-folder']).toBe('research');
  expect(descendants(folder).some(node => node.type === 'svg')).toBe(true);
  expect(nodes.filter(node => node.props?.className === 'project-rail-session')).toHaveLength(1);
  expect(renderSession).toHaveBeenCalledWith({ id: 'temporary-session', groupId: null }, false);
  expect(nodes.some(node => node.props?.className === 'project-navigation')).toBe(false);
});
