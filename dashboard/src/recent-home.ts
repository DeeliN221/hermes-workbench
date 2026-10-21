import { uiText } from './ui-locale';
import { loadHomeProfiles } from './home-profiles';
import { openHomeConversation } from './home-navigation';
import { agentDisplayName } from './kanban-agent-picker';
import { createHomeSwipeCard } from './home-swipe-card';
import { readMarkers, fetchReadMarkers, cardWasRead, markCardRead, saveReadMarker, cardIdentity, activityVersion, type ReadMarkers } from './home-read-state';
import type { FetchJSON } from './workbench-api';
import { sessionDisplayTitle } from './session-organization';
import { decodeHermesStructuredContent, type HermesRecord } from './hermes-transcript';

export type RecentSession = { id: string; title: string; source: 'Codex' | 'Hermes'; updated: number; status: string; workspace: string; profile: string; completedSeq: number; readSeq?: number; messageCount: number; historyId?: string };
export function isScheduledSession(row: HermesRecord): boolean {
  const source = String(row.source ?? '').trim().toLocaleLowerCase();
  const id = String(row.id ?? row.session_id ?? '').trim().toLocaleLowerCase();
  return source === 'cron' || id.startsWith('cron_');
}

/** Worker runs belong to a Kanban task, not to the operator's conversation list. */
export function isKanbanRunSession(row: HermesRecord): boolean {
  const source = `${row.source ?? ''} ${row.created_source ?? ''}`.toLocaleLowerCase();
  if (source.split(/[\s,]+/).includes('kanban')) return true;
  // Older rows can lose their source marker in a projection; the generated
  // worker title still carries the stable task id.
  return /^(?:work(?: on)?|complete)\s+kanban task\b/i.test(String(row.title ?? '').trim());
}

export function isInternalSession(row: HermesRecord): boolean {
  return isScheduledSession(row) || isKanbanRunSession(row);
}

