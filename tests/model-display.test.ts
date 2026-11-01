// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { loadModelDisplay, migrationPreferences, modelIsVisible, saveModelDisplay, type ModelDisplay } from '../dashboard/src/model-display';
import { loadCodexModels } from '../dashboard/src/codex-api';
import type { FetchJSON } from '../dashboard/src/workbench-api';
afterEach(() => localStorage.clear());
it('starts with exactly 3+1 visible models and their aliases', () => {
  const value = migrationPreferences('default');
  expect(value.visible).toEqual(['gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-terra', 'deepseek/deepseek-flash']);
  expect(Object.values(value.aliases)).toEqual(['astra', 'luna', 'terra', 'ds']);
  expect(modelIsVisible(value, 'gpt-new')).toBe(false);
});
it('merges profile v1 and shared v2, preserves explicit show-all and custom values', () => {
  localStorage.setItem('workbench.model-visibility.v1:writer', '[]');
  localStorage.setItem('workbench.model-aliases.v1:writer', JSON.stringify({ custom: 'writer', 'gpt-6-astra': 'old' }));
  localStorage.setItem('workbench.model-aliases.v1:other', JSON.stringify({ other: 'private' }));
  localStorage.setItem('workbench.model-aliases.v2', JSON.stringify({ 'gpt-6-astra': 'mine' }));
  const value = migrationPreferences('writer');
  expect(value.aliases.custom).toBe('writer');
  expect(value.aliases['gpt-6-astra']).toBe('mine');
  expect(value.aliases.other).toBeUndefined();
  expect(modelIsVisible(value, 'gpt-new')).toBe(true);
  expect(migrationPreferences('other').mode).toBe('visible');
});
it('ignores corrupt keys and respects an explicitly empty alias map', () => {
  localStorage.setItem('workbench.model-visibility.v1:default', '{');
  localStorage.setItem('workbench.model-aliases.v2', '{}');
  expect(migrationPreferences('default').aliases).toEqual({});
  expect(migrationPreferences('default').mode).toBe('visible');
});
it('migrates once, then ignores stale or absent browser storage across clients', async () => {
  let saved: ModelDisplay | null = null;
  let migrations = 0;
  const read = (async (_url: string, init?: RequestInit) => {
    if (init) { migrations++; saved ||= { ...JSON.parse(String(init.body)), revision: 1 }; }
    return { preferences: saved };
  }) as FetchJSON;
  const first = await loadModelDisplay(read, 'default');
  localStorage.setItem('workbench.model-aliases.v2', '{"gpt-6-astra":"stale"}');
  expect(await loadModelDisplay(read, 'default')).toEqual(first);
  localStorage.clear();
  expect(await loadModelDisplay(read, 'default')).toEqual(first);
  expect(migrations).toBe(1);
});
it('chat reads server preferences, independently for each profile', async () => {
  const read = (async (url: string) => {
    if (url.includes('/model-display')) return { preferences: { ...migrationPreferences('default'), aliases: { 'gpt-6-astra': url.includes('writer') ? 'writer' : 'astra' } } };
    if (url.includes('/models')) return { data: [{ model: 'gpt-6-astra' }, { model: 'gpt-hidden' }] };
    return {};
  }) as FetchJSON;
  expect((await loadCodexModels(read, 'default')).map(row => row.label)).toEqual(['astra']);
  expect((await loadCodexModels(read, 'writer')).map(row => row.label)).toEqual(['writer']);
});
it('propagates save errors without altering the last saved value or legacy storage', async () => {
  const value = migrationPreferences('default');
  const before = JSON.stringify(value);
  const read = (async () => { throw new Error('disk full'); }) as FetchJSON;
  await expect(saveModelDisplay(read, 'default', value)).rejects.toThrow('disk full');
  expect(JSON.stringify(value)).toBe(before);
  expect(localStorage.length).toBe(0);
});
