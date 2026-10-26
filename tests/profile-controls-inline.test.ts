// @vitest-environment happy-dom
// React is supplied by the host bundle; this repository intentionally ships without React type packages.
// @ts-expect-error untyped host dependency
import { act } from 'react-dom/test-utils';
// @ts-expect-error untyped host dependency
import { createRoot } from 'react-dom/client';
// @ts-expect-error untyped host dependency
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProfileControls } from '../dashboard/src/profile-controls';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
let root: any = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function renderProfileAction(fetchJSON = vi.fn(async () => ({ profiles: [{ name: 'default' }, { name: 'writer' }] }))) {
  document.documentElement.lang = 'en';
  history.replaceState(null, '', '/sessions?profile=default');
  const { ProfileAction } = createProfileControls({ React, hooks: React, fetchJSON } as any);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(h(ProfileAction, { profile: 'default', label: 'default', className: 'dashboard-nav-profile' }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return host;
}

describe('inline profile switcher', () => {
  it('expands the roster beneath the trigger without opening a dialog', async () => {
    const element = await renderProfileAction();
    const trigger = element.querySelector<HTMLButtonElement>('.dashboard-nav-profile > button')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => trigger.click());
    const menu = element.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu).not.toBeNull();
    expect(element.querySelector('dialog')).toBeNull();
    const options = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    expect(options.map(option => option.textContent)).toEqual(['default', 'writer']);
    expect(options.map(option => option.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await act(async () => options[1].click());
    expect(element.querySelector('[role="menu"]')).toBeNull();
    expect(window.location.pathname).toBe('/sessions');
    expect(new URLSearchParams(window.location.search).get('profile')).toBe('writer');
  });

  it('closes on Escape or an outside pointer press and keeps focus on the trigger', async () => {
    const element = await renderProfileAction();
    const trigger = element.querySelector<HTMLButtonElement>('.dashboard-nav-profile > button')!;

    await act(async () => trigger.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(element.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => trigger.click());
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(element.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps load failures visible inside the expanded panel', async () => {
    const element = await renderProfileAction(vi.fn(async () => { throw new Error('HTTP 503'); }));
    await act(async () => element.querySelector<HTMLButtonElement>('.dashboard-nav-profile > button')!.click());
    const menu = element.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.textContent).toContain('Failed to load profiles');
    expect(menu.querySelector('[role="alert"] button')?.textContent).toBe('Retry');
  });

  it('shows an asynchronous switch failure when the panel is reopened', async () => {
    const element = await renderProfileAction();
    await act(async () => window.dispatchEvent(new CustomEvent('workbench:profile-error', { detail: { message: 'Profile sync failed' } })));
    await act(async () => element.querySelector<HTMLButtonElement>('.dashboard-nav-profile > button')!.click());
    expect(element.querySelector('[role="menu"]')?.textContent).toContain('Profile sync failed');
  });
});
