/**
 * Shared per-session titles for the Codex sidebar and every open pane.
 *
 * The sidebar card and each pane header read the same profile-scoped store, so
 * renaming from either entry point updates every other view immediately instead
 * of waiting for the next two-second list poll. The server stays the source of
 * truth: a stored title is adopted on every list refresh, and clearing a title
 * falls back to the first-message default derived in `session-title.ts`.
 */
import { renameCodexSession, type CodexSession } from './codex-api';
import type { FetchJSON } from './workbench-api';
import { uiText } from './ui-locale';

/** Mirrors the server limit applied after whitespace normalization. */
export const MAX_SESSION_TITLE_LENGTH = 200;

type TitleEntry = { title: string; source: 'user' | 'cleared' | 'derived'; pending: boolean };
type TitleSource = { id: string; title?: string; customTitle?: string | null; titleSource?: string | null };

export type SessionTitleErrorCode = 'too-long' | 'not-found' | 'invalid' | 'network' | 'unknown';

const entries = new Map<string, TitleEntry>();
const listeners = new Set<() => void>();
const writes = new Map<string, number>();
let writeSequence = 0;

const keyOf = (profile: string, sessionId: string) => `${profile}\u0000${sessionId}`;

function notify() {
  for (const listener of [...listeners]) listener();
}

export function subscribeSessionTitles(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Collapse whitespace exactly like the server before measuring or saving. */
export function normalizeSessionTitleDraft(value: unknown): string {
  return String(value ?? '').split(/\s+/).filter(Boolean).join(' ');
}

/** Null when the draft can be saved, otherwise the reason it cannot. */
export function sessionTitleDraftError(value: unknown): SessionTitleErrorCode | null {
  return normalizeSessionTitleDraft(value).length > MAX_SESSION_TITLE_LENGTH ? 'too-long' : null;
}

/** The locally known title, or null while the server record decides. */
export function sessionTitleEntry(profile: string, sessionId: string): { title: string; source: 'user' | 'cleared' | 'derived' } | null {
  const entry = entries.get(keyOf(profile, sessionId));
  return entry ? { title: entry.title, source: entry.source } : null;
}

function setEntry(profile: string, sessionId: string, entry: TitleEntry) {
  entries.set(keyOf(profile, sessionId), entry);
  notify();
}

/**
 * Adopt server truth. A cleared or transcript-derived entry survives list polls
 * until the server owns a title again, so a refresh cannot resurrect the title
 * the user just removed or drop the default they were shown.
 */
export function primeSessionTitles(profile: string, sessions: TitleSource[]) {
  let changed = false;
  for (const session of sessions) {
    const key = keyOf(profile, session.id), entry = entries.get(key);
    if (entry?.pending) continue;
    const custom = normalizeSessionTitleDraft(session.customTitle);
    if (custom) {
      if (!entry || entry.title !== custom || entry.source !== 'user') {
        entries.set(key, { title: custom, source: 'user', pending: false });
        changed = true;
      }
      continue;
    }
    const namesSession = session.titleSource === 'auto' && Boolean(session.title) && session.title !== session.id;
    if (entry && namesSession) {
      entries.delete(key);
      changed = true;
    }
  }
  if (changed) notify();
}

/**
 * Keep the first-message default a transcript reveals. Explicit names still win,
 * and the next list poll decides once the server names the session itself.
 */
export function rememberDerivedSessionTitle(profile: string, sessionId: string, title: string) {
  const key = keyOf(profile, sessionId), entry = entries.get(key), value = normalizeSessionTitleDraft(title);
  if (!value || entry?.pending || entry?.source === 'user') return;
  if (entry?.title === value && entry.source === 'derived') return;
  entries.set(key, { title: value, source: 'derived', pending: false });
  notify();
}

/**
 * Save a draft title (empty = restore the derived default). The card and panes
 * show the draft immediately and fall back to the previous title on failure.
 */
export async function renameSessionTitle(
  read: FetchJSON, profile: string, sessionId: string, draft: string,
): Promise<CodexSession | null> {
  const normalized = normalizeSessionTitleDraft(draft);
  const reason = sessionTitleDraftError(normalized);
  if (reason) throw Object.assign(new Error(reason), { code: reason });
  const key = keyOf(profile, sessionId), previous = entries.get(key), write = ++writeSequence;
  writes.set(key, write);
  entries.set(key, { title: normalized, source: normalized ? 'user' : 'cleared', pending: true });
  notify();
  try {
    const session = await renameCodexSession(read, profile, sessionId, normalized || null);
    if (writes.get(key) === write) {
      writes.delete(key);
      const stored = normalizeSessionTitleDraft(session?.customTitle ?? normalized);
      entries.set(key, { title: stored, source: stored ? 'user' : 'cleared', pending: false });
      notify();
    }
    return session;
  } catch (error) {
    if (writes.get(key) === write) {
      writes.delete(key);
      previous ? entries.set(key, previous) : entries.delete(key);
      notify();
    }
    throw error;
  }
}

/** Test hook: forget every locally known title. */
export function resetSessionTitles() {
  entries.clear();
  writes.clear();
  writeSequence = 0;
}

/** Classify a failed rename so the dialog can explain what to do next. */
export function sessionTitleErrorCode(error: unknown): SessionTitleErrorCode {
  const raw = error as { code?: unknown; status?: unknown; message?: unknown } | null;
  const explicit = typeof raw?.code === 'string' ? raw.code : '';
  if (explicit === 'too-long' || explicit === 'not-found' || explicit === 'invalid' || explicit === 'network') return explicit;
  const status = Number(raw?.status);
  if (status === 404) return 'not-found';
  if (status === 400) return 'too-long';
  if (status === 422) return 'invalid';
  const message = String(raw?.message ?? error ?? '');
  if (/\b404\b|not found|no such session|不存在|已删除/i.test(message)) return 'not-found';
  if (/\b400\b|200 characters|at most 200|过长/i.test(message)) return 'too-long';
  if (/\b422\b|unprocessable/i.test(message)) return 'invalid';
  if (/network|failed to fetch|load failed|网络|连接/i.test(message)) return 'network';
  return 'unknown';
}

export function sessionTitleErrorMessage(error: unknown): string {
  switch (sessionTitleErrorCode(error)) {
    case 'too-long':
      return uiText(`标题过长，最多 ${MAX_SESSION_TITLE_LENGTH} 个字符。`, `Title is too long. Keep it under ${MAX_SESSION_TITLE_LENGTH} characters.`);
    case 'not-found':
      return uiText('会话不存在或已删除，请刷新后重试。', 'This session no longer exists. Refresh and try again.');
    case 'invalid':
      return uiText('标题格式不正确，请重新输入。', 'That title is not valid. Enter another one.');
    case 'network':
      return uiText('网络连接失败，标题未保存，请重试。', 'The network request failed and the title was not saved. Try again.');
    default: {
      const detail = String((error as { message?: unknown } | null)?.message ?? error ?? '').trim();
      const head = uiText('标题保存失败', 'Could not save the title');
      return detail ? `${head}：${detail}` : head;
    }
  }
}
