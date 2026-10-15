import type { RecentSession } from './recent-home';
import type { FetchJSON } from './workbench-api';
export type ReadMarkers = Record<string, string>;
const storageKey = (profile: string) => `workbench.home.read.v1:${profile}`;
export const cardIdentity = (row: RecentSession) => JSON.stringify([row.profile, row.source, row.id]);
export const activityVersion = (row: RecentSession) => JSON.stringify(['v2', row.source === 'Codex' ? row.completedSeq : row.messageCount]);
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
/** Persist only the activity the user saw, so concurrent completions remain unread. */
export async function markCardRead(fetchJSON: FetchJSON, row: RecentSession): Promise<ReadMarkers> {
  if (row.source === 'Codex') {
    await fetchJSON(`/api/plugins/workbench/codex/session/read?profile=${encodeURIComponent(row.profile)}&session_id=${encodeURIComponent(row.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readSeq: row.completedSeq }),
    });
  }
  const markers = { ...readMarkers(row.profile), [cardIdentity(row)]: activityVersion(row) };
  // Surface unavailable storage rather than pretending the dismissal survived a reload.
  localStorage.setItem(storageKey(row.profile), JSON.stringify(markers));
  return markers;
}
