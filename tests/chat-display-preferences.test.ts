// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  cachedChatDisplayPreferences,
  loadChatDisplayPreferences,
  renderChatDisplayPreferences,
  saveChatDisplayPreferences,
} from '../dashboard/src/chat-display-preferences';
import type { FetchJSON } from '../dashboard/src/workbench-api';

afterEach(() => document.body.replaceChildren());

it('defaults both optional utilities to hidden and round-trips server preferences', async () => {
  expect(cachedChatDisplayPreferences('new-profile')).toEqual({
    generationSpeedEnabled: false,
    userMessageNavigatorEnabled: false,
  });
  let state = { generationSpeedEnabled: false, userMessageNavigatorEnabled: false };
  const read = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') state = JSON.parse(String(init.body));
    return state;
  }) as unknown as FetchJSON;
  expect(await loadChatDisplayPreferences(read, 'writer')).toEqual(state);
  const enabled = { generationSpeedEnabled: true, userMessageNavigatorEnabled: true };
  expect(await saveChatDisplayPreferences(read, 'writer', enabled)).toEqual(enabled);
  expect(cachedChatDisplayPreferences('writer')).toEqual(enabled);
});

it('renders two off switches and saves each visibility choice', async () => {
  const panel = document.createElement('section');
  document.body.append(panel);
  let state = { generationSpeedEnabled: false, userMessageNavigatorEnabled: false };
  const read = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') state = JSON.parse(String(init.body));
    return state;
  }) as unknown as FetchJSON;
  renderChatDisplayPreferences(panel, read, 'default');
  const messages = panel.querySelector<HTMLButtonElement>('[data-testid="user-message-ball-toggle"]')!;
  const speed = panel.querySelector<HTMLButtonElement>('[data-testid="generation-speed-toggle"]')!;
  await vi.waitFor(() => expect(messages.disabled).toBe(false));
  expect(messages.getAttribute('aria-checked')).toBe('false');
  expect(speed.getAttribute('aria-checked')).toBe('false');
  messages.click();
  await vi.waitFor(() => expect(messages.getAttribute('aria-checked')).toBe('true'));
  await vi.waitFor(() => expect(messages.disabled).toBe(false));
  speed.click();
  await vi.waitFor(() => expect(speed.getAttribute('aria-checked')).toBe('true'));
  expect(state).toEqual({ generationSpeedEnabled: true, userMessageNavigatorEnabled: true });
});

it('keeps the previous choice when saving fails', async () => {
  const panel = document.createElement('section');
  document.body.append(panel);
  let fail = false;
  const read = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && fail) throw new Error('Unavailable');
    return { generationSpeedEnabled: false, userMessageNavigatorEnabled: false };
  }) as unknown as FetchJSON;
  renderChatDisplayPreferences(panel, read, 'failure-profile');
  const toggle = panel.querySelector<HTMLButtonElement>('[data-testid="generation-speed-toggle"]')!;
  await vi.waitFor(() => expect(toggle.disabled).toBe(false));
  fail = true;
  toggle.click();
  await vi.waitFor(() => expect(panel.textContent).toContain('Could not save'));
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});
