/** Cross-profile search keeps profile + engine + id together through preview and navigation. */
import type { FetchJSON } from './workbench-api';
import { organizeCodexSession } from './codex-api';
import { searchWorkbench } from './workbench-search-api';
import { statusLabel } from './task-control-model';
import { loadRecentTranscript } from './session-api';
import { messagesFromTurns, type ChatMessage } from './codex-messages';
import type { WorkbenchTranscript } from './session-api';
import { rememberKanbanReturn } from './kanban-navigation';
import { openHomeConversation } from './home-navigation';
import { uiText as text } from './ui-locale';
import { searchAllProfiles, searchResultKey, type SearchResult, type SearchSnapshot } from './session-search-api';
import './session-search.css';

export { searchAllProfiles, searchResultKey, type SearchResult } from './session-search-api';
export function searchTime(value: SearchResult['updatedAt']): string {
  if (!value) return text('时间未知', 'Unknown date');
  const number = Number(value);
  const date = new Date(Number.isFinite(number) ? (number < 1e12 ? number * 1000 : number) : value);
  return Number.isNaN(date.valueOf()) ? text('时间未知', 'Unknown date') : date.toLocaleString();
}

export async function readSearchPreview(read: FetchJSON, row: SearchResult): Promise<ChatMessage[]> {
  const scope = `profile=${encodeURIComponent(row.profile)}&session_id=${encodeURIComponent(row.id)}`;
  const response = await read<{ turns?: any[]; cached?: boolean }>(`/api/plugins/workbench/codex/session/preview?${scope}&turns=8&full=true`);
  if (response.cached === false) throw new Error(text('暂无本地预览', 'No local preview available'));
  if (!Array.isArray(response.turns)) throw new Error(text('无法读取会话正文', 'Session content is unavailable'));
  return messagesFromTurns(response.turns, row.id);
}

// In-memory search context survives profile navigation without writing session data.
const searchContext: { query: string; selected: SearchResult | null; index: number } = {
  query: '', selected: null, index: 0,
};

