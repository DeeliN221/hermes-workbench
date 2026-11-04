/** Independent bounded sources: a Fleet failure must not hide conversations. */
import type { FetchJSON } from './workbench-api';
import { fleetAPI } from './task-control-api';
import { specMarkdown } from './task-control-model';
import { searchAllProfiles, type SearchOptions, type SearchResult, type SearchSnapshot } from './session-search-api';
import { uiText as text } from './ui-locale';

export async function searchWorkbench(read: FetchJSON, profile: string, query: string, options: SearchOptions = {}): Promise<SearchSnapshot> {
  if (!query.trim()) return { results: [], failures: [], complete: true, timedOut: false };
  let sessions: SearchSnapshot = { results: [], failures: [], complete: false, timedOut: false };
  let tasks: SearchResult[] = [], taskFailure = '', taskDone = false;
  const snapshot = (): SearchSnapshot => ({
    results: [...tasks, ...sessions.results],
    failures: [...sessions.failures, ...(taskFailure ? [taskFailure] : [])],
    complete: sessions.complete && taskDone, timedOut: sessions.timedOut,
  });
  const publish = () => { if (!options.signal?.aborted) options.onUpdate?.(snapshot()); };
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new Error(text('任务搜索超时，请重试', 'Task search timed out. Retry.'))), options.totalTimeoutMs ?? 4800);
  const aborted = new Promise<never>((_, reject) => {
    const stop = () => reject(controller.signal.reason || new DOMException('Search aborted', 'AbortError'));
    if (controller.signal.aborted) stop();
    else controller.signal.addEventListener('abort', stop, { once: true });
  });
  const taskSearch = (async () => {
    try {
      // The same authenticated API used by the task board; includes archived tasks.
      const page = await Promise.race([fleetAPI(read).search(query.trim(), false, '', controller.signal), aborted]);
      if (!Array.isArray(page.tasks)) throw new Error(text('任务搜索返回无效数据', 'Invalid task search response'));
      tasks = page.tasks.slice(0, 100).map(task => ({
        id: task.id, profile: '', kind: 'task', title: task.title || task.id,
        snippet: specMarkdown(task), groupName: task.repo, updatedAt: task.updated_at || task.created_at, task,
      }));
    } catch (error) {
      taskFailure = `Fleet · ${error instanceof Error ? error.message : text('任务搜索失败', 'Task search failed')}`;
    } finally { taskDone = true; publish(); }
  })();
  try {
    await Promise.all([
      searchAllProfiles(read, profile, query, { ...options, onUpdate: value => { sessions = value; publish(); } })
        .then(value => { sessions = value; }),
      taskSearch,
    ]);
    if (options.signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
    return snapshot();
  } finally {
    clearTimeout(timer); controller.abort(); options.signal?.removeEventListener('abort', cancel);
  }
}
