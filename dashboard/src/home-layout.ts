import type { FetchJSON } from './workbench-api';

/** Desktop home density is owned by the backend, never by localStorage. */
export type HomeLayout = { columns: number; sessionsPerProfile: number };

export const HOME_LAYOUT_DEFAULTS: HomeLayout = { columns: 3, sessionsPerProfile: 3 };
export const HOME_LAYOUT_COLUMNS = { min: 1, max: 6 } as const;
export const HOME_LAYOUT_SESSIONS = { min: 1, max: 20 } as const;
export const HOME_LAYOUT_CHANGE_EVENT = 'hermes-workbench:home-layout-change';

export type HomeLayoutInvalidField = 'columns' | 'sessionsPerProfile';
export type HomeLayoutResult = { layout: HomeLayout; invalid: HomeLayoutInvalidField[] };

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

/** Invalid persisted values degrade to defaults instead of breaking the home page. */
export function normalizeHomeLayout(value: unknown): HomeLayoutResult {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const columns = boundedInteger(source.columns, HOME_LAYOUT_COLUMNS.min, HOME_LAYOUT_COLUMNS.max, HOME_LAYOUT_DEFAULTS.columns);
  const sessionsPerProfile = boundedInteger(source.sessions_per_profile, HOME_LAYOUT_SESSIONS.min, HOME_LAYOUT_SESSIONS.max, HOME_LAYOUT_DEFAULTS.sessionsPerProfile);
  const invalid: HomeLayoutInvalidField[] = [];
  if (columns !== source.columns && Number(source.columns) !== columns) invalid.push('columns');
  if (sessionsPerProfile !== source.sessions_per_profile && Number(source.sessions_per_profile) !== sessionsPerProfile) invalid.push('sessionsPerProfile');
  if (source.invalid_fields && !invalid.length) invalid.push('columns', 'sessionsPerProfile');
  return { layout: { columns, sessionsPerProfile }, invalid };
}

export async function loadHomeLayout(fetchJSON: FetchJSON, profile: string, signal?: AbortSignal): Promise<HomeLayoutResult> {
  const value = await fetchJSON<unknown>(`/api/plugins/workbench/home-layout?profile=${encodeURIComponent(profile)}`, { signal });
  return normalizeHomeLayout(value);
}

export async function saveHomeLayout(fetchJSON: FetchJSON, profile: string, layout: HomeLayout): Promise<HomeLayout> {
  const value = await fetchJSON<unknown>(`/api/plugins/workbench/home-layout?profile=${encodeURIComponent(profile)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns: layout.columns, sessions_per_profile: layout.sessionsPerProfile }),
  });
  return normalizeHomeLayout(value).layout;
}

export function announceHomeLayout(layout: HomeLayout): void {
  window.dispatchEvent(new CustomEvent<HomeLayout>(HOME_LAYOUT_CHANGE_EVENT, { detail: layout }));
}
