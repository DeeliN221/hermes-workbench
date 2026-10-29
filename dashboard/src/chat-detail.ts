/** Work-detail presentation shared by the chat toolbar and message renderers. */

export const CHAT_DETAIL_MODES = ['compact', 'standard', 'detailed'] as const;
export type ChatDetailMode = (typeof CHAT_DETAIL_MODES)[number];

/** Keep the current folding behaviour while adding a bounded tail preview. */
export const DEFAULT_CHAT_DETAIL_MODE: ChatDetailMode = 'standard';
export const CHAT_DETAIL_STORAGE_KEY = 'hermes-workbench.chat-detail';

/** Null means the complete work detail is shown. */
export const CHAT_DETAIL_LINE_LIMITS: Record<ChatDetailMode, number | null> = {
  compact: 1,
  standard: 10,
  detailed: null,
};

export interface ClippedChatText {
  /** Visible tail after applying the selected detail level. */
  text: string;
  /** Non-empty lines omitted before the visible tail. */
  hiddenLines: number;
}

/** Accept only persisted values understood by this client. */
export function normalizeChatDetailMode(value: unknown): ChatDetailMode {
  return typeof value === 'string' && (CHAT_DETAIL_MODES as readonly string[]).includes(value)
    ? value as ChatDetailMode
    : DEFAULT_CHAT_DETAIL_MODE;
}

type ChatDetailStorage = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(storage?: ChatDetailStorage | null): ChatDetailStorage | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Restore the reader's last work-detail choice; blocked storage keeps the default. */
export function readChatDetailMode(storage?: ChatDetailStorage | null): ChatDetailMode {
  try {
    return normalizeChatDetailMode(resolveStorage(storage)?.getItem(CHAT_DETAIL_STORAGE_KEY));
  } catch {
    return DEFAULT_CHAT_DETAIL_MODE;
  }
}

/** Persist a deliberate choice without making the UI depend on storage success. */
export function writeChatDetailMode(mode: ChatDetailMode, storage?: ChatDetailStorage | null): void {
  try {
    resolveStorage(storage)?.setItem(CHAT_DETAIL_STORAGE_KEY, normalizeChatDetailMode(mode));
  } catch {
    // The selected mode remains active for this page when storage is unavailable.
  }
}

/**
 * Keep the newest lines that fit the selected level. Blank trailing lines are
 * ignored, and hidden counts include only non-empty lines so the disclosure
 * never claims that whitespace was omitted.
 */
export function clipChatText(content: string, mode: ChatDetailMode): ClippedChatText {
  const complete = String(content ?? '');
  const limit = CHAT_DETAIL_LINE_LIMITS[normalizeChatDetailMode(mode)];
  if (limit === null || complete === '') return { text: complete, hiddenLines: 0 };

  const lines = complete.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return { text: '', hiddenLines: 0 };

  let start = Math.max(0, lines.length - limit);
  if (limit === 1) {
    while (start < lines.length - 1 && lines[start].trim() === '') start += 1;
  }
  const hiddenLines = lines.slice(0, start).filter(line => line.trim() !== '').length;
  return hiddenLines === 0
    ? { text: complete, hiddenLines: 0 }
    : { text: lines.slice(start).join('\n'), hiddenLines };
}

/** Read the newest non-empty line for one-line collapsed previews. */
export function lastChatLine(content: string): string {
  const { text } = clipChatText(content, 'compact');
  return text.split('\n').find(line => line.trim() !== '')?.trim() ?? '';
}
