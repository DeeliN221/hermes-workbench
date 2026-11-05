import { describe, expect, it } from 'vitest';
import {
  HOME_LAYOUT_DEFAULTS,
  normalizeHomeLayout,
  saveHomeLayout,
} from '../dashboard/src/home-layout';
import type { FetchJSON } from '../dashboard/src/workbench-api';

describe('home layout', () => {
  it('defaults to three columns and three sessions', () => {
    expect(normalizeHomeLayout({}).layout).toEqual(HOME_LAYOUT_DEFAULTS);
    expect(normalizeHomeLayout({ columns: 3, sessions_per_profile: 3 }).invalid).toEqual([]);
  });

  it('accepts the configured bounds and rejects values outside them', () => {
    expect(normalizeHomeLayout({ columns: 1, sessions_per_profile: 1 }).layout).toEqual({ columns: 1, sessionsPerProfile: 1 });
    expect(normalizeHomeLayout({ columns: 6, sessions_per_profile: 20 }).layout).toEqual({ columns: 6, sessionsPerProfile: 20 });
    const invalid = normalizeHomeLayout({ columns: 0, sessions_per_profile: 21 });
    expect(invalid.layout).toEqual(HOME_LAYOUT_DEFAULTS);
    expect(invalid.invalid).toEqual(['columns', 'sessionsPerProfile']);
    expect(normalizeHomeLayout({ columns: 4.5, sessions_per_profile: 'many' }).layout).toEqual(HOME_LAYOUT_DEFAULTS);
  });

  it('saves the backend field names and normalizes the response', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchJSON: FetchJSON = async <T>(url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { columns: 4, sessions_per_profile: 5 } as T;
    };
    await expect(saveHomeLayout(fetchJSON, 'writer', { columns: 4, sessionsPerProfile: 5 }))
      .resolves.toEqual({ columns: 4, sessionsPerProfile: 5 });
    expect(calls[0].url).toBe('/api/plugins/workbench/home-layout?profile=writer');
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ columns: 4, sessions_per_profile: 5 });
  });
});
