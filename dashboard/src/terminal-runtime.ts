/** Use the lockfile's terminal implementation instead of maintaining a bundled copy. */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { terminalTheme } from './terminal-theme';
export function createWorkbenchTerminal(element: HTMLElement) {
  const terminal = new Terminal({
    allowProposedApi: false, convertEol: false, cursorBlink: true,
    fontFamily: 'var(--theme-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    fontSize: window.matchMedia('(max-width: 640px)').matches ? 15 : 13,
    minimumContrastRatio: 4.5, scrollback: 5000, theme: terminalTheme(element),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);
  return { terminal, fit };
}
