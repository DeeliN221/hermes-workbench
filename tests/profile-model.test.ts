import { describe, expect, it } from 'vitest';
import { applyProfileModel, applyProfileChatDefaults } from '../dashboard/src/profile-model';

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
  it('reports unavailable configured models instead of silently using another model', () => {
    expect(() => applyProfileModel(models, { model: { default: 'unavailable' } })).toThrow('unavailable');
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
  it('uses catalog defaults when unset and reports unsupported settings', () => {
    expect(applyProfileChatDefaults(catalog, {})[0]).toMatchObject({ defaultEffort: 'medium', defaultFast: false });
    expect(() => applyProfileChatDefaults(catalog, { agent: { reasoning_effort: 'ultra' } })).toThrow('ultra');
    expect(() => applyProfileChatDefaults(catalog.map(m => ({ ...m, fastServiceTier: undefined })), { agent: { service_tier: 'priority' } })).toThrow();
  });
});
