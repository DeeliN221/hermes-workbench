import { uiText as sourceText } from './ui-locale';
/**
 * Board-level delivery progress for the native Kanban page.
 *
 * One bounded request feeds a compact statistics strip and per-card stage and
 * result summaries, so a phone reader sees progress without opening worker logs.
 * The strip degrades to nothing when the sidecar has no board database.
 */

const WORKBENCH_API = '/api/plugins/workbench';
const POLL_INTERVAL_MS = 12_000;
const EMPTY_RETRY_MS = 30_000;
const SUMMARY_LIMIT = 180;

export type KanbanRun = {
  id: number;
  status: string;
  outcome: string;
  summary: string;
  started_at: number | null;
  ended_at: number | null;
};

export type KanbanTaskProgress = {
  task_id: string;
  title: string;
  status: string;
  assignee: string;
  summary: string;
  failure: string;
  run_count: number;
  completed_runs: number;
  failed_runs: number;
  latest_run: KanbanRun | null;
};

export type KanbanBoardStats = {
  tasks_total: number;
  by_status: Record<string, number>;
  runs_total: number;
  runs_completed: number;
  runs_failed: number;
  runs_in_flight: number;
  runs_neutral: number;
  success_rate: number | null;
};

export type KanbanOverview = {
  available: boolean;
  board: string;
  stats: KanbanBoardStats | null;
  tasks: KanbanTaskProgress[];
};

const STAGE_LABELS: Record<string, [string, string]> = {
  triage: ['待分类', 'Triage'],
  todo: ['待办', 'Todo'],
  scheduled: ['已排期', 'Scheduled'],
  ready: ['就绪', 'Ready'],
  running: ['进行中', 'Running'],
  blocked: ['已阻塞', 'Blocked'],
  review: ['待审核', 'Review'],
  done: ['已完成', 'Done'],
  archived: ['已归档', 'Archived'],
};

const OUTCOME_LABELS: Record<string, [string, string]> = {
  completed: ['成功', 'Completed'],
  crashed: ['崩溃', 'Crashed'],
  gave_up: ['放弃', 'Gave up'],
  timed_out: ['超时', 'Timed out'],
  spawn_failed: ['启动失败', 'Spawn failed'],
  blocked: ['阻塞', 'Blocked'],
  review_requested: ['待审核', 'Review'],
  changes_requested: ['待修改', 'Changes requested'],
  reclaimed: ['已回收', 'Reclaimed'],
};

function chinese(): boolean {
  return document.documentElement.lang.toLowerCase().startsWith('zh');
}

function pairLabel(pairs: Record<string, [string, string]>, key: string): string {
  const pair = pairs[String(key || '').toLowerCase()];
  if (!pair) return String(key || '');
  return pair[chinese() ? 0 : 1];
}

export function kanbanStageLabel(status: string): string {
  return pairLabel(STAGE_LABELS, status);
}

export function kanbanOutcomeLabel(outcome: string): string {
  return pairLabel(OUTCOME_LABELS, outcome);
}

/** Fixed board selection mirroring the native page; URL wins over storage. */
export function kanbanBoardFromLocation(): string {
  const explicit = new URLSearchParams(window.location.search).get('board')?.trim();
  if (explicit) return explicit;
  try {
    return (window.localStorage.getItem('hermes.kanban.selectedBoard') || '').trim();
  } catch {
    return '';
  }
}

