import type { RecentSession } from './recent-home';
import type { FetchJSON } from './workbench-api';
export type ReadMarkers = Record<string, string>;
type ServerReadState = { profile?: unknown; source?: unknown; session_id?: unknown; activity_version?: unknown };
const storageKey = (profile: string) => `workbench.home.read.v1:${profile}`;
export const cardIdentity = (row: RecentSession) => JSON.stringify([row.profile, row.source, row.id]);
export const activityVersion = (row: RecentSession) => JSON.stringify(['v2', row.source === 'Codex' ? row.completedSeq : row.messageCount]);
const serverMarker = (item: ServerReadState): [string, string] | null => {
  const profile = String(item.profile || ''), source = String(item.source || ''), sessionId = String(item.session_id || '');
  const version = typeof item.activity_version === 'string' ? item.activity_version : '';
  return profile && source && sessionId && version
    ? [JSON.stringify([profile, source, sessionId]), version] : null;
};
export function readMarkers(profile: string): ReadMarkers {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(profile)) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, marker]) => typeof marker === 'string')) as ReadMarkers : {};
  } catch { return {}; }
}
export function cardWasRead(row: RecentSession, markers: ReadMarkers): boolean {
  const marker = markers[cardIdentity(row)];
  if (marker === activityVersion(row)) return true;
  // Preserve v1 acknowledgements: metadata timestamps are not new messages.
  if (marker) {
    try {
      const old = JSON.parse(marker);
      if (Array.isArray(old) && old.length === 3 && typeof old[0] === 'number'
        && old[1] === row.completedSeq && old[2] === row.messageCount) return true;
    } catch { /* Ignore corrupt browser state. */ }
  }
  // Restore server acknowledgements when browser storage is missing. A running
  // turn may have new activity beyond the last completed reply.
  return row.source === 'Codex' && row.status !== 'running' && row.completedSeq > 0
    && (row.readSeq ?? 0) >= row.completedSeq;
}
/** Load acknowledgements written by any device; local storage remains a cache. */
export async function fetchReadMarkers(fetchJSON: FetchJSON, signal?: AbortSignal): Promise<ReadMarkers> {
  const result = await fetchJSON<{ items?: ServerReadState[] }>('/api/plugins/workbench/home-read-state', { signal });
  if (!Array.isArray(result.items)) throw new Error('Invalid recent-home read state response');
  return Object.fromEntries(result.items.map(serverMarker).filter((item): item is [string, string] => item !== null));
}
/** Persist one card's activity cursor so every device sees the same acknowledgement. */
export async function saveReadMarker(fetchJSON: FetchJSON, row: RecentSession): Promise<void> {
  await fetchJSON('/api/plugins/workbench/home-read-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: row.profile, source: row.source, session_id: row.id, activity_version: activityVersion(row) }),
  });
}
/** Persist only the activity the user saw, so concurrent completions remain unread. */
export async function markCardRead(fetchJSON: FetchJSON, row: RecentSession): Promise<ReadMarkers> {
  if (row.source === 'Codex') {
    await fetchJSON(`/api/plugins/workbench/codex/session/read?profile=${encodeURIComponent(row.profile)}&session_id=${encodeURIComponent(row.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readSeq: row.completedSeq }),
    });
  }
  await saveReadMarker(fetchJSON, row);
  const markers = { ...readMarkers(row.profile), [cardIdentity(row)]: activityVersion(row) };
  // Surface unavailable storage rather than pretending the dismissal survived a reload.
  localStorage.setItem(storageKey(row.profile), JSON.stringify(markers));
  return markers;
}
