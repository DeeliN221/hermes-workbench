import { describe, expect, it } from 'vitest';
import { readHiddenModels, visibleModels, writeHiddenModels, type ModelVisibilityStorage } from '../dashboard/src/model-visibility';

function memoryStorage(): ModelVisibilityStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

const models = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
  { id: 'google-antigravity/gemini-4-argon', label: 'Gemini 4 Argon' },
  { id: 'google-antigravity/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
];

describe('chat model visibility', () => {
  it('shows every catalog model by default', () => {
    expect(visibleModels('project-manager', models, memoryStorage())).toEqual(models);
  });

  it('keeps hidden models per profile and preserves catalog order', () => {
    const store = memoryStorage();
    writeHiddenModels('project-manager', ['google-antigravity/gemini-3.8-flash'], store);
    expect(visibleModels('project-manager', models, store).map(model => model.id)).toEqual([
      'gpt-6.1-sol', 'google-antigravity/gemini-4-argon',
    ]);
    expect(visibleModels('writer', models, store)).toEqual(models);
    expect([...readHiddenModels('project-manager', store)]).toEqual(['google-antigravity/gemini-3.8-flash']);
  });

  it('ignores malformed storage and keeps the in-memory fallback usable', () => {
    const store = memoryStorage();
    store.setItem('workbench.model-visibility.v1:default', '{bad json');
    expect(visibleModels('default', models, store)).toEqual(models);
  });
});
