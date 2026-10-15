/**
 * Map OZW mobile terminal shortcuts to PTY/xterm byte sequences.
 * Convert mobile helper buttons into terminal input sequences.
 */
export type TerminalHelperKey = 'escape' | 'tab' | 'arrowUp' | 'arrowDown' | 'arrowLeft' | 'arrowRight';

const NORMAL_INPUT: Record<TerminalHelperKey, string> = {
  escape: '\x1b',
  tab: '\t',
  arrowUp: '\x1b[A',
  arrowDown: '\x1b[B',
  arrowLeft: '\x1b[D',
  arrowRight: '\x1b[C',
};

const CTRL_INPUT: Partial<Record<TerminalHelperKey, string>> = {
  arrowUp: '\x1b[1;5A',
  arrowDown: '\x1b[1;5B',
  arrowLeft: '\x1b[1;5D',
  arrowRight: '\x1b[1;5C',
};

const CTRL_CHARACTER_INPUT: Record<string, string> = {
  ' ': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  _: '\x1f',
};

/** Return PTY input for a helper key; use xterm modifiers for arrows while Ctrl is latched. */
export function terminalHelperKeyInput(key: TerminalHelperKey, ctrlActive: boolean): string {
  return (ctrlActive ? CTRL_INPUT[key] : undefined) || NORMAL_INPUT[key];
}

/** Combine virtual Ctrl with the next character or arrow key into control bytes. */
export function virtualCtrlInput(key: string): string | null {
  if (key.length === 1) {
    const lowerKey = key.toLowerCase();
    if (lowerKey >= 'a' && lowerKey <= 'z') {
      return String.fromCharCode(lowerKey.charCodeAt(0) - 96);
    }
    return CTRL_CHARACTER_INPUT[key] || null;
  }

  const browserKeys: Partial<Record<string, TerminalHelperKey>> = {
    ArrowUp: 'arrowUp',
    ArrowDown: 'arrowDown',
    ArrowLeft: 'arrowLeft',
    ArrowRight: 'arrowRight',
    Escape: 'escape',
    Tab: 'tab',
  };
  const helperKey = browserKeys[key];
  return helperKey ? terminalHelperKeyInput(helperKey, true) : null;
}
