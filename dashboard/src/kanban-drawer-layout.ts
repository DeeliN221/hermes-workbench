import { uiText } from './ui-locale';
/** V4 layout: native form nodes stay owned by React; read-only history is enhanced. */
import { listKanbanSessions } from './kanban-session-api';
import { workbenchPath } from './kanban-session-bridge';
import { loadKanbanRunSessions, sessionsForRun, runSessionPath, type RunSession } from './kanban-run-sessions';

type Tab = 'overview' | 'sessions' | 'files' | 'settings';
type State = { task: string; board: string; tab: Tab; tabs: HTMLElement; sessions: HTMLElement; runs: HTMLElement; alert: HTMLElement; fingerprint: string; timer?: ReturnType<typeof setTimeout>; request: number; dataKey?: string; linksLoaded: boolean; assignee?: string; disposed?: boolean; runSessions?: RunSession[]; runSessionError?: string; runSessionRequest?: number; runData?: any[]; discussionLinks?: any[] };
const states = new WeakMap<HTMLElement, State>();
let nextId = 0;
const labels: Record<Tab, string> = { overview: uiText("概览", "Overview"), sessions: uiText("关联会话", "Linked sessions"), files: uiText("附件", "Attachments"), settings: uiText("依赖与设置", "Dependencies and settings") };
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = cls; if (text) node.textContent = text; return node;
}
function text(node: Element | null, value: string) { if (node && node.textContent !== value) node.textContent = value; }
function head(node: Element): HTMLElement | null { return Array.from(node.children).find(n => n.classList.contains('hermes-kanban-section-head')) as HTMLElement || node.querySelector('.hermes-kanban-section-head-row .hermes-kanban-section-head'); }
function isHeading(value: string, names: string[]) { return names.some(name => value === name || value.startsWith(name + ' (') || value.startsWith(name + '（')); }
function own<T extends HTMLElement>(node: T) { node.dataset.wbOwned = 'true'; return node; }
function setTab(drawer: HTMLElement, state: State, tab: Tab) {
  state.tab = tab; drawer.dataset.wbTab = tab;
  for (const button of state.tabs.querySelectorAll<HTMLButtonElement>('button')) {
    const selected = button.dataset.tab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
  }
  for (const section of drawer.querySelectorAll<HTMLElement>('[data-wb-panel]')) {
    section.hidden = section.dataset.wbPanel !== tab;
  }
  if (tab === 'sessions') void loadSessions(drawer, state);
}
export function showDrawerSettings(drawer: HTMLElement) {
  const state = states.get(drawer); if (!state) return;
  setTab(drawer, state, 'settings');
  drawer.querySelector<HTMLElement>('[data-wb-panel="settings"]')?.scrollIntoView({ block: 'nearest' });
}
function showLog(drawer: HTMLElement, state: State) {
  setTab(drawer, state, 'overview'); drawer.dataset.wbLog = 'true';
  drawer.querySelector<HTMLElement>('.wb-native-log')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function logButton(drawer: HTMLElement, state: State, label: string) {
  const button = el('button', 'wb-text-button', label); button.type = 'button'; button.addEventListener('click', () => showLog(drawer, state)); return button;
}
async function loadSessions(drawer: HTMLElement, state: State) {
  if (state.linksLoaded) return;
  state.linksLoaded = true; text(state.sessions, uiText("正在读取关联会话…", "Loading linked sessions\u2026"));
  try {
    const links = await listKanbanSessions(state.task, state.board);
    if (!drawer.isConnected || states.get(drawer) !== state) return;
    state.discussionLinks = links;
    renderSessions(state);
  } catch (error) {
    text(state.sessions, uiText(`关联会话读取失败：${String(error)} `, `Failed to load linked sessions: ${String(error)} `));
    const retry = el('button', 'wb-text-button', uiText("重试", "Retry")); retry.onclick = () => { state.linksLoaded = false; void loadSessions(drawer, state); }; state.sessions.append(retry);
  }
}
function renderSessions(state: State) {
    state.sessions.replaceChildren();
    const workers = (state.runData || []).flatMap(run => sessionsForRun(run, state.runData || [], state.runSessions || []));
    const links = state.discussionLinks || [];
    text(state.tabs.querySelector('[data-tab="sessions"]'), uiText(`关联会话 ${links.length + workers.length}`, `Linked sessions ${links.length + workers.length}`));
    if (!links.length && !workers.length) state.sessions.append(el('p', 'wb-muted', uiText("暂无关联会话，可通过“对话”开始讨论；执行会话保存后会显示在运行记录中。", "No linked sessions. Start a discussion with Chat; saved execution sessions appear in run history.")));
    for (const link of links) {
      const anchor = el('a', 'wb-session-link'); anchor.href = workbenchPath(state.task, state.board, link);
      const body = el('span'); body.append(el('strong', '', uiText("继续卡片讨论", "Continue card discussion")), el('small', 'wb-muted', link.profile));
      anchor.append(body, el('span', '', '›')); state.sessions.append(anchor);
    }
    for (const session of workers) {
      const anchor = el('a', 'wb-session-link'); anchor.href = runSessionPath(session);
      const body = el('span'); body.append(el('strong', '', uiText("打开执行会话", "Open execution session")), el('small', 'wb-muted', `${session.profile} · ${new Date(session.started_at * 1000).toLocaleString(document.documentElement.lang || 'en')}`));
      anchor.append(body, el('span', '', '›')); state.sessions.append(anchor);
    }
}
function renderRunSessions(drawer: HTMLElement, state: State) {
  for (const container of state.runs.querySelectorAll<HTMLElement>('[data-run-sessions]')) {
    const run = state.runData?.find(row => String(row.id) === container.dataset.runSessions);
    container.replaceChildren();
    const sessions = sessionsForRun(run, state.runData || [], state.runSessions || []);
    for (const session of sessions) {
      const link = el('a', 'wb-run-conversation', uiText("打开执行会话 →", "Open execution session \u2192")); link.href = runSessionPath(session);
      container.append(link);
    }
    if (!sessions.length) {
      container.append(el('span', 'wb-muted', state.runSessionError || (state.runSessions ? uiText("尚未找到本次执行的会话记录。", "No session found for this run yet.") : uiText("正在读取执行会话…", "Loading execution session\u2026"))));
      if (state.runSessions || state.runSessionError) {
        const retry = el('button', 'wb-text-button', uiText("重新查找", "Search again")); retry.onclick = () => void refreshRunSessions(drawer, state); container.append(retry);
      }
    }
  }
  if (state.discussionLinks) renderSessions(state);
}
async function refreshRunSessions(drawer: HTMLElement, state: State) {
  const sdk = (window as any).__HERMES_PLUGIN_SDK__; if (!sdk?.fetchJSON) return;
  const request = state.runSessionRequest = (state.runSessionRequest || 0) + 1;
  state.runSessionError = undefined; state.runSessions = undefined; renderRunSessions(drawer, state);
  try {
    const sessions = await loadKanbanRunSessions(sdk.fetchJSON, state.task);
    if (!drawer.isConnected || states.get(drawer) !== state || request !== state.runSessionRequest) return;
    state.runSessions = sessions;
  } catch (error) {
    if (!drawer.isConnected || states.get(drawer) !== state || request !== state.runSessionRequest) return;
    state.runSessionError = uiText(`执行会话读取失败：${String(error)}`, `Failed to load execution session: ${String(error)}`);
  }
  renderRunSessions(drawer, state);
}
function renderData(drawer: HTMLElement, state: State, data: any) {
  const key = JSON.stringify([data.task, data.runs]);
  const changed = state.dataKey !== key; state.dataKey = key;
  const task = data.task; state.assignee = task.assignee;
  const select = drawer.querySelector<HTMLSelectElement>('.hti-kanban-control-field select');
  if (select && !select.disabled && !select.dataset.userSelected && task.assignee && Array.from(select.options).some(o => o.value === task.assignee)) select.value = task.assignee;
  if (!changed) return;
  state.alert.replaceChildren();
  const failures = Number(task.consecutive_failures || 0);
  if (task.last_failure_error || (task.status === 'blocked' && task.diagnostics?.length)) {
    state.alert.hidden = false;
    const summary = el('div', 'wb-alert-summary');
    const message = el('div'); message.append(el('strong', '', task.status === 'blocked' ? uiText("任务受阻", "Task blocked") : uiText("最近一次执行异常", "Latest execution failed")));
    if (failures) message.append(el('small', '', uiText(`连续失败 ${failures} 次`, `${failures} consecutive failures`)));
    summary.append(el('span', 'wb-alert-icon', '!'), message, logButton(drawer, state, uiText("查看日志 →", "View logs \u2192")));
    const detail = el('details', 'wb-error-detail'); detail.append(el('summary', '', uiText("查看原因", "View details")), el('pre', '', task.last_failure_error || task.diagnostics[0]?.detail || task.diagnostics[0]?.title || ''));
    state.alert.append(summary, detail);
  } else state.alert.hidden = true;
  const openRuns = new Set(Array.from(state.runs.querySelectorAll<HTMLDetailsElement>('details[data-run][open]')).map(n => n.dataset.run));
  const outerOpen = state.runs.querySelector('details')?.open ?? true;
  const runs = [...(data.runs || [])].sort((a, b) => (b.started_at || 0) - (a.started_at || 0) || Number(b.id) - Number(a.id));
  state.runData = runs;
  state.runs.replaceChildren();
  const outer = el('details', 'wb-run-list'); outer.open = outerOpen;
  outer.append(el('summary', 'wb-section-summary', uiText(`运行记录 ${runs.length}`, `Run history ${runs.length}`)));
  if (!runs.length) outer.append(el('p', 'wb-muted wb-empty', uiText("暂无运行记录", "No runs yet")));
  runs.forEach((run, i) => {
    const item = el('details', 'wb-run'); item.dataset.run = String(run.id); item.open = openRuns.has(String(run.id)) || (openRuns.size === 0 && i === 0 && !state.runs.dataset.rendered);
    const outcome = run.outcome || run.status || 'unknown';
    const failed = ['crashed', 'failed', 'error', 'protocol_violation', 'timed_out'].includes(outcome);
    item.dataset.outcome = failed ? 'failed' : ['done', 'completed', 'success'].includes(outcome) ? 'done' : 'other';
    const summary = el('summary', 'wb-run-heading');
    const date = run.started_at ? new Date(run.started_at * 1000) : null;
    const stamp = el('time', 'wb-run-time', date ? date.toLocaleTimeString(document.documentElement.lang || 'en', { hour: '2-digit', minute: '2-digit' }) : '—');
    if (date) { stamp.dateTime = date.toISOString(); stamp.title = date.toLocaleString(document.documentElement.lang || 'en'); }
    const title = el('strong', '', uiText(`第 ${runs.length - i} 次执行`, `Run ${runs.length - i}`));
    const status = el('span', 'wb-run-status', failed ? uiText("失败", "Failed") : ({ done: uiText("完成", "Completed"), completed: uiText("完成", "Completed"), success: uiText("完成", "Completed"), running: uiText("运行中", "Running"), blocked: uiText("受阻", "Blocked"), cancelled: uiText("已取消", "Cancelled") } as Record<string, string>)[outcome] || outcome);
    summary.append(stamp, title, status); item.append(summary);
    const detail = el('div', 'wb-run-detail');
    if (run.profile) detail.append(el('small', 'wb-muted', run.profile));
    if (run.summary) detail.append(el('p', '', run.summary));
    if (run.error) detail.append(el('pre', 'wb-run-error', run.error));
    if (run.metadata && Object.keys(run.metadata).length) {
      const meta = el('details', 'wb-run-metadata'); meta.append(el('summary', '', uiText("执行详情", "Execution details")), el('pre', '', JSON.stringify(run.metadata, null, 2))); detail.append(meta);
    }
    const conversations = el('div', 'wb-run-conversations'); conversations.dataset.runSessions = String(run.id);
    detail.append(conversations, logButton(drawer, state, uiText("查看原始进程日志", "View raw process logs"))); item.append(detail); outer.append(item);
  });
  state.runs.dataset.rendered = 'true'; state.runs.append(outer);
  drawer.dataset.wbHistoryLoaded = 'true';
  setTab(drawer, state, state.tab);
  if (runs.length) void refreshRunSessions(drawer, state);
}
async function refreshData(drawer: HTMLElement, state: State) {
  const request = ++state.request;
  const sdk = (window as any).__HERMES_PLUGIN_SDK__;
  if (!sdk?.fetchJSON) return;
  try {
    const data = await sdk.fetchJSON(`/api/plugins/kanban/tasks/${encodeURIComponent(state.task)}?board=${encodeURIComponent(state.board)}`);
    if (!drawer.isConnected || states.get(drawer) !== state || request !== state.request) return;
    if (data?.task?.id !== state.task) throw new Error(uiText("卡片数据不匹配", "Card data mismatch"));
    renderData(drawer, state, data);
  } catch (error) {
    if (!drawer.isConnected || states.get(drawer) !== state || request !== state.request) return;
    state.dataKey = undefined;
    // Keep native run history visible if the enhancement cannot read its source.
    state.runs.replaceChildren(el('span', 'wb-muted', uiText(`运行详情读取失败：${String(error)} `, `Failed to load run details: ${String(error)} `)));
    const retry = el('button', 'wb-text-button', uiText("重试", "Retry")); retry.onclick = () => void refreshData(drawer, state); state.runs.append(retry);
    delete drawer.dataset.wbHistoryLoaded;
  }
}
function commentsDock(drawer: HTMLElement, source: HTMLElement | undefined) {
  const footer = drawer.querySelector<HTMLElement>('.hermes-kanban-drawer-comment-foot'); if (!footer) return;
  let details = footer.querySelector<HTMLDetailsElement>('.wb-comments');
  if (!details) { details = own(el('details', 'wb-comments')); details.append(el('summary', 'wb-section-summary', uiText('评论 0', 'Comments 0')), el('div', 'wb-comments-history')); footer.prepend(details); }
  const heading = source && head(source);
  const count = heading?.textContent?.match(/[（(](\d+)[）)]/)?.[1] || '0';
  text(details.querySelector('summary'), uiText(`评论 ${count}`, `Comments ${count}`));
  const content = details.querySelector<HTMLElement>('.wb-comments-history')!;
  const signature = source?.innerHTML || '';
  if (content.dataset.signature !== signature) {
    content.dataset.signature = signature;
    content.replaceChildren(...(source ? Array.from(source.children).filter(child => child !== heading).map(child => child.cloneNode(true)) : []));
  }
  const input = footer.querySelector('input'); if (input) { input.placeholder = uiText('添加评论…', 'Add a comment…'); input.setAttribute('aria-label', uiText('添加评论', 'Add a comment')); }
  text(footer.querySelector('.hermes-kanban-drawer-comment-row button'), uiText('发送', 'Send'));
}
/** Called after native React updates; never reparent or replace its editable nodes. */
export function layoutKanbanDrawer(drawer: HTMLElement) {
  const body = drawer.querySelector<HTMLElement>('.hermes-kanban-drawer-body');
  const task = drawer.querySelector('.hermes-kanban-drawer-head span')?.textContent?.trim() || '';
  if (!body || !task) return;
  const board = new URLSearchParams(window.location.search).get('board') || window.localStorage.getItem('hermes.kanban.selectedBoard') || '';
  let state = states.get(drawer);
  if (state && (state.task !== task || state.board !== board)) {
    clearTimeout(state.timer); state.request++; drawer.querySelectorAll('[data-wb-owned]').forEach(n => n.remove()); states.delete(drawer); state = undefined;
    delete drawer.dataset.wbHistoryLoaded; delete drawer.dataset.wbLog;
  }
  drawer.classList.add('hti-kanban-v4'); body.classList.add('hti-kanban-prioritized-body');
  if (!state) {
    const tabs = own(el('nav', 'wb-drawer-tabs')); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', uiText('卡片详情', 'Card details'));
    state = { task, board, tab: 'overview', tabs, sessions: own(el('section', 'wb-sessions')), runs: own(el('section', 'wb-runs')), alert: own(el('section', 'wb-task-alert')), fingerprint: '', request: 0, linksLoaded: false };
    states.set(drawer, state);
    const id = `wb-card-${++nextId}`;
    for (const tab of Object.keys(labels) as Tab[]) {
      const button = el('button', '', labels[tab]); button.type = 'button'; button.dataset.tab = tab; button.setAttribute('role', 'tab'); button.id = `${id}-${tab}`;
      button.addEventListener('click', () => setTab(drawer, state!, tab));
      button.addEventListener('keydown', event => {
        const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('button')); const index = buttons.indexOf(button);
        const target = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (target >= 0) { event.preventDefault(); buttons[target].click(); buttons[target].focus(); }
      }); tabs.append(button);
    }
    state.sessions.dataset.wbPanel = 'sessions'; state.runs.dataset.wbPanel = 'overview'; state.alert.dataset.wbPanel = 'overview'; state.alert.hidden = true;
    body.append(tabs, state.alert, state.runs, state.sessions);
    setTab(drawer, state, 'overview');
    const crumb = own(el('small', 'wb-board-name', board ? board + ' / ' : ''));
    drawer.querySelector('.hermes-kanban-drawer-head')?.prepend(crumb);
  }
  const agent = drawer.querySelector<HTMLSelectElement>('.hti-kanban-control-field select');
  if (agent && !agent.disabled && !agent.dataset.userSelected && state.assignee && Array.from(agent.options).some(o => o.value === state.assignee)) agent.value = state.assignee;
  void loadSessions(drawer, state);
  let commentSource: HTMLElement | undefined;
  const fingerprints: string[] = [];
  for (const child of Array.from(body.children) as HTMLElement[]) {
    if (child.dataset.wbOwned || child.classList.contains('hti-kanban-execution-control')) continue;
    const heading = head(child); const label = heading?.textContent?.trim() || '';
    let tab: Tab = 'settings';
    if (child.classList.contains('hermes-kanban-drawer-title')) { child.classList.add('wb-task-title'); delete child.dataset.wbPanel; fingerprints.push(child.textContent || ''); continue; }
    if (isHeading(label, ['Description', '说明', '描述', '理解后的需求', '任务描述'])) { tab = 'overview'; child.classList.add('wb-description'); text(heading, uiText('任务描述', 'Task description')); }
    if (isHeading(label, ['Result', 'Final Result', '最终结果', '结果', '最终回复', '子任务结果', 'Child Results'])) { tab = 'overview'; child.classList.add('wb-result'); }
    if (isHeading(label, ['Attachments', '附件'])) { tab = 'files'; child.classList.add('wb-attachments'); const count = label.match(/[（(](\d+)[）)]/)?.[1]; text(state.tabs.querySelector('[data-tab="files"]'), uiText("附件", "Attachments") + (count ? ' ' + count : '')); }
    if (isHeading(label, ['Comments', '评论', '备注'])) { commentSource = child; child.classList.add('wb-native-comments'); }
    if (isHeading(label, ['Run history', '运行历史', '运行记录', '执行历史'])) { tab = 'overview'; child.classList.add('wb-native-runs'); }
    if (child.querySelector('.hermes-kanban-log') || isHeading(label, ['Worker log', '工作者日志', '工作进程日志', '工作日志', '运行日志', '执行日志'])) { tab = 'overview'; child.classList.add('wb-native-log'); }
    child.dataset.wbPanel = tab; child.hidden = tab !== state.tab;
    fingerprints.push(child.textContent || '');
  }
  commentsDock(drawer, commentSource);
  const fingerprint = fingerprints.join('\0');
  if (fingerprint !== state.fingerprint) {
    state.fingerprint = fingerprint; clearTimeout(state.timer);
    state.timer = setTimeout(() => { if (drawer.isConnected) void refreshData(drawer, state!); }, 180);
  }
}
