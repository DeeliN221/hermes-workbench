// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { announceHomeLayout } from '../dashboard/src/home-layout';
import { createProfileOverview } from '../dashboard/src/profile-overview-page';
import type { FetchJSON } from '../dashboard/src/workbench-api';

const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await React.act(async () => root.unmount());
  document.body.innerHTML = '';
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

it('renders only the freshest three per profile after merging unordered sources, preserving full membership', async () => {
  const now = Date.now();
  const sessions = [
    { id: 'fourth', title: 'Hidden fourth', updatedAt: now - 4000, groupId: 'older-project' },
    { id: 'second', title: 'Second', updatedAt: now - 2000 },
    { id: 'opened', title: 'Recently opened', updatedAt: now - 9000, last_opened_at: now },
    { id: 'fifth', title: 'Hidden fifth', updatedAt: now - 5000 },
  ];
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith('/profile-overview')) return { profiles: ['default', 'writer'].map(name => ({
      name, projects: [{ id: 'older-project', name: 'Older project' }], sessions, failed: [],
    })) } as T;
    if (url.startsWith('/api/profiles/sessions?')) return { sessions: ['default', 'writer'].map(profile => ({
      id: 'third', title: 'Third from history', profile, updated_at: now - 3000,
    })), total: 2 } as T;
    return { profiles: [], order: [] } as T;
  };
  const Component = createProfileOverview({ React, hooks: React, fetchJSON }, vi.fn());
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await React.act(async () => root.render(React.createElement(Component)));
  expect(host.querySelectorAll('.profile-overview-column')).toHaveLength(2);
  for (const column of host.querySelectorAll('.profile-overview-column')) {
    expect([...column.querySelectorAll('.profile-session strong')].map(node => node.textContent))
      .toEqual(['Recently opened', 'Second', 'Third from history']);
    expect(column.querySelectorAll('.profile-session')).toHaveLength(3);
    expect(column.querySelector('.profile-column-count')?.textContent).toBe('5 sessions');
    expect(column.querySelectorAll('.profile-empty-project')).toHaveLength(0);
  }
  expect(host.textContent).not.toMatch(/Hidden fourth|Hidden fifth|Show all|Expand all/);
  expect(host.querySelectorAll('a[href*="fourth"], a[href*="fifth"]')).toHaveLength(0);
  expect(host.querySelectorAll('.profile-new-session')).toHaveLength(2);
  expect(host.querySelectorAll('time, .profile-session-meta')).toHaveLength(0);
  expect(host.querySelector('select, .profile-order-controls, .profile-project-actions, .profile-overview-heading')).toBeNull();
  expect(host.querySelectorAll('.profile-column-heading button')).toHaveLength(2);
  expect(sessions.map(row => row.id)).toEqual(['fourth', 'second', 'opened', 'fifth']);
});

it('renders a configured four-by-five home layout without changing session behavior', async () => {
  const now = Date.now();
  const sessions = Array.from({ length: 9 }, (_, index) => ({
    id: `session-${index}`, title: `Session ${index}`, updatedAt: now - index * 1000, groupId: 'project', unread: index === 0,
  }));
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith('/home-layout?profile=default')) return { columns: 4, sessions_per_profile: 5 } as T;
    if (url.endsWith('/profile-overview')) return { profiles: [{ name: 'default', projects: [{ id: 'project', name: 'Project' }], sessions, failed: [] }] } as T;
    if (url.startsWith('/api/profiles/sessions?')) return { sessions: [], total: 0 } as T;
    return { profiles: [], order: [], labels: {} } as T;
  };
  const Component = createProfileOverview({ React, hooks: React, fetchJSON }, vi.fn());
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await React.act(async () => root.render(React.createElement(Component)));
  const grid = host.querySelector('.profile-overview-columns') as HTMLElement;
  expect(grid.dataset.columns).toBe('4');
  expect(grid.style.getPropertyValue('--profile-columns')).toBe('4');
  expect(host.querySelectorAll('.profile-session')).toHaveLength(5);
  expect(host.querySelector('.profile-column-count')?.textContent).toBe('9 sessions');
  expect(host.querySelectorAll('.profile-session-indicator[aria-label="Unread"]')).toHaveLength(1);
  expect(host.querySelector<HTMLAnchorElement>('.profile-session')?.href).toContain('profile=default');
  expect(host.querySelector('.profile-new-session')).not.toBeNull();
  await React.act(async () => announceHomeLayout({ columns: 6, sessionsPerProfile: 8 }));
  expect(grid.dataset.columns).toBe('6');
  expect(host.querySelectorAll('.profile-session')).toHaveLength(8);
});
