import type { FetchJSON } from './workbench-api';
import { loadProfileOverview, freshnessRank, type ProfileColumn } from './profile-overview';
import { openHomeConversation } from './home-navigation';
import { useProfileDisplay } from './profile-display';
import { profileTabName } from './kanban-agent-picker';
import { uiText as tr } from './ui-locale';

const HOME_SESSIONS_PER_PROFILE = 3;

export function createProfileOverview(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }, navigate: (path: string, profile: string) => void) {
  const h = sdk.React.createElement, { useState, useEffect } = sdk.hooks;
  return function ProfileOverview() {
    useProfileDisplay(sdk);
    const [columns, setColumns] = useState([] as ProfileColumn[]);
    const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
    const [order, setOrder] = useState([] as string[]);
    const [preferences, setPreferences] = useState({} as Record<string, boolean>);
    useEffect(() => {
      const controller = new AbortController();
      sdk.fetchJSON<{order: string[]}>('/api/plugins/workbench/profile-order', { signal: controller.signal })
        .then(value => setOrder(value.order || [])).catch(() => {});
      sdk.fetchJSON<{labels: Record<string, boolean>}>('/api/plugins/workbench/home-preferences', { signal: controller.signal })
        .then(value => setPreferences(value.labels || {})).catch(() => {});
      return () => controller.abort();
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
      error || allFailed ? h('p', { role: 'alert', className: 'overview-notice' }, tr('会话总览暂不可用，请重试。', 'Session overview unavailable. Please retry.'), retry()) : null,
      loading && !columns.length ? h('p', { role: 'status', className: 'overview-notice' }, tr('正在加载 Profile 和项目会话…', 'Loading profiles and project sessions…')) : null,
      !loading && !error && !columns.length ? h('p', { className: 'overview-notice' }, tr('暂无 Profile。', 'No profiles available.')) : null,
      h('div', { className: 'profile-overview-columns', 'aria-label': tr('按 Profile 分组的会话', 'Sessions grouped by profile') },
        sorted.map((column: ProfileColumn, position: number) => {
          const rows = column.rows;
          return h('section', { key: column.name, className: 'profile-overview-column', 'data-profile': column.name, 'aria-labelledby': `overview-${column.name}` },
            h('header', { className: 'profile-column-heading' }, h('span', { className: 'profile-column-icon', 'aria-hidden': true }, column.icon || '◈'),
              h('h2', { id: `overview-${column.name}` }, profileTabName(column.name)), h('span', { className: 'profile-column-count' }, `${rows.length} ${tr('会话', 'sessions')}`),
              h('button', { type: 'button', className: 'profile-new-session', 'aria-label': `${tr('新建会话', 'New session')} · ${profileTabName(column.name)}`, onClick: () => openHomeConversation('/chat?new=1', column.name, navigate) }, '+')),
            h('div', { className: 'profile-column-scroll', 'aria-label': profileTabName(column.name) },
              column.failed.length ? h('p', { role: 'alert', className: 'overview-notice' }, tr('部分数据加载失败', 'Some sessions unavailable.'), retry()) : null,
              column.loading ? h('p', { role: 'status', className: 'overview-notice' }, tr('正在加载历史会话…', 'Loading conversation history…')) : null,
              rows.slice(0, HOME_SESSIONS_PER_PROFILE).map((row) => {
                const rank = freshnessRank(row, column.rows.indexOf(row), now);
                const href = `/chat?${row.source === 'Codex' ? 'session' : 'hermesSession'}=${encodeURIComponent(row.id)}&profile=${encodeURIComponent(column.name)}`;
                return h('a', { key: `${row.source}:${row.id}`, href, className: 'profile-session', 'data-freshness': rank,
                  onClick: (event: MouseEvent) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openHomeConversation(href, column.name, navigate); } },
                  preferences[column.name] !== false && row.groupId ? h('span', { className: 'profile-session-project', title: projectName(column, row) }, projectName(column, row)) : null,
                  h('strong', null, row.title),
                  row.unread ? h('span', { className: 'profile-session-indicator', role: 'img', 'aria-label': tr('未读', 'Unread'), title: tr('未读', 'Unread') }, '●') : null,
                  ['running', 'active', 'streaming', 'in_progress'].includes(row.status) ? h('span', { className: 'profile-session-indicator', role: 'img', 'aria-label': tr('运行中', 'Running'), title: tr('运行中', 'Running') }, '◉') : null);
              }),
              !column.loading && !rows.length && !column.failed.length ? h('p', { className: 'overview-notice' }, tr('暂无会话', 'No sessions yet')) : null));
        })));
  };
}
