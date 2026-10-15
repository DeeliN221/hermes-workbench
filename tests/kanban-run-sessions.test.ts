import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadKanbanRunSessions, runSessionPath, sessionsForRun } from '../dashboard/src/kanban-run-sessions';

const session = (id: string, started_at: number, profile = 'default', preview = 'work kanban task t1') => ({ id, started_at, profile, preview, source: 'kanban' });
describe('Kanban execution conversations', () => {
  it('reads worker sessions across profiles and excludes references to another task', async () => {
    const fetch = vi.fn(async (_url: string) => ({ sessions: [session('correct', 101), session('other', 102, 'default', 'work kanban task t10'), session('mention', 103, 'default', 'Please review work kanban task t1')], total: 3 }));
    expect((await loadKanbanRunSessions(fetch as any, 't1')).map(row => row.id)).toEqual(['correct']);
    expect(fetch.mock.calls[0][0]).toContain('profile=all&source=kanban');
  });
  it('maps repeated executions and profile ownership without borrowing the latest task log', () => {
    const runs = [{ id: 1, started_at: 100, ended_at: 150 }, { id: 2, started_at: 200, profile: 'writer' }];
    const sessions = [session('first', 101), session('gap', 175), session('second', 201, 'writer'), session('wrong-profile', 202)];
    expect(sessionsForRun(runs[0], runs, sessions).map(row => row.id)).toEqual(['first']);
    expect(sessionsForRun(runs[1], runs, sessions).map(row => row.id)).toEqual(['second']);
    expect(sessionsForRun(undefined, runs, sessions)).toEqual([]);
    const url = new URL(runSessionPath(session('session / id', 101, 'writer')), 'http://localhost');
    expect(url.pathname).toBe('/chat');
    expect(url.searchParams.get('hermesSession')).toBe('session / id');
    expect(url.searchParams.has('session')).toBe(false);
  });
  it('reports profile read failures instead of silently claiming the conversation is absent', async () => {
    await expect(loadKanbanRunSessions((async () => ({ errors: [{ profile: 'writer' }] })) as any, 't1')).rejects.toThrow('读取失败');
  });
  it('uses the original worker prompt when compression has replaced the preview', async () => {
    const fetch = vi.fn(async (url: string) => url.includes('/export')
      ? { messages: [{ role: 'user', content: 'work kanban task t1' }] }
      : { sessions: [{ ...session('tip', 101, 'writer', 'Conversation summary'), _lineage_root_id: 'root' }], total: 1 });
    expect((await loadKanbanRunSessions(fetch as any, 't1')).map(row => row.id)).toEqual(['tip']);
    expect(fetch.mock.calls[1][0]).toContain('/root/export?profile=writer');
  });
});

// These assertions exercise the retained Chinese translation explicitly.
beforeEach(() => vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } }));
afterEach(() => vi.unstubAllGlobals());
