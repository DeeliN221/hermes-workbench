import { expect, it } from 'vitest';
import { recentSessions } from '../dashboard/src/recent-home';
import { renameCodexSession, organizeCodexSession, renameCodexGroup, deleteCodexGroup, sendCodexMessage } from '../dashboard/src/codex-api';
it('opens a selected aggregate identity for all writes, even when IDs overlap with default', async () => {
  const rows = ['default', 'writer'].flatMap(profile => recentSessions([{ id: 'same', groupId: 'same' }], [], profile));
  const selected = rows.find(row => row.profile === 'writer')!;
  const calls: { url: URL; body: any }[] = [];
  const read = async <T>(url: string, init?: RequestInit): Promise<T> => {
    calls.push({ url: new URL(url, 'http://localhost'), body: init?.body ? JSON.parse(String(init.body)) : null });
    return { session: { id: 'same' }, group: { id: 'same', name: 'Renamed' }, request: { status: 'accepted' } } as T;
  };
  await renameCodexSession(read, selected.profile, selected.id, 'Renamed');
  await organizeCodexSession(read, selected.profile, selected.id, { deleted: true });
  await sendCodexMessage(read, selected.profile, selected.id, 'Continue', 'request', {});
  await renameCodexGroup(read, selected.profile, 'same', 'Renamed');
  await deleteCodexGroup(read, selected.profile, 'same');
  expect(calls).toHaveLength(5);
  expect(calls.every(call => call.url.searchParams.get('profile') === 'writer')).toBe(true);
  expect(calls[2].body.profile).toBe('writer');
});
