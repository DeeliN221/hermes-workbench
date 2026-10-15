/**
 * Read and save Workbench session metadata through the authenticated Dashboard client.
 * Call only plugin APIs and do not modify native Hermes session tables.
 */
import {
  indexSessionOrganization,
  normalizeSessionOrganization,
  type SessionOrganization,
  type SessionOrganizationMap,
} from './session-organization';

type FetchJSON = <T>(url: string, init?: RequestInit) => Promise<T>;
const ORGANIZATION_API = '/api/plugins/workbench/session-organization';

/** Encode one query parameter without letting profile text alter the endpoint. */
function query(value: string): string {
  return encodeURIComponent(value);
}

/** Load all organization metadata for the active profile. */
export async function loadSessionOrganization(
  fetchJSON: FetchJSON,
  profile: string,
): Promise<SessionOrganizationMap> {
  const response = await fetchJSON<{ items?: unknown[] }>(
    `${ORGANIZATION_API}?profile=${query(profile)}`,
  );
  return indexSessionOrganization(response?.items);
}

/** Persist the complete organization state for one session. */
export async function saveSessionOrganization(
  fetchJSON: FetchJSON,
  value: SessionOrganization,
): Promise<SessionOrganization | null> {
  const response = await fetchJSON<any>(ORGANIZATION_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: value.profile,
      session_id: value.sessionId,
      display_name: value.displayName,
      collection: value.collection,
      tags: value.tags,
      pinned: value.pinned,
      summary: value.summary,
    }),
  });
  if (response?.deleted === true) return null;
  return normalizeSessionOrganization(response);
}
