/** Pure header-tool interaction state shared by React components and Vitest. */
export type TerminalDialogAction = 'trigger' | 'close' | 'escape' | 'backdrop';

export function nextTerminalDialogState(
  open: boolean,
  action: TerminalDialogAction,
): boolean {
  return action === 'trigger' ? !open : false;
}