export function createSessionSearch(sdk: any, localResults: (props: any) => SearchResult[], renderers: {
  Transcript: any; HermesHistoryTimeline: any;
}) {
  const h = sdk.React.createElement;
  const { useState, useEffect, useRef, useMemo } = sdk.hooks;
  return function SessionSearch(props: any) {
    const dialog = useRef(null as HTMLDialogElement | null);
    const input = useRef(null as HTMLInputElement | null);
    const previewHeader = useRef(null as HTMLElement | null);
    const lifecycle = useRef(0);
    const [query, setQuery] = useState(searchContext.query);
    const [remote, setRemote] = useState([] as SearchResult[]);
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(searchContext.selected);
    const [transcript, setTranscript] = useState(null as WorkbenchTranscript | null);
    const [messages, setMessages] = useState([] as ChatMessage[]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [opening, setOpening] = useState(false);
    const [retry, setRetry] = useState(0);
    const [searchRetry, setSearchRetry] = useState(0);
    const [index, setIndex] = useState(searchContext.index);
    useEffect(() => { Object.assign(searchContext, { query, selected, index }); }, [query, selected, index]);
    useEffect(() => {
      if (!props.open) return;
      dialog.current?.showModal(); input.current?.focus();
      return () => dialog.current?.close();
    }, [props.open]);
    useEffect(() => {
      if (!props.open || !query.trim()) { setRemote([]); setLoading(false); setNotice(''); return; }
      let live = true;
      const controller = new AbortController();
      setLoading(true); setRemote([]); setNotice('');
      const apply = (snapshot: SearchSnapshot) => {
        if (!live) return;
        setRemote(snapshot.results);
        setNotice(snapshot.failures.length
          ? text('部分来源搜索失败：', 'Some sources could not be searched: ') + snapshot.failures.join(', ')
          : '');
        setLoading(!snapshot.complete);
      };
      const timer = setTimeout(() => {
        searchWorkbench(props.fetchJSON, props.profile, query.trim(), {
          signal: controller.signal, onUpdate: apply,
        }).then(apply).catch((reason: any) => {
          if (live && reason?.name !== 'AbortError') setNotice(text('搜索失败，请重试', 'Search failed. Please retry.'));
        })
          .finally(() => { if (live) setLoading(false); });
      }, 220);
      return () => { live = false; clearTimeout(timer); controller.abort(); };
    }, [props.open, props.profile, query, searchRetry]);
    useEffect(() => {
      lifecycle.current += 1; setOpening(false);
      if (selected && window.innerWidth <= 700) previewHeader.current?.focus();
      setMessages([]); setTranscript(null); setPreviewError('');
      if (!props.open || !selected || selected.kind === 'task') { setPreviewLoading(false); return; }
      let live = true;
      setPreviewLoading(true);
      (selected.kind === 'hermes'
        ? loadRecentTranscript(props.fetchJSON, selected.profile, selected.id, 160).then(value => { if (live) setTranscript(value); })
        : readSearchPreview(props.fetchJSON, selected).then(rows => { if (live) setMessages(rows); }))
        .catch(() => { if (live) setPreviewError(text('预览不可用，请重试或打开会话', 'Preview unavailable. Retry or open the session.')); })
        .finally(() => { if (live) setPreviewLoading(false); });
      return () => { live = false; };
    }, [props.open, selected, retry]);
    const rows: SearchResult[] = useMemo(() => {
      const merged = new Map<string, SearchResult>();
      for (const row of localResults({ ...props, query })) {
        const scoped = { ...row, profile: props.profile }; merged.set(searchResultKey(scoped), scoped);
      }
      for (const row of remote) {
        const prior = merged.get(searchResultKey(row));
        merged.set(searchResultKey(row), { ...prior, ...row, groupName: row.groupName || prior?.groupName });
      }
      return [...merged.values()].sort((a, b) => Number(b.kind === 'task') - Number(a.kind === 'task'));
    }, [props.sessions, props.archivedSessions, props.hermesSessions, props.groups, props.profile, query, remote]);
    const visible = rows.slice(0, 200);
    useEffect(() => { setIndex((value: number) => Math.min(value, Math.max(0, visible.length - 1))); }, [visible.length]);
    const choose = (row: SearchResult, position: number) => { setIndex(position); setSelected(row); };
    const open = async () => {
      if (!selected || opening) return;
      const ticket = lifecycle.current;
      setOpening(true); setPreviewError('');
      try {
        if (selected.kind === 'task') {
          const destination = `/kanban?${new URLSearchParams({ task: selected.id })}`;
          rememberKanbanReturn(destination);
          props.onClose();
          window.history.pushState(null, '', destination);
          window.dispatchEvent(new PopStateEvent('popstate'));
          return;
        }
        if (selected.kind === 'archived') {
          if (selected.profile === props.profile) {
            if (!await props.onRestoreArchived(selected.session || { id: selected.id })) throw new Error('Restore failed');
          } else await organizeCodexSession(props.fetchJSON, selected.profile, selected.id, { deleted: false });
        }
        if (ticket !== lifecycle.current) return;
        if (selected.profile === props.profile) {
          props.onClose();
          (selected.kind === 'hermes' ? props.onSelectHermes : props.onSelectSession)(selected.id);
        } else {
          const path = `/chat?${new URLSearchParams({ profile: selected.profile, [selected.kind === 'hermes' ? 'hermesSession' : 'session']: selected.id })}`;
          openHomeConversation(path, selected.profile, destination => {
            window.history.pushState(null, '', destination);
            window.dispatchEvent(new PopStateEvent('popstate'));
            window.dispatchEvent(new Event('workbench:session-navigation-select'));
          });
          props.onClose();
        }
      } catch { if (ticket === lifecycle.current) setPreviewError(text('打开失败，请重试', 'Could not open the session. Please retry.')); }
      finally { if (ticket === lifecycle.current) setOpening(false); }
    };
    if (!props.open) return null;
    const kindLabel = (row: SearchResult) => row.kind === 'task' ? text('看板任务', 'Board task') : text('会话', 'Session');
    const meta = (row: SearchResult) => row.kind === 'task'
      ? `Fleet · ${row.task ? statusLabel(row.task.status) : ''} · ${row.groupName || row.id} · ${searchTime(row.updatedAt)}`
      : `${row.profile} · ${row.groupName || text('未整理', 'Unorganized')} · ${searchTime(row.updatedAt)}${row.kind === 'archived' ? text(' · 已归档', ' · Archived') : ''}`;
    return h('dialog', { ref: dialog, className: 'codex-session-search-dialog-backdrop', 'aria-label': text('搜索', 'Search'),
      onCancel: (event: Event) => { event.preventDefault(); props.onClose(); },
      onClick: (event: MouseEvent) => { if (event.target === event.currentTarget) props.onClose(); } },
      h('section', { className: 'codex-session-search-dialog session-search-workspace' },
        h('header', { className: 'codex-session-search-header' }, h('div', null, h('h2', null, text('搜索', 'Search')),
          h('small', null, text('会话与看板任务', 'Sessions and board tasks'))),
          h('button', { className: 'codex-session-search-close', onClick: props.onClose, 'aria-label': text('关闭搜索', 'Close search') }, '×')),
        h('input', { ref: input, className: 'codex-session-search-input', name: 'session-search', value: query,
          placeholder: text('搜索会话、任务或项目', 'Search sessions, tasks or projects'), 'aria-label': text('搜索', 'Search'),
          onChange: (event: any) => { setQuery(event.target.value); setIndex(0); setSelected(null); },
          onKeyDown: (event: KeyboardEvent) => {
            if (event.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setIndex(Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
            } else if (event.key === 'Enter' && visible[index]) { event.preventDefault(); choose(visible[index], index); }
          } }),
        h('small', { role: 'status' }, loading ? visible.length
          ? text('正在搜索更多结果…', 'Searching for more results…')
          : text('正在搜索全部档案…', 'Searching all profiles…') : query.trim()
          ? text(`${visible.length} 条结果 · 每来源最多 100 条`, `${visible.length} results · Up to 100 per source`)
          : text('最近会话；输入关键词搜索全部档案与看板任务', 'Recent sessions; type to search all profiles and board tasks')),
        notice ? h('p', { role: 'alert', className: 'codex-session-search-error' }, h('span', null, notice), h('button', { onClick: () => setSearchRetry(searchRetry + 1) }, text('重试', 'Retry'))) : null,
        h('div', { className: `session-search-columns${selected ? ' has-preview' : ''}` },
          h('div', { className: 'codex-session-search-results', 'aria-label': text('搜索结果', 'Search results') },
            ...visible.map((row, position) => h('button', { key: searchResultKey(row), type: 'button',
              className: `codex-session-search-result${index === position ? ' is-selected' : ''}`, 'data-result-id': row.id, 'data-result-kind': row.kind, 'data-profile': row.profile,
              'aria-pressed': selected ? searchResultKey(selected) === searchResultKey(row) : false,
              ref: (node: HTMLElement | null) => { if (node && position === index) node.scrollIntoView?.({ block: 'nearest' }); },
              onClick: () => choose(row, position) },
              h('span', { className: 'session-search-result-heading' },
                h('span', { className: 'session-search-kind' }, kindLabel(row)),
                h('strong', { className: 'codex-session-search-result-title', title: row.title || row.id }, row.title || row.id)),
              h('span', { className: 'codex-session-search-result-meta', title: meta(row) }, meta(row)),
              row.snippet ? h('span', { className: 'codex-session-search-result-snippet' }, row.snippet) : null)),
            !visible.length && !loading ? h('p', null, text('没有匹配的会话或任务', 'No matching sessions or tasks')) : null),
          h('aside', { className: 'session-search-preview', 'aria-label': text('结果预览', 'Result preview') },
            selected ? h(sdk.React.Fragment, null,
              h('header', { ref: previewHeader, tabIndex: -1 },
                h('div', { className: 'session-search-preview-heading' },
                  h('strong', { title: selected.title }, selected.title || selected.id),
                  h('button', { className: 'session-search-open', disabled: opening, onClick: open,
                    'aria-label': selected.kind === 'archived' ? text('恢复并打开会话', 'Restore and open session') : undefined },
                    opening ? text('正在打开…', 'Opening…') : selected.kind === 'task' ? text('打开任务', 'Open task') : selected.kind === 'archived' ? text('恢复并打开', 'Restore & open') : text('打开会话', 'Open session'))),
                h('div', { className: 'session-search-preview-meta' },
                  h('small', { title: meta(selected) }, `${kindLabel(selected)} · ${meta(selected)}`),
                  h('button', { className: 'session-search-back', onClick: () => { setSelected(null); input.current?.focus(); } }, text('返回结果', 'Back to results')))),
              h('div', { className: 'session-search-transcript', key: searchResultKey(selected), 'aria-busy': previewLoading },
                previewLoading ? h('p', { role: 'status' }, text('正在加载预览…', 'Loading preview…')) : null,
                previewError ? h('p', { role: 'alert' }, previewError, ' ', h('button', { onClick: () => setRetry(retry + 1) }, text('重试', 'Retry'))) : null,
                selected.kind === 'task' ? h('p', { className: 'session-search-task-summary' }, selected.snippet || text('暂无任务摘要，打开任务查看详情', 'No summary available. Open the task for details.')) : transcript ? h(renderers.HermesHistoryTimeline, { transcript, collapsed: true })
                  : h(renderers.Transcript, { messages, detail: 'compact' }),
                selected.kind !== 'task' && !previewLoading && !previewError && !messages.length && !transcript?.turns.length ? h('p', null, text('暂无消息', 'No messages yet')) : null))
              : h('p', { className: 'session-search-placeholder' }, text('选择结果，预览会话或任务摘要', 'Select a result to preview the conversation or task summary'))))));
  };
}
