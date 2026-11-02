import { expect, it } from 'vitest';
import { normalizeHermesTranscript } from '../dashboard/src/hermes-transcript';
import { searchSessions } from '../dashboard/src/session-api';
import { searchCodexSessions } from '../dashboard/src/codex-api';

it('excludes hidden Hermes messages and blocks even from raw-event details', () => {
  const rows = [
    { id: 1, session_id: 's', role: 'user', hidden: true, content: 'private whole message' },
    { id: 2, session_id: 's', role: 'user', content: '\0json:' + JSON.stringify([
      { type: 'text', text: 'User input' }, { type: 'text', hidden: true, text: 'private context block' },
    ]) },
  ];
  const turns = normalizeHermesTranscript(rows, ['s']);
  expect(turns).toHaveLength(1);
  expect(turns[0].user).toBe('User input');
  expect(JSON.stringify(turns)).not.toContain('private');
  expect(rows[1].content).toContain('private context block');
});

it('excludes hidden search records in both providers', async () => {
  const read = async <T>() => ({ results: [
    { id: 'hidden', hidden: true, snippet: 'secret' }, { id: 'visible', snippet: 'original' },
  ] }) as T;
  expect((await searchSessions(read, 'default', 'original')).map(row => row.id)).toEqual(['visible']);
  expect((await searchCodexSessions(read, 'default', 'original')).map(row => row.id)).toEqual(['visible']);
});
