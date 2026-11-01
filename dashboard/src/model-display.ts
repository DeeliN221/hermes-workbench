/** Server-owned preferences. Legacy browser keys are read only, never updated. */
import type { FetchJSON } from './workbench-api';
import { normalizeModelAlias } from './model-aliases';
export interface ModelDisplay {
  mode: 'visible' | 'hidden'; visible: string[]; hidden: string[];
  aliases: Record<string, string>; revision: number;
}
const defaults = { 'gpt-6-astra': 'astra', 'gpt-6-luna': 'luna', 'gpt-6.1-terra': 'terra', 'deepseek/deepseek-flash': 'ds' };
const endpoint = (profile: string) => `/api/plugins/workbench/model-display?profile=${encodeURIComponent(profile)}`;
function legacy(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
}
export function migrationPreferences(profile: string): ModelDisplay {
  const result: ModelDisplay = { mode: 'visible', visible: Object.keys(defaults), hidden: [], aliases: { ...defaults }, revision: 0 };
  const hidden = legacy(`workbench.model-visibility.v1:${profile}`);
  if (Array.isArray(hidden)) {
    result.mode = 'hidden'; result.hidden = hidden.filter((id): id is string => typeof id === 'string').map(id => id.trim()).filter(Boolean);
  }
  const old = legacy(`workbench.model-aliases.v1:${profile}`);
  const shared = legacy('workbench.model-aliases.v2');
  for (const value of [old, shared]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    // Explicit empty maps mean original names; do not restore defaults.
    if (!Object.keys(value).length) result.aliases = {};
    for (const [id, alias] of Object.entries(value)) {
      if (typeof alias === 'string' && id.trim()) {
        const clean = normalizeModelAlias(alias);
        // Existing names take priority over colliding defaults or legacy names.
        for (const key of Object.keys(result.aliases)) {
          if (result.aliases[key].toLowerCase() === clean.toLowerCase()) delete result.aliases[key];
        }
        if (clean) result.aliases[id] = clean;
        else delete result.aliases[id];
      }
    }
  }
  return result;
}
export async function loadModelDisplay(read: FetchJSON, profile: string): Promise<ModelDisplay> {
  const response = await read<{ preferences: ModelDisplay | null }>(endpoint(profile));
  if (response.preferences) return response.preferences;
  const migrated = await read<{ preferences: ModelDisplay }>(`/api/plugins/workbench/model-display/migrate?profile=${encodeURIComponent(profile)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(migrationPreferences(profile)),
  });
  if (!migrated.preferences) throw new Error('Invalid model display response');
  return migrated.preferences;
}
export async function saveModelDisplay(read: FetchJSON, profile: string, preferences: ModelDisplay): Promise<ModelDisplay> {
  const result = await read<{ preferences: ModelDisplay }>(endpoint(profile), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences),
  });
  if (!result.preferences) throw new Error('Invalid model display response');
  window.dispatchEvent(new Event('hermes-workbench:model-aliases-change'));
  return result.preferences;
}
export function modelIsVisible(preferences: ModelDisplay, id: string): boolean {
  return preferences.mode === 'hidden' ? !preferences.hidden.includes(id) : preferences.visible.includes(id);
}
