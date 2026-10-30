import { describe, expect, it } from 'vitest';
import {
  CHAT_DETAIL_STORAGE_KEY,
  CHAT_DETAIL_WINDOW_PX,
  chatDetailWindowPx,
  isProcessWindowAtLatest,
  normalizeChatDetailMode,
  PROCESS_WINDOW_FOLLOW_THRESHOLD_PX,
  readChatDetailMode,
  writeChatDetailMode,
} from '../dashboard/src/chat-detail';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    value: (key: string) => values.get(key) ?? null,
  };
}

describe('chat detail preference', () => {
  it('defaults to standard for missing or unknown values', () => {
    expect(normalizeChatDetailMode(undefined)).toBe('standard');
    expect(normalizeChatDetailMode('verbose')).toBe('standard');
    expect(readChatDetailMode(memoryStorage())).toBe('standard');
  });

  it('restores and persists a valid mode', () => {
    const storage = memoryStorage({ [CHAT_DETAIL_STORAGE_KEY]: 'detailed' });
    expect(readChatDetailMode(storage)).toBe('detailed');
    writeChatDetailMode('compact', storage);
    expect(storage.value(CHAT_DETAIL_STORAGE_KEY)).toBe('compact');
  });

  it('falls back when storage access fails', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readChatDetailMode(blocked)).toBe('standard');
    expect(() => writeChatDetailMode('compact', blocked)).not.toThrow();
  });
});

describe('process window height', () => {
  it('caps every level with a usable positive height', () => {
    for (const height of Object.values(CHAT_DETAIL_WINDOW_PX)) {
      expect(Number.isFinite(height)).toBe(true);
      expect(height).toBeGreaterThan(0);
    }
  });

  it('orders compact, standard, and detailed from shortest to tallest', () => {
    expect(CHAT_DETAIL_WINDOW_PX.compact).toBeLessThan(CHAT_DETAIL_WINDOW_PX.standard);
    expect(CHAT_DETAIL_WINDOW_PX.standard).toBeLessThan(CHAT_DETAIL_WINDOW_PX.detailed);
  });

  it('resolves the window height per mode and falls back for unknown input', () => {
    expect(chatDetailWindowPx('compact')).toBe(CHAT_DETAIL_WINDOW_PX.compact);
    expect(chatDetailWindowPx('detailed')).toBe(CHAT_DETAIL_WINDOW_PX.detailed);
    expect(chatDetailWindowPx('verbose' as never)).toBe(CHAT_DETAIL_WINDOW_PX.standard);
  });
});

describe('isProcessWindowAtLatest', () => {
  const window = { scrollHeight: 900, clientHeight: 240 };

  it('keeps following when the newest line is visible', () => {
    expect(isProcessWindowAtLatest({ ...window, scrollTop: 660 })).toBe(true);
  });

  it('stops following once the reader scrolls up', () => {
    expect(isProcessWindowAtLatest({ ...window, scrollTop: 0 })).toBe(false);
    expect(isProcessWindowAtLatest({ ...window, scrollTop: 400 })).toBe(false);
  });

  it('treats sub-pixel rounding as the bottom', () => {
    const rounded = { ...window, scrollTop: 660 - PROCESS_WINDOW_FOLLOW_THRESHOLD_PX };
    expect(isProcessWindowAtLatest(rounded)).toBe(true);
    expect(isProcessWindowAtLatest({ ...rounded, scrollTop: rounded.scrollTop - 1 })).toBe(false);
  });

  it('keeps following when layout metrics are unavailable', () => {
    expect(isProcessWindowAtLatest({ scrollHeight: Number.NaN, scrollTop: 0, clientHeight: 240 })).toBe(true);
  });
});
