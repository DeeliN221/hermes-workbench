import type { FetchJSON } from './workbench-api';
import { scoped, sessionURL } from './runtime-client';

type Task = { message: string; receipt: { task_id: string; status: string; origin: Record<string, string> } };
export function createRuntimeTaskReceipts(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }) {
  const h = sdk.React.createElement;
  return function RuntimeTaskReceipts({ profile, session }: { profile: string; session: string }) {
    const [tasks, setTasks] = sdk.hooks.useState([] as Task[]);
    const [error, setError] = sdk.hooks.useState('');
    sdk.hooks.useEffect(() => {
      let active = true;
      const load = () => sdk.fetchJSON<{ tasks: Task[] }>(scoped(sessionURL(profile, session) + '/tasks', profile))
        .then(value => { if (active) { setTasks(value.tasks); setError(''); } })
        .catch(error => { if (active) setError(String(error)); });
      void load();
      window.addEventListener('workbench:background-task', load);
      return () => { active = false; window.removeEventListener('workbench:background-task', load); };
    }, [profile, session]);
    return h('section', { className: 'runtime-task-receipts', 'aria-label': 'Background tasks' },
      error ? h('p', { role: 'alert' }, error) : null,
      tasks.map((task: Task) => h('article', { key: task.receipt.task_id, className: 'codex-process-group' },
        h('p', null, task.message), h('p', { role: 'status' }, 'Background task · ', task.receipt.status),
        h('a', { href: `/kanban?profile=${encodeURIComponent(profile)}&task=${encodeURIComponent(task.receipt.task_id)}` }, 'Fleet task ', task.receipt.task_id))));
  };
}
