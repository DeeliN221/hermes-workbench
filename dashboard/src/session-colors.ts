/**
 * Shared accent colours for Codex sessions. The pane header and the temporary
 * session card read one profile-scoped store so a change on either side shows
 * up immediately in the other without waiting for the next list poll.
 */
import { organizeCodexSession, type CodexSession } from './codex-api';
import type { FetchJSON } from './workbench-api';

export const SESSION_COLORS = [
  '#3b82f6', '#14b8a6', '#8b5cf6', '#f59e0b',
  '#f43f5e', '#22c55e', '#06b6d4', '#f97316',
] as const;

export const SESSION_COLOR_LABELS = [
  ['蓝色', 'Blue'], ['青色', 'Teal'], ['紫色', 'Purple'], ['琥珀色', 'Amber'],
  ['玫红色', 'Rose'], ['绿色', 'Green'], ['天蓝色', 'Cyan'], ['橙色', 'Orange'],
] as const;

type SessionColorEntry = { color: string; pending: boolean };
type SessionColorSource = { id: string; color?: string };

const entries = new Map<string, SessionColorEntry>();
const listeners = new Set<() => void>();
const writes = new Map<string, number>();
let writeSequence = 0;

const keyOf = (profile: string, sessionId: string) => `${profile}\u0000${sessionId}`;

export function isSessionColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}

/** Empty means "no explicit colour"; invalid values are treated the same way. */
export function normalizeSessionColor(value: unknown): string {
  return isSessionColor(value) ? value.toLowerCase() : '';
}

/** FNV-1a keeps the fallback stable across refreshes, panes, and profiles. */
export function defaultSessionColor(profile: string, sessionId: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${profile}\u0000${sessionId}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return SESSION_COLORS[hash % SESSION_COLORS.length];
}

/** Explicit colour when one exists, otherwise the deterministic fallback. */
export function sessionColor(profile: string, sessionId: string, stored = ''): string {
  const entry = entries.get(keyOf(profile, sessionId));
  const value = entry ? entry.color : normalizeSessionColor(stored);
  return value || defaultSessionColor(profile, sessionId);
}

export function subscribeSessionColors(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  for (const listener of [...listeners]) listener();
}

/** Adopt server truth unless a local write for that session is in flight. */
export function primeSessionColors(profile: string, sessions: SessionColorSource[]) {
  let changed = false;
  for (const session of sessions) {
    const key = keyOf(profile, session.id), color = normalizeSessionColor(session.color);
    const entry = entries.get(key);
    if (entry) {
      if (!entry.pending && entry.color !== color) { entry.color = color; changed = true; }
      continue;
    }
    entries.set(key, { color, pending: false });
    changed = true;
  }
  if (changed) notify();
}

/**
 * Persist one colour and keep both surfaces in sync while the request runs.
 * A failed PATCH restores the previous colour so neither side keeps a lie.
 */
export async function saveSessionColor(
  read: FetchJSON, profile: string, sessionId: string, color: string,
): Promise<CodexSession | null> {
  const key = keyOf(profile, sessionId), previous = entries.get(key);
  const value = normalizeSessionColor(color);
  const token = ++writeSequence;
  writes.set(key, token);
  entries.set(key, { color: value, pending: true });
  notify();
  try {
    const saved = await organizeCodexSession(read, profile, sessionId, { color: value });
    if (writes.get(key) === token) {
      writes.delete(key);
      entries.set(key, {
        color: saved ? normalizeSessionColor(saved.color) : value,
        pending: false,
      });
      notify();
    }
    return saved;
  } catch (error) {
    if (writes.get(key) === token) {
      writes.delete(key);
      if (previous) entries.set(key, { ...previous });
      else entries.delete(key);
      notify();
    }
    throw error;
  }
}

/** Test helper: drop every cached colour and subscriber. */
export function resetSessionColors() {
  entries.clear();
  listeners.clear();
  writes.clear();
}
