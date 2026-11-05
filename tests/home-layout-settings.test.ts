// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHomeLayoutSettings } from '../dashboard/src/home-layout-settings';
import { HOME_LAYOUT_CHANGE_EVENT } from '../dashboard/src/home-layout';
import type { FetchJSON } from '../dashboard/src/workbench-api';

const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); };

beforeEach(() => {
  document.documentElement.lang = 'en';
  window.history.replaceState(null, '', '/config?workbench=display&profile=writer');
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('home layout settings', () => {
  it('loads the current profile layout and saves valid values to the backend', async () => {
    let saved = { columns: 3, sessions_per_profile: 3 };
    const calls: string[] = [];
    const fetchJSON: FetchJSON = async <T>(url: string, init?: RequestInit) => {
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (init?.method === 'PUT') saved = JSON.parse(String(init.body));
      return saved as T;
    };
    const panel = document.createElement('section');
    document.body.append(panel);
    await renderHomeLayoutSettings(panel, fetchJSON);
    const columns = panel.querySelector<HTMLInputElement>('[data-testid="home-layout-columns"]')!;
    const sessions = panel.querySelector<HTMLInputElement>('[data-testid="home-layout-sessions"]')!;
    expect(columns.value).toBe('3');
    expect(sessions.value).toBe('3');
    expect(calls[0]).toBe('GET /api/plugins/workbench/home-layout?profile=writer');

    columns.value = '4';
    columns.dispatchEvent(new Event('change'));
    await flush();
    expect(saved).toEqual({ columns: 4, sessions_per_profile: 3 });
    expect(panel.querySelector('[role="status"]')?.textContent).toContain('Saved');

    sessions.value = '5';
    sessions.dispatchEvent(new Event('change'));
    await flush();
    expect(saved).toEqual({ columns: 4, sessions_per_profile: 5 });
    expect(calls.filter(call => call.startsWith('PUT'))).toHaveLength(2);
  });

  it('restores and saves the default for invalid input with an accessible status', async () => {
    let saved = { columns: 4, sessions_per_profile: 5 };
    const fetchJSON: FetchJSON = async <T>(_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') saved = JSON.parse(String(init.body));
      return saved as T;
    };
    const panel = document.createElement('section');
    document.body.append(panel);
    await renderHomeLayoutSettings(panel, fetchJSON);
    const columns = panel.querySelector<HTMLInputElement>('[data-testid="home-layout-columns"]')!;
    columns.value = '7';
    columns.dispatchEvent(new Event('change'));
    await flush();
    expect(columns.value).toBe('3');
    expect(saved).toEqual({ columns: 3, sessions_per_profile: 5 });
    expect(panel.querySelector('[role="status"]')?.textContent).toContain('Default 3 restored');

    const sessions = panel.querySelector<HTMLInputElement>('[data-testid="home-layout-sessions"]')!;
    sessions.value = '';
    sessions.dispatchEvent(new Event('change'));
    await flush();
    expect(sessions.value).toBe('3');
    expect(saved).toEqual({ columns: 3, sessions_per_profile: 3 });
  });

  it('announces saved changes for a home page that is already mounted', async () => {
    const fetchJSON: FetchJSON = async <T>(_url: string, init?: RequestInit) => (
      init?.method === 'PUT' ? { columns: 6, sessions_per_profile: 1 } : { columns: 3, sessions_per_profile: 3 }
    ) as T;
    const panel = document.createElement('section');
    document.body.append(panel);
    await renderHomeLayoutSettings(panel, fetchJSON);
    const event = vi.fn();
    window.addEventListener(HOME_LAYOUT_CHANGE_EVENT, event);
    try {
      const columns = panel.querySelector<HTMLInputElement>('[data-testid="home-layout-columns"]')!;
      columns.value = '6';
      columns.dispatchEvent(new Event('change'));
      await flush();
      expect(event).toHaveBeenCalledTimes(1);
      expect((event.mock.calls[0][0] as CustomEvent).detail).toEqual({ columns: 6, sessionsPerProfile: 1 });
    } finally {
      window.removeEventListener(HOME_LAYOUT_CHANGE_EVENT, event);
    }
  });
});
