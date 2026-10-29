/** Browser-local chat model aliases, scoped by profile and never written to Hermes config. */

export type ModelAliasStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type ModelAliases = Map<string, string>;

export const MODEL_ALIAS_MAX_LENGTH = 32;
export const MODEL_ALIASES_CHANGE_EVENT = 'hermes-workbench:model-aliases-change';
const STORAGE_PREFIX = 'workbench.model-aliases.v1:';
const fallback = new Map<string, ModelAliases>();

function storageKey(profile: string): string {
  return STORAGE_PREFIX + (profile.trim() || 'default');
}

function browserStorage(): ModelAliasStorage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Keep aliases single-line and short enough for the chat model menu. */
export function normalizeModelAlias(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MODEL_ALIAS_MAX_LENGTH);
}

export function readModelAliases(profile: string, store: ModelAliasStorage | null = browserStorage()): ModelAliases {
  const key = storageKey(profile);
  if (!store) return new Map(fallback.get(key) || []);
  try {
    const raw = store.getItem(key);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const aliases: ModelAliases = new Map();
    for (const [rawId, rawAlias] of Object.entries(parsed)) {
      const id = rawId.trim();
      if (!id || typeof rawAlias !== 'string') continue;
      const alias = normalizeModelAlias(rawAlias);
      if (alias) aliases.set(id, alias);
    }
    return aliases;
  } catch {
    return new Map(fallback.get(key) || []);
  }
}

export function writeModelAliases(
  profile: string,
  aliases: Iterable<[string, string]>,
  store: ModelAliasStorage | null = browserStorage(),
): ModelAliases {
  const key = storageKey(profile);
  const clean: ModelAliases = new Map();
  for (const [rawId, rawAlias] of aliases) {
    const id = rawId.trim();
    const alias = normalizeModelAlias(rawAlias);
    if (id && alias) clean.set(id, alias);
  }
  fallback.set(key, new Map(clean));
  if (store) {
    try {
      const sorted = [...clean].sort(([left], [right]) => left.localeCompare(right));
      store.setItem(key, JSON.stringify(Object.fromEntries(sorted)));
    } catch { /* Keep the in-memory copy. */ }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MODEL_ALIASES_CHANGE_EVENT));
  return clean;
}

/** Resolve a model id to the alias shown in the chat model menu. */
export function modelAlias<T extends { id: string; label: string }>(
  aliases: ReadonlyMap<string, string>,
  choice: T,
): string {
  return aliases.get(choice.id) || choice.label;
}

export function applyModelAliases<T extends { id: string; label: string }>(
  profile: string,
  choices: T[],
  store?: ModelAliasStorage | null,
): T[] {
  const aliases = readModelAliases(profile, store);
  if (!aliases.size) return choices;
  return choices.map(choice => {
    const alias = aliases.get(choice.id);
    return alias ? { ...choice, label: alias } : choice;
  });
}

/** Return the other model already using the same alias, ignoring case. */
export function aliasConflict(
  aliases: ReadonlyMap<string, string>,
  modelId: string,
  candidate: string,
): string | null {
  const target = normalizeModelAlias(candidate).toLocaleLowerCase();
  if (!target) return null;
  for (const [id, alias] of aliases) {
    if (id !== modelId && alias.toLocaleLowerCase() === target) return id;
  }
  return null;
}
