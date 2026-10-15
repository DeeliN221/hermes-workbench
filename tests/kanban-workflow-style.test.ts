// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutKanbanDrawer } from '../dashboard/src/kanban-drawer-layout';
vi.mock('../dashboard/src/kanban-session-api', () => ({ listKanbanSessions: vi.fn(async () => [{ task_id: 't1', board: 'money', profile: 'finance-advisor', session_id: 's1' }]) }));
const detail = { task: { id: 't1', assignee: 'finance-advisor', status: 'blocked', last_failure_error: 'real failure', consecutive_failures: 2 }, runs: [{ id: 1, started_at: 1, status: 'crashed', error: 'original <script>unsafe</script>' }, { id: 2, started_at: 2, status: 'done', summary: 'actual outcome' }] };
function fixture() {
 window.history.replaceState({}, '', '/kanban?board=money');
 const drawer = document.createElement('section'); drawer.className = 'hermes-kanban-drawer';
 drawer.innerHTML = `<div class="hermes-kanban-drawer-head"><span>t1</span></div><div class="hermes-kanban-drawer-body">
 <div class="hermes-kanban-drawer-title">Original title</div>
 <div class="hermes-kanban-section"><div class="hermes-kanban-section-head">Description</div><textarea>Keep this unsaved draft</textarea></div>
 <div class="hermes-kanban-section"><div class="hermes-kanban-section-head">Attachments (2)</div><input type="file"></div>
 <div class="hermes-kanban-section"><div class="hermes-kanban-section-head">Comments (1)</div><p>original comment</p></div>
 <div class="hermes-kanban-section"><div class="hermes-kanban-section-head">Run history (2)</div>native history</div>
 <div class="hermes-kanban-section"><div class="hermes-kanban-section-head">Dependencies</div><button>native action</button></div>
 </div><div class="hermes-kanban-drawer-comment-foot"><div class="hermes-kanban-drawer-comment-row"><input><button>Comment</button></div></div>`;
 document.body.append(drawer); return drawer;
}
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('V4 native drawer progressive disclosure', () => {
 it('preserves native editable nodes and drafts through tabs and native updates, keeps comments in footer', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__HERMES_PLUGIN_SDK__', { fetchJSON: vi.fn(async () => detail) });
  const d = fixture(); const textarea = d.querySelector('textarea')!; const click = vi.fn(); d.querySelector('button')!.onclick = click;
  layoutKanbanDrawer(d); await vi.advanceTimersByTimeAsync(200);
  expect(d.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Overview');
  d.querySelector<HTMLButtonElement>('[data-tab=files]')!.click();
  expect(textarea.parentElement!.hidden).toBe(true); expect(d.querySelector('input[type=file]')!.parentElement!.hidden).toBe(false);
  d.querySelector<HTMLButtonElement>('[data-tab=settings]')!.click(); d.querySelector<HTMLElement>('[data-wb-panel=settings] button')!.click(); expect(click).toHaveBeenCalledOnce();
  d.querySelector<HTMLButtonElement>('[data-tab=overview]')!.click(); layoutKanbanDrawer(d);
  expect(d.querySelector('textarea')).toBe(textarea); expect(textarea.value).toBe('Keep this unsaved draft');
  expect(d.querySelectorAll('[role=tablist]')).toHaveLength(1);
  expect(d.querySelector('.hermes-kanban-drawer-comment-foot .wb-comments')?.textContent).toContain('original comment');
  const summaries = d.querySelectorAll('.wb-run-heading'); expect(summaries[0].textContent).toContain('Run 2');
  expect(d.querySelector('.wb-runs script')).toBeNull(); expect(d.querySelector('.wb-runs')?.textContent).toContain('<script>unsafe</script>');
  expect(d.querySelector('.wb-task-alert')?.textContent).toContain('real failure');
  d.querySelector<HTMLButtonElement>('[data-tab=sessions]')!.click(); await Promise.resolve(); await Promise.resolve();
  expect(d.querySelector('.wb-session-link')?.getAttribute('href')).toContain('session=s1');
 });
 it('retains native history when source loading fails and recovers with retry without mutating task data', async () => {
  vi.useFakeTimers(); const fetch = vi.fn().mockRejectedValueOnce(Error('503')).mockResolvedValue(detail); vi.stubGlobal('__HERMES_PLUGIN_SDK__', { fetchJSON: fetch });
  const d = fixture(); layoutKanbanDrawer(d); await vi.advanceTimersByTimeAsync(200);
  expect(d.dataset.wbHistoryLoaded).toBeUndefined(); expect(d.querySelector('.wb-runs')?.textContent).toContain('503');
  d.querySelector<HTMLButtonElement>('.wb-runs button')!.click(); await Promise.resolve(); await Promise.resolve();
  expect(d.dataset.wbHistoryLoaded).toBe('true'); expect(fetch.mock.calls.every(call => call.length === 1)).toBe(true);
 });
});
