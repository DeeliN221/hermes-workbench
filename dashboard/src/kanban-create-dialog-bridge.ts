import { uiText as sourceText } from './ui-locale';
import { cardDocumentFromBody, renderCardDocument, validateCardDocument } from './kanban-card-schema';
import { createCardFields } from './kanban-card-fields';
import { agentDisplayName, loadKanbanProfiles } from './kanban-agent-picker';
import { historyFromTasks, recommendAssignee, recommendationText, type AssigneeHistory, type AssigneeRecommendation } from './kanban-assignee-recommendation';
import { fetchKanbanOverview } from './kanban-overview';
/**
 * Shape the native Kanban create form without replacing its React submit/state logic.
 * Keep the fields needed to describe and schedule a task visible at the first level.
 */
const KANBAN_API = '/api/plugins/kanban';

type Project = { id: string; slug?: string; name?: string; primary_path?: string };

function boardFromLocation(): string { return new URLSearchParams(window.location.search).get('board') || ''; }
function api(path: string): string {
  const board = boardFromLocation();
  return board ? `${KANBAN_API}${path}${path.includes('?') ? '&' : '?'}board=${encodeURIComponent(board)}` : `${KANBAN_API}${path}`;
}
async function authedFetch(url: string): Promise<Response> {
  const sdk = (window as any).__HERMES_PLUGIN_SDK__;
  return sdk?.authedFetch ? sdk.authedFetch(url) : fetch(url, { credentials: 'same-origin' });
}

