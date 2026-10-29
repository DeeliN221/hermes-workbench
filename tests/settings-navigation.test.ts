// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import {
  readSettingsMoreOpen,
  settingsLinkActive,
  settingsNavSections,
  writeSettingsMoreOpen,
} from '../dashboard/src/settings-navigation';

afterEach(() => {
  document.documentElement.removeAttribute('lang');
  localStorage.clear();
});

it('groups settings into preferences, agent, maintenance, and one collapsed more section', () => {
  const sections = settingsNavSections();
  expect(sections.map(section => [section.id, section.collapsible === true])).toEqual([
    ['preferences', false],
    ['agent', false],
    ['maintenance', false],
    ['more', true],
  ]);
  const hrefs = sections.flatMap(section => section.items).map(([href]) => href);
  expect(hrefs).toHaveLength(16);
  expect(new Set(hrefs).size).toBe(16);
  // Every settings page from the flat navigation stays reachable after regrouping.
  expect(hrefs).toEqual(expect.arrayContaining([
    '/config', '/config?workbench=display', '/config?workbench=models', '/config?workbench=shortcuts',
    '/profiles', '/models', '/env', '/config?workbench=versions',
    '/plugins', '/mcp', '/channels', '/webhooks', '/pairing', '/system', '/logs', '/docs',
  ]));
  expect(sections[0].items.map(([, label]) => label)).toEqual(['General', 'Chat display', 'Model visibility', 'Keyboard shortcuts']);
  expect(sections[3].items.map(([href]) => href)).toEqual([
    '/plugins', '/mcp', '/channels', '/webhooks', '/pairing', '/system', '/docs',
  ]);
});

it('marks only one Workbench settings tab as current', () => {
  expect(settingsLinkActive('/config', { path: '/config', settingsTab: '' })).toBe(true);
  expect(settingsLinkActive('/config', { path: '/config', settingsTab: 'models' })).toBe(false);
  expect(settingsLinkActive('/config?workbench=models', { path: '/config', settingsTab: 'models' })).toBe(true);
  expect(settingsLinkActive('/config?workbench=versions', { path: '/config', settingsTab: 'settings' })).toBe(true);
  expect(settingsLinkActive('/config?workbench=versions', { path: '/config', settingsTab: 'versions' })).toBe(true);
  expect(settingsLinkActive('/profiles', { path: '/profiles', settingsTab: 'manage' })).toBe(true);
  expect(settingsLinkActive('/profiles', { path: '/profiles/writer', settingsTab: '' })).toBe(true);
  expect(settingsLinkActive('/logs', { path: '/config', settingsTab: '' })).toBe(false);
});

it('remembers whether the more section is expanded', () => {
  expect(readSettingsMoreOpen()).toBe(false);
  writeSettingsMoreOpen(true);
  expect(readSettingsMoreOpen()).toBe(true);
  writeSettingsMoreOpen(false);
  expect(readSettingsMoreOpen()).toBe(false);
});
