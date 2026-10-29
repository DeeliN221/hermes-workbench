/**
 * Persist a compact Codex pane snapshot so a full page reload paints the latest
 * messages before the session preview and authoritative snapshot arrive.
 */

export type CodexSnapshotPreview = {
  messages: any[];
  turnId: string;
};

const PREFIX = 'hermes-workbench.codex-snapshot.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SERIALIZED_CHARS = 450_000;
const MESSAGE_COUNTS = [48, 24, 12, 6, 3, 1];

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(key: string): string {
  return `${PREFIX}:${encodeURIComponent(key)}`;
}

/** Save only the newest messages, shrinking until localStorage accepts the snapshot. */
export function saveCodexSnapshot(key: string, snapshot: { messages?: any[]; turnId?: string }): void {
  const target = storage();
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  if (!target || !key || messages.length === 0) return;
  const turnId = String(snapshot.turnId || '');
  for (const count of MESSAGE_COUNTS) {
    try {
      const serialized = JSON.stringify({
        cachedAt: Date.now(),
        messages: messages.slice(-count),
        turnId,
      });
      if (serialized.length > MAX_SERIALIZED_CHARS) continue;
      target.setItem(storageKey(key), serialized);
      return;
    } catch {
      // Quota or privacy failures must never block live session updates.
    }
  }
}

/** Read a fresh snapshot synchronously; malformed and expired entries are ignored. */
export function loadCodexSnapshot(key: string): CodexSnapshotPreview | null {
  const target = storage();
  if (!target || !key) return null;
  try {
    const raw = target.getItem(storageKey(key));
    if (!raw) return null;
    const value = JSON.parse(raw) as { cachedAt?: number; messages?: unknown; turnId?: unknown };
    if (Date.now() - Number(value.cachedAt || 0) > MAX_AGE_MS || !Array.isArray(value.messages)) return null;
    return { messages: value.messages, turnId: String(value.turnId || '') };
  } catch {
    return null;
  }
}

function messageText(message: any): string {
  const content = message?.content ?? message?.text ?? '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => typeof part === 'string' ? part : String(part?.text || '')).join('\n');
}

/** Return the latest user/assistant text for the thin loader's pre-runtime preview. */
export function loadCodexPreview(key: string, limit = 2): Array<{ role: 'user' | 'assistant'; content: string }> {
  const snapshot = loadCodexSnapshot(key);
  if (!snapshot) return [];
  return snapshot.messages
    .filter(message => message?.role === 'user' || message?.role === 'assistant')
    .slice(-Math.max(1, limit))
    .map(message => ({ role: message.role, content: messageText(message).slice(-1_600) }))
    .filter(message => message.content.trim());
}
