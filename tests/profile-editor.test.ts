import { describe, expect, it } from 'vitest';
import { configuredProviders } from '../dashboard/src/profile-editor';

describe('profile model inventory', () => {
  it('excludes unconfigured catalogs even when they contain supported models', () => {
    const rows = configuredProviders({ providers: [
      { slug: 'openai-codex', authenticated: true, models: ['gpt-6.1-sol', 'gpt-6-luna'] },
      { slug: 'anthropic', authenticated: false, models: ['claude-opus'] },
      { slug: 'unknown', models: ['unverified'] },
    ] });
    expect(rows.map(row => row.slug)).toEqual(['openai-codex']);
  });
  it('keeps authenticated custom providers without a catalog for manual model IDs', () => {
    expect(configuredProviders({ providers: [{ slug: 'local', authenticated: true }] }))
      .toEqual([{ slug: 'local', authenticated: true, models: [] }]);
  });
  it('deduplicates suggestions without mutating the shared API inventory', () => {
    const provider = { slug: 'openai-codex', authenticated: true, models: ['gpt-6.1-sol', 'gpt-6.1-sol', ''] };
    expect(configuredProviders({ providers: [provider] })[0].models).toEqual(['gpt-6.1-sol']);
    expect(provider.models).toHaveLength(3);
  });
  it('reports malformed responses rather than presenting a successful empty list', () => {
    expect(() => configuredProviders({} as any)).toThrow('Invalid model options response');
  });
});
