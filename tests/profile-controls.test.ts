// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { createProfileControls } from '../dashboard/src/profile-controls';

it('opens the target editor without switching scope, and scopes skills to its own card', () => {
  history.replaceState(null, '', '/profiles?profile=default');
  let state = 0;
  const sdk = {
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat() }) },
    hooks: {
      useRef: (value: any) => ({ current: value }), useEffect: vi.fn(),
      useState: (value: any) => [state++ === 0 ? [{ name: 'writer' }] : typeof value === 'function' ? value() : value, vi.fn()],
    },
    fetchJSON: vi.fn(),
  };
  const tree = createProfileControls(sdk).ProfilesPage({ profile: 'default' });
  const descendants = (node: any): any[] => node && typeof node === 'object' ? [node, ...node.children.flatMap(descendants)] : [];
  const links = descendants(tree).filter(node => node.type === 'a');
  const edit = new URL(links.find(node => node.children.includes('Edit')).props.href, 'http://localhost');
  const models = new URL(links.find(node => node.children.includes('Models')).props.href, 'http://localhost');
  const skills = new URL(links.find(node => node.children.includes('Skills')).props.href, 'http://localhost');
  expect(edit.pathname).toBe('/profiles');
  expect(edit.searchParams.get('edit')).toBe('writer');
  expect(edit.searchParams.get('profile')).toBe('default');
  expect(edit.searchParams.has('workbench')).toBe(false);
  expect(models.pathname).toBe('/profiles');
  expect(models.searchParams.get('edit')).toBe('writer');
  expect(models.searchParams.get('section')).toBe('model');
  expect(models.searchParams.get('profile')).toBe('default');
  expect(skills.pathname).toBe('/skills');
  expect(skills.searchParams.get('profile')).toBe('writer');
});
