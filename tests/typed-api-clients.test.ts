import { describe, expect, it, vi } from 'vitest';
import { cronForm, cronPayload, nativeCronPayload, needsExtendedCron, mergeCronHistory, updateCronJob, changeCronJobState } from '../dashboard/src/cron-api';
import { listSkillEntries, mutateSkillFile, saveSkillFile, skillPreviewKind, downloadSkillFile } from '../dashboard/src/skills-api';
import { answerCodexApproval, sendCodexMessage, normalizeSession, normalizeGoal, CodexSendError } from '../dashboard/src/codex-api';
import type { FetchJSON } from '../dashboard/src/workbench-api';
const client = (value: unknown) => vi.fn(async () => value) as unknown as FetchJSON;
describe('typed cron API', () => {
  it('round trips continuity and advanced fields without dropping explicit false or zero values', () => {
    const form = cronForm({ name: ' Daily ', schedule: { expr: '0 8 * * *' }, context_from: ['previous', 'SELF'], repeat: { times: 0 }, no_agent: false,
      skills: ['one', 'one', 'two'], monitor_url: ' https://example.org/health ' });
    expect(form.continuity).toBe(true);
    expect(form.context_from).toBe('previous');
    expect(cronPayload(form)).toMatchObject({ name: 'Daily', schedule: '0 8 * * *', context_from: ['previous', 'self'], repeat: 0, no_agent: false, skills: ['one', 'two'], monitor_url: 'https://example.org/health' });
    expect(needsExtendedCron(form)).toBe(true);
    expect(nativeCronPayload(form)).not.toHaveProperty('repeat');
  });
  it('sorts native sessions and execution-only history together across timestamp formats', () => {
    expect(mergeCronHistory([{ session_id: 'older', started_at: 1800000000 }], [{ id: 'newer', finished_at: 1800000001000 }]).map(row => row.key)).toEqual(['execution:newer', 'session:older']);
  });
  it('uses the host trigger action for an immediate run', async () => {
    const read = client({ job: { id: 'job' } });
    await changeCronJobState(read, 'writer', 'job', 'trigger');
    expect(read).toHaveBeenCalledWith('/api/cron/jobs/job/trigger?profile=writer', { method: 'POST' });
  });
  it('scopes updates and retains the native updates envelope', async () => {
    const read = client({ job: { id: 'job' } }), form = cronForm({ name: 'test', schedule: 'daily' });
    await updateCronJob(read, 'writer & team', 'job/1', form);
    expect(read).toHaveBeenCalledWith('/api/cron/jobs/job%2F1?profile=writer%20%26%20team', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ updates: cronPayload(form) }) }));
  });
});
describe('typed skill files API', () => {
  it('preserves explicit paths and lists directories before files', async () => {
    const entries = await listSkillEntries(client({ entries: [{ name: 'z', type: 'directory' }, { path: 'shared/a.ts', size: 7 }, 'local.md'] }), 'writer', 'demo', 'references');
    expect(entries.map(row => row.path)).toEqual(['references/z', 'shared/a.ts', 'references/local.md']);
    expect(skillPreviewKind('report.pdf')).toBe('pdf');
    expect(skillPreviewKind('LICENSE')).toBe('text');
  });
  it('sends optimistic concurrency tokens and preserves write conflict errors', async () => {
    const read = client({ version: 'v2' });
    await saveSkillFile(read, 'writer', 'demo', 'SKILL.md', 'new content', 'v1');
    expect(read).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ profile: 'writer', skill: 'demo', path: 'SKILL.md', content: 'new content', mode: 'replace', version: 'v1' }) }));
    const conflict = new Error('version conflict');
    const rejected = vi.fn(async () => { throw conflict; }) as FetchJSON;
    await expect(saveSkillFile(rejected, 'writer', 'demo', 'SKILL.md', '', 'old')).rejects.toBe(conflict);
  });
  it('keeps create and rename operations distinct and reports download errors', async () => {
    const read = client({});
    await mutateSkillFile(read, 'writer', 'demo', { action: 'rename', path: 'old.md', newPath: 'new.md' });
    expect(read).toHaveBeenCalledWith('/api/plugins/workbench/skills/files/rename?profile=writer', expect.objectContaining({ body: JSON.stringify({ profile: 'writer', skill: 'demo', source: 'old.md', destination: 'new.md', mode: 'create' }) }));
    await expect(downloadSkillFile(async () => new Response('{"detail":"file missing"}', { status: 404 }), 'writer', 'demo', 'missing')).rejects.toThrow('file missing');
  });
});
describe('typed Codex command API', () => {
  it('normalizes session and goal identity without trusting malformed numbers', () => {
    expect(normalizeSession({ session_id: 's', workspace_path: '/workspace/demo', last_completed_seq: 'bad', read_seq: 3 })).toMatchObject({ id: 's', workspace: 'demo', lastCompletedSeq: 0, readSeq: 3 });
    expect(normalizeGoal({ threadId: 't', status: 'unexpected', tokens_used: '42', token_budget: 'bad' })).toMatchObject({ threadId: 't', status: null, tokensUsed: 42, tokenBudget: null });
  });
  it('routes steering with stable request identity and propagates send status for retry decisions', async () => {
    const read = client({ request: { status: 'accepted', turn_id: 'turn' } });
    await expect(sendCodexMessage(read, 'writer', 's/1', 'More detail', 'r1', { expectedTurnId: 'turn' })).resolves.toMatchObject({ accepted: true, turnId: 'turn', clientRequestId: 'r1' });
    expect(read).toHaveBeenCalledWith('/api/plugins/workbench/codex/session/steer?profile=writer&session_id=s%2F1', expect.objectContaining({ method: 'POST' }));
    await expect(sendCodexMessage(read, 'writer', 's', 'Hi', 'r1', {}, async () => new Response('busy', { status: 409 }))).rejects.toBeInstanceOf(CodexSendError);
  });
  it('does not silently retry an approval with unknown delivery', async () => {
    await expect(answerCodexApproval(client({ status: 'pending' }), 'writer', 's', 'approval', 'approve')).rejects.toMatchObject({ requestDeliveryUnknown: true });
  });
});
