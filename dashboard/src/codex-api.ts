/** Profile-scoped Codex commands and validated application models. */
import type { FetchJSON } from './workbench-api';
import { record, rows, text, optionalNumber, type AuthedFetch } from './api-values';
import { loadChatSetup } from './chat-setup';
import { applyProfileChatDefaults } from './profile-model';
import { runtimeErrorText } from './chat-runtime-errors';
import { uiText } from './ui-locale';
const API = '/api/plugins/workbench/codex';
const encode = encodeURIComponent;
const sessionQuery = (profile: string, session: string) => `profile=${encode(profile)}&session_id=${encode(session)}`;
const json = (method: string, body: object): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export interface CodexSession {
  id: string; threadId?: string; title: string; workspace: string; workspaceId: string; workspacePath: string;
  favorite: boolean; groupId: string | null; deleted: boolean; updatedAt: string; createdAt: number;
  status: 'running' | 'waiting' | 'failed' | 'completed' | 'idle'; unread: boolean; lastCompletedSeq: number; readSeq: number;
  color: string;
}
export interface CodexGroup { id: string; name: string; workspaceId: string; workspacePath: string }
const GOAL_STATES = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const;
type GoalStatus = typeof GOAL_STATES[number];
export interface CodexGoal {
  objective: string | null; threadId: string; status: GoalStatus | null; tokenBudget: number | null;
  tokensUsed: number | null; timeUsedSeconds: number | null; createdAt: string; updatedAt: string;
}
export interface CodexAttachment { id: string; name: string; size: number; mimeType: string }
export interface SessionOptions { model?: string; effort?: string; serviceTier?: string; cwd?: string; workspaceId?: string; sessionId?: string }
export interface SendOptions extends SessionOptions { attachmentIds?: string[]; expectedTurnId?: string }
export class CodexSendError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'CodexSendError'; }
}
function sessionStatus(value: unknown): CodexSession['status'] {
  const status = text(value).toLowerCase();
  if (status.includes('run') || ['processing', 'in_progress', 'inprogress'].includes(status)) return 'running';
  if (['wait', 'approval', 'question'].some(part => status.includes(part))) return 'waiting';
  if (status.includes('fail') || status.includes('error')) return 'failed';
  return status.includes('complete') || status === 'done' ? 'completed' : 'idle';
}
function displayTimestamp(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) {
    const date = new Date(Number(value) * (Number(value) < 1e12 ? 1000 : 1));
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : '';
  }
  return text(value);
}
export function normalizeSession(value: unknown): CodexSession | null {
  const row = record(value), id = text(row.id ?? row.sessionId ?? row.session_id);
  if (!id) return null;
  const path = text(row.workspacePath ?? row.workspace_path ?? row.path ?? row.cwd);
  const completed = Number(row.lastCompletedSeq ?? row.last_completed_seq ?? row.completedSeq ?? 0), read = Number(row.readSeq ?? row.read_seq ?? 0);
  const group = row.groupId ?? row.group_id, color = text(row.color ?? row.sessionColor ?? row.session_color);
  return { id, threadId: text(row.threadId ?? row.thread_id) || undefined, title: text(row.title ?? row.name ?? row.summary, id),
    workspace: text(row.workspaceName ?? row.workspace_name, path.split('/').filter(Boolean).at(-1) || path || uiText('默认工作区', 'Default workspace')),
    workspaceId: text(row.workspaceId ?? row.workspace_id), workspacePath: path,
    favorite: row.favorite === true || row.favourited === true || row.isFavorite === true,
    groupId: group == null || text(group).trim() === '' ? null : text(group), deleted: row.deleted === true,
    updatedAt: displayTimestamp(row.updatedAt ?? row.updated_at ?? row.timestamp), createdAt: Number(row.createdAt ?? row.created_at) || 0,
    status: sessionStatus(row.status ?? row.state ?? (row.running ? 'running' : 'idle')),
    unread: row.unread === true || row.hasUnread === true || completed > read,
    lastCompletedSeq: Number.isFinite(completed) ? completed : 0, readSeq: Number.isFinite(read) ? read : 0,
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '' };
}
export async function listCodexSessions(read: FetchJSON, profile: string, options: boolean | { deleted?: boolean } = {}): Promise<CodexSession[]> {
  const deleted = typeof options === 'boolean' ? options : options.deleted === true, result: CodexSession[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = rows(await read(`${API}/sessions?profile=${encode(profile)}&limit=100&offset=${offset}${deleted ? '&deleted=true' : ''}`), 'items');
    for (const item of page) { const session = normalizeSession(item); if (session && session.deleted === deleted) result.push(session); }
    if (page.length < 100) return result.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
}
export function normalizeGroup(value: unknown): CodexGroup | null {
  const row = record(value), id = text(row.id ?? row.groupId ?? row.group_id).trim(), name = text(row.name ?? row.title).trim();
  return id && name ? { id, name, workspaceId: text(row.workspaceId ?? row.workspace_id).trim(), workspacePath: text(row.workspacePath ?? row.workspace_path ?? row.path).trim() } : null;
}
export async function listCodexGroups(read: FetchJSON, profile: string) {
  return rows(await read(`${API}/groups?profile=${encode(profile)}`), 'items').flatMap(value => { const group = normalizeGroup(value); return group ? [group] : []; });
}
async function writeGroup(read: FetchJSON, url: string, method: string, body: object) {
  const response = await read(url, json(method, body)), group = normalizeGroup(record(response).group ?? response);
  if (!group) throw new Error(uiText('服务端未返回有效项目', 'The server returned no valid project'));
  return group;
}
export function createCodexGroup(read: FetchJSON, profile: string, name: string) { return writeGroup(read, `${API}/groups`, 'POST', { profile, name }); }
export function renameCodexGroup(read: FetchJSON, profile: string, id: string, name: string) { return writeGroup(read, `${API}/groups/${encode(id)}?profile=${encode(profile)}`, 'PATCH', { name }); }
export async function deleteCodexGroup(read: FetchJSON, profile: string, id: string) { await read(`${API}/groups/${encode(id)}?profile=${encode(profile)}`, { method: 'DELETE' }); }
export async function organizeCodexSession(read: FetchJSON, profile: string, session: string, changes: { favorite?: boolean; groupId?: string | null; deleted?: boolean; title?: string; color?: string }) {
  const response = await read(`${API}/session/organization?${sessionQuery(profile, session)}`, json('PATCH', changes));
  return normalizeSession(record(response).session ?? response);
}
export function normalizeGoal(value: unknown): CodexGoal | null {
  const row = record(value), threadId = text(row.threadId ?? row.thread_id).trim();
  if (!threadId) return null;
  const status = text(row.status).trim();
  return { objective: row.objective == null ? null : text(row.objective), threadId,
    status: GOAL_STATES.find(value => value === status) ?? null,
    tokenBudget: optionalNumber(row.tokenBudget ?? row.token_budget) ?? null,
    tokensUsed: optionalNumber(row.tokensUsed ?? row.tokens_used) ?? null,
    timeUsedSeconds: optionalNumber(row.timeUsedSeconds ?? row.time_used_seconds) ?? null,
    createdAt: text(row.createdAt ?? row.created_at), updatedAt: text(row.updatedAt ?? row.updated_at) };
}
function goalResponse(value: unknown) {
  const row = record(value), raw = 'goal' in row ? row.goal : value;
  if (raw == null) return null;
  const goal = normalizeGoal(raw);
  if (!goal) throw new Error(uiText('服务端未返回有效目标', 'The server returned no valid goal'));
  return goal;
}
export async function readCodexGoal(read: FetchJSON, profile: string, session: string) { return goalResponse(await read(`${API}/session/goal?${sessionQuery(profile, session)}`)); }
export async function updateCodexGoal(read: FetchJSON, profile: string, session: string, goal: { objective?: string; status?: GoalStatus; tokenBudget?: number | null }) {
  return goalResponse(await read(`${API}/session/goal?${sessionQuery(profile, session)}`, json('PUT', goal)));
}
export async function deleteCodexGoal(read: FetchJSON, profile: string, session: string) { await read(`${API}/session/goal?${sessionQuery(profile, session)}`, { method: 'DELETE' }); }
export async function listCodexWorkspaces(read: FetchJSON, profile: string) {
  return rows(await read(`${API}/workspaces?profile=${encode(profile)}`), 'items').flatMap(value => {
    const row = record(value), path = text(row.path ?? row.workspace_path);
    return path ? [{ id: text(row.id, path), name: text(row.name, path), path }] : [];
  });
}
export async function loadCodexModels(read: FetchJSON, profile: string) {
  const [catalog, config] = await loadChatSetup(read, profile);
  const choices = rows(catalog, 'data', 'models').flatMap(value => {
    const row = record(value), id = text(row.model ?? row.id);
    if (!id) return [];
    const fast = rows(row.serviceTiers).map(record).find(tier => text(tier.name).toLowerCase() === 'fast');
    return [{ id, label: text(row.displayName, id), supportsFast: !!fast, fastServiceTier: fast ? text(fast.id) : undefined,
      efforts: rows(row.supportedReasoningEfforts).map(value => text(record(value).reasoningEffort)).filter(Boolean),
      defaultEffort: text(row.defaultReasoningEffort), isDefault: row.isDefault === true }];
  });
  return applyProfileChatDefaults(choices, config);
}
export async function markCodexSessionRead(read: FetchJSON, profile: string, session: string, readSeq: number) {
  if (readSeq) await read(`${API}/session/read?${sessionQuery(profile, session)}`, json('POST', { profile, readSeq }));
}
export async function createCodexSession(read: FetchJSON, profile: string, options: SessionOptions) {
  const response = record(await read(`${API}/sessions`, json('POST', { profile, model: options.model || undefined,
    effort: options.effort || undefined, serviceTier: options.serviceTier || undefined, cwd: options.cwd || undefined,
    workspace_id: options.workspaceId || undefined, session_id: options.sessionId || undefined })));
  const session = normalizeSession(response.session);
  if (!session) throw new Error('Codex did not return a session');
  return session;
}
export async function sendCodexMessage(read: FetchJSON, profile: string, session: string, content: string, requestId: string, options: SendOptions, fetch?: AuthedFetch) {
  const url = `${API}/session${options.expectedTurnId ? '/steer' : ''}?${sessionQuery(profile, session)}`;
  const init = json('POST', { profile, text: content, clientRequestId: requestId, model: options.model || undefined,
    effort: options.effort || undefined, serviceTier: options.serviceTier || undefined, attachmentIds: options.attachmentIds || [],
    expectedTurnId: options.expectedTurnId, input: [{ type: 'text', text: content }] });
  let result: unknown;
  if (fetch) {
    const response = await fetch(url, init);
    if (!response.ok) throw new CodexSendError(response.status, await response.text().catch(() => '') || uiText(`消息发送失败（HTTP ${response.status}）`, `Message send failed (HTTP ${response.status})`));
    result = await response.json();
  } else result = await read(url, init);
  const request = record(record(result).request);
  return { accepted: request.status === 'accepted', status: text(request.status), turnId: text(request.turn_id), error: runtimeErrorText(request.result), clientRequestId: requestId };
}
export function normalizeAttachment(value: unknown): CodexAttachment | null {
  const row = record(value), id = text(row.id), size = Number(row.size);
  return id ? { id, name: text(row.name, uiText('附件', 'Attachments')), size: Number.isFinite(size) && size >= 0 ? size : 0,
    mimeType: text(row.mimeType ?? row.mime_type, 'application/octet-stream') } : null;
}
export async function uploadCodexAttachment(fetch: AuthedFetch, profile: string, session: string, file: File, progress?: (fraction: number) => void) {
  progress?.(0);
  const form = new FormData(); form.append('file', file, file.name || 'attachment');
  const response = await fetch(`${API}/attachments?${sessionQuery(profile, session)}`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text().catch(() => '') || uiText(`附件上传失败（HTTP ${response.status}）`, `Attachment upload failed (HTTP ${response.status})`));
  const attachment = normalizeAttachment(record(await response.json()).attachment);
  if (!attachment) throw new Error(uiText('附件上传未返回有效附件编号', 'Upload returned no valid attachment ID'));
  progress?.(1); return attachment;
}
export async function stopCodexTurn(read: FetchJSON, profile: string, session: string, turnId: string) {
  if (!turnId) throw new Error(uiText('当前没有可停止的轮次', 'No active turn to stop'));
  await read(`${API}/session/stop?${sessionQuery(profile, session)}`, json('POST', { profile, turnId }));
}
export async function answerCodexApproval(read: FetchJSON, profile: string, session: string, approvalId: string, answer: string | Record<string, unknown>) {
  const result = record(await read(`${API}/session/approval?${sessionQuery(profile, session)}`, json('POST', {
    profile, approvalId, ...(typeof answer === 'object' ? { answers: answer } : { decision: answer === 'approve' ? 'accept' : answer === 'reject' ? 'decline' : answer }),
  })));
  if (result.status !== 'accepted') throw Object.assign(new Error(uiText('提交状态未知，请等待会话恢复后检查，勿重复提交。', 'Submission status is unknown. Wait for the session to recover; do not submit again.')), { requestDeliveryUnknown: true });
}
