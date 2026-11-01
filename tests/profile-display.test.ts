// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { loadProfileDisplay, saveProfileDisplay } from '../dashboard/src/profile-display';
import { profileTabName, agentDisplayName } from '../dashboard/src/kanban-agent-picker';
it('loads backend names and resets to the localized fallback without changing IDs', async () => {
  const aliases: Record<string, string> = {};
  const calls: string[] = [];
  const read = async <T>(url: string, init?: RequestInit): Promise<T> => {
    calls.push(url);
    if (init?.method === 'PUT') aliases[new URL(url, location.origin).searchParams.get('profile')!] = JSON.parse(String(init.body)).display_name;
    return { aliases: { ...aliases } } as T;
  };
  await saveProfileDisplay(read, 'default', 'Main Agent');
  expect(profileTabName('default')).toBe('Main Agent');
  expect(agentDisplayName('default')).toContain('default');
  expect(calls[0]).toContain('profile=default');
  await loadProfileDisplay(read);
  expect(profileTabName('default')).toBe('Main Agent');
  await saveProfileDisplay(read, 'default', '');
  expect(profileTabName('default')).toBe('default');
  expect(profileTabName('constructor')).toBe('constructor');
});