/** Compact percentage with the decisions behind it, or a dash before any run. */
export function formatSuccessRate(stats: KanbanBoardStats | null | undefined): string {
  const rate = stats?.success_rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, rate)) * 100)}%`;
}

export function successRateDetail(stats: KanbanBoardStats | null | undefined): string {
  if (!stats) return '';
  const decided = stats.runs_completed + stats.runs_failed;
  return sourceText(`${stats.runs_completed}/${decided} 次运行成功`, `${stats.runs_completed}/${decided} runs succeeded`);
}

function truncate(text: string, limit = SUMMARY_LIMIT): string {
  const points = Array.from(text);
  return points.length > limit ? `${points.slice(0, limit - 1).join('').trimEnd()}…` : text;
}

/** Prefer the delivered result, then the last run summary, then the failure. */
export function taskOutputText(task: KanbanTaskProgress): string {
  const delivered = String(task.summary || '').trim();
  if (delivered) return truncate(delivered);
  const failure = String(task.failure || '').trim();
  // A blocked card is waiting on a decision or a failure, so lead with it.
  if (failure && String(task.status || '').toLowerCase() === 'blocked') return truncate(failure);
  const runSummary = String(task.latest_run?.summary || '').trim();
  if (runSummary) return truncate(runSummary);
  return failure ? truncate(failure) : '';
}

export function taskAttemptLabel(task: KanbanTaskProgress): string {
  if (task.run_count <= 1) return '';
  return sourceText(`第 ${task.run_count} 次运行`, `run ${task.run_count}`);
}

export function outcomeTone(status: string, task: KanbanTaskProgress): 'ok' | 'warn' | 'bad' | 'live' {
  const outcome = String(task.latest_run?.outcome || '').toLowerCase();
  if (outcome === 'completed') return 'ok';
  if (['crashed', 'gave_up', 'spawn_failed', 'timed_out'].includes(outcome)) return 'bad';
  if (status === 'blocked' || outcome === 'blocked') return 'warn';
  return status === 'running' ? 'live' : 'warn';
}

/** One request for the whole board; a missing sidecar degrades quietly. */
export async function fetchKanbanOverview(board: string, request: typeof fetch = fetch): Promise<KanbanOverview | null> {
  try {
    const response = await request(`${WORKBENCH_API}/kanban-overview`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload || typeof payload.available !== 'boolean') return null;
    if (board && String(payload.board || '') !== board) return null;
    return {
      available: payload.available,
      board: String(payload.board || board),
      stats: payload.stats || null,
      tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
    };
  } catch {
    return null;
  }
}

function ensureStrip(columns: HTMLElement): HTMLElement | null {
  const parent = columns.parentElement;
  if (!parent) return null;
  const existing = parent.querySelector<HTMLElement>(':scope > .hti-kanban-overview');
  if (existing) return existing;
  const strip = document.createElement('div');
  strip.className = 'hti-kanban-overview';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', sourceText('看板进度', 'Board progress'));
  parent.insertBefore(strip, columns);
  return strip;
}

function chip(text: string, modifier: string): HTMLElement {
  const element = document.createElement('span');
  element.className = `hti-kanban-overview-chip ${modifier}`;
  element.textContent = text;
  return element;
}

/** Render one compact stats strip above the columns; idempotent per update. */
export function applyBoardOverview(columns: HTMLElement, overview: KanbanOverview | null): void {
  const strip = ensureStrip(columns);
  if (!strip) return;
  if (!overview?.available || !overview.stats) {
    strip.hidden = true;
    strip.replaceChildren();
    return;
  }
  const stats = overview.stats;
  const byStatus = stats.by_status || {};
  strip.hidden = false;
  strip.dataset.htiBoard = overview.board;
  const rate = document.createElement('span');
  rate.className = 'hti-kanban-overview-rate';
  rate.dataset.htiSuccessRate = String(stats.success_rate == null ? '' : stats.success_rate);
  const value = document.createElement('strong');
  value.textContent = formatSuccessRate(stats);
  const label = document.createElement('span');
  label.textContent = sourceText('交付成功率', 'Delivery success');
  rate.append(value, label);

  const detail = document.createElement('span');
  detail.className = 'hti-kanban-overview-detail';
  detail.textContent = successRateDetail(stats);

  const chips: HTMLElement[] = [];
  if (byStatus.running) chips.push(chip(sourceText(`进行中 ${byStatus.running}`, `Running ${byStatus.running}`), 'live'));
  if (byStatus.blocked) chips.push(chip(sourceText(`阻塞 ${byStatus.blocked}`, `Blocked ${byStatus.blocked}`), 'warn'));
  if (byStatus.review) chips.push(chip(sourceText(`待审核 ${byStatus.review}`, `Review ${byStatus.review}`), 'warn'));
  if (byStatus.done) chips.push(chip(sourceText(`已完成 ${byStatus.done}`, `Done ${byStatus.done}`), 'ok'));

  strip.replaceChildren(rate, detail, ...chips);
  strip.title = sourceText(
    `共 ${stats.tasks_total} 张卡片，${stats.runs_total} 次运行；进行中 ${stats.runs_in_flight}`,
    `${stats.tasks_total} cards, ${stats.runs_total} runs; ${stats.runs_in_flight} in flight`,
  );
}

function cardContent(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>('.hermes-kanban-card-content');
}

/** Add the stage chip and the delivered-result line to one card; idempotent. */
export function applyCardProgress(card: HTMLElement, task: KanbanTaskProgress | undefined): void {
  const content = cardContent(card);
  if (!content) return;
  const status = card.closest<HTMLElement>('[data-kanban-column]')?.dataset.kanbanColumn
    || task?.status
    || '';
  if (!task) {
    content.querySelector('.hti-kanban-stage')?.remove();
    content.querySelector('.hti-kanban-result')?.remove();
    return;
  }
  const meta = content.querySelector('.hermes-kanban-card-meta');
  let stage = content.querySelector<HTMLElement>('.hti-kanban-stage');
  if (!stage) {
    stage = document.createElement('span');
    stage.className = 'hti-kanban-stage';
    content.insertBefore(stage, meta);
  }
  const attempt = taskAttemptLabel(task);
  const outcome = String(task.latest_run?.outcome || '').toLowerCase();
  const parts = [kanbanStageLabel(status || task.status)];
  if (outcome) parts.push(kanbanOutcomeLabel(outcome));
  if (attempt) parts.push(attempt);
  const stageText = parts.filter(Boolean).join(' · ');
  if (stage.textContent !== stageText) stage.textContent = stageText;
  stage.dataset.htiStage = status || task.status;
  stage.dataset.htiTone = outcomeTone(status || task.status, task);
  stage.title = sourceText(
    `阶段：${kanbanStageLabel(status || task.status)}；运行 ${task.completed_runs}/${task.run_count} 成功`,
    `Stage: ${kanbanStageLabel(status || task.status)}; ${task.completed_runs}/${task.run_count} runs succeeded`,
  );

  const output = taskOutputText(task);
  let result = content.querySelector<HTMLElement>('.hti-kanban-result');
  const showResult = Boolean(output) && (task.summary || task.failure || task.latest_run?.summary);
  if (!showResult) {
    result?.remove();
    return;
  }
  if (!result) {
    result = document.createElement('p');
    result.className = 'hti-kanban-result';
    content.insertBefore(result, meta);
  }
  if (result.textContent !== output) result.textContent = output;
  result.dataset.htiTone = task.failure && !task.summary ? 'bad' : 'ok';
  result.title = output;
}

/** Read the authoritative board state once for the current page. */
export async function refreshKanbanOverview(request: typeof fetch = fetch): Promise<KanbanOverview | null> {
  const board = kanbanBoardFromLocation();
  const overview = await fetchKanbanOverview(board, request);
  if (kanbanBoardFromLocation() !== board) return null;
  applyOverviewToPage(overview);
  return overview;
}

function boardColumns(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.hermes-kanban-columns'));
}

function applyOverviewToPage(overview: KanbanOverview | null): void {
  for (const columns of boardColumns()) applyBoardOverview(columns, overview);
  const byId = new Map((overview?.tasks || []).map(task => [task.task_id, task]));
  for (const card of Array.from(document.querySelectorAll<HTMLElement>('.hermes-kanban-card[data-task-id]'))) {
    applyCardProgress(card, byId.get(card.dataset.taskId || ''));
  }
}

/** Install one throttled poller; no PTY, socket, or per-card request. */
export function installKanbanBoardOverview(): void {
  if ((window as any).__HERMES_WORKBENCH_KANBAN_OVERVIEW__) return;
  (window as any).__HERMES_WORKBENCH_KANBAN_OVERVIEW__ = true;
  let timer = 0;
  let frame = 0;
  let polling = false;
  let currentBoard = '';
  let cached: KanbanOverview | null = null;
  let nextFetchAt = 0;

  const poll = async () => {
    timer = 0;
    if (document.hidden || polling) return;
    if (!window.location.pathname.includes('kanban')) {
      schedule();
      return;
    }
    polling = true;
    try {
      const board = kanbanBoardFromLocation();
      if (board !== currentBoard) {
        currentBoard = board;
        cached = null;
        nextFetchAt = 0;
      }
      if (Date.now() >= nextFetchAt) {
        nextFetchAt = Date.now() + POLL_INTERVAL_MS;
        const fresh = await fetchKanbanOverview(board, fetch);
        if (kanbanBoardFromLocation() !== board) return;
        cached = fresh;
        nextFetchAt = Date.now() + (fresh?.available ? POLL_INTERVAL_MS : EMPTY_RETRY_MS);
      }
      applyOverviewToPage(cached);
    } finally {
      polling = false;
      schedule();
    }
  };

  const schedule = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
  };
  const scheduleFrame = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (cached) applyOverviewToPage(cached);
      else if (!polling && Date.now() >= nextFetchAt) void poll();
    });
  };
  new MutationObserver(scheduleFrame).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', scheduleFrame);
  window.addEventListener('popstate', scheduleFrame);
  scheduleFrame();
}
