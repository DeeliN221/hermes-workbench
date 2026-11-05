import { homeSessionsPath, mergeHomeSessions, openedHomeSessions, sessionKey, type HomeSession } from './home-session-selection';
import type { FetchJSON } from './workbench-api';
import { loadProfileOverview, freshnessRank, type ProfileColumn } from './profile-overview';
import { openHomeConversation } from './home-navigation';
import { useProfileDisplay } from './profile-display';
import { profileTabName } from './kanban-agent-picker';
import { uiText as tr } from './ui-locale';
import { currentProfile } from './profile-scope';
import {
  HOME_LAYOUT_CHANGE_EVENT,
  HOME_LAYOUT_DEFAULTS,
  loadHomeLayout,
  normalizeHomeLayout,
  type HomeLayout,
} from './home-layout';

export function createProfileOverview(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }, navigate: (path: string, profile: string) => void) {
  const h = sdk.React.createElement, { useState, useEffect } = sdk.hooks;
  return function ProfileOverview() {
    useProfileDisplay(sdk);
    const [selected, setSelected] = useState([] as HomeSession[]);
    const [notice, setNotice] = useState('');
    const opened = openedHomeSessions();
    const clearSelection = () => { setSelected([]); setNotice(''); };
    useEffect(() => {
      const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') clearSelection(); };
      window.addEventListener('keydown', escape);
      return () => window.removeEventListener('keydown', escape);
    }, []);
    const limitNotice = () => setNotice(tr('最多同时选择或打开 3 个会话，请先取消选择或关闭窗格。', 'Select or open up to 3 sessions. Deselect a session or close a pane first.'));
    const confirm = (sessions: HomeSession[]) => {
      const combined = mergeHomeSessions(sessions, openedHomeSessions());
      if (!combined) { limitNotice(); return; }
      clearSelection();
      openHomeConversation(homeSessionsPath(combined, sessions[0]), combined[0].profile, navigate);
    };
    const [columns, setColumns] = useState([] as ProfileColumn[]);
    const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
    const [order, setOrder] = useState([] as string[]);
    const [preferences, setPreferences] = useState({} as Record<string, boolean>);
    const [layout, setLayout] = useState({ ...HOME_LAYOUT_DEFAULTS } as HomeLayout);
    useEffect(() => {
      const controller = new AbortController();
      sdk.fetchJSON<{order: string[]}>('/api/plugins/workbench/profile-order', { signal: controller.signal })
        .then(value => setOrder(value.order || [])).catch(() => {});
      sdk.fetchJSON<{labels: Record<string, boolean>}>('/api/plugins/workbench/home-preferences', { signal: controller.signal })
        .then(value => setPreferences(value.labels || {})).catch(() => {});
      return () => controller.abort();
    }, []);
    useEffect(() => {
      const controller = new AbortController();
      void loadHomeLayout(sdk.fetchJSON, currentProfile(), controller.signal)
        .then(result => { if (!controller.signal.aborted) setLayout(result.layout); })
        .catch(() => { /* The default 3x3 layout keeps the home page usable. */ });
      const update = (event: Event) => {
        const value = (event as CustomEvent<HomeLayout>).detail;
        setLayout(normalizeHomeLayout({ columns: value.columns, sessions_per_profile: value.sessionsPerProfile }).layout);
      };
      window.addEventListener(HOME_LAYOUT_CHANGE_EVENT, update);
      return () => { controller.abort(); window.removeEventListener(HOME_LAYOUT_CHANGE_EVENT, update); };
    }, []);
    const sorted = [...columns].sort((a: ProfileColumn, b: ProfileColumn) => {
      const rank = (name: string) => order.includes(name) ? order.indexOf(name) : order.length;
      return rank(a.name) - rank(b.name);
    });
    const projectName = (column: ProfileColumn, row: ProfileColumn['rows'][number]) => column.projects.find(item => item.id === row.groupId)?.name || row.projectName || (row.source === 'Codex' ? row.workspace.split('/').filter(Boolean).at(-1) : '') || tr('未分组项目', 'Ungrouped project');
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      const controller = new AbortController();
      setLoading(true); setError(false); setColumns([]);
      void loadProfileOverview(sdk.fetchJSON, controller.signal, setColumns)
        .catch(() => { if (!controller.signal.aborted) setError(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
      const timer = setInterval(() => setNow(Date.now()), 30_000);
      return () => { controller.abort(); clearInterval(timer); };
    }, [attempt]);
    const retry = () => h('button', { type: 'button', onClick: () => setAttempt((value: number) => value + 1) }, tr('重试', 'Retry'));
    const allFailed = !loading && columns.length > 0 && columns.every((column: ProfileColumn) => column.failed.includes('sessions') && column.failed.includes('history') && !column.rows.length);
    return h('section', { className: 'profile-overview', 'aria-label': tr('全部 Profile 项目会话', 'All profile project sessions'), 'aria-busy': loading },
      selected.length ? h('div', { className: 'home-selection-actions', role: 'group', 'aria-label': tr('会话选择', 'Session selection') },
        h('button', { type: 'button', onClick: clearSelection }, tr('清空选择', 'Clear selection')),
        h('button', { type: 'button', className: 'home-open-selected', onClick: () => confirm(selected) }, `${tr('打开选中', 'Open selected')} (${selected.length})`)) : null,
      notice ? h('p', { role: 'alert', className: 'overview-notice' }, notice) : null,
      error || allFailed ? h('p', { role: 'alert', className: 'overview-notice' }, tr('会话总览暂不可用，请重试。', 'Session overview unavailable. Please retry.'), retry()) : null,
      loading && !columns.length ? h('p', { role: 'status', className: 'overview-notice' }, tr('正在加载 Profile 和项目会话…', 'Loading profiles and project sessions…')) : null,
      !loading && !error && !columns.length ? h('p', { className: 'overview-notice' }, tr('暂无 Profile。', 'No profiles available.')) : null,
      h('div', { className: 'profile-overview-columns', 'data-columns': String(layout.columns),
        style: { '--profile-columns': layout.columns }, 'aria-label': tr('按 Profile 分组的会话', 'Sessions grouped by profile') },
        sorted.map((column: ProfileColumn, position: number) => {
          const rows = column.rows;
          return h('section', { key: column.name, className: 'profile-overview-column', 'data-profile': column.name, 'aria-labelledby': `overview-${column.name}` },
            h('header', { className: 'profile-column-heading' }, h('span', { className: 'profile-column-icon', 'aria-hidden': true }, column.icon || '◈'),
              h('h2', { id: `overview-${column.name}` }, profileTabName(column.name)), h('span', { className: 'profile-column-count' }, `${rows.length} ${tr('会话', 'sessions')}`),
              h('button', { type: 'button', className: 'profile-new-session', 'aria-label': `${tr('新建会话', 'New session')} · ${profileTabName(column.name)}`, onClick: () => openHomeConversation('/chat?new=1', column.name, navigate) }, '+')),
            h('div', { className: 'profile-column-scroll', 'aria-label': profileTabName(column.name) },
              column.failed.length ? h('p', { role: 'alert', className: 'overview-notice' }, tr('部分数据加载失败', 'Some sessions unavailable.'), retry()) : null,
              column.loading ? h('p', { role: 'status', className: 'overview-notice' }, tr('正在加载历史会话…', 'Loading conversation history…')) : null,
              rows.slice(0, layout.sessionsPerProfile).map((row) => {
                const rank = freshnessRank(row, column.rows.indexOf(row), now);
                const href = `/chat?${row.source === 'Codex' ? 'session' : 'hermesSession'}=${encodeURIComponent(row.id)}&profile=${encodeURIComponent(column.name)}`;
                const target: HomeSession = { profile: column.name, sessionId: row.source === 'Codex' ? row.id : '', hermesSessionId: row.source === 'Codex' ? '' : row.id };
                const isSelected = selected.some((item: HomeSession) => sessionKey(item) === sessionKey(target));
                const isOpened = opened.some(item => sessionKey(item) === sessionKey(target));
                return h('a', { role: 'button', 'aria-pressed': isSelected, 'data-opened': isOpened, key: `${row.source}:${row.id}`, href, className: `profile-session${isSelected ? ' is-selected' : ''}`, title: isOpened ? tr('已打开', 'Already open') : undefined, 'data-freshness': rank,
                  onKeyDown: (event: KeyboardEvent) => { if (event.key === ' ') { event.preventDefault(); (event.currentTarget as HTMLElement).click(); } },
                  onClick: (event: MouseEvent) => {
                    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    if (window.matchMedia('(max-width: 800px)').matches) { confirm([target]); return; }
                    if (isSelected) { setSelected(selected.filter((item: HomeSession) => sessionKey(item) !== sessionKey(target))); setNotice(''); return; }
                    if (!mergeHomeSessions([...selected, target], openedHomeSessions())) { limitNotice(); return; }
                    setSelected([...selected, target]); setNotice('');
                  } },
                  preferences[column.name] !== false && row.groupId ? h('span', { className: 'profile-session-project', title: projectName(column, row) }, projectName(column, row)) : null,
                  h('strong', null, row.title),
                  isOpened ? h('span', { className: 'profile-session-indicator', 'aria-label': tr('已打开', 'Already open'), title: tr('已打开', 'Already open') }, '▣') : null,
                  row.unread ? h('span', { className: 'profile-session-indicator', role: 'img', 'aria-label': tr('未读', 'Unread'), title: tr('未读', 'Unread') }, '●') : null,
                  ['running', 'active', 'streaming', 'in_progress'].includes(row.status) ? h('span', { className: 'profile-session-indicator', role: 'img', 'aria-label': tr('运行中', 'Running'), title: tr('运行中', 'Running') }, '◉') : null);
              }),
              !column.loading && !rows.length && !column.failed.length ? h('p', { className: 'overview-notice' }, tr('暂无会话', 'No sessions yet')) : null));
        })));
  };
}
