/** Cross-profile search keeps profile + engine + id together through preview and navigation. */
import type { FetchJSON } from './workbench-api';
import { searchCodexSessions, organizeCodexSession } from './codex-api';
import { loadSessionOrganization } from './session-organization-api';
import { searchSessions, loadRecentTranscript } from './session-api';
import { messagesFromTurns, normalizeMessage, type ChatMessage } from './codex-messages';
import { renderMarkdownSource } from './markdown-source';
import { openHomeConversation } from './home-navigation';
import { uiText as text } from './ui-locale';
import './session-search.css';

export interface SearchResult {
  id: string; profile: string; kind: 'session' | 'hermes' | 'archived';
  title: string; snippet?: string; groupName?: string; updatedAt?: string | number;
  session?: any;
}
export const searchResultKey = (row: SearchResult) => JSON.stringify([row.profile, row.kind, row.id]);
export function searchTime(value: SearchResult['updatedAt']): string {
  if (!value) return text('时间未知', 'Unknown date');
  const number = Number(value);
  const date = new Date(Number.isFinite(number) ? (number < 1e12 ? number * 1000 : number) : value);
  return Number.isNaN(date.valueOf()) ? text('时间未知', 'Unknown date') : date.toLocaleString();
}

export async function searchAllProfiles(read: FetchJSON, current: string, query: string) {
  let profiles = [current];
  const failures: string[] = [];
  try {
    const roster = await read<{ profiles: { name: string }[] }>('/api/profiles');
    if (!Array.isArray(roster.profiles)) throw new Error('Invalid profile list');
    profiles = [...new Set([current, ...roster.profiles.map(row => row.name).filter(Boolean)])];
  } catch { failures.push(text('档案列表', 'Profile list')); }
  const results: SearchResult[] = [];
  // Bound fan-out on installations with many profiles; each worker reads both engines concurrently.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, profiles.length) }, async () => {
    while (cursor < profiles.length) {
      const profile = profiles[cursor++];
      const codexRead: FetchJSON = async <T,>(url: string, init?: RequestInit) => {
        const response = await read<T>(url, init);
        if ((response as { contentError?: string }).contentError) failures.push(`${profile} / Codex ${text('正文搜索', 'content search')}`);
        return response;
      };
      const [codex, hermes, organization] = await Promise.allSettled([
        searchCodexSessions(codexRead, profile, query, 100), searchSessions(read, profile, query, true), loadSessionOrganization(read, profile),
      ]);
      if (organization.status === 'rejected') failures.push(`${profile} / ${text('项目信息', 'project metadata')}`);
      if (codex.status === 'fulfilled') results.push(...codex.value.map(row => ({ ...row, profile,
        kind: (row.deleted ? 'archived' : 'session') as SearchResult['kind'] })));
      else failures.push(`${profile} / Codex`);
      if (hermes.status === 'fulfilled') for (const row of hermes.value) {
        if (!row.session_id || String(row.source).toLowerCase() === 'codex') continue;
        const metadata = organization.status === 'fulfilled' ? organization.value[String(row.session_id)] : undefined;
        results.push({ id: String(row.session_id), profile, kind: 'hermes', title: String(metadata?.displayName || row.title || row.session_title || row.snippet || row.session_id),
          snippet: String(row.snippet || ''), groupName: String(metadata?.collection || row.group_name || row.project_name || ''), updatedAt: row.session_started });
      } else failures.push(`${profile} / Hermes`);
    }
  }));
  const kindOrder = { session: 0, hermes: 1, archived: 2 };
  results.sort((a, b) => Number(b.profile === current) - Number(a.profile === current)
    || a.profile.localeCompare(b.profile) || kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id));
  return { results, failures };
}

export async function readSearchPreview(read: FetchJSON, row: SearchResult): Promise<ChatMessage[]> {
  if (row.kind === 'hermes') {
    const transcript = await loadRecentTranscript(read, row.profile, row.id, 160);
    return transcript.rows.flatMap((message, index) => {
      const normalized = normalizeMessage(message, `hermes-${index}`);
      const reasoning = message.reasoning_content;
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      return [reasoning ? { id: `reasoning-${index}`, role: 'reasoning', content: String(reasoning) } : null,
        normalized, ...calls.map((call, callIndex) => ({ id: `tool-${index}-${callIndex}`, role: 'tool', content: JSON.stringify(call, null, 2) }))]
        .filter((item): item is ChatMessage => item !== null);
    });
  }
  const scope = `profile=${encodeURIComponent(row.profile)}&session_id=${encodeURIComponent(row.id)}`;
  const response = await read<{ turns?: any[]; cached?: boolean }>(row.kind === 'archived'
    ? `/api/plugins/workbench/codex/session/preview?${scope}&turns=8`
    : `/api/plugins/workbench/codex/session?${scope}&after=0&limit=200&defer_persistence=true`);
  if (response.cached === false) throw new Error(text('暂无存档预览', 'No archived preview available'));
  if (!Array.isArray(response.turns)) throw new Error(text('无法读取会话正文', 'Session content is unavailable'));
  return messagesFromTurns(response.turns, row.id);
}

