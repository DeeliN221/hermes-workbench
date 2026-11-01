import { listCodexGroups, type CodexGroup } from './codex-api';
import { uiText as sourceText } from './ui-locale';
import type { FetchJSON } from './workbench-api';
import type { HermesRecord } from './hermes-transcript';
import { listSessions } from './session-api';
import { codexSessions, recentSessions, type RecentSession } from './recent-home';

export type HomeProject = CodexGroup & { profile: string; updated: number };
export type HomeSnapshot = { rows: RecentSession[]; failed: string[]; projects: HomeProject[] };
type HomeLoadOptions = { initialProfile?: string; initialRows?: RecentSession[]; onProgress?: (snapshot: HomeSnapshot) => void };

/** Publish each source/page independently; a slow roster or archive must not hide ready cards. */
export async function loadHomeProfiles(fetchJSON: FetchJSON, signal: AbortSignal, options: HomeLoadOptions = {}): Promise<HomeSnapshot> {
  const read: FetchJSON = (url, init) => fetchJSON(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
  const projects = new Map<string, HomeProject[]>();
  const byProfile = new Map<string, RecentSession[]>(), failed = new Set<string>();
  for (const row of options.initialRows || []) byProfile.set(row.profile, [...(byProfile.get(row.profile) || []), row]);
  const snapshot = (): HomeSnapshot => ({ rows: [...byProfile.values()].flat().sort((a, b) => b.updated - a.updated || a.profile.localeCompare(b.profile) || a.id.localeCompare(b.id)), failed: [...failed], projects: [...projects.values()].flat().sort((a, b) => b.updated - a.updated) });
  const publish = () => { if (!signal.aborted) options.onProgress?.(snapshot()); };
  const load = async (profile: string) => {
    let groups: CodexGroup[] = [];
    let codex: HermesRecord[] | undefined, hermes: HermesRecord[] | undefined;
    const previous = byProfile.get(profile) || [];
    const update = () => {
      const retained = previous.filter(row => row.source === 'Codex' ? !codex : !hermes);
      byProfile.set(profile, [...recentSessions(codex || [], hermes || [], profile), ...retained]
        .sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id)).slice(0, 24));
      projects.set(profile, groups.map(group => ({ ...group, profile,
        updated: Math.max(0, ...(byProfile.get(profile) || []).filter(row => row.groupId === group.id).map(row => row.updated)),
      })));
      publish();
    };
    await Promise.all([
      listCodexGroups(read, profile).then(rows => { groups = rows; update(); }),
      codexSessions(read, profile, signal, rows => { codex = rows; update(); }, true),
      listSessions(read, profile, rows => { hermes = rows; update(); }, ['kanban']),
    ].map(async (request, index) => {
      try { await request; } catch {
        failed.add(profile);
        if (index === 1) codex = [];
        if (index === 2) hermes = [];
        update();
      }
    }));
  };
  // The current profile is known before the expensive roster (skills/gateway probes) returns.
  const first = options.initialProfile ? load(options.initialProfile) : Promise.resolve();
  try {
    const roster = await read<{ profiles: { name: string }[] }>('/api/plugins/workbench/profile-names');
    if (!Array.isArray(roster.profiles)) throw new Error(sourceText("智能体列表格式异常", "Invalid agent list response"));
    const names = [...new Set(roster.profiles.map(row => String(row.name || '').trim()).filter(Boolean))];
    for (const name of byProfile.keys()) if (!names.includes(name)) { byProfile.delete(name); projects.delete(name); }
    const pending = names.filter(name => name !== options.initialProfile);
    const worker = async () => {
      while (pending.length && !signal.aborted) await load(pending.shift()!);
    };
    await Promise.all([first.then(worker), worker(), worker()]);
    for (const name of byProfile.keys()) if (!names.includes(name)) { byProfile.delete(name); projects.delete(name); }
    publish();
  } catch (error) {
    await first;
    throw error;
  }
  return snapshot();
}
