import type { FetchJSON } from './workbench-api';
import { scoped, sessionURL } from './runtime-client';

type Task = { message: string; receipt: { task_id: string; status: string; origin: Record<string, string> }; current?: { status?: string; revision?: number }; status_error?: string };
export function createRuntimeTaskReceipts(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }) {
  const h = sdk.React.createElement;
  function TaskCard({ task, profile, session, refresh }: { task: Task; profile: string; session: string; refresh(): void }) {
    const [text, setText] = sdk.hooks.useState(''), [notice, setNotice] = sdk.hooks.useState(''), [busy, setBusy] = sdk.hooks.useState(false);
    const messageId = sdk.hooks.useRef('');
    const endpoint = scoped(`/api/plugins/workbench/fleet/tasks/${encodeURIComponent(task.receipt.task_id)}`, profile) + '&session_id=' + encodeURIComponent(session);
    const status = task.current?.status || task.receipt.status;
    async function submit(action: string) {
      if (busy) return;
      setBusy(true); setNotice('');
      if (!messageId.current) messageId.current = crypto.randomUUID();
      try {
        await sdk.fetchJSON(endpoint.replace('?','/' + action + '?'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'messages' ? { message_id: messageId.current, text } : { request_id: messageId.current, revision: task.current?.revision }) });
        if (action === 'messages') setText('');
        messageId.current = ''; setNotice(action === 'messages' ? 'Follow-up accepted by this task.' : 'Task action accepted.'); refresh();
      } catch (error) { setNotice(String(error)); } finally { setBusy(false); }
    }
    return h('article', { className: 'runtime-task-card', 'data-task-id': task.receipt.task_id },
      h('p', null, task.message), h('p', { role: 'status' }, 'Background task · ', status),
      h('a', { href: `/kanban?profile=${encodeURIComponent(profile)}&task=${encodeURIComponent(task.receipt.task_id)}` }, 'Fleet task ', task.receipt.task_id),
      task.status_error ? h('p', { role: 'alert' }, task.status_error) : null,
      h('form', { onSubmit: (event: Event) => { event.preventDefault(); void submit('messages'); } },
        h('label', null, 'Task follow-up', h('textarea', { rows: 2, 'aria-label': 'Task follow-up', value: text, disabled: busy, onChange: (event: any) => { messageId.current = ''; setText(event.target.value); } })),
        h('button', { type: 'submit', disabled: busy || !text.trim() }, 'Send to task')),
      h('div', { className: 'standalone-actions' },
        h('button', { type: 'button', disabled: busy || ['done','review','completed','failed','cancelled','canceled','archived'].includes(status), onClick: () => submit('cancel') }, 'Stop task'),
        h('button', { type: 'button', disabled: busy || !['failed','cancelled','canceled','blocked'].includes(status), onClick: () => submit('retry') }, 'Retry task')),
      notice ? h('p', { role: /Error|409|rejected/i.test(notice) ? 'alert' : 'status' }, notice) : null);
  }
  return function RuntimeTaskReceipts({ profile, session }: { profile: string; session: string }) {
    const [tasks, setTasks] = sdk.hooks.useState([] as Task[]), [error, setError] = sdk.hooks.useState(''), [revision, setRevision] = sdk.hooks.useState(0);
    sdk.hooks.useEffect(() => {
      let active = true, pending = false;
      const load = async () => {
        if (pending) return; pending = true;
        try { const value = await sdk.fetchJSON<{ tasks: Task[] }>(scoped(sessionURL(profile, session) + '/tasks', profile)); if (active) { setTasks(value.tasks); setError(''); } }
        catch (error) { if (active) setError(String(error)); } finally { pending = false; }
      };
      void load(); const timer = setInterval(load, 2000);
      window.addEventListener('workbench:background-task', load);
      return () => { active = false; clearInterval(timer); window.removeEventListener('workbench:background-task', load); };
    }, [profile, session, revision]);
    return h('section', { className: 'runtime-task-receipts', 'aria-label': 'Background tasks' },
      error ? h('p', { role: 'alert' }, error) : null,
      tasks.map((task: Task) => h(TaskCard, { key: task.receipt.task_id, task, profile, session, refresh: () => setRevision((n: number) => n + 1) })));
  };
}