async function postJSON(url: string, value: unknown): Promise<any> {
  const sdk = (window as any).__HERMES_PLUGIN_SDK__;
  if (sdk?.fetchJSON) return sdk.fetchJSON(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  const response = await fetch(url, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

/** React-controlled native input update, preserving its validation and create request shape. */
function setReactValue(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function nativeWorkspaceControls(form: HTMLElement): { kind: HTMLSelectElement; path: HTMLInputElement | null } | null {
  const workspaceLabel = Array.from(form.querySelectorAll('label')).find(label => /workspace|工作区/i.test(label.textContent || ''));
  const row = workspaceLabel?.parentElement;
  const kind = row?.querySelector('select') as HTMLSelectElement | null;
  if (!kind) return null;
  return { kind, path: row?.querySelector('input') as HTMLInputElement | null };
}

async function projects(): Promise<Project[]> {
  const response = await authedFetch(api('/projects'));
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body.projects) ? body.projects.filter((project: Project) => project.primary_path) : [];
}

async function boardDefaultWorkspace(): Promise<string> {
  const response = await authedFetch(api('/boards'));
  if (!response.ok) return '';
  const body = await response.json();
  const slug = boardFromLocation() || body.current;
  const board = (body.boards || []).find((item: any) => item.slug === slug);
  return String(board?.default_workdir || '').trim();
}

function localizeDialogTitle(form: HTMLElement): void {
  const title = form.querySelector('.hermes-kanban-dialog-title');
  if (title?.textContent?.trim().startsWith('New task')) {
    title.textContent = title.textContent.replace(/^\s*New task/, sourceText("新建任务", "New job"));
  }
}

function applyResolvedColors(form: HTMLElement): void {
  const root = getComputedStyle(document.documentElement);
  const ink = root.getPropertyValue('--color-popover-foreground').trim()
    || root.getPropertyValue('--color-card-foreground').trim()
    || root.getPropertyValue('--midground').trim();
  const muted = root.getPropertyValue('--color-muted-foreground').trim() || ink;
  for (const element of Array.from(form.querySelectorAll<HTMLElement>(
    '.hti-kanban-create-workspace label, .hti-kanban-create-workspace select, .hti-kanban-create-body-label',
  ))) element.style.setProperty('color', ink, 'important');
  for (const element of Array.from(form.querySelectorAll<HTMLElement>('.hti-kanban-create-workspace p')))
    element.style.setProperty('color', muted, 'important');
}

function labelText(element: Element): string {
  return element.textContent?.replace(/\s+/g, ' ').trim() || '';
}

type AssigneeAssistant = { root: HTMLElement; value: () => string };

async function getUserJSON(url: string): Promise<any> {
  const sdk = (window as any).__HERMES_PLUGIN_SDK__;
  if (sdk?.fetchJSON) return sdk.fetchJSON(url);
  const response = await authedFetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Suggest an execution profile while the card is being written.
 *
 * The suggestion is prefilled only until the person touches the selector, so
 * typing a title never overwrites a deliberate choice.
 */
export function createAssigneeAssistant(
  form: HTMLElement,
  readIntent: () => { title: string; body: string },
): AssigneeAssistant {
  const root = document.createElement('div');
  root.className = 'hti-kanban-create-assignee';
  const label = document.createElement('label');
  label.textContent = sourceText("执行 Agent（智能推荐）", "Execution agent (suggested)");
  const select = document.createElement('select');
  select.setAttribute('aria-label', sourceText("选择执行 Agent", "Select execution agent"));
  const fallback = document.createElement('option');
  fallback.value = '';
  fallback.textContent = sourceText("交给调度器决定", "Let the dispatcher decide");
  select.append(fallback);
  const hint = document.createElement('p');
  hint.className = 'hti-kanban-recommendation';
  hint.hidden = true;
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'hti-kanban-apply-recommendation';
  apply.textContent = sourceText("使用推荐", "Use suggestion");
  apply.hidden = true;
  const note = document.createElement('p');
  note.className = 'hti-kanban-create-assignee-note';
  note.textContent = sourceText(
    "推荐依据标题、卡片要点和本看板的交付记录；可随时改写。",
    "Suggested from the title, card details, and this board's delivery record; you can change it.",
  );
  root.append(label, select, hint, apply, note);

  let profiles: string[] = [];
  let history: AssigneeHistory = {};
  let recommendation: AssigneeRecommendation | null = null;
  let touched = false;
  let timer = 0;

  const render = () => {
    const { title, body } = readIntent();
    recommendation = profiles.length
      ? recommendAssignee({ title, body, board: boardFromLocation(), profiles, history })
      : null;
    hint.hidden = !recommendation;
    hint.textContent = recommendation ? recommendationText(recommendation) : '';
    const current = recommendation;
    apply.hidden = !current || select.value === current.assignee;
    if (!touched && current && !select.value
      && Array.from(select.options).some(option => option.value === current.assignee)) {
      select.value = current.assignee;
    }
  };
  const schedule = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(render, 180);
  };

  select.addEventListener('change', () => {
    touched = true;
    apply.hidden = true;
  });
  apply.addEventListener('click', () => {
    if (!recommendation) return;
    select.value = recommendation.assignee;
    touched = true;
    apply.hidden = true;
  });
  // The title and card fields are siblings of this block, so listen on the form.
  form.addEventListener('input', schedule, true);
  form.addEventListener('change', schedule, true);

  void Promise.all([
    loadKanbanProfiles(getUserJSON, api('/profiles')).catch(() => [] as string[]),
    fetchKanbanOverview(boardFromLocation()).catch(() => null),
  ]).then(([names, overview]) => {
    profiles = names;
    history = historyFromTasks(overview?.tasks || []);
    for (const name of profiles) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = agentDisplayName(name);
      select.append(option);
    }
    render();
  });
  window.setTimeout(render, 0);
  return { root, value: () => select.value.trim() };
}

function installForm(form: HTMLElement): void {
  localizeDialogTitle(form);
  applyResolvedColors(form);
  if (form.dataset.htiCreateDialog === 'ready') return;
  const fields = form.querySelector('.flex.flex-col.gap-3') as HTMLElement | null;
  if (!fields || !fields.children.length) return;
  form.dataset.htiCreateDialog = 'ready';
  const titleField = fields.children[0] as HTMLElement;
  const existingBody = Array.from(fields.querySelectorAll('textarea')).find(node => !titleField.contains(node)) as HTMLTextAreaElement | undefined;
  // InlineCreate does not keep body in React state. Hide the legacy field and
  // submit the structured body directly through the Kanban API instead.
  if (existingBody) existingBody.hidden = true;
  const editor = createCardFields(cardDocumentFromBody(existingBody?.value || ''), { showReview: true });
  titleField.after(editor.root);

  // Keep priority, parent, goal mode, and the native workspace controls. The
  // old foldout's agent/skills/model fields are not task creation concerns.
  const keep = /priority|父任务|parent|目标模式|goal mode|workspace|工作区/i;
  for (const child of Array.from(fields.children).slice(1)) {
    if (child.classList.contains('hti-kanban-create-body-field') || child.querySelector('textarea')) continue;
    if (child === editor.root) continue;
    if (!keep.test(labelText(child))) child.remove();
  }

  const workspace = document.createElement('div');
  workspace.className = 'hti-kanban-create-workspace';
  const label = document.createElement('label');
  label.textContent = sourceText("工作区", "Workspace");
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', sourceText("选择工作区", "Select workspace"));
  const inherited = document.createElement('option');
  inherited.value = 'board-default'; inherited.textContent = sourceText("使用看板默认工作区", "Use board default workspace");
  const scratch = document.createElement('option');
  scratch.value = 'scratch'; scratch.textContent = sourceText("临时工作区（任务结束后清理）", "Temporary workspace (cleaned after the task)");
  picker.append(inherited, scratch);
  const note = document.createElement('p');
  note.textContent = sourceText("默认使用看板配置；如需其他项目，请从列表选择，无需手动输入路径。", "Use the board settings by default, or choose another project from the list without entering a path.");
  workspace.append(label, picker, note);
  titleField.after(workspace);

  const native = nativeWorkspaceControls(form);
  const initialKind = native?.kind.value || 'scratch';
  const initialPath = native?.path?.value || '';
  picker.addEventListener('change', () => {
    if (!native) return;
    const choice = picker.value;
    if (choice === 'board-default') {
      setReactValue(native.kind, initialKind);
      if (native.path) setReactValue(native.path, initialPath);
      return;
    }
    if (choice === 'scratch') { setReactValue(native.kind, 'scratch'); return; }
    const project = projectMap.get(choice);
    if (!project?.primary_path) return;
    setReactValue(native.kind, 'worktree');
    // React may add the path input only after workspace kind changes.
    window.setTimeout(() => {
      const refreshed = nativeWorkspaceControls(form);
      if (refreshed?.path) setReactValue(refreshed.path, project.primary_path || '');
    }, 0);
  });
  const projectMap = new Map<string, Project>();
  void boardDefaultWorkspace().then(path => {
    if (path) inherited.textContent = sourceText(`使用看板默认工作区（${path}）`, `Use board default workspace (${path})`);
  }).catch(() => undefined);
  void projects().then(rows => {
    for (const project of rows) {
      projectMap.set(project.id, project);
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name || project.slug || project.primary_path || project.id;
      picker.append(option);
    }
  }).catch(() => undefined);

  const cancelButton = () => Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => /^(cancel|取消)$/i.test(button.textContent?.trim() || ''));
  const createButton = () => Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => /^(create|创建)$/i.test(button.textContent?.trim() || ''));
  const titleInput = titleField.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input');
  const assigneeAssistant = createAssigneeAssistant(form, () => {
    const card = editor.read();
    return {
      title: titleInput?.value || '',
      body: [card.fields.background, card.fields.output, ...card.fields.acceptance, ...card.fields.boundaries].join('\n'),
    };
  });
  editor.root.after(assigneeAssistant.root);
  let busy = false;
  const submit = async () => {
    if (busy) return;
    const title = titleInput?.value.trim() || '';
    const card = editor.read();
    const errors = validateCardDocument(card);
    if (!title) errors.unshift(sourceText("请填写标题", "Title is required"));
    if (errors.length) { editor.showErrors(errors); return; }
    const payload: Record<string, any> = {
      title,
      body: renderCardDocument(card),
      priority: 0,
      triage: form.closest('[data-kanban-column]')?.getAttribute('data-kanban-column') === 'triage',
    };
    const assignee = Array.from(form.querySelectorAll<HTMLInputElement>('input')).find(input =>
      /assignee|specifier|负责人|分配/i.test(input.placeholder || ''));
    const chosenAgent = assigneeAssistant.value() || assignee?.value.trim() || '';
    if (chosenAgent) payload.assignee = chosenAgent;
    const numberInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type=number]'));
    const priority = numberInputs.find(input => /pri/i.test(input.placeholder || ''));
    if (priority?.value) payload.priority = Number(priority.value) || 0;
    const skills = Array.from(form.querySelectorAll<HTMLInputElement>('input')).find(input =>
      /skills/i.test(input.placeholder || ''));
    if (skills?.value.trim()) payload.skills = skills.value.split(',').map(value => value.trim()).filter(Boolean);
    const parent = form.querySelector<HTMLSelectElement>('select[title*="parent" i]');
    if (parent?.value) payload.parents = [parent.value];
    const workspaceKind = Array.from(form.querySelectorAll<HTMLSelectElement>('select')).find(select =>
      Array.from(select.options).some(option => option.value === 'worktree'));
    if (workspaceKind?.value && workspaceKind.value !== 'scratch') payload.workspace_kind = workspaceKind.value;
    const workspacePath = Array.from(form.querySelectorAll<HTMLInputElement>('input')).find(input =>
      /workspace path/i.test(input.placeholder || ''));
    if (workspacePath?.value.trim()) payload.workspace_path = workspacePath.value.trim();
    const goalMode = form.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (goalMode?.checked) {
      payload.goal_mode = true;
      const turns = numberInputs.find(input => /max turns/i.test(input.placeholder || ''));
      if (turns?.value) payload.goal_max_turns = Number(turns.value) || undefined;
    }
    busy = true;
    const button = createButton(); if (button) button.disabled = true;
    editor.setBusy(true);
    editor.showErrors([]);
    try {
      await postJSON(api('/tasks'), payload);
      cancelButton()?.click();
    } catch (error) {
      editor.showErrors([sourceText(`创建失败：${String(error)}`, `Create failed: ${String(error)}`)]);
      if (button) button.disabled = false;
      busy = false;
      editor.setBusy(false);
    }
  };
  form.addEventListener('click', event => {
    const button = (event.target as Element | null)?.closest('button');
    if (!button || !/^(create|创建)$/i.test(button.textContent?.trim() || '')) return;
    event.preventDefault(); event.stopPropagation(); void submit();
  }, true);
  form.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.target !== titleInput) return;
    event.preventDefault(); event.stopPropagation(); void submit();
  }, true);
  applyResolvedColors(form);
}

