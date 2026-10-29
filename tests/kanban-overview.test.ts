// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBoardOverview,
  applyCardProgress,
  fetchKanbanOverview,
  formatSuccessRate,
  kanbanOutcomeLabel,
  kanbanStageLabel,
  outcomeTone,
  successRateDetail,
  taskAttemptLabel,
  taskOutputText,
  type KanbanOverview,
  type KanbanTaskProgress,
} from '../dashboard/src/kanban-overview';

function boardFixture(): { columns: HTMLElement; card: HTMLElement } {
  document.body.innerHTML = `
    <div id="board">
      <div class="hermes-kanban-columns">
        <section data-kanban-column="running">
          <article class="hermes-kanban-card" data-task-id="t_one">
            <div class="hermes-kanban-card-content">
              <strong>Ship it</strong>
              <div class="hermes-kanban-card-meta">project-manager</div>
            </div>
          </article>
        </section>
      </div>
    </div>`;
  return {
    columns: document.querySelector<HTMLElement>('.hermes-kanban-columns')!,
    card: document.querySelector<HTMLElement>('.hermes-kanban-card')!,
  };
}

function overviewFixture(overrides: Partial<KanbanOverview> = {}): KanbanOverview {
  return {
    available: true,
    board: 'workbench',
    stats: {
      tasks_total: 4,
      by_status: { running: 1, blocked: 1, done: 2 },
      runs_total: 6,
      runs_completed: 3,
      runs_failed: 1,
      runs_in_flight: 1,
      runs_neutral: 1,
      success_rate: 0.75,
    },
    tasks: [{
      task_id: 't_one',
      title: 'Ship it',
      status: 'running',
      assignee: 'project-manager',
      summary: '',
      failure: '',
      run_count: 2,
      completed_runs: 1,
      failed_runs: 1,
      latest_run: { id: 9, status: 'running', outcome: 'crashed', summary: 'Worker exited', started_at: 1, ended_at: 2 },
    }],
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  vi.restoreAllMocks();
});

describe('Kanban board overview', () => {
  it('formats the delivery rate with the decisions behind it', () => {
    const stats = overviewFixture().stats!;
    expect(formatSuccessRate(stats)).toBe('75%');
    expect(successRateDetail(stats)).toBe('3/4 runs succeeded');
    expect(formatSuccessRate({ ...stats, success_rate: null })).toBe('—');
    expect(formatSuccessRate(null)).toBe('—');
  });

  it('localizes stages and outcomes without inventing labels', () => {
    document.documentElement.lang = 'en';
    expect(kanbanStageLabel('running')).toBe('Running');
    expect(kanbanOutcomeLabel('crashed')).toBe('Crashed');
    expect(kanbanStageLabel('custom')).toBe('custom');
    document.documentElement.lang = 'zh';
    expect(kanbanStageLabel('blocked')).toBe('已阻塞');
    expect(kanbanOutcomeLabel('timed_out')).toBe('超时');
  });

  it('prefers the delivered result, then the last run summary, then the failure', () => {
    const task = overviewFixture().tasks[0];
    expect(taskOutputText({ ...task, summary: 'Shipped the board overview' })).toBe('Shipped the board overview');
    expect(taskOutputText({ ...task, summary: '' })).toBe('Worker exited');
    expect(taskOutputText({ ...task, summary: '', latest_run: null, failure: 'Provider refused' })).toBe('Provider refused');
    expect(taskOutputText({ ...task, summary: '', latest_run: null, failure: '', status: 'blocked' })).toBe('');
    expect(taskOutputText({ ...task, status: 'blocked', failure: 'Provider refused' })).toBe('Provider refused');
    expect(taskAttemptLabel({ ...task, run_count: 2 })).toBe('run 2');
    expect(taskAttemptLabel({ ...task, run_count: 1 })).toBe('');
    expect(outcomeTone('running', task)).toBe('bad');
    expect(outcomeTone('running', { ...task, latest_run: null })).toBe('live');
    expect(outcomeTone('blocked', { ...task, latest_run: null })).toBe('warn');
  });

  it('renders one strip above the columns and hides it without a board database', () => {
    const { columns } = boardFixture();
    applyBoardOverview(columns, overviewFixture());
    const strip = columns.parentElement!.querySelector<HTMLElement>('.hti-kanban-overview')!;
    expect(strip.hidden).toBe(false);
    expect(strip.textContent).toContain('75%');
    expect(strip.textContent).toContain('3/4');
    expect(strip.textContent).toContain('Running 1');
    expect(strip.textContent).toContain('Blocked 1');
    expect(strip.textContent).toContain('Done 2');
    expect(strip.querySelector('[data-hti-success-rate]')?.getAttribute('data-hti-success-rate')).toBe('0.75');
    expect(columns.parentElement!.querySelectorAll('.hti-kanban-overview')).toHaveLength(1);

    applyBoardOverview(columns, overviewFixture({ stats: null, available: false }));
    expect(strip.hidden).toBe(true);
    expect(strip.textContent).toBe('');
  });

  it('adds one stage chip and one result line per card, idempotently', () => {
    const { card } = boardFixture();
    const task = overviewFixture().tasks[0];
    applyCardProgress(card, task);
    applyCardProgress(card, task);
    const content = card.querySelector('.hermes-kanban-card-content')!;
    expect(content.querySelectorAll('.hti-kanban-stage')).toHaveLength(1);
    expect(content.querySelectorAll('.hti-kanban-result')).toHaveLength(1);
    const stage = content.querySelector<HTMLElement>('.hti-kanban-stage')!;
    expect(stage.textContent).toContain('Running');
    expect(stage.textContent).toContain('Crashed');
    expect(stage.textContent).toContain('run 2');
    expect(stage.dataset.htiTone).toBe('bad');
    expect(content.querySelector('.hti-kanban-result')!.textContent).toBe('Worker exited');

    applyCardProgress(card, undefined);
    expect(content.querySelector('.hti-kanban-stage')).toBeNull();
    expect(content.querySelector('.hti-kanban-result')).toBeNull();
  });

  it('rejects a mismatched board and keeps a missing sidecar quiet', async () => {
    const payload = overviewFixture();
    const request = vi.fn(async () => ({ ok: true, json: async () => payload }) as any);
    expect((await fetchKanbanOverview('workbench', request as any))?.stats?.success_rate).toBe(0.75);
    expect(await fetchKanbanOverview('other', request as any)).toBeNull();

    const failed = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as any);
    expect(await fetchKanbanOverview('workbench', failed as any)).toBeNull();
    const offline = vi.fn(async () => { throw new Error('offline'); }) as any;
    expect(await fetchKanbanOverview('workbench', offline)).toBeNull();
    const malformed = vi.fn(async () => ({ ok: true, json: async () => ({ board: 'workbench' }) }) as any);
    expect(await fetchKanbanOverview('workbench', malformed as any)).toBeNull();
  });
});
