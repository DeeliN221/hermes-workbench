import type { FetchJSON } from './workbench-api';

import { standalone } from './runtime-mode';
type Models = { data?: unknown[]; models?: unknown[]; default?: { model?: string; provider?: string } };
type Entry = { expires: number; models?: Promise<Models>; config?: Promise<unknown> };
// Scope to both the authenticated client and profile. Never persist config or credentials.
const clients = new WeakMap<FetchJSON, Map<string, Entry>>();

function catalogRows(catalog: Models): unknown[] {
  return Array.isArray(catalog) ? catalog : catalog.data ?? catalog.models ?? [];
}

function modelId(row: unknown): string {
  if (!row || typeof row !== 'object') return '';
  const value = (row as { model?: unknown; id?: unknown }).model ?? (row as { id?: unknown }).id;
  return typeof value === 'string' ? value.trim() : '';
}

async function mergeCatalog(catalog: Models, extra: Models): Promise<Models> {
  const data = [...catalogRows(catalog)];
  const seen = new Set(data.map(modelId).filter(Boolean));
  for (const row of catalogRows(extra)) {
    const id = modelId(row);
    if (!id || !seen.has(id)) {
      if (id) seen.add(id);
      data.push(row);
    }
  }
  return { data };
}

export async function loadChatSetup(read: FetchJSON, profile: string): Promise<[Models, unknown]> {
  if (standalone) {
    const [catalog, config] = await Promise.all([read<Models>('/api/runtime/models'), read<unknown>(`/api/config?profile=${encodeURIComponent(profile)}`)]);
    const data = catalogRows(catalog).filter(row => !catalog.default?.provider || (row as Record<string, unknown>).provider === catalog.default.provider).map(row => {
      const model = row as Record<string, unknown>;
      return { ...model, id: model.id, displayName: model.label || model.name || model.id, isDefault: model.isDefault ?? model.is_default ?? model.id === catalog.default?.model, supportedReasoningEfforts: [], defaultReasoningEffort: '' };
    });
    return [{ data }, config];
  }
  let profiles = clients.get(read);
  if (!profiles) clients.set(read, profiles = new Map());
  let entry = profiles.get(profile);
  if (!entry) profiles.set(profile, entry = { expires: 0 });
  const key = encodeURIComponent(profile);
  if (!entry.models || entry.expires <= Date.now()) {
    entry.expires = Date.now() + 30000;
    const codex = read<Models>(`/api/plugins/workbench/codex/models?profile=${key}`);
    const opencode = read<Models>(`/api/plugins/workbench/opencode/models?profile=${key}`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => ({ data: [] }));
    const merged: Promise<Models> = Promise.all([codex, opencode]).then(([c, o]) => mergeCatalog(c, o));
    entry.models = merged;
    void merged.catch(() => { if (entry!.models === merged) entry!.models = undefined; });
  }
  // Defaults are always fresh on navigation; only simultaneous reads share a request.
  if (!entry.config) {
    const request = read<unknown>(`/api/config?profile=${key}`);
    entry.config = request;
    const clear = () => { if (entry!.config === request) entry!.config = undefined; };
    void request.then(clear, clear);
  }
  return Promise.all([entry.models, entry.config]);
}
