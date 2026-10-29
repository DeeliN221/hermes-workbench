import { describe, expect, it } from 'vitest';
import {
  CHAT_DETAIL_STORAGE_KEY,
  clipChatText,
  lastChatLine,
  normalizeChatDetailMode,
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

describe('clipChatText', () => {
  const fifteen = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join('\n');

  it('keeps the latest line for compact mode', () => {
    expect(clipChatText(fifteen, 'compact')).toEqual({ text: 'line 15', hiddenLines: 14 });
  });

  it('keeps the latest ten lines for standard mode', () => {
    const clipped = clipChatText(fifteen, 'standard');
    expect(clipped.text.split('\n')).toEqual([
      'line 6', 'line 7', 'line 8', 'line 9', 'line 10',
      'line 11', 'line 12', 'line 13', 'line 14', 'line 15',
    ]);
    expect(clipped.hiddenLines).toBe(5);
  });

  it('leaves detailed content untouched', () => {
    expect(clipChatText(fifteen, 'detailed')).toEqual({ text: fifteen, hiddenLines: 0 });
  });

  it('does not trim content that already fits', () => {
    const exactlyTen = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');
    expect(clipChatText(exactlyTen, 'standard')).toEqual({ text: exactlyTen, hiddenLines: 0 });
  });

  it('ignores trailing blank lines and counts only hidden text lines', () => {
    const content = 'first\n\nsecond\nthird\n\n';
    expect(clipChatText(content, 'compact')).toEqual({ text: 'third', hiddenLines: 2 });
    expect(clipChatText(content, 'standard')).toEqual({ text: content, hiddenLines: 0 });
  });

  it('normalizes CRLF while clipping', () => {
    expect(clipChatText('first\r\nsecond\r\nthird', 'compact')).toEqual({ text: 'third', hiddenLines: 2 });
  });

  it('returns an empty tail for blank-only content', () => {
    expect(clipChatText('\n  \n', 'compact')).toEqual({ text: '', hiddenLines: 0 });
  });
});

describe('lastChatLine', () => {
  it('returns the newest non-empty line with surrounding whitespace removed', () => {
    expect(lastChatLine('first\n\n  latest result  \n')).toBe('latest result');
  });

  it('returns an empty string for blank content', () => {
    expect(lastChatLine('\n \n')).toBe('');
  });
});
