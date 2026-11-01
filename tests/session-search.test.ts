import { describe, expect, it, vi } from 'vitest';
import { readSearchPreview, searchAllProfiles, searchResultKey, searchTime } from '../dashboard/src/session-search';

describe('cross-profile search identity and partial failures', () => {
  it('includes the current profile even when absent from the roster and keeps identical IDs distinct', async () => {
    const read = vi.fn(async (path: string) => {
      if (path === '/api/profiles') return { profiles: [{ name: 'writer' }, { name: 'writer' }] };
      if (path.startsWith('/api/sessions/search')) {
        expect(path).not.toContain('exclude_sources');
        return { results: [{ session_id: 'shared', source: 'cron', snippet: 'Automation is searchable' }] };
      }
      return { results: [{ session_id: 'shared', title: 'Same identifier', group_name: 'Release' }] };
    });
    const { results, failures } = await searchAllProfiles(read as any, 'current profile', 'needle & thread');
    expect(failures).toEqual([]);
    expect(results).toHaveLength(4);
    expect(new Set(results.map(searchResultKey)).size).toBe(4);
    expect(results.filter(row => row.profile === 'current profile')).toHaveLength(2);
    expect(read.mock.calls.some(([path]) => path.includes('profile=current%20profile') && path.includes('needle%20%26%20thread'))).toBe(true);
  });
  it('shows Hermes project metadata and warns when Codex content search degrades', async () => {
    const read = vi.fn(async (path: string) => {
      if (path === '/api/profiles') return { profiles: [] };
      if (path.includes('/session-organization')) return { items: [{ profile: 'default', session_id: 'history', display_name: 'Release checklist', collection: 'Release project' }] };
      if (path.includes('/codex/search')) return { results: [], contentError: 'Upstream unavailable' };
      return { results: [{ session_id: 'history', source: 'web', snippet: 'Needle' }] };
    });
    const result = await searchAllProfiles(read as any, 'default', 'needle');
    expect(result.results[0]).toMatchObject({ title: 'Release checklist', groupName: 'Release project' });
    expect(result.failures).toContain('default / Codex content search');
  });
  it('keeps successful sources when one engine fails and reports the failed scope', async () => {
    const read = vi.fn(async (path: string) => {
      if (path === '/api/profiles') return { profiles: [{ name: 'writer' }] };
      if (path.includes('/codex/search') && path.includes('profile=writer')) throw new Error('Offline');
      return { results: [{ session_id: 'one', source: 'web', title: 'Available' }] };
    });
    const result = await searchAllProfiles(read as any, 'default', 'needle');
    expect(result.results).toHaveLength(3);
    expect(result.failures).toEqual(['writer / Codex']);
  });
  it('searches the current profile and reports a roster failure', async () => {
    const read = vi.fn(async (path: string) => {
      if (path === '/api/profiles') throw new Error('Offline');
      return { results: [] };
    });
    expect((await searchAllProfiles(read as any, 'default', 'needle')).failures).toEqual(['Profile list']);
    expect(read).toHaveBeenCalledTimes(4);
  });
});

describe('preview body normalization', () => {
  it('reads the selected profile without marking read or submitting a turn', async () => {
    const read = vi.fn(async () => ({ turns: [{ id: 'turn', items: [
      { id: 'q', type: 'userMessage', content: [{ type: 'text', text: 'Question' }] },
      { id: 'r', type: 'reasoning', summary: [{ text: 'Thinking' }] },
      { id: 't', type: 'commandExecution', command: 'npm test', aggregatedOutput: 'Passed' },
      { id: 'a', type: 'agentMessage', text: '**Answer**', phase: 'final' },
    ] }] }));
    const messages = await readSearchPreview(read as any, { id: 'shared', profile: 'writer', kind: 'session', title: 'Preview' });
    expect(messages.map(row => row.role)).toEqual(['user', 'reasoning', 'tool', 'assistant']);
    expect(messages.at(-1)?.content).toBe('**Answer**');
    expect(read).toHaveBeenCalledExactlyOnceWith('/api/plugins/workbench/codex/session?profile=writer&session_id=shared&after=0&limit=200&defer_persistence=true');
  });
  it('preserves Hermes tool calls and reasoning alongside the answer', async () => {
    const read = vi.fn(async () => ({ messages: [{ role: 'assistant', content: 'Answer', reasoning_content: 'Thinking', tool_calls: [{ function: { name: 'lookup', arguments: '{}' } }] }] }));
    const messages = await readSearchPreview(read as any, { id: 'shared', profile: 'writer', kind: 'hermes', title: 'Preview' });
    expect(messages.map(row => row.role)).toEqual(['reasoning', 'assistant', 'tool']);
    expect(messages[2].content).toContain('lookup');
  });
  it('uses only local cached history for archived previews', async () => {
    const read = vi.fn(async () => ({ cached: true, turns: [] }));
    await readSearchPreview(read as any, { id: 'archive', profile: 'writer', kind: 'archived', title: 'Archived' });
    expect(read).toHaveBeenCalledExactlyOnceWith('/api/plugins/workbench/codex/session/preview?profile=writer&session_id=archive&turns=8');
  });
  it('rejects missing snapshots instead of presenting an empty success', async () => {
    await expect(readSearchPreview((async () => ({})) as any, { id: 'one', profile: 'default', kind: 'session', title: '' })).rejects.toThrow('unavailable');
  });
  it('renders seconds, milliseconds, ISO timestamps and unknown dates', () => {
    expect(searchTime(1700000000)).toBe(searchTime(1700000000000));
    expect(searchTime('2023-11-14T22:13:20Z')).toBe(searchTime(1700000000));
    expect(searchTime('invalid')).toBe('Unknown date');
  });
});
