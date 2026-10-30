/** Work-detail presentation shared by the chat toolbar and message renderers. */

export const CHAT_DETAIL_MODES = ['compact', 'standard', 'detailed'] as const;
export type ChatDetailMode = (typeof CHAT_DETAIL_MODES)[number];

export const DEFAULT_CHAT_DETAIL_MODE: ChatDetailMode = 'standard';
export const CHAT_DETAIL_STORAGE_KEY = 'hermes-workbench.chat-detail';

/**
 * Folded process groups always show a single summary line. The detail level
 * only caps the height of the expanded scrolling window, so long reasoning and
 * tool output stay inside that window instead of stretching the transcript.
 */
export const CHAT_DETAIL_WINDOW_PX: Record<ChatDetailMode, number> = {
  compact: 132,
  standard: 240,
  detailed: 384,
};

/** Keep small layout roundings from looking like a deliberate scroll-up. */
export const PROCESS_WINDOW_FOLLOW_THRESHOLD_PX = 8;

export interface ProcessWindowMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
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

/** Height cap for one expanded process window at the selected detail level. */
export function chatDetailWindowPx(mode: ChatDetailMode): number {
  return CHAT_DETAIL_WINDOW_PX[normalizeChatDetailMode(mode)] ?? CHAT_DETAIL_WINDOW_PX.standard;
}

/**
 * Decide whether the window should keep following new content. A reader who
 * scrolled up stays where they are; returning to the bottom resumes following.
 */
export function isProcessWindowAtLatest(
  metrics: ProcessWindowMetrics,
  threshold = PROCESS_WINDOW_FOLLOW_THRESHOLD_PX,
): boolean {
  const { scrollHeight, scrollTop, clientHeight } = metrics;
  if (![scrollHeight, scrollTop, clientHeight].every(Number.isFinite)) return true;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