function inlineChoice(form: HTMLElement, match: (label: string) => boolean): HTMLButtonElement | undefined {
  return Array.from(form.querySelectorAll<HTMLButtonElement>('button[role="combobox"]'))
    .find(button => match(button.textContent?.trim() || ''));
}

function installInlineCreate(form: HTMLElement): void {
  if (form.dataset.htiCreateDialog === 'ready') return;
  const title = form.querySelector<HTMLTextAreaElement>('textarea');
  if (!title) return;
  form.dataset.htiCreateDialog = 'ready';
  const editor = createCardFields(cardDocumentFromBody(''), { showReview: true });
  title.after(editor.root);
  const assigneeAssistant = createAssigneeAssistant(form, () => {
    const card = editor.read();
    return {
      title: title.value || '',
      body: [card.fields.background, card.fields.output, ...card.fields.acceptance, ...card.fields.boundaries].join('\n'),
    };
  });
  editor.root.after(assigneeAssistant.root);
  const cancelButton = () => Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => /^(cancel|取消)$/i.test(button.textContent?.trim() || ''));
  let busy = false;
  const submit = async () => {
    if (busy) return;
    const card = editor.read();
    const errors = validateCardDocument(card);
    if (!title.value.trim()) errors.unshift(sourceText("请填写标题", "Title is required"));
    if (errors.length) { editor.showErrors(errors); return; }
    const payload: Record<string, any> = {
      title: title.value.trim(),
      body: renderCardDocument(card),
      priority: 0,
      triage: form.closest('[data-kanban-column]')?.getAttribute('data-kanban-column') === 'triage',
    };
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
    const assignee = inputs.find(input => /assignee|specifier/i.test(input.placeholder || ''));
    const chosenAgent = assigneeAssistant.value() || assignee?.value.trim() || '';
    if (chosenAgent) payload.assignee = chosenAgent;
    const priority = inputs.find(input => input.type === 'number' && /pri/i.test(input.placeholder || ''));
    if (priority?.value) payload.priority = Number(priority.value) || 0;
    const skills = inputs.find(input => /skills/i.test(input.placeholder || ''));
    if (skills?.value.trim()) payload.skills = skills.value.split(',').map(value => value.trim()).filter(Boolean);
    const workspace = inlineChoice(form, value => /^(scratch|worktree|dir)$/i.test(value));
    if (workspace && !/^scratch$/i.test(workspace.textContent?.trim() || '')) {
      payload.workspace_kind = workspace.textContent?.trim().toLowerCase();
      const path = inputs.find(input => /workspace path/i.test(input.placeholder || ''));
      if (path?.value.trim()) payload.workspace_path = path.value.trim();
    }
    const parent = inlineChoice(form, value => /^t_[a-z0-9]+/i.test(value) || /no parent|无父任务/i.test(value));
    const parentId = parent?.textContent?.trim().match(/^t_[a-z0-9]+/i)?.[0];
    if (parentId) payload.parents = [parentId];
    const goal = form.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (goal?.checked) {
      payload.goal_mode = true;
      const turns = inputs.find(input => /max turns/i.test(input.placeholder || ''));
      if (turns?.value) payload.goal_max_turns = Number(turns.value) || undefined;
    }
    busy = true; editor.setBusy(true); editor.showErrors([]);
    try {
      await postJSON(api('/tasks'), payload);
      cancelButton()?.click();
    } catch (error) {
      editor.showErrors([sourceText(`创建失败：${String(error)}`, `Create failed: ${String(error)}`)]);
      busy = false; editor.setBusy(false);
    }
  };
  form.addEventListener('click', event => {
    const button = (event.target as Element | null)?.closest('button');
    if (!button || !/^(create|创建)$/i.test(button.textContent?.trim() || '')) return;
    event.preventDefault(); event.stopPropagation(); void submit();
  }, true);
  form.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.target !== title) return;
    event.preventDefault(); event.stopPropagation(); void submit();
  }, true);
}

/** Reapply after the native React form mounts or re-renders. */
export function installKanbanCreateDialogBridge(): void {
  if ((window as any).__HERMES_WORKBENCH_CREATE_DIALOG_BRIDGE__) return;
  (window as any).__HERMES_WORKBENCH_CREATE_DIALOG_BRIDGE__ = true;
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      for (const form of Array.from(document.querySelectorAll('.hermes-kanban-create-dialog, .hermes-kanban-inline-create'))) {
        if (form.classList.contains('hermes-kanban-inline-create')) installInlineCreate(form as HTMLElement);
        else installForm(form as HTMLElement);
      }
    });
  };
  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
  // ThemeProvider writes CSS vars on <html style="…">; recolor any open form on switch.
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  refresh();
}