export function createSessionSearch(sdk: any, localResults: (props: any) => SearchResult[]) {
  const h = sdk.React.createElement;
  const { useState, useEffect, useRef, useMemo } = sdk.hooks;
  return function SessionSearch(props: any) {
    const dialog = useRef(null as HTMLDialogElement | null);
    const input = useRef(null as HTMLInputElement | null);
    const previewHeader = useRef(null as HTMLElement | null);
    const lifecycle = useRef(0);
    const [query, setQuery] = useState('');
    const [remote, setRemote] = useState([] as SearchResult[]);
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null as SearchResult | null);
    const [messages, setMessages] = useState([] as ChatMessage[]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [opening, setOpening] = useState(false);
    const [retry, setRetry] = useState(0);
    const [index, setIndex] = useState(0);
    useEffect(() => {
      if (!props.open) return;
      setQuery(''); setRemote([]); setSelected(null); setNotice(''); setIndex(0);
      dialog.current?.showModal(); input.current?.focus();
      return () => dialog.current?.close();
    }, [props.open]);
    useEffect(() => {
      if (!props.open || !query.trim()) { setRemote([]); setLoading(false); setNotice(''); return; }
      let live = true;
      setLoading(true); setRemote([]); setNotice('');
      const timer = setTimeout(() => {
        searchAllProfiles(props.fetchJSON, props.profile, query.trim()).then(({ results, failures }) => {
          if (!live) return;
          setRemote(results);
          setNotice(failures.length ? text('部分来源搜索失败：', 'Some sources could not be searched: ') + failures.join(', ') : '');
        }).catch(() => { if (live) setNotice(text('搜索失败，请重试', 'Search failed. Please retry.')); })
          .finally(() => { if (live) setLoading(false); });
      }, 220);
      return () => { live = false; clearTimeout(timer); };
    }, [props.open, props.profile, query]);
    useEffect(() => {
      lifecycle.current += 1; setOpening(false);
      if (selected && window.innerWidth <= 700) previewHeader.current?.focus();
      setMessages([]); setPreviewError('');
      if (!props.open || !selected) { setPreviewLoading(false); return; }
      let live = true;
      setPreviewLoading(true);
      readSearchPreview(props.fetchJSON, selected).then(rows => { if (live) setMessages(rows); })
        .catch(() => { if (live) setPreviewError(text('无法加载预览。请重试；已归档会话需恢复后才能读取。', 'Preview unavailable. Retry, or restore an archived session to read it.')); })
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
      return [...merged.values()];
    }, [props.sessions, props.archivedSessions, props.hermesSessions, props.groups, props.profile, query, remote]);
    const visible = rows.slice(0, 200);
    useEffect(() => { setIndex((value: number) => Math.min(value, Math.max(0, visible.length - 1))); }, [visible.length]);
    const choose = (row: SearchResult, position: number) => { setIndex(position); setSelected(row); };
    const open = async () => {
      if (!selected || opening) return;
      const ticket = lifecycle.current;
      setOpening(true); setPreviewError('');
      try {
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
    const meta = (row: SearchResult) => `${row.profile} · ${row.groupName || text('未整理', 'Unorganized')} · ${searchTime(row.updatedAt)}${row.kind === 'archived' ? text(' · 已归档', ' · Archived') : ''}`;
    return h('dialog', { ref: dialog, className: 'codex-session-search-dialog-backdrop', 'aria-label': text('搜索会话', 'Search sessions'),
      onCancel: (event: Event) => { event.preventDefault(); props.onClose(); },
      onClick: (event: MouseEvent) => { if (event.target === event.currentTarget) props.onClose(); } },
      h('section', { className: 'codex-session-search-dialog session-search-workspace' },
        h('header', { className: 'codex-session-search-header' }, h('div', null, h('h2', null, text('搜索会话', 'Search sessions')),
          h('small', null, text('跨全部档案搜索 · 先预览，再打开', 'Search across all profiles · Preview before opening'))),
          h('button', { className: 'codex-session-search-close', onClick: props.onClose, 'aria-label': text('关闭搜索', 'Close search') }, '×')),
        h('input', { ref: input, className: 'codex-session-search-input', name: 'session-search', value: query,
          placeholder: text('搜索标题、正文或项目', 'Search titles, messages or projects'), 'aria-label': text('搜索会话', 'Search sessions'),
          onChange: (event: any) => { setQuery(event.target.value); setIndex(0); },
          onKeyDown: (event: KeyboardEvent) => {
            if (event.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setIndex(Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
            } else if (event.key === 'Enter' && visible[index]) { event.preventDefault(); choose(visible[index], index); }
          } }),
        h('small', { role: 'status' }, loading ? text('正在搜索全部档案…', 'Searching all profiles…') : query.trim()
          ? text(`显示 ${visible.length} 条结果（每个来源最多 100 条，请细化关键词）`, `${visible.length} results shown (up to 100 per source; refine your search)`)
          : text('当前档案最近会话；输入关键词搜索全部档案', 'Recent sessions in this profile; type to search all profiles')),
        notice ? h('p', { role: 'alert', className: 'codex-session-search-error' }, notice) : null,
        h('div', { className: `session-search-columns${selected ? ' has-preview' : ''}` },
          h('div', { className: 'codex-session-search-results', 'aria-label': text('搜索结果', 'Search results') },
            ...visible.map((row, position) => h('button', { key: searchResultKey(row), type: 'button',
              className: `codex-session-search-result${index === position ? ' is-selected' : ''}`, 'data-result-id': row.id, 'data-result-kind': row.kind, 'data-profile': row.profile,
              'aria-pressed': selected ? searchResultKey(selected) === searchResultKey(row) : false,
              ref: (node: HTMLElement | null) => { if (node && position === index) node.scrollIntoView?.({ block: 'nearest' }); },
              onClick: () => choose(row, position) },
              h('strong', { className: 'codex-session-search-result-title' }, row.title || row.id),
              h('span', { className: 'codex-session-search-result-meta' }, meta(row)),
              row.snippet ? h('span', { className: 'codex-session-search-result-snippet' }, row.snippet) : null)),
            !visible.length && !loading ? h('p', null, text('没有匹配的会话', 'No matching sessions')) : null),
          h('aside', { className: 'session-search-preview', 'aria-label': text('会话预览', 'Session preview') },
            selected ? h(sdk.React.Fragment, null,
              h('header', { ref: previewHeader, tabIndex: -1 }, h('strong', null, selected.title), h('small', null, meta(selected)),
                h('button', { className: 'session-search-open', disabled: opening, onClick: open }, opening ? text('正在打开…', 'Opening…') : selected.kind === 'archived' ? text('恢复并打开会话', 'Restore and open session') : text('打开会话', 'Open session')),
                h('button', { className: 'session-search-back', onClick: () => { setSelected(null); input.current?.focus(); } }, text('返回结果', 'Back to results'))),
              h('div', { className: 'session-search-transcript', key: searchResultKey(selected), 'aria-busy': previewLoading },
                previewLoading ? h('p', { role: 'status' }, text('正在加载预览…', 'Loading preview…')) : null,
                previewError ? h('p', { role: 'alert' }, previewError, ' ', h('button', { onClick: () => setRetry(retry + 1) }, text('重试', 'Retry'))) : null,
                ...messages.map((message: ChatMessage) => {
                  const process = !['user', 'assistant'].includes(message.role) || message.phase === 'commentary';
                  const label = message.role === 'user' ? text('用户', 'User') : message.role === 'assistant' && !process ? text('助手', 'Assistant') : message.role === 'reasoning' ? text('思考', 'Thinking') : text('工具 / 过程', 'Tools / process');
                  const body = process ? h('pre', null, [message.content, message.input && JSON.stringify(message.input, null, 2), message.result && JSON.stringify(message.result, null, 2)].filter(Boolean).join('\n'))
                    : h('div', { className: 'hti-rich-text', dangerouslySetInnerHTML: { __html: renderMarkdownSource(message.content) } });
                  return process ? h('details', { key: message.id }, h('summary', null, label), body)
                    : h('article', { key: message.id }, h('small', null, label), body);
                }),
                !previewLoading && !previewError && !messages.length ? h('p', null, text('暂无消息', 'No messages yet')) : null,
                h('small', null, text('Hermes 预览最多显示最近 160 条消息；已归档会话显示最近 8 轮。', 'Hermes previews show up to 160 recent messages; archived sessions show the last 8 turns.'))))
              : h('p', { className: 'session-search-placeholder' }, text('选择会话，在此预览问题与答复', 'Select a session to preview its questions and answers'))))));
  };
}