export function activityTime(row: HermesRecord): number {
  for (const value of [row.updatedAt, row.updated_at, row.last_active, row.last_message_at, row.createdAt, row.created_at]) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    const time = Number.isFinite(numeric) ? numeric * (numeric < 1e12 ? 1000 : 1) : Date.parse(String(value));
    if (Number.isFinite(time) && time > 0) return time;
  }
  return 0;
}
export function recentSessions(codex: HermesRecord[], hermes: HermesRecord[], profile = 'default'): RecentSession[] {
  const seen = new Set<string>();
  const mirrors = new Set(hermes.filter(row => row.source === 'codex').map(row => `${row.profile || profile}:${row.id ?? row.session_id}`));
  return (['Codex', 'Hermes'] as const).flatMap(source => (source === 'Codex' ? codex : hermes).flatMap(row => {
    const id = String(row.id ?? row.session_id ?? '');
    const owner = String(row.profile || profile);
    const key = `${owner}:${source}:${id}`;
    if (!id || row.deleted || row.archived || isInternalSession(row) || seen.has(key)) return [];
    // The chat reader rejects Codex projections; only mapped Codex sessions are openable.
    if (source === 'Hermes' && row.source === 'codex') return [];
    seen.add(key);
    return [{ id, source, historyId: source === 'Codex' && mirrors.has(`${owner}:${id}`) ? id : undefined, profile: owner, completedSeq: Number(row.lastCompletedSeq || 0), readSeq: Number(row.readSeq || 0), messageCount: Number(row.message_count || 0), title: sessionDisplayTitle(row), updated: activityTime(row),
      status: String(row.status || ''), workspace: String(row.workspacePath ?? row.workspace_path ?? row.model ?? '') }];
  })).sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id)).slice(0, 24);
}
export async function codexSessions(fetchJSON: FetchJSON, profile: string, signal: AbortSignal, onPage?: (rows: HermesRecord[]) => void, recent = false): Promise<HermesRecord[]> {
  const rows: HermesRecord[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await fetchJSON<{ items: HermesRecord[] }>(`/api/plugins/workbench/codex/sessions?profile=${encodeURIComponent(profile)}&limit=${recent ? 24 : 100}&offset=${offset}${recent ? "&recent=true" : ""}`, { signal });
    if (!Array.isArray(page.items)) throw new Error(uiText("会话列表格式异常", "Invalid session list response"));
    rows.push(...page.items);
    onPage?.([...rows]);
    if (recent || page.items.length < 100) return rows;
  }
}
export type PromptPair = { first: string; latest: string; partial?: boolean; error?: string };
function messageText(content: unknown): string {
  if (typeof content === 'string') return decodeHermesStructuredContent(content).trim();
  if (!Array.isArray(content)) return '';
  return content.map(block => {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object') return '';
    if (['text', 'input_text', 'inputText'].includes(block.type)) return String(block.text ?? '');
    if (['image', 'input_image', 'localImage'].includes(block.type)) return uiText("［图片］", "[Image]");
    return '';
  }).filter(Boolean).join('\n').trim();
}
/** OZW's visible-request rule excludes complete provider bootstrap wrappers. */
export function visibleRequest(text: string): string {
  let value = text.trim();
  for (;;) {
    const before = value;
    value = value.replace(/^# AGENTS\.md instructions(?:\s+for\b[^\n]*)?\s*\n+\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i, '').trim();
    for (const tag of ['environment_context', 'system-reminder', 'codex_internal_context']) {
      value = value.replace(new RegExp(`^<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>\\s*`, 'i'), '')
        .replace(new RegExp(`\\s*<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>\\s*$`, 'i'), '').trim();
    }
    if (before === value) return value;
  }
}
/** Only user messages identify a conversation; assistant/tool output is never a request. */
export function promptPair(messages: HermesRecord[]): PromptPair {
  const prompts = messages.filter(row => row.role === 'user' || row.type === 'userMessage')
    .map(row => visibleRequest(messageText(row.content ?? row.text))).filter(Boolean);
  return { first: prompts[0] || '', latest: prompts.at(-1) || '' };
}
export async function loadPromptPair(fetchJSON: FetchJSON, profile: string, row: RecentSession, signal: AbortSignal): Promise<PromptPair> {
  const timeout = AbortSignal.timeout(10000);
  const bounded = AbortSignal.any([signal, timeout]);
  const read: FetchJSON = (url, init) => fetchJSON(url, { ...init, signal: bounded });
  if (row.source === 'Hermes' || row.historyId) {
    return read<PromptPair>(`/api/plugins/workbench/session-prompts?profile=${encodeURIComponent(profile)}&session_id=${encodeURIComponent(row.historyId || row.id)}`);
  }
  const result = await read<{ turns?: { items?: HermesRecord[]; error?: { message?: string } }[]; lastError?: string }>(
    `/api/plugins/workbench/codex/session/preview?profile=${encodeURIComponent(profile)}&session_id=${encodeURIComponent(row.id)}&turns=8`);
  if (!Array.isArray(result.turns)) throw new Error(uiText("会话内容格式异常", "Invalid session content response"));
  const error = String(result.lastError || "").trim() || [...result.turns].reverse()
    .map(turn => String(turn.error?.message || "").trim()).find(Boolean) || "";
  return { ...promptPair(result.turns.flatMap(turn => turn.items || [])), partial: true, ...(error ? { error } : {}) };
}

export function createRecentHome(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }, navigate: (path: string, profile: string) => void) {
  const h = sdk.React.createElement;
  const SwipeCard = createHomeSwipeCard(sdk.React);
  const { useState, useEffect, useRef } = sdk.hooks;
  let savedRows: RecentSession[] = [];
  let savedServerMarkers: ReadMarkers = {};
  const savedPreviews = new Map<string, { updated: number; historyId?: string; pair: PromptPair }>();
  const markersFor = (rows: RecentSession[], server = savedServerMarkers) => Object.assign({},
    ...[...new Set(rows.map(row => row.profile))].map(readMarkers), server);
  return function RecentHome({ profile }: { profile: string }) {
    const [rows, setRows] = useState(() => savedRows);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [epoch, setEpoch] = useState(0);
    const [markers, setMarkers] = useState(() => markersFor(savedRows));
    const [handlingAll, setHandlingAll] = useState(false);
    const bulkBusy = useRef(false);
    const [notice, setNotice] = useState('');
    useEffect(() => {
      const update = () => setMarkers(markersFor(rows));
      window.addEventListener('storage', update);
      return () => window.removeEventListener('storage', update);
    }, [rows]);
    const cache = useRef(savedPreviews);
    const [previews, setPreviews] = useState(() => Object.fromEntries([...savedPreviews].map(([key, value]) => [key, value.pair])) as Record<string, PromptPair | 'error'>);
    useEffect(() => {
      const controller = new AbortController();
      let busy = false;
      let previewTimer: ReturnType<typeof setTimeout> | undefined;
      let updates: Record<string, PromptPair | 'error'> = {};
      const queuePreview = (key: string, pair: PromptPair | 'error') => {
        updates[key] = pair;
        previewTimer ??= setTimeout(() => {
          const batch = updates; updates = {}; previewTimer = undefined;
          if (!controller.signal.aborted) setPreviews((current: Record<string, PromptPair | 'error'>) => ({ ...current, ...batch }));
        }, 80);
      };
      const refresh = async () => {
        if (busy || document.hidden) return;
        busy = true;
        setLoading(true);
        let nextRows: RecentSession[];
        try {
          savedServerMarkers = await fetchReadMarkers(sdk.fetchJSON, controller.signal);
          if (controller.signal.aborted) return;
          setMarkers(markersFor(savedRows));
        } catch {
          if (controller.signal.aborted) return;
          // Keep the last server snapshot; local markers remain a fallback.
        }
        const syncLocalReadMarkers = async (rows: RecentSession[]) => {
          const local = Object.assign({}, ...[...new Set(rows.map(row => row.profile))].map(readMarkers));
          const pending = rows.filter(row => {
            const key = cardIdentity(row);
            return local[key] && local[key] !== savedServerMarkers[key] && cardWasRead(row, local);
          });
          await Promise.all(pending.map(async row => {
            try {
              await saveReadMarker(sdk.fetchJSON, row);
              savedServerMarkers[cardIdentity(row)] = activityVersion(row);
            } catch { /* Retry on the next refresh. */ }
          }));
        };
        const pending: RecentSession[] = [];
        const scheduled = new Set<string>();
        const workers: Promise<void>[] = [];
        let activeWorkers = 0;
        const worker = async () => {
          activeWorkers++;
          try {
            while (pending.length && !controller.signal.aborted) {
              const row = pending.shift()!;
              const key = cardIdentity(row);
              const cached = cache.current.get(key);
              try {
                const pair = cached?.updated === row.updated && (!row.historyId || cached.historyId === row.historyId) && row.status !== 'running'
                  ? cached.pair : await loadPromptPair(sdk.fetchJSON, row.profile, row, controller.signal);
                if (controller.signal.aborted) return;
                if (!row.historyId && cache.current.get(key)?.historyId) continue;
                cache.current.set(key, { updated: row.updated, historyId: row.historyId, pair });
                queuePreview(key, pair);
              } catch {
                if (!controller.signal.aborted) queuePreview(key, 'error');
              }
            }
          } finally { activeWorkers--; }
        };
        const enqueuePreviews = (rows: RecentSession[]) => {
          const markers = markersFor(rows);
          for (const row of rows) {
            const key = `${cardIdentity(row)}:${row.updated}:${row.historyId || ""}`;
            if (scheduled.has(key) || cardWasRead(row, markers)) continue;
            scheduled.add(key); pending.push(row);
          }
          while (pending.length && activeWorkers < 3) workers.push(worker());
        };

        try {
          const result = await loadHomeProfiles(sdk.fetchJSON, controller.signal, {
            initialProfile: profile, initialRows: savedRows,
            onProgress: result => {
              if (controller.signal.aborted) return;
              savedRows = result.rows;
              setRows(result.rows);
              setMarkers(markersFor(result.rows));
              enqueuePreviews(result.rows);
            },
          });
          if (controller.signal.aborted) return;
          nextRows = result.rows;
          savedRows = nextRows;
          const retained = new Set(nextRows.map(cardIdentity));
          for (const key of cache.current.keys()) if (!retained.has(key)) cache.current.delete(key);
          setRows(nextRows);
          setMarkers(markersFor(nextRows));
          void syncLocalReadMarkers(nextRows);
          setError(result.failed.length ? uiText(`部分智能体的会话未能加载：${result.failed.map(agentDisplayName).join('、')}。请重试。`, `Some agent sessions failed to load: ${result.failed.map(agentDisplayName).join(", ")}. Please retry.`) : '');
        } catch {
          if (!controller.signal.aborted) { setError(uiText("智能体列表加载失败，请重试。", "Failed to load agents. Please retry.")); setLoading(false); }
          busy = false; return;
        }
        setLoading(false);
        enqueuePreviews(nextRows);
        await Promise.all(workers);
        busy = false;
      };
      void refresh();
      const timer = window.setInterval(refresh, 30000);
      window.addEventListener('focus', refresh);
      return () => { controller.abort(); clearTimeout(previewTimer); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
    }, [epoch]);
    const refreshNow = () => { cache.current.clear(); setEpoch((n: number) => n + 1); };
    const link = (path: string, label: any, props: Record<string, unknown> = {}) => h('a', {
      ...props, href: `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`,
      onClick: (event: MouseEvent) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); navigate(path, profile);
      },
    }, label);
    const renderPrompts = (row: RecentSession) => {
      const pair = previews[cardIdentity(row)];
      if (!pair) return h('p', { key: 'requests', className: 'workbench-home-request-status' }, uiText("正在读取提问…", "Loading requests\u2026"));
      if (pair === 'error') return h('p', { key: 'requests', className: 'workbench-home-request-status' }, uiText("提问加载失败，请刷新重试", "Failed to load requests. Refresh to retry."));
      if (!pair.first) return pair.error
        ? h('p', { key: 'requests', className: 'workbench-home-request-error', role: 'status' }, pair.error)
        : h('p', { key: 'requests', className: 'workbench-home-request-status' }, pair.partial ? uiText("提问尚未缓存，可打开会话查看。", "Requests are not cached yet. Open the conversation to view them.") : uiText("暂无用户提问", "No user requests yet"));
      return h('div', { key: 'requests', className: 'workbench-home-requests' },
        h('p', { className: 'workbench-home-request', 'aria-label': pair.partial ? uiText("最近提问", "Recent request") : uiText("首条提问", "First request") }, pair.first),
        pair.latest !== pair.first ? h(sdk.React.Fragment, null,
          h('p', { className: 'workbench-home-ellipsis', 'aria-label': uiText("中间提问已省略", "Intermediate requests omitted") }, '…'),
          h('p', { className: 'workbench-home-request', 'aria-label': uiText("最新提问", "Latest request") }, pair.latest)) : null,
        pair.error ? h('p', { key: 'error', className: 'workbench-home-request-error', role: 'status' }, pair.error) : null);
    };
    const visibleRows = rows.filter((row: RecentSession) => !cardWasRead(row, markers));
    const acknowledge = async (row: RecentSession) => {
      const next = await markCardRead(sdk.fetchJSON, row);
      setMarkers((current: ReadMarkers) => ({ ...current, ...next }));
    };
    const handleAll = async () => {
      if (bulkBusy.current || !visibleRows.length) return;
      bulkBusy.current = true; setHandlingAll(true); setNotice('');
      const snapshot = [...visibleRows];
      let failed = 0;
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (snapshot.length) {
          const row = snapshot.shift()!;
          try { await acknowledge(row); } catch { failed++; }
        }
      }));
      setNotice(failed ? uiText(`${failed} 个会话处理失败，已保留，可再次点击重试。`, `${failed} sessions could not be handled and were retained. Retry when ready.`) : uiText("当前列表已全部处理完成。", "All sessions in this list have been handled."));
      bulkBusy.current = false; setHandlingAll(false);
    };
    return h('section', { className: 'workbench-recent-home', 'aria-label': uiText("最近活跃的会话", "Recently active sessions"), 'aria-busy': loading },
      h('header', { className: 'workbench-home-header' }, h('div', null,
        h('h1', null, uiText("最近会话", "Recent sessions")), h('p', null, uiText("所有 profile", "All profiles"))),
        h('div', { className: 'workbench-home-actions' },
          h('button', { type: 'button', onClick: handleAll, disabled: loading || handlingAll || !visibleRows.length }, handlingAll ? uiText("正在处理…", "Processing\u2026") : uiText("全部处理完成", "Mark all handled")),
          h('button', { type: 'button', onClick: refreshNow }, uiText("刷新", "Refresh")),
          link('/chat', uiText("＋ 新会话", "\uff0b New session")))),
      error ? h('p', { role: 'alert' }, error, h('button', { type: 'button', onClick: refreshNow }, uiText("重试", "Retry"))) : null,
      notice ? h('p', { role: 'status' }, notice) : null,
      loading ? h('p', { role: 'status' }, rows.length ? uiText("正在更新其余会话…", "Updating remaining sessions\u2026") : uiText("正在读取最近会话…", "Loading recent sessions\u2026")) : null,
      !loading && !error && !rows.length ? h('p', { className: 'workbench-home-empty' }, uiText("还没有会话，开始一次新的对话吧。", "No sessions yet. Start a conversation.")) : null,
      !loading && rows.length > 0 && !visibleRows.length ? h('p', { className: 'workbench-home-empty', role: 'status' }, uiText("最近会话均已读，有新活动时会再次显示。", "All recent sessions have been read. New activity will appear here.")) : null,
      h('div', { className: 'workbench-home-grid' }, ...visibleRows.map((row: RecentSession) => {
        const path = `/chat?${row.source === 'Codex' ? 'session' : 'hermesSession'}=${encodeURIComponent(row.id)}`;
        return h(SwipeCard, { key: `${row.profile}:${row.source}:${row.id}`,
          href: `${path}&profile=${encodeURIComponent(row.profile)}`,
          onNavigate: () => openHomeConversation(path, row.profile, navigate),
          onRead: () => acknowledge(row), disabled: handlingAll,
          children:
        [h('div', { key: 'meta', className: 'workbench-home-card-meta' }, h('span', null, agentDisplayName(row.profile)),
          row.status === 'running' ? h('span', { className: 'is-running' }, uiText("进行中", "Running")) : null),
        h('h2', { key: 'title' }, row.title),
        renderPrompts(row),
        h('time', { key: 'time', dateTime: row.updated ? new Date(row.updated).toISOString() : undefined },
          row.updated ? new Date(row.updated).toLocaleString() : uiText("时间未知", "Unknown time"))],
        });
      })));
  };
}
