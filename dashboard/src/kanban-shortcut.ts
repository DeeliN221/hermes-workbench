/** Inputs, editors, dropdowns and modal editors keep their own typing behavior. */
export function isEditableKanbanTarget(node: EventTarget | null | undefined): boolean {
  if (!(node instanceof Element)) return false;
  if (node instanceof HTMLElement && node.isContentEditable) return true;
  return Boolean(node.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="menuitem"], [role="option"], .cm-editor, .monaco-editor, .xterm',
  ));
}

/** Only an unmodified B on an idle desktop surface opens the floating board. */
export function shouldHandleKanbanShortcut(event: KeyboardEvent, desktop: boolean): boolean {
  if (!desktop || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return false;
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  if (String(event.key || '').toLowerCase() !== 'b') return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  if (path.some(isEditableKanbanTarget) || isEditableKanbanTarget(document.activeElement)) return false;
  const overlays = document.querySelectorAll('dialog[open], [aria-modal="true"], [role="menu"], [role="listbox"], .dashboard-accessory-backdrop');
  if (Array.from(overlays).some(node => node instanceof HTMLElement && node.checkVisibility())) return false;
  return true;
}
