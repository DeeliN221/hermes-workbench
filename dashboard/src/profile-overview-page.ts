import type { FetchJSON } from './workbench-api';
import { loadProfileOverview, sessionTime, freshnessRank, timeHint, type ProfileColumn } from './profile-overview';
import { openHomeConversation } from './home-navigation';
import { useProfileDisplay } from './profile-display';
import { profileTabName } from './kanban-agent-picker';
import { uiText as tr } from './ui-locale';

export function createOverviewTabs(sdk: { React: any }, navigate: (path: string, profile: string) => void) {
  const h = sdk.React.createElement;
  return function OverviewTabs({ board, profile }: { board: boolean; profile: string }) {
    return h('nav', { className: 'overview-tabs', 'aria-label': tr('工作台视图', 'Workbench views') },
      [[false, '/', tr('项目会话', 'Project sessions')], [true, '/kanban', tr('看板', 'Kanban')]].map(([active, path, title]) =>
        h('a', { key: String(path), href: `${path}?profile=${encodeURIComponent(profile)}`, 'aria-current': board === active ? 'page' : undefined,
          onClick: (event: MouseEvent) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(String(path), profile); } }, title)));
  };
}

export function createProfileOverview(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }, navigate: (path: string, profile: string) => void) {
  const h = sdk.React.createElement, { useState, useEffect } = sdk.hooks;
  return function ProfileOverview() {
    useProfileDisplay(sdk);
    const [columns, setColumns] = useState([] as ProfileColumn[]);
    const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
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
      h('header', { className: 'profile-overview-heading' }, h('h1', null, tr('项目会话', 'Project sessions')), h('p', null, tr('全部 Profile · 最近打开优先', 'All profiles · Recently opened first'))),
      error || allFailed ? h('p', { role: 'alert', className: 'overview-notice' }, tr('会话总览暂不可用，请重试。', 'Session overview unavailable. Please retry.'), retry()) : null,
      loading && !columns.length ? h('p', { role: 'status', className: 'overview-notice' }, tr('正在加载 Profile 和项目会话…', 'Loading profiles and project sessions…')) : null,
      !loading && !error && !columns.length ? h('p', { className: 'overview-notice' }, tr('暂无 Profile。', 'No profiles available.')) : null,
      h('div', { className: 'profile-overview-columns', tabIndex: 0, 'aria-label': tr('横向浏览 Profile', 'Scroll profiles horizontally') },
        columns.map((column: ProfileColumn) => {
          const projectNames = new Map(column.projects.map(project => [project.id, project.name]));
          const emptyProjects = column.projects.filter(project => !column.rows.some(row => row.groupId === project.id));
          return h('section', { key: column.name, className: 'profile-overview-column', 'data-profile': column.name, 'aria-labelledby': `overview-${column.name}` },
            h('header', { className: 'profile-column-heading' }, h('span', { className: 'profile-column-icon', 'aria-hidden': true }, column.icon || '◈'),
              h('h2', { id: `overview-${column.name}` }, profileTabName(column.name)), h('span', { className: 'profile-column-count' }, `${column.rows.length} ${tr('会话', 'sessions')}`)),
            h('div', { className: 'profile-column-scroll', tabIndex: 0, 'aria-label': profileTabName(column.name) },
              column.failed.length ? h('p', { role: 'alert', className: 'overview-notice' }, tr('部分数据加载失败，已保留可用会话。', 'Some data failed to load. Available sessions are shown.'), retry()) : null,
              column.loading ? h('p', { role: 'status', className: 'overview-notice' }, tr('正在加载历史会话…', 'Loading conversation history…')) : null,
              column.rows.map((row, index) => {
                const time = sessionTime(row), rank = freshnessRank(row, index, now);
                const href = `/chat?${row.source === 'Codex' ? 'session' : 'hermesSession'}=${encodeURIComponent(row.id)}&profile=${encodeURIComponent(column.name)}`;
                return h('a', { key: `${row.source}:${row.id}`, href, className: 'profile-session', 'data-freshness': rank,
                  onClick: (event: MouseEvent) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openHomeConversation(href, column.name, navigate); } },
                  h('span', { className: 'profile-session-project' }, projectNames.get(row.groupId || '') || row.projectName || (row.source === 'Codex' ? row.workspace.split('/').filter(Boolean).at(-1) : '') || tr('未分组项目', 'Ungrouped project')),
                  h('strong', null, row.title),
                  h('span', { className: 'profile-session-meta' }, row.source, row.status ? ` · ${row.status}` : '', row.unread ? ` · ${tr('未读', 'Unread')}` : ''),
                  h('time', { dateTime: time ? new Date(time).toISOString() : undefined, title: time ? new Date(time).toLocaleString() : undefined },
                    `${row.lastOpened ? tr('打开', 'Opened') : tr('活动', 'Active')} · ${timeHint(time, now)}${time ? ' · ' + new Date(time).toLocaleString() : ''}`));
              }),
              emptyProjects.map(project => h('div', { key: project.id, className: 'profile-empty-project' }, h('strong', null, project.name), h('p', null, tr('暂无会话', 'No sessions yet')))),
              !column.loading && !column.rows.length && !emptyProjects.length && !column.failed.length ? h('p', { className: 'overview-notice' }, tr('暂无项目或会话', 'No projects or sessions yet')) : null));
        })));
  };
}
