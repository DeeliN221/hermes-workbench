import { describe, expect, it, vi } from 'vitest';

import { searchCodexSessions } from '../dashboard/src/codex-api';

describe('Codex session search API', () => {
  it('encodes the profile and query and normalizes content hits', async () => {
    const read = vi.fn(async () => ({
      results: [{
        session_id: 'session-1', thread_id: 'thread-1', title: 'Search everything',
        snippet: 'matching message content', matched: 'content', updated_at: 123, deleted: false,
        group_name: 'Project A', status: 'idle', workspace_id: 'workspace', workspace_path: '/workspace',
      }],
    }));
    const hits = await searchCodexSessions(read as any, 'project manager', 'needle & thread');
    expect(read).toHaveBeenCalledWith(
      '/api/plugins/workbench/codex/search?profile=project%20manager&q=needle%20%26%20thread&limit=60',
    );
    expect(hits).toEqual([{
      id: 'session-1', threadId: 'thread-1', title: 'Search everything', snippet: 'matching message content',
      matched: 'content', updatedAt: 123, deleted: false, groupName: 'Project A', status: 'idle',
      workspace: 'workspace', workspacePath: '/workspace',
    }]);
  });

  it('drops malformed rows instead of fabricating sessions', async () => {
    const read = vi.fn(async () => ({ results: [{ title: 'Missing id' }, null, { session_id: 'ok', matched: 'unexpected' }] }));
    const hits = await searchCodexSessions(read as any, 'default', 'query');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: 'ok', matched: 'title', deleted: false });
  });
});
