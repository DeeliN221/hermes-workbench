// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aliasConflict,
  applyModelAliases,
  MODEL_ALIAS_MAX_LENGTH,
  MODEL_ALIASES_CHANGE_EVENT,
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
    writeModelAliases('project-manager', [['deepseek/deepseek-flash', 'ds-flash']], store);
    expect(applyModelAliases('project-manager', models, store).map(model => model.label))
      .toEqual(['GPT-6.1 Sol', 'ds-flash']);
    expect(applyModelAliases('writer', models, store).map(model => model.label))
      .toEqual(['GPT-6.1 Sol', 'DeepSeek Flash']);
  });

  it('normalizes whitespace, trims values, and caps long aliases', () => {
    const store = memoryStorage();
    const long = 'x'.repeat(MODEL_ALIAS_MAX_LENGTH + 8);
    writeModelAliases('writer', [[' deepseek/deepseek-flash ', '  ds   ' + long + '  '], ['', 'empty id'], ['gpt-6.1-sol', '   ']], store);
    const aliases = readModelAliases('writer', store);
    expect([...aliases]).toEqual([['deepseek/deepseek-flash', 'ds ' + 'x'.repeat(MODEL_ALIAS_MAX_LENGTH - 3)]]);
    expect(normalizeModelAlias('  a\tb\n c  ')).toBe('a b c');
  });

  it('ignores malformed storage while preserving the in-memory fallback', () => {
    const store = memoryStorage();
    writeModelAliases('writer', [['gpt-6.1-sol', 'sol']], store);
    store.setItem('workbench.model-aliases.v1:writer', '{bad json');
    expect([...readModelAliases('writer', store)]).toEqual([['gpt-6.1-sol', 'sol']]);
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
      writeModelAliases('writer', [['gpt-6.1-sol', 'sol']], memoryStorage());
      expect(changes).toBe(1);
    } finally {
      window.removeEventListener(MODEL_ALIASES_CHANGE_EVENT, listener);
    }
  });

  it('uses the custom alias in the labels returned to the chat model selector', async () => {
    writeModelAliases('default', [['deepseek/deepseek-flash', 'ds-flash']], localStorage);
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
    const choices = await loadCodexModels(read, 'default');
    expect(choices.map(choice => [choice.id, choice.label])).toEqual([
      ['gpt-6.1-sol', 'GPT-6.1 Sol'],
      ['deepseek/deepseek-flash', 'ds-flash'],
    ]);
  });
});
