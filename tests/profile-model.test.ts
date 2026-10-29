import { describe, expect, it } from 'vitest';
import { applyProfileModel, applyProfileChatDefaults, closestEffort, modelKey } from '../dashboard/src/profile-model';

const models = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'].map((id, index) => ({ id, label: id, isDefault: index === 0 }));

describe('profile default model', () => {
  it('overrides the shared service default with each profile configuration', () => {
    for (const id of ['gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-Sol']) {
      const result = applyProfileModel(models, { model: { default: id } });
      expect(result.filter(model => model.isDefault).map(model => model.id)).toEqual([id.toLowerCase()]);
    }
    expect(models[0].isDefault).toBe(true);
  });
  it('supports string settings and service defaults when no profile setting exists', () => {
    expect(applyProfileModel(models, { model: 'gpt-6-luna' })[2].isDefault).toBe(true);
    expect(applyProfileModel(models, {})).toEqual(models);
  });
  it('falls back to the catalog default when a profile still names an unavailable model', () => {
    expect(applyProfileModel(models, { model: { default: 'unavailable' } })
      .find(model => model.isDefault)?.id).toBe('gpt-6.1-sol');
  });
  it('resolves a provider-qualified version alias to the live Codex model', () => {
    const live = [{ id: 'deepseek/deepseek-flash', label: 'DeepSeek Flash', isDefault: false }];
    expect(applyProfileModel(live, { model: { default: 'deepseek/deepseek-v4-flash' }})[0].isDefault).toBe(true);
    expect(modelKey('deepseek/deepseek-v4-flash')).toBe('deepseek-flash');
  });
});

describe('profile chat defaults', () => {
  const catalog = models.map(model => ({ ...model, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', supportsFast: true, fastServiceTier: 'priority' }));
  it('keeps different profiles isolated and honors per-model reasoning overrides', () => {
    const writer = applyProfileChatDefaults(catalog, { model: 'gpt-6-astra', agent: { reasoning_effort: 'high', reasoning_overrides: { 'gpt-6-astra': 'low' }, service_tier: 'priority' } });
    const coach = applyProfileChatDefaults(catalog, { model: 'gpt-6-luna', agent: { reasoning_effort: 'high', service_tier: 'default' } });
    expect(writer.find(m => m.isDefault)).toMatchObject({ id: 'gpt-6-astra', defaultEffort: 'low', defaultFast: true });
    expect(coach.find(m => m.isDefault)).toMatchObject({ id: 'gpt-6-luna', defaultEffort: 'high', defaultFast: false });
    expect(catalog[0].defaultEffort).toBe('medium');
  });
  it('uses catalog defaults when unset and adapts unsupported settings', () => {
    expect(applyProfileChatDefaults(catalog, {})[0]).toMatchObject({ defaultEffort: 'medium', defaultFast: false });
    expect(applyProfileChatDefaults(catalog, { agent: { reasoning_effort: 'ultra' } })[0].defaultEffort).toBe('high');
    expect(applyProfileChatDefaults(catalog.map(m => ({ ...m, fastServiceTier: undefined })), { agent: { service_tier: 'priority' } })[0].defaultFast).toBe(false);
  });
  it('matches reasoning overrides through provider and version aliases', () => {
    const deepseek = [{ id: 'deepseek/deepseek-flash', label: 'DeepSeek Flash', isDefault: false,
      efforts: ['low', 'high', 'max'], defaultEffort: 'high', supportsFast: false }];
    const result = applyProfileChatDefaults(deepseek, {
      model: { default: 'deepseek/deepseek-v4-flash' },
      agent: { reasoning_effort: 'xhigh', reasoning_overrides: { 'deepseek/deepseek-v4-flash': 'max' } },
    });
    expect(result[0]).toMatchObject({ id: 'deepseek/deepseek-flash', isDefault: true, defaultEffort: 'max', defaultFast: false });
    expect(closestEffort('xhigh', ['low', 'high', 'max'])).toBe('max');
  });
});
