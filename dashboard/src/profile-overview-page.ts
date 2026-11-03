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
    const initialQuery = new URLSearchParams(window.location.search);
    const [project, setProject] = useState(initialQuery.get('project') || '');
    const [sort, setSort] = useState(['project', 'updated'].includes(initialQuery.get('sort') || '') ? initialQuery.get('sort')! : 'recent');
    const updateView = (key: string, value: string) => {
      const url = new URL(window.location.href);
      if (value && !(key === 'sort' && value === 'recent')) url.searchParams.set(key, value); else url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', url);
      if (key === 'project') setProject(value); else setSort(value);
    };
    const [columns, setColumns] = useState([] as ProfileColumn[]);
    const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
    const [order, setOrder] = useState([] as string[]);
    const [saving, setSaving] = useState(false), [orderReady, setOrderReady] = useState(false), [notice, setNotice] = useState('');
    useEffect(() => {
      const controller = new AbortController();
      sdk.fetchJSON<{order: string[]}>('/api/plugins/workbench/profile-order', { signal: controller.signal })
        .then(value => { setOrder(value.order || []); setOrderReady(true); })
        .catch(() => { if (!controller.signal.aborted) setNotice(tr('排序加载失败，请刷新重试', 'Unable to load order. Reload to retry.')); });
      return () => controller.abort();
    }, []);
    const saveOrder = async (next: string[]) => {
      setSaving(true);
      try {
        await sdk.fetchJSON('/api/plugins/workbench/profile-order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: next }) });
        setOrder(next); setNotice(tr('分组顺序已保存', 'Group order saved'));
      } catch { setNotice(tr('保存失败，请重试', 'Unable to save order. Please retry.')); }
      finally { setSaving(false); }
    };
    const sorted = [...columns].sort((a: ProfileColumn, b: ProfileColumn) => {
      const rank = (name: string) => order.includes(name) ? order.indexOf(name) : order.length;
      return rank(a.name) - rank(b.name);
    });
    const projectName = (column: ProfileColumn, row: ProfileColumn['rows'][number]) => column.projects.find(item => item.id === row.groupId)?.name || row.projectName || (row.source === 'Codex' ? row.workspace.split('/').filter(Boolean).at(-1) : '') || tr('未分组项目', 'Ungrouped project');
    const projects = [...new Set<string>(columns.flatMap((column: ProfileColumn) => column.rows.map(row => projectName(column, row))))].sort((a, b) => a.localeCompare(b));
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
      h('header', { className: 'profile-overview-heading' }, h('h1', null, tr('项目会话', 'Project sessions'))),
      error || allFailed ? h('p', { role: 'alert', className: 'overview-notice' }, tr('会话总览暂不可用，请重试。', 'Session overview unavailable. Please retry.'), retry()) : null,
      loading && !columns.length ? h('p', { role: 'status', className: 'overview-notice' }, tr('正在加载 Profile 和项目会话…', 'Loading profiles and project sessions…')) : null,
      !loading && !error && !columns.length ? h('p', { className: 'overview-notice' }, tr('暂无 Profile。', 'No profiles available.')) : null,
      h('div', { className: 'profile-order-toolbar' },
        h('select', { 'aria-label': tr('按项目筛选', 'Filter by project'), value: project, onChange: (event: any) => updateView('project', event.target.value) },
          h('option', { value: '' }, tr('全部项目', 'All projects')),
          (project && !projects.includes(project) ? [project, ...projects] : projects).map(name => h('option', { key: name, value: name }, name))),
        h('select', { 'aria-label': tr('会话排序', 'Sort sessions'), value: sort, onChange: (event: any) => updateView('sort', event.target.value) },
          [['recent', tr('最近打开', 'Recently opened')], ['updated', tr('最近更新', 'Recently updated')], ['project', tr('项目名称', 'Project name')]].map(([value, label]) => h('option', { key: value, value }, label))), h('button', { type: 'button', disabled: saving || !orderReady, onClick: () => void saveOrder([]) }, tr('恢复默认顺序', 'Restore default order')), h('a', { href: '/profiles', className: 'profile-home-navigation' }, tr('管理 Profile', 'Manage profiles')), h('span', { role: 'status', 'aria-live': 'polite' }, notice)),
      h('div', { className: 'profile-overview-columns', 'aria-label': tr('按 Profile 分组的会话', 'Sessions grouped by profile') },
        sorted.map((column: ProfileColumn, position: number) => {
          const rows = column.rows.filter(row => !project || projectName(column, row) === project);
          if (sort === 'updated') rows.sort((a, b) => b.updated - a.updated);
          if (sort === 'project') rows.sort((a, b) => projectName(column, a).localeCompare(projectName(column, b)) || b.updated - a.updated);
          return h('section', { key: column.name, className: 'profile-overview-column', 'data-profile': column.name, 'aria-labelledby': `overview-${column.name}` },
            h('header', { className: 'profile-column-heading' }, h('span', { className: 'profile-column-icon', 'aria-hidden': true }, column.icon || '◈'),
              h('h2', { id: `overview-${column.name}` }, profileTabName(column.name)), h('span', { className: 'profile-column-count' }, `${rows.length} ${tr('会话', 'sessions')}`),
              h('button', { type: 'button', className: 'profile-new-session', 'aria-label': `${tr('新增会话', 'New session')} · ${profileTabName(column.name)}`, title: tr('新增会话', 'New session'), onClick: () => openHomeConversation('/chat?new=1', column.name, navigate) }, '+')),
            h('div', { className: 'profile-order-controls' }, ...([-1, 1] as const).map(direction => h('button', { type: 'button', disabled: saving || !orderReady || position + direction < 0 || position + direction >= sorted.length, 'aria-label': `${profileTabName(column.name)} ${direction < 0 ? tr('上移', 'Move up') : tr('下移', 'Move down')}`, onClick: () => { const next = sorted.map((item: ProfileColumn) => item.name); [next[position], next[position + direction]] = [next[position + direction], next[position]]; void saveOrder(next); } }, direction < 0 ? '↑' : '↓'))),
            h('div', { className: 'profile-column-scroll', 'aria-label': profileTabName(column.name) },
              column.failed.length ? h('p', { role: 'alert', className: 'overview-notice' }, tr('部分数据加载失败', 'Some sessions unavailable.'), retry()) : null,
              column.loading ? h('p', { role: 'status', className: 'overview-notice' }, tr('正在加载历史会话…', 'Loading conversation history…')) : null,
              // Filter and sort before limiting; freshness keeps its original rank.
              rows.slice(0, HOME_SESSIONS_PER_PROFILE).map((row) => {
                const rank = freshnessRank(row, column.rows.indexOf(row), now);
                const href = `/chat?${row.source === 'Codex' ? 'session' : 'hermesSession'}=${encodeURIComponent(row.id)}&profile=${encodeURIComponent(column.name)}`;
                return h('a', { key: `${row.source}:${row.id}`, href, className: 'profile-session', 'data-freshness': rank,
                  onClick: (event: MouseEvent) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openHomeConversation(href, column.name, navigate); } },
                  h('span', { className: 'profile-session-project', title: projectName(column, row) }, projectName(column, row)),
                  h('strong', null, row.title),
                  row.unread ? h('span', { className: 'profile-session-indicator', role: 'img', 'aria-label': tr('未读', 'Unread'), title: tr('未读', 'Unread') }, '●') : null,
                  ['running', 'active', 'streaming', 'in_progress'].includes(row.status) ? h('span', { className: 'profile-session-indicator', role: 'img', 'aria-label': tr('运行中', 'Running'), title: tr('运行中', 'Running') }, '◉') : null);
              }),
              !column.loading && !rows.length && !column.failed.length ? h('p', { className: 'overview-notice' }, project ? tr('无匹配会话', 'No matching sessions') : tr('暂无会话', 'No sessions yet')) : null));
        })));
  };
}
