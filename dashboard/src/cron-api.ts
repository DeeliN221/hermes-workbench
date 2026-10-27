/** Translate host cron responses and editor forms at a single typed boundary. */
import type { FetchJSON } from './workbench-api';
import { record, rows, text, type JsonRecord } from './api-values';
import { uiText } from './ui-locale';
const API = '/api/cron';
const EXTENDED_API = '/api/plugins/workbench-cron';
const encode = encodeURIComponent;
const profileQuery = (profile: string) => `profile=${encode(profile || 'default')}`;
export interface CronForm {
  name: string; prompt: string; schedule: string; deliver: string; failure_deliver: string;
  skills: string; model: string; provider: string; base_url: string; script: string;
  no_agent: boolean; context_from: string; enabled_toolsets: string; workdir: string;
  continuity: boolean; repeat_times: string; attach_to_session: boolean;
  monitor_script: string; monitor_url: string; reasoning_effort: string;
}
export type CronJob = JsonRecord & { id: string };
export type CronHistoryEntry =
  | { kind: 'session'; key: string; sessionId: string; run: JsonRecord }
  | { kind: 'execution'; key: string; sessionId: null; execution: JsonRecord };
export function cronList(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : text(value).split(/[\n,]/)).map(value => text(value).trim()).filter(Boolean))];
}
const nullableText = (value: unknown) => text(value).trim() || null;
export function cronSchedule(value: unknown): string {
  const job = record(value), schedule = job.schedule;
  if (typeof schedule === 'string') return schedule;
  const object = record(schedule);
  for (const key of ['expr', 'run_at', 'value', 'display']) {
    const value = text(object[key]).trim();
    if (value) return value;
  }
  return text(job.schedule_display).trim();
}
export function cronTimezone(value: unknown): string {
  const job = record(value), schedule = record(job.schedule), metadata = record(job.metadata);
  for (const value of [job.timezone, job.time_zone, job.tz, schedule.timezone, schedule.time_zone, metadata.timezone, metadata.time_zone]) {
    const zone = text(value).trim(); if (zone) return zone;
  }
  return uiText('原生未返回时区', 'No timezone returned by the host');
}
export function cronForm(value: unknown): CronForm {
  const job = record(value), repeat = record(job.repeat), context = cronList(job.context_from);
  return {
    name: text(job.name), prompt: text(job.prompt), schedule: cronSchedule(job),
    deliver: cronList(job.deliver).join(', '), failure_deliver: cronList(job.failure_deliver).join(', '),
    skills: cronList(job.skills ?? job.skill).join(', '), model: text(job.model), provider: text(job.provider),
    base_url: text(job.base_url), script: text(job.script), no_agent: !!job.no_agent,
    context_from: context.filter(value => value.toLowerCase() !== 'self').join(', '),
    enabled_toolsets: cronList(job.enabled_toolsets).join(', '), workdir: text(job.workdir),
    continuity: !!job.continuity || context.some(value => value.toLowerCase() === 'self'), repeat_times: text(repeat.times),
    attach_to_session: !!job.attach_to_session, monitor_script: text(job.monitor_script), monitor_url: text(job.monitor_url),
    reasoning_effort: text(job.reasoning_effort),
  };
}
export function cronPayload(form: CronForm) {
  const repeats = form.repeat_times.trim() ? Number(form.repeat_times) : null;
  const context = cronList(form.context_from).filter(value => value.toLowerCase() !== 'self');
  if (form.continuity) context.push('self');
  return {
    prompt: form.prompt, schedule: form.schedule.trim(), name: form.name.trim(), deliver: form.deliver.trim() || 'local',
    skills: cronList(form.skills), model: nullableText(form.model), provider: nullableText(form.provider),
    base_url: nullableText(form.base_url), script: nullableText(form.script), context_from: context,
    enabled_toolsets: cronList(form.enabled_toolsets), workdir: nullableText(form.workdir), no_agent: form.no_agent,
    repeat: Number.isFinite(repeats) ? repeats : null, attach_to_session: form.attach_to_session,
    monitor_script: nullableText(form.monitor_script), monitor_url: nullableText(form.monitor_url),
    reasoning_effort: nullableText(form.reasoning_effort), failure_deliver: nullableText(form.failure_deliver),
  };
}
export function nativeCronPayload(form: CronForm) {
  const { repeat, attach_to_session, monitor_script, monitor_url, reasoning_effort, failure_deliver, ...native } = cronPayload(form);
  return native;
}
export function needsExtendedCron(form: CronForm) {
  return !!(form.repeat_times.trim() || form.attach_to_session || form.monitor_script.trim() || form.monitor_url.trim() || form.reasoning_effort.trim() || form.failure_deliver.trim());
}
export function normalizeCronJobs(value: unknown): CronJob[] {
  return rows(value, 'jobs').flatMap(value => {
    const job = record(value), id = text(job.id).trim(); return id ? [{ ...job, id }] : [];
  });
}
export function normalizeCronJob(value: unknown): CronJob {
  const outer = record(value), job = record('job' in outer ? outer.job : value);
  if (!Object.keys(job).length) throw new Error(uiText('定时任务响应无效', 'Invalid scheduled job response'));
  const id = text(job.id).trim();
  if (!id) throw new Error(uiText('定时任务缺少身份', 'Scheduled job has no identity'));
  return { ...job, id };
}
function historyRows(value: unknown, ...keys: string[]): JsonRecord[] {
  return rows(value, ...keys).filter(value => value && typeof value === 'object').map(record);
}
export function cronSessionId(run: JsonRecord) { return text(run.session_id || run.id).trim(); }
/** Profiles that may own a legacy cron session after profile storage moved. */
export function cronSessionProfiles(run: JsonRecord, owner: string): string[] {
  return [...new Set([run.profile, run.profile_name, owner, 'default']
    .map(value => text(value).trim())
    .filter(value => value && value.toLowerCase() !== 'all'))];
}
/** The host uses a 404 with this message when a cron session was pruned or moved. */
export function isCronSessionNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : text(error);
  return /(?:session|会话)\s*(?:not\s*found|不存在|不可用)/i.test(message)
    || /(?:not\s*found|不存在)\D{0,24}(?:session|会话)/i.test(message)
    || /\b404\b/i.test(message);
}
export function cronTimestamp(value: unknown) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number < 1e12 ? number * 1000 : number;
  const date = Date.parse(text(value)); return Number.isFinite(date) ? date : 0;
}
export function mergeCronHistory(runs: JsonRecord[], executions: JsonRecord[]): CronHistoryEntry[] {
  const entries: CronHistoryEntry[] = runs.flatMap(run => {
    const id = cronSessionId(run); return id ? [{ kind: 'session' as const, key: `session:${id}`, sessionId: id, run }] : [];
  });
  for (const execution of executions) {
    const id = text(execution.id).trim();
    if (id) entries.push({ kind: 'execution', key: `execution:${id}`, sessionId: null, execution });
  }
  const time = (entry: CronHistoryEntry) => entry.kind === 'session'
    ? entry.run.started_at || entry.run.last_active || entry.run.ended_at
    : entry.execution.finished_at || entry.execution.started_at || entry.execution.claimed_at;
  return entries.sort((a, b) => cronTimestamp(time(b)) - cronTimestamp(time(a)) || a.key.localeCompare(b.key));
}
export async function listCronJobs(read: FetchJSON, profile: string) { return normalizeCronJobs(await read(`${API}/jobs?${profileQuery(profile)}`)); }
export async function listCronRuns(read: FetchJSON, profile: string, id: string) { return historyRows(await read(`${API}/jobs/${encode(id)}/runs?${profileQuery(profile)}&limit=100`), 'runs'); }
export async function listCronExecutions(read: FetchJSON, profile: string, id: string) {
  try { return historyRows(await read(`${EXTENDED_API}/executions?${profileQuery(profile)}&job_id=${encode(id)}&limit=100`), 'executions', 'items'); }
  catch { return []; } // Older hosts do not provide the optional execution journal.
}
async function writeJob(read: FetchJSON, url: string, method: string, body?: object) {
  return normalizeCronJob(await read(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
}
export function createNativeCronJob(read: FetchJSON, profile: string, form: CronForm) { return writeJob(read, `${API}/jobs?${profileQuery(profile)}`, 'POST', nativeCronPayload(form)); }
export function createExtendedCronJob(read: FetchJSON, profile: string, form: CronForm) { return writeJob(read, `${EXTENDED_API}/jobs?${profileQuery(profile)}`, 'POST', cronPayload(form)); }
export function updateCronJob(read: FetchJSON, profile: string, id: string, form: CronForm) { return writeJob(read, `${API}/jobs/${encode(id)}?${profileQuery(profile)}`, 'PUT', { updates: cronPayload(form) }); }
export function changeCronJobState(read: FetchJSON, profile: string, id: string, action: 'pause' | 'resume' | 'trigger') { return writeJob(read, `${API}/jobs/${encode(id)}/${action}?${profileQuery(profile)}`, 'POST'); }
export async function deleteCronJob(read: FetchJSON, profile: string, id: string) { await read(`${API}/jobs/${encode(id)}?${profileQuery(profile)}`, { method: 'DELETE' }); }
