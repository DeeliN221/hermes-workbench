import type { FetchJSON } from './workbench-api';
import { scoped, sessionURL, type RuntimeSnapshot } from './runtime-client';
import type { Task } from './task-control-model';

/** Fleet can embed its execution envelope inside summary; show the actual prompt. */
export function fleetPrompt(summary: string | undefined): string {
  if (!summary) return '';
  try {
    const value = JSON.parse(summary);
    if (value && typeof value.prompt === 'string' && Object.keys(value).every(key => ['prompt', 'model', 'reasoning_effort'].includes(key))) return value.prompt;
  } catch { /* Plain text is already the user-visible prompt. */ }
  return summary;
}

export function createStandaloneTaskContext(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }) {
  const h = sdk.React.createElement;
  return function StandaloneTaskContext({ task, navigate }: { task: Task; navigate(path: string, profile: string): void }) {
    const origin = task.origin;
    const [result, setResult] = sdk.hooks.useState(''), [error, setError] = sdk.hooks.useState(''), [verified, setVerified] = sdk.hooks.useState(false);
    sdk.hooks.useEffect(() => {
      const controller = new AbortController(); let pending = false;
      setVerified(false); setResult(''); setError('');
      if (!origin || origin.runtime !== 'dsh') return () => controller.abort();
      const load = async () => {
        if (pending) return; pending = true;
        try {
          const snapshot = await sdk.fetchJSON<RuntimeSnapshot>(scoped(sessionURL(origin.profile_id, origin.session_id) + '/snapshot', origin.profile_id), { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (snapshot.session?.id !== origin.session_id || snapshot.session.profile_id !== origin.profile_id || snapshot.session.project_id !== origin.project_id) throw new Error('DSH task origin was not confirmed');
          setVerified(true); setError('');
          setResult(snapshot.deliveries?.filter(value => value.source === 'fleet' && value.task_id === task.id && (!task.attempt_id || value.attempt_id === task.attempt_id) && (task.epoch === undefined || value.epoch === task.epoch) && typeof value.content === 'string').at(-1)?.content || '');
        } catch (error) { if (!controller.signal.aborted) { setVerified(false); setError(String(error)); } }
        finally { pending = false; }
      };
      void load(); const timer = setInterval(load, 3000);
      return () => { controller.abort(); clearInterval(timer); };
    }, [task.id, origin?.profile_id, origin?.session_id, task.attempt_id, task.epoch]);
    return h('section', { className: 'tower-sessions', 'aria-label': 'DSH task origin and result' },
      h('h3', null, 'Original DSH conversation'),
      h('button', { type: 'button', disabled: !verified, onClick: () => origin && navigate(`/chat?profile=${encodeURIComponent(origin.profile_id)}&session=${encodeURIComponent(origin.session_id)}`, origin.profile_id) }, 'Open source conversation'),
      error ? h('p', { role: 'alert' }, error) : null,
      result ? h('section', { 'aria-label': 'Persisted Fleet result' }, h('h4', null, 'Fleet notification'), h('p', { style: { whiteSpace: 'pre-wrap' } }, result))
        : h('p', { role: 'status' }, verified ? 'No persisted result notification yet.' : 'Verifying the owned conversation…'));
  };
}
