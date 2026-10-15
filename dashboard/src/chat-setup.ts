import type { FetchJSON } from './workbench-api';

type Models = { data?: unknown[]; models?: unknown[] };
type Entry = { expires: number; models?: Promise<Models>; config?: Promise<unknown> };
// Scope to both the authenticated client and profile. Never persist config or credentials.
const clients = new WeakMap<FetchJSON, Map<string, Entry>>();
export async function loadChatSetup(read: FetchJSON, profile: string): Promise<[Models, unknown]> {
  let profiles = clients.get(read);
  if (!profiles) clients.set(read, profiles = new Map());
  let entry = profiles.get(profile);
  if (!entry) profiles.set(profile, entry = { expires: 0 });
  const key = encodeURIComponent(profile);
  if (!entry.models || entry.expires <= Date.now()) {
    entry.expires = Date.now() + 30000;
    const request = read<Models>(`/api/plugins/workbench/codex/models?profile=${key}`);
    entry.models = request;
    void request.catch(() => { if (entry!.models === request) entry!.models = undefined; });
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
