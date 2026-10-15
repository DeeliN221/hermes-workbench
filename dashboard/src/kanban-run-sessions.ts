import { uiText as sourceText } from './ui-locale';
import type { FetchJSON } from './workbench-api';

export type RunSession = { id: string; profile: string; started_at: number; preview: string; source: string; _lineage_root_id?: string };

/** Read only worker conversations; do not bind them as the card's discussion. */
export async function loadKanbanRunSessions(fetchJSON: FetchJSON, task: string): Promise<RunSession[]> {
  const items: RunSession[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const data = await fetchJSON<{ sessions?: RunSession[]; total?: number; errors?: unknown[] }>(
      `/api/profiles/sessions?profile=all&source=kanban&archived=include&order=created&limit=100&offset=${offset}`,
    );
    if (data.errors?.length) throw new Error(sourceText("部分 Agent 的会话读取失败，请重试", "Some agent sessions could not be loaded. Please retry."));
    const rows = data.sessions || [];
    const matches = (preview: string) => [
      `work kanban task ${task}`, `work on kanban task ${task}`,
    ].includes(String(preview || '').trim().toLowerCase());
    const checked = await Promise.all(rows.filter(row => row.source === 'kanban').map(async row => {
      if (matches(row.preview)) return row;
      // Compression replaces the listed preview, while preserving root start time.
      if (row._lineage_root_id) {
        const exported = await fetchJSON<{ messages?: { role: string; content: string }[] }>(
          `/api/sessions/${encodeURIComponent(row._lineage_root_id)}/export?profile=${encodeURIComponent(row.profile)}`,
        );
        if (matches(exported.messages?.find(message => message.role === 'user')?.content || '')) return row;
      }
      return null;
    }));
    items.push(...checked.filter((row): row is RunSession => row !== null));
    if (rows.length < 100 || offset + 100 >= Number(data.total || 0)) break;
  }
  return items;
}

export function sessionsForRun(run: any, runs: any[], sessions: RunSession[]): RunSession[] {
  const start = Number(run?.started_at);
  if (!Number.isFinite(start) || start <= 0) return [];
  const next = Math.min(...runs.map(row => Number(row.started_at)).filter(time => time > start));
  const end = run.ended_at ? Number(run.ended_at) : Infinity;
  return sessions.filter(session => session.profile === (run.profile || 'default')
    && session.started_at >= start && session.started_at <= end && session.started_at < next)
    .sort((a, b) => a.started_at - b.started_at);
}

export function runSessionPath(session: RunSession): string {
  return `/chat?${new URLSearchParams({ profile: session.profile, hermesSession: session.id })}`;
}
