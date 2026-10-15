import { uiText as sourceText } from './ui-locale';
import { layoutKanbanDrawer } from './kanban-drawer-layout';
import { loadKanbanProfiles, populateKanbanAgentSelect } from './kanban-agent-picker';
/** Progressive disclosure and direct handoff actions for the native Kanban drawer. */
import { listKanbanSessions } from './kanban-session-api';
import { drawerConversationPath } from './kanban-session-bridge';

const KANBAN_API = '/api/plugins/kanban';
export const STATUS_ACTIONS: Record<string, { label: string; title: string }> = {
  '→ triage': { label: sourceText("移至：待分类", "Move to triage"), title: sourceText("退回待分类，重新澄清任务", "Return to triage to clarify the task") },
  '→ ready': { label: sourceText("确认执行 → 就绪", "Confirm execution → Ready"), title: sourceText("任务会等待指定执行 Agent；已分配后由调度器处理", "The task waits for an assigned agent, then the scheduler handles it") },
  Block: { label: sourceText("暂停 / 等待反馈", "Pause / Await input"), title: sourceText("暂停任务，等待人工补充或决策", "Pause the task for human input or a decision") },
  Unblock: { label: sourceText("解除阻塞 → 就绪", "Unblock → Ready"), title: sourceText("解除等待状态；需指定执行 Agent 才会自动处理", "Unblock the task; automatic processing requires an assigned agent") },
  Complete: { label: sourceText("标记完成", "Mark completed"), title: sourceText("确认交付完成，并解锁依赖它的后续任务", "Confirm delivery and unblock dependent tasks") },
  Archive: { label: sourceText("归档", "Archive"), title: sourceText("不再处理，但保留历史记录", "Stop processing while preserving history") },
  '✨ Specify': { label: sourceText("生成任务草案", "Draft task"), title: sourceText("让模型将待分类想法整理为任务说明", "Ask the model to turn the idea into a task description") },
  '⚗ Decompose': { label: sourceText("拆分任务", "Split task"), title: sourceText("让模型生成可独立执行的子任务图", "Ask the model to create independently executable subtasks") },
};

function boardFromLocation(): string {
  return new URLSearchParams(window.location.search).get('board') || window.localStorage.getItem('hermes.kanban.selectedBoard') || '';
}

function api(path: string): string {
  const board = boardFromLocation();
  return board ? `${KANBAN_API}${path}${path.includes('?') ? '&' : '?'}board=${encodeURIComponent(board)}` : `${KANBAN_API}${path}`;
}

/** Kanban JSON APIs must use the host JSON client so both auth modes work. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const sdk = (window as any).__HERMES_PLUGIN_SDK__;
  if (typeof sdk?.fetchJSON === 'function') return sdk.fetchJSON(url, init);
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function installedProfiles(): Promise<string[]> {
  return loadKanbanProfiles(fetchJson, api('/profiles'));
}

function labelledControl(labelText: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'hti-kanban-control-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  wrapper.append(label, control);
  return wrapper;
}

/** First-row handoff: choose Agent, then talk or assign directly. */
function installDrawerExecutionControl(drawer: HTMLElement, actions: HTMLElement): void {
  const taskId = drawer.querySelector('.hermes-kanban-drawer-head span')?.textContent?.trim() || '';
  if (!taskId) return;
  const previous = drawer.querySelector<HTMLElement>('.hti-kanban-execution-control');
  if (previous?.dataset.task === taskId) return;
  previous?.remove();

  const control = document.createElement('section');
  control.className = 'hti-kanban-execution-control hti-kanban-primary';
  control.dataset.task = taskId;
  control.setAttribute('aria-label', sourceText("任务执行", "Task execution"));

  const failure = document.createElement('div'); failure.className = 'wb-action-error'; failure.setAttribute('role', 'alert'); failure.hidden = true;
  const agentSelect = document.createElement('select');
  agentSelect.setAttribute('aria-label', sourceText("选择执行 Agent", "Select execution agent"));
  const defaultOption = document.createElement('option');
  defaultOption.value = 'default';
  defaultOption.textContent = sourceText("default（默认 Agent）", "default");
  agentSelect.appendChild(defaultOption);

  const conversationButton = document.createElement('button');
  conversationButton.type = 'button';
  conversationButton.className = 'hti-kanban-action hti-kanban-conversation-action';
  conversationButton.textContent = sourceText("对话", "Chat");
  conversationButton.title = sourceText("打开与所选 Agent 的交互会话；不会派发任务或改变卡片状态", "Open a conversation with the selected agent without dispatching work or changing card status");
  conversationButton.addEventListener('click', async () => {
    failure.hidden = true;
    const assignee = agentSelect.value || 'default';
    conversationButton.disabled = true;
    conversationButton.textContent = sourceText("打开中…", "Opening…");
    try {
      const links = await listKanbanSessions(taskId, boardFromLocation());
      window.location.assign(drawerConversationPath(taskId, boardFromLocation(), assignee, links));
    } catch (error) {
      failure.hidden = false; failure.textContent = sourceText(`打开会话失败：${String(error)}`, `Could not open session: ${String(error)}`);
      conversationButton.disabled = false;
      conversationButton.textContent = sourceText("对话", "Chat");
      conversationButton.title = String(error instanceof Error ? error.message : error);
    }
  });

  const assignButton = document.createElement('button');
  assignButton.type = 'button';
  assignButton.className = 'hti-kanban-action hti-kanban-assign-action';
  assignButton.textContent = sourceText("指派", "Assign");
  assignButton.title = sourceText("把卡片交给所选 Agent，转为就绪并触发后台调度", "Assign the card to this agent, mark it ready, and trigger scheduling");
  assignButton.addEventListener('click', async () => {
    failure.hidden = true;
    const assignee = agentSelect.value || 'default';
    assignButton.disabled = true;
    assignButton.textContent = sourceText("指派中…", "Assigning…");
    try {
      await fetchJson(api(`/tasks/${encodeURIComponent(taskId)}`), {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee, status: 'ready' }),
      });
      await fetchJson(api('/dispatch'), { method: 'POST' });
      window.location.reload();
    } catch (error) {
      failure.hidden = false; failure.textContent = sourceText(`指派失败：${String(error)}`, `Assignment failed: ${String(error)}`);
      assignButton.disabled = false;
      assignButton.textContent = sourceText("指派", "Assign");
      assignButton.title = String(error instanceof Error ? error.message : error);
    }
  });

  agentSelect.addEventListener('change', () => { agentSelect.dataset.userSelected = 'true'; });
  control.append(
    labelledControl(sourceText("执行 Agent", "Execution agent"), agentSelect),
    conversationButton,
    assignButton,
    failure,
  );
  // StatusActions wraps `.hermes-kanban-actions` in an anonymous div. Inserting
  // beside `actions` makes the control inherit that wrapper's secondary state
  // and disappear with it. Keep the handoff as a direct drawer-body child.
  const drawerBody = drawer.querySelector('.hermes-kanban-drawer-body');
  drawerBody?.insertBefore(control, drawerBody.firstChild);

  void populateKanbanAgentSelect(agentSelect, [conversationButton, assignButton], control, installedProfiles, async () => {
    const data = await fetchJson<{ task: { assignee?: string }; board_default_assignee?: string }>(api(`/tasks/${encodeURIComponent(taskId)}`));
    return data.task.assignee || data.board_default_assignee || 'default';
  }).then(() => {
    // The drawer observer refreshes the persisted assignee after the roster loads.
    classifyDrawerSections(drawer);
  });
}

