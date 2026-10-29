/**
 * Browser-local chat model aliases shared by every profile.
 *
 * Aliases describe a model id, not a profile, so one rename applies wherever the
 * same model appears. They are never written to Hermes or Codex configuration.
 */

export type ModelAliasStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type ModelAliases = Map<string, string>;

export const MODEL_ALIAS_MAX_LENGTH = 32;
export const MODEL_ALIASES_CHANGE_EVENT = 'hermes-workbench:model-aliases-change';
export const MODEL_ALIASES_STORAGE_KEY = 'workbench.model-aliases.v2';
/** Per-profile keys written by the first alias release; migrated once into the shared key. */
const LEGACY_PREFIX = 'workbench.model-aliases.v1:';
let fallback: ModelAliases = new Map();

type EnumerableStorage = ModelAliasStorage & { readonly length?: number; key?: (index: number) => string | null };

function browserStorage(): ModelAliasStorage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Keep aliases single-line and short enough for the chat model menu. */
export function normalizeModelAlias(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MODEL_ALIAS_MAX_LENGTH);
}

function parseAliases(raw: string | null): ModelAliases | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const aliases: ModelAliases = new Map();
  for (const [rawId, rawAlias] of Object.entries(parsed)) {
    const id = rawId.trim();
    if (!id || typeof rawAlias !== 'string') continue;
    const alias = normalizeModelAlias(rawAlias);
    if (alias) aliases.set(id, alias);
  }
  return aliases;
}

function serialize(aliases: ModelAliases): string {
  const sorted = [...aliases].sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(sorted));
}

/** Return the legacy profile names in migration order: default first, then alphabetical. */
function legacyProfiles(store: EnumerableStorage): string[] {
  if (typeof store.length !== 'number' || typeof store.key !== 'function') return [];
  const names: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(LEGACY_PREFIX)) names.push(key.slice(LEGACY_PREFIX.length));
  }
  return names.sort((left, right) => (left === 'default' ? -1 : right === 'default' ? 1 : left.localeCompare(right)));
}

/**
 * Merge the old per-profile aliases once. When profiles disagree, the default
 * profile wins, then profiles in name order; a name already taken by another
 * model is skipped so the shared menu never shows duplicates.
 */
function migrateLegacyAliases(store: EnumerableStorage): ModelAliases {
  const merged: ModelAliases = new Map();
  for (const profile of legacyProfiles(store)) {
    let aliases: ModelAliases | null = null;
    try { aliases = parseAliases(store.getItem(LEGACY_PREFIX + profile)); } catch { aliases = null; }
    for (const [id, alias] of aliases || []) {
      if (merged.has(id) || aliasConflict(merged, id, alias)) continue;
      merged.set(id, alias);
    }
  }
  try {
    store.setItem(MODEL_ALIASES_STORAGE_KEY, serialize(merged));
  } catch { /* Retry the migration on the next read. */ }
  return merged;
}

export function readModelAliases(store: ModelAliasStorage | null = browserStorage()): ModelAliases {
  if (!store) return new Map(fallback);
  try {
    const raw = store.getItem(MODEL_ALIASES_STORAGE_KEY);
    if (raw === null) return migrateLegacyAliases(store as EnumerableStorage);
    return parseAliases(raw) || new Map();
  } catch {
    return new Map(fallback);
  }
}

export function writeModelAliases(
  aliases: Iterable<[string, string]>,
  store: ModelAliasStorage | null = browserStorage(),
): ModelAliases {
  const clean: ModelAliases = new Map();
  for (const [rawId, rawAlias] of aliases) {
    const id = rawId.trim();
    const alias = normalizeModelAlias(rawAlias);
    if (id && alias) clean.set(id, alias);
  }
  fallback = new Map(clean);
  if (store) {
    try { store.setItem(MODEL_ALIASES_STORAGE_KEY, serialize(clean)); } catch { /* Keep the in-memory copy. */ }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MODEL_ALIASES_CHANGE_EVENT));
  return clean;
}

/** Re-broadcast alias edits made in another tab so mounted chat menus refresh. */
export function installModelAliasSync(target: Window = window): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === MODEL_ALIASES_STORAGE_KEY) target.dispatchEvent(new Event(MODEL_ALIASES_CHANGE_EVENT));
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}

/** Resolve a model id to the alias shown in the chat model menu. */
export function modelAlias<T extends { id: string; label: string }>(
  aliases: ReadonlyMap<string, string>,
  choice: T,
): string {
  return aliases.get(choice.id) || choice.label;
}

export function applyModelAliases<T extends { id: string; label: string }>(
  choices: T[],
  store?: ModelAliasStorage | null,
): T[] {
  const aliases = readModelAliases(store);
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
