import { describe, expect, it } from 'vitest';
import { shouldSendMessage, type SendShortcut } from '../dashboard/src/send-shortcut';

const enter = { key: 'Enter', keyCode: 13, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

describe('message send shortcut', () => {
  it('requires Ctrl or Command in the default mode', () => {
    expect(shouldSendMessage(enter, 'ctrl-enter')).toBe(false);
    expect(shouldSendMessage({ ...enter, ctrlKey: true }, 'ctrl-enter')).toBe(true);
    expect(shouldSendMessage({ ...enter, metaKey: true }, 'ctrl-enter')).toBe(true);
  });
  it('sends with plain Enter only when selected', () => {
    expect(shouldSendMessage(enter, 'enter')).toBe(true);
    expect(shouldSendMessage({ ...enter, ctrlKey: true }, 'enter')).toBe(false);
  });
  it.each<SendShortcut>(['ctrl-enter', 'enter'])('preserves newlines and IME composition in %s mode', shortcut => {
    const key = { ...enter, ctrlKey: shortcut === 'ctrl-enter' };
    for (const extra of [{ shiftKey: true }, { altKey: true }, { isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { key: 'a' }]) {
      expect(shouldSendMessage({ ...key, ...extra }, shortcut)).toBe(false);
    }
  });
});
