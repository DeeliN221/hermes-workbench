import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchJSON } from '../dashboard/src/workbench-api';

beforeEach(() => { vi.resetModules(); vi.stubGlobal('__WORKBENCH_STANDALONE__', true); });
afterEach(() => vi.unstubAllGlobals());
const reader = (fn: (url: string, init?: RequestInit) => Promise<unknown>) => fn as FetchJSON;

describe('standalone UI command seam', () => {
  it('creates, sends and cancels only through neutral APIs and keeps accepted separate from completed', async () => {
    const api = await import('../dashboard/src/codex-api');
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const read = reader(async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body || '{}')) });
      if (url === '/api/runtime/sessions') return { id: 's', runtime: 'dsh', profile_id: 'p', project_id: 'j' };
      return { accepted: true, status: 'accepted', session_id: 's', request_id: 'r' };
    });
    const session = await api.createCodexSession(read, 'p', { workspaceId: 'j', cwd: '/untrusted-browser-path', model: 'runtime-model' });
    expect(session.id).toBe('s');
    expect(calls[0].body).toEqual({ profile_id: 'p', project_id: 'j', model: 'runtime-model' });
    const receipt = await api.sendCodexMessageRetry(read, 'p', 's', 'hello', 'r', {});
    expect(receipt.status).toBe('accepted');
    expect(calls[1]).toMatchObject({ url: '/api/runtime/sessions/s/messages?profile_id=p', body: { content: 'hello', request_id: 'r', mode: 'queue' } });
    await api.sendCodexMessage(read, 'p', 's', 'steer', 'r2', { expectedTurnId: 's' });
    expect(calls[2].body.mode).toBe('steer');
    await api.stopCodexTurn(read, 'p', 's', '');
    expect(calls[3].url).toBe('/api/runtime/sessions/s/cancel?profile_id=p');
    expect(calls.every(call => !/codex|thread|turn/.test(call.url))).toBe(true);
  });
  it('surfaces unavailable, unacknowledged, and expired interaction responses', async () => {
    const api = await import('../dashboard/src/codex-api');
    const unavailable = vi.fn(async () => { throw Object.assign(new Error('DSH unavailable'), { status: 503 }); });
    await expect(api.sendCodexMessageRetry(reader(unavailable), 'p', 's', 'hello', 'r', {})).rejects.toThrow('DSH unavailable');
    expect(unavailable).toHaveBeenCalledTimes(1);
    await expect(api.sendCodexMessage(reader(async () => ({ status: 'completed' })), 'p', 's', 'hello', 'r', {})).rejects.toThrow('did not acknowledge');
    await expect(api.answerCodexApproval(reader(async () => { throw Object.assign(new Error('expired'), { status: 410 }); }), 'p', 's', 'q', 'approve')).rejects.toMatchObject({ interactionExpired: true });
  });
  it('scopes project creation and reads the real runtime catalog without fallback models', async () => {
    const api = await import('../dashboard/src/codex-api');
    const calls: string[] = [];
    const read = reader(async url => {
      calls.push(url);
      if (url.includes('/groups')) return { id: 'j', name: 'Project' };
      if (url === '/api/runtime/models') return { models: [{ id: 'dsh-model', label: 'Runtime model', is_default: true }] };
      if (url.includes('/model-display')) return { preferences: { mode: 'hidden', hidden: [], aliases: {}, visible: [], revision: 1 } };
      return { model: 'dsh-model' };
    });
    await api.createCodexGroup(read, 'other', 'Project');
    expect(calls[0]).toBe('/api/plugins/workbench/runtime-ui/groups?profile=other');
    const models = await api.loadCodexModels(read, 'other');
    expect(models).toHaveLength(1); expect(models[0].id).toBe('dsh-model');
    expect(calls.some(url => /codex|opencode/.test(url))).toBe(false);
  });
});
