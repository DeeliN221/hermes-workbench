import { describe, expect, it } from 'vitest';
import { activityTime, isInternalSession, isKanbanRunSession, isScheduledSession, recentSessions, promptPair, visibleRequest, loadPromptPair, withinRecentWindow, RECENT_WINDOW_DAYS } from '../dashboard/src/recent-home';

describe('recent home activity', () => {
  it('recognizes scheduled sessions even when the Codex projection omits source metadata', () => {
    expect(isScheduledSession({ source: 'cron', id: 'run-1' })).toBe(true);
    expect(isScheduledSession({ id: 'cron_abc_20261017_120000' })).toBe(true);
    expect(isScheduledSession({ id: 'chat_1' })).toBe(false);
    expect(recentSessions([{ id: 'cron_abc_20261017_120000', title: 'No reply', updatedAt: 300 }], [], 'writer')).toEqual([]);
  });

  it('hides Kanban worker runs even when their source or title casing varies', () => {
    expect(isKanbanRunSession({ source: 'kanban', id: 'run-1' })).toBe(true);
    expect(isKanbanRunSession({ created_source: 'kanban', id: 'run-2' })).toBe(true);
    expect(isKanbanRunSession({ id: 'run-3', title: 'work kanban task t_e32c1716 #3' })).toBe(true);
    expect(isKanbanRunSession({ id: 'run-4', title: 'Work on kanban task t_715fea9c' })).toBe(true);
    expect(isKanbanRunSession({ id: 'run-5', title: 'Complete Kanban task t_bdc784f0' })).toBe(true);
    expect(isKanbanRunSession({ id: 'chat-1', title: 'How does the kanban task view work?' })).toBe(false);
    expect(isInternalSession({ source: 'cron', id: 'run-6' })).toBe(true);
    expect(recentSessions([], [{ source: 'kanban', id: 'run-1', title: 'work kanban task t_e32c1716' }], 'default')).toEqual([]);
  });

  it('orders old conversations by new activity across sources, without mixing IDs', () => {
    const rows = recentSessions([
      { id: 'old', title: 'Old', createdAt: 1, updatedAt: 200 },
      { id: 'new', title: 'New', createdAt: 100, updatedAt: 100 },
      { id: 'old', updatedAt: 200 },
      { id: 'deleted', deleted: true, updatedAt: 900 },
    ], [ { id: 'old', title: 'History', updated_at: 150 }, { id: 'cron', source: 'cron', updated_at: 999 } ]);
    expect(rows.map(row => `${row.source}:${row.id}`)).toEqual(['Codex:old', 'Hermes:old', 'Codex:new']);
  });
  it('accepts seconds, milliseconds, ISO times and missing activity dates', () => {
    const time = Date.parse('2026-10-12T00:00:00Z');
    expect(activityTime({ updated_at: time / 1000 })).toBe(time);
    expect(activityTime({ updatedAt: time })).toBe(time);
    expect(activityTime({ updated_at: '2026-10-12T00:00:00Z' })).toBe(time);
    expect(activityTime({ updated_at: 'invalid', created_at: time })).toBe(time);
    expect(activityTime({})).toBe(0);
  });
  it('drops stale cards from the recent home while keeping unknown timestamps', () => {
    const now = Date.parse('2026-10-23T00:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    expect(withinRecentWindow({ updated: now - day }, now)).toBe(true);
    expect(withinRecentWindow({ updated: now - RECENT_WINDOW_DAYS * day }, now)).toBe(true);
    expect(withinRecentWindow({ updated: now - (RECENT_WINDOW_DAYS * day + 1) }, now)).toBe(false);
    expect(withinRecentWindow({ updated: 0 }, now)).toBe(true);
  });
});


describe('OZW request cards', () => {
  it('shows the first and last user request, ignoring assistant and tool output', () => {
    expect(promptPair([
      { type: 'userMessage', content: [{ type: 'text', text: '<environment_context>cwd</environment_context>' }] },
      { type: 'userMessage', content: [{ type: 'text', text: 'First request' }] },
      { role: 'assistant', content: 'Not a question' },
      { role: 'user', content: 'Middle request' },
      { type: 'userMessage', content: [{ type: 'text', text: 'Latest request' }] },
      { role: 'tool', content: 'Not latest' },
    ])).toEqual({ first: 'First request', latest: 'Latest request' });
  });
  it('strips bootstrap wrappers but preserves ordinary references and a single request', () => {
    const text = '# AGENTS.md instructions for /work\n\n<INSTRUCTIONS>rules</INSTRUCTIONS><environment_context>cwd</environment_context>Do this';
    expect(visibleRequest(text)).toBe('Do this');
    expect(visibleRequest('Explain <environment_context> in this code')).toBe('Explain <environment_context> in this code');
    expect(promptPair([{ role: 'user', content: 'One request' }])).toEqual({ first: 'One request', latest: 'One request' });
    expect(promptPair([{ role: 'assistant', content: 'No user' }])).toEqual({ first: '', latest: '' });
  });
  it('reads a Codex projection without opening the live thread', async () => {
    const urls: string[] = [];
    const read = async <T>(url: string): Promise<T> => { urls.push(url); return {first:'First',latest:'Latest'} as T; };
    const row = recentSessions([{id:'one'}], [{id:'one',source:'codex'}], 'writer')[0];
    expect(await loadPromptPair(read, 'writer', row, new AbortController().signal)).toEqual({first:'First',latest:'Latest'});
    expect(urls).toEqual(['/api/plugins/workbench/session-prompts?profile=writer&session_id=one']);
  });
  it('uses the bounded cache for unmirrored sessions, never live history', async () => {
    const urls: string[] = [];
    const read = async <T>(url: string): Promise<T> => { urls.push(url); return {turns:[{items:[{type:'userMessage',content:'Cached request'}]}]} as T; };
    const row = recentSessions([{id:'one'}], [], 'writer')[0];
    expect(await loadPromptPair(read, 'writer', row, new AbortController().signal)).toEqual({first:'Cached request',latest:'Cached request',partial:true});
    expect(urls[0]).toBe('/api/plugins/workbench/codex/session/preview?profile=writer&session_id=one&turns=8');
  });
  it('surfaces a terminal error instead of claiming an uncached prompt', async () => {
    const row = recentSessions([{ id: 'one', status: 'failed' }], [], 'writer')[0];
    const read = async <T>(): Promise<T> => ({ turns: [], lastError: 'Selected model is at capacity. Please try a different model.' }) as T;
    expect(await loadPromptPair(read, 'writer', row, new AbortController().signal)).toEqual({
      first: '', latest: '', partial: true, error: 'Selected model is at capacity. Please try a different model.',
    });
  });
  it('keeps a prompt and its failed-turn error together', async () => {
    const row = recentSessions([{ id: 'one', status: 'failed' }], [], 'writer')[0];
    const read = async <T>(): Promise<T> => ({ turns: [{ items: [{ type: 'userMessage', content: 'Run the task' }], error: { message: 'serverOverloaded' } }] }) as T;
    expect(await loadPromptPair(read, 'writer', row, new AbortController().signal)).toEqual({
      first: 'Run the task', latest: 'Run the task', partial: true, error: 'serverOverloaded',
    });
  });
});
