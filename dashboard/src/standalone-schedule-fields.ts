import type { FetchJSON } from './workbench-api';
import type { CronForm } from './cron-api';
export function createScheduleRuntimeFields(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }) {
  const h = sdk.React.createElement;
  return function ScheduleRuntimeFields({ form, onChange, profile }: { form: CronForm; onChange(changes: Partial<CronForm>): void; profile: string }) {
    const [sessions, setSessions] = sdk.hooks.useState([] as { id: string; title?: string }[]), [error, setError] = sdk.hooks.useState('');
    sdk.hooks.useEffect(() => { let active = true; void sdk.fetchJSON<{ id: string; title?: string }[]>('/api/runtime/sessions?profile_id=' + encodeURIComponent(profile)).then(value => { if (active) setSessions(value); }).catch(error => { if (active) setError(String(error)); }); return () => { active = false; }; }, [profile]);
    return h('fieldset', { className: 'standalone-schedule-fields' }, h('legend', null, 'Runtime and delivery'),
      h('label', null, 'Execution', h('select', { 'aria-label': 'Scheduled execution', value: form.execution || 'background', onChange: (event: any) => onChange({ execution: event.target.value }) }, h('option', { value: 'background' }, 'Background Fleet task'), h('option', { value: 'foreground' }, 'Foreground DSH input'))),
      h('label', null, 'Timezone', h('input', { 'aria-label': 'Schedule timezone', value: form.timezone || 'UTC', onChange: (event: any) => onChange({ timezone: event.target.value }) })),
      h('label', null, 'Conversation', h('select', { 'aria-label': 'Scheduled conversation', value: form.session_id || '', onChange: (event: any) => onChange({ session_id: event.target.value, attach_to_session: !!event.target.value }) }, h('option', { value: '' }, 'Create a new owned DSH conversation'), sessions.map((session: { id: string; title?: string }) => h('option', { key: session.id, value: session.id }, session.title || session.id)))),
      error ? h('p', { role: 'alert' }, error) : null);
  };
}
