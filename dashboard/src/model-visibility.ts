/** Browser-local chat model visibility, scoped by profile and never written to Hermes config. */

export type ModelVisibilityStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_PREFIX = 'workbench.model-visibility.v1:';
const fallback = new Map<string, Set<string>>();

function storageKey(profile: string): string {
  return STORAGE_PREFIX + (profile.trim() || 'default');
}

function browserStorage(): ModelVisibilityStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export function readHiddenModels(profile: string, store: ModelVisibilityStorage | null = browserStorage()): Set<string> {
  const key = storageKey(profile);
  if (!store) return new Set(fallback.get(key) || []);
  try {
    const raw = store.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && !!id.trim()).map(id => id.trim()));
  } catch {
    return new Set(fallback.get(key) || []);
  }
}

export function writeHiddenModels(profile: string, hidden: Iterable<string>, store: ModelVisibilityStorage | null = browserStorage()): Set<string> {
  const key = storageKey(profile);
  const clean = new Set([...hidden].map(id => id.trim()).filter(Boolean));
  fallback.set(key, clean);
  if (store) {
    try { store.setItem(key, JSON.stringify([...clean].sort())); } catch { /* Keep the in-memory copy. */ }
  }
  return clean;
}

export function visibleModels<T extends { id: string }>(profile: string, choices: T[], store?: ModelVisibilityStorage | null): T[] {
  const hidden = readHiddenModels(profile, store);
  return hidden.size ? choices.filter(choice => !hidden.has(choice.id)) : choices;
}
