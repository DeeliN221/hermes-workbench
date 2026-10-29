// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aliasConflict,
  applyModelAliases,
  MODEL_ALIAS_MAX_LENGTH,
  MODEL_ALIASES_CHANGE_EVENT,
  MODEL_ALIASES_STORAGE_KEY,
  installModelAliasSync,
  normalizeModelAlias,
  readModelAliases,
  writeModelAliases,
  type ModelAliasStorage,
} from '../dashboard/src/model-aliases';
import { loadCodexModels } from '../dashboard/src/codex-api';
import type { FetchJSON } from '../dashboard/src/workbench-api';

function memoryStorage(): ModelAliasStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

const models = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'deepseek/deepseek-flash', label: 'DeepSeek Flash' },
];

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('chat model aliases', () => {
  it('keeps aliases per profile and applies them only to exact model ids', () => {
    const store = memoryStorage();
    writeModelAliases([['deepseek/deepseek-flash', 'ds-flash']], store);
    expect(applyModelAliases(models, store).map(model => model.label))
      .toEqual(['GPT-6.1 Sol', 'ds-flash']);
    expect(store.getItem(MODEL_ALIASES_STORAGE_KEY)).toBe('{"deepseek/deepseek-flash":"ds-flash"}');
  });

  it('migrates per-profile aliases once, preferring default and skipping duplicate names', () => {
    localStorage.setItem('workbench.model-aliases.v1:writer', JSON.stringify({ 'gpt-6.1-sol': 'sol', 'deepseek/deepseek-flash': 'writer-ds' }));
    localStorage.setItem('workbench.model-aliases.v1:default', JSON.stringify({ 'deepseek/deepseek-flash': 'ds' }));
    localStorage.setItem('workbench.model-aliases.v1:project-manager', JSON.stringify({ 'gpt-6.1-nova': 'SOL' }));
    expect([...readModelAliases(localStorage)]).toEqual([
      ['deepseek/deepseek-flash', 'ds'],
      ['gpt-6.1-nova', 'SOL'],
    ]);
    expect(JSON.parse(localStorage.getItem(MODEL_ALIASES_STORAGE_KEY)!)).toEqual({
      'deepseek/deepseek-flash': 'ds',
      'gpt-6.1-nova': 'SOL',
    });
    // After migration the shared key is authoritative, even when it is cleared.
    writeModelAliases([], localStorage);
    expect([...readModelAliases(localStorage)]).toEqual([]);
  });

  it('refreshes mounted menus when another tab edits the shared aliases', () => {
    const stop = installModelAliasSync(window);
    let changes = 0;
    const listener = () => { changes += 1; };
    window.addEventListener(MODEL_ALIASES_CHANGE_EVENT, listener);
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
      window.dispatchEvent(new StorageEvent('storage', { key: MODEL_ALIASES_STORAGE_KEY }));
      expect(changes).toBe(1);
    } finally {
      window.removeEventListener(MODEL_ALIASES_CHANGE_EVENT, listener);
      stop();
    }
  });

  it('normalizes whitespace, trims values, and caps long aliases', () => {
    const store = memoryStorage();
    const long = 'x'.repeat(MODEL_ALIAS_MAX_LENGTH + 8);
    writeModelAliases([[' deepseek/deepseek-flash ', '  ds   ' + long + '  '], ['', 'empty id'], ['gpt-6.1-sol', '   ']], store);
    const aliases = readModelAliases(store);
    expect([...aliases]).toEqual([['deepseek/deepseek-flash', 'ds ' + 'x'.repeat(MODEL_ALIAS_MAX_LENGTH - 3)]]);
    expect(normalizeModelAlias('  a\tb\n c  ')).toBe('a b c');
  });

  it('ignores malformed storage while preserving the in-memory fallback', () => {
    const store = memoryStorage();
    writeModelAliases([['gpt-6.1-sol', 'sol']], store);
    store.setItem('workbench.model-aliases.v1:writer', '{bad json');
    store.setItem(MODEL_ALIASES_STORAGE_KEY, '{bad json');
    expect([...readModelAliases(store)]).toEqual([['gpt-6.1-sol', 'sol']]);
  });

  it('detects duplicate aliases without breaking the stored alias', () => {
    const aliases = new Map([
      ['deepseek/deepseek-flash', 'ds-flash'],
      ['gpt-6.1-sol', 'sol'],
    ]);
    expect(aliasConflict(aliases, 'gpt-6.1-sol', 'DS-FLASH')).toBe('deepseek/deepseek-flash');
    expect(aliasConflict(aliases, 'gpt-6.1-sol', 'sol')).toBeNull();
    expect(aliasConflict(aliases, 'gpt-6.1-sol', 'new-name')).toBeNull();
  });

  it('notifies mounted chat surfaces after an alias change', () => {
    let changes = 0;
    const listener = () => { changes += 1; };
    window.addEventListener(MODEL_ALIASES_CHANGE_EVENT, listener);
    try {
      writeModelAliases([['gpt-6.1-sol', 'sol']], memoryStorage());
      expect(changes).toBe(1);
    } finally {
      window.removeEventListener(MODEL_ALIASES_CHANGE_EVENT, listener);
    }
  });

  it('uses the same custom alias in every profile chat model selector', async () => {
    writeModelAliases([['deepseek/deepseek-flash', 'ds-flash']], localStorage);
    const read = (async (url: string) => {
      if (url.includes('/codex/models')) {
        return {
          data: [
            { model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', isDefault: true },
            { model: 'deepseek/deepseek-flash', displayName: 'DeepSeek Flash', isDefault: false },
          ],
        };
      }
      return { model: 'gpt-6.1-sol' };
    }) as FetchJSON;
    for (const profile of ['default', 'writer']) {
      const choices = await loadCodexModels(read, profile);
      expect(choices.map(choice => [choice.id, choice.label])).toEqual([
        ['gpt-6.1-sol', 'GPT-6.1 Sol'],
        ['deepseek/deepseek-flash', 'ds-flash'],
      ]);
    }
  });
});