/** Preserve the exported integration point for native drawer refreshes. */
export const classifyDrawerSections = layoutKanbanDrawer;

function localizeStatusActions(): void {
  for (const actions of Array.from(document.querySelectorAll('.hermes-kanban-actions'))) {
    const drawer = actions.closest('.hermes-kanban-drawer') as HTMLElement | null;
    if (drawer) {
      installDrawerExecutionControl(drawer, actions as HTMLElement);
      classifyDrawerSections(drawer);
    }
    // The old workflow recommendation is intentionally removed: users move cards directly on the board.
    actions.parentElement?.querySelector('.hti-kanban-workflow-hint')?.remove();
    for (const button of Array.from(actions.querySelectorAll('button'))) {
      const raw = button.textContent?.trim() || '';
      const aliases: Record<string, string> = { '已阻塞': 'Block', '解除阻塞': 'Unblock', '完成': 'Complete', '归档': 'Archive' };
      const key = aliases[raw] || (STATUS_ACTIONS[raw] ? raw : Object.keys(STATUS_ACTIONS).find(key => STATUS_ACTIONS[key].label === raw));
      if (!key) continue;
      const translated = STATUS_ACTIONS[key];
      if (button.textContent !== translated.label) button.textContent = translated.label;
      button.title = translated.title;
      button.setAttribute('aria-label', translated.label);
      button.dataset.wbAction = ({ '→ triage': 'triage', '→ ready': 'ready', Block: 'block', Unblock: 'unblock', Complete: 'complete', Archive: 'archive', '✨ Specify': 'specify', '⚗ Decompose': 'decompose' } as Record<string, string>)[key];
    }
  }
}

async function refreshReadyGuide(): Promise<void> {
  document.querySelector('.hti-kanban-ready-guide')?.remove();
}

/** Keep the compatibility layer alive across native Kanban React re-renders. */
export function installKanbanWorkflowBridge(): void {
  if ((window as any).__HERMES_WORKBENCH_KANBAN_WORKFLOW__) return;
  (window as any).__HERMES_WORKBENCH_KANBAN_WORKFLOW__ = true;
  let queued = false;
  let lastGuideAt = 0;
  const refresh = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      localizeStatusActions();
      for (const drawer of Array.from(document.querySelectorAll('.hermes-kanban-drawer'))) {
        classifyDrawerSections(drawer as HTMLElement);
      }
      if (Date.now() - lastGuideAt < 2_000) return;
      lastGuideAt = Date.now();
      void refreshReadyGuide().catch(() => undefined);
    });
  };
  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', refresh);
  refresh();
}
