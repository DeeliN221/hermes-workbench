import type { FetchJSON } from './workbench-api';
import type { HermesRecord } from './hermes-transcript';
import type { CodexGroup } from './codex-api';
import { recentSessions, type RecentSession } from './recent-home';
import { uiText as tr } from './ui-locale';

export const FRESHNESS = { count: 3, justNowMs: 60_000, dayMs: 86_400_000, weekMs: 7 * 86_400_000 } as const;
export type ProfileColumn = { name: string; icon?: string; projects: CodexGroup[]; rows: RecentSession[]; failed: string[]; loading: boolean };
type ProfileData = { name: string; icon?: string; projects: CodexGroup[]; sessions: HermesRecord[]; failed: string[] };
export const sessionTime = (row: RecentSession) => row.lastOpened || row.updated;
export const sortSessions = (rows: RecentSession[]) => [...rows].sort((a, b) => sessionTime(b) - sessionTime(a) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
export function freshnessRank(row: RecentSession, index: number, now: number): number {
  const time = sessionTime(row);
  return time > 0 && time <= now && now - time < FRESHNESS.weekMs && index < FRESHNESS.count ? index + 1 : 0;
}
export function timeHint(time: number, now: number): string {
  if (!time) return tr('时间未知', 'Time unknown');
  const age = now - time;
  if (age >= 0 && age < FRESHNESS.justNowMs) return tr('刚刚', 'Just now');
  if (age >= 0 && new Date(time).toDateString() === new Date(now).toDateString()) return tr('今天', 'Today');
  if (age >= 0 && age < FRESHNESS.weekMs) return tr('最近一周', 'Past week');
  return new Date(time).toLocaleDateString();
}

/** Two aggregate sources, never a request per profile. Publish ready columns while history loads. */
export async function loadProfileOverview(read: FetchJSON, signal: AbortSignal, publish: (columns: ProfileColumn[]) => void): Promise<ProfileColumn[]> {
  let roster: ProfileData[] = [], history: HermesRecord[] = [], historyDone = false, historyFailed = false;
  const failedProfiles = new Set<string>();
  const snapshot = () => roster.map(profile => ({ name: profile.name, icon: profile.icon, projects: profile.projects,
    rows: sortSessions(recentSessions(profile.sessions, history.filter(row => row.profile === profile.name), profile.name, Infinity)),
    failed: [...profile.failed, ...(historyFailed || failedProfiles.has(profile.name) ? ['history'] : [])], loading: !historyDone }));
  const update = () => { if (!signal.aborted) publish(snapshot()); };
  const get: FetchJSON = (url, init) => read(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  const profiles = get<{ profiles: ProfileData[] }>('/api/plugins/workbench/profile-overview').then(data => {
    if (!Array.isArray(data.profiles)) throw new Error('Invalid profile overview');
    roster = data.profiles; update();
  });
  const archive = (async () => {
    try {
      for (let offset = 0; ; offset += 500) {
        const data = await get<{ sessions: HermesRecord[]; total: number; errors?: { profile: string }[] }>('/api/profiles/sessions?profile=all&limit=500&offset=' + offset + '&archived=exclude&order=recent&exclude_sources=cron,kanban');
        if (!Array.isArray(data.sessions)) throw new Error('Invalid session list');
        history.push(...data.sessions);
        for (const failure of data.errors || []) failedProfiles.add(failure.profile);
        update();
        if (offset + 500 >= data.total || data.sessions.length < 500) break;
      }
    } catch { historyFailed = true; }
    finally { historyDone = true; update(); }
  })();
  await Promise.all([profiles, archive]);
  return snapshot();
}

/** Canonical URLs keep old home/session and board query links working on reload and popstate. */
export function overviewRoute(input: string): string {
  const url = new URL(input, 'http://localhost');
  const home = ['/', '/home', '/sessions'].includes(url.pathname);
  if (home) url.pathname = url.searchParams.has('board') || ['kanban', 'board', 'tasks'].includes(url.searchParams.get('view') || '') || url.searchParams.get('workbench') === 'kanban' ? '/kanban' : '/';
  if (home || url.pathname === '/kanban') {
    url.searchParams.delete('view');
    if (url.searchParams.get('workbench') === 'kanban') url.searchParams.delete('workbench');
  }
  return url.pathname + url.search + url.hash;
}
