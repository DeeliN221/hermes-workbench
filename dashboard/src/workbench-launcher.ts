import { uiText } from './ui-locale';
import { craftingIcon } from './crafting-icons';

export const OPEN_WORKBENCH = 'workbench:open-actions';

export function createWorkbenchLauncher(sdk: Record<string, any>) {
  const h = sdk.React.createElement;
  const { useState, useEffect } = sdk.hooks;
  return function WorkbenchLauncher() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
      const update = (event: CustomEvent) => setOpen(Boolean(event.detail?.open));
      window.addEventListener('workbench:actions-state', update as EventListener);
      return () => window.removeEventListener('workbench:actions-state', update as EventListener);
    }, []);
    return h('button', {
      type: 'button', className: 'workbench-launcher', title: uiText('工作台', 'Workbench'),
      'aria-label': uiText('打开工作台', 'Open workbench'), 'aria-haspopup': 'dialog', 'aria-expanded': open,
      onClick: (event: MouseEvent) => window.dispatchEvent(new CustomEvent(OPEN_WORKBENCH, { detail: { trigger: event.currentTarget } })),
    }, craftingIcon(sdk.React, 'workbench'));
  };
}

export function createWorkbenchDialog(sdk: Record<string, any>) {
  const h = sdk.React.createElement;
  const { useRef, useEffect } = sdk.hooks;
  return function WorkbenchDialog({ open, onClose, children, headerAction }: { open: boolean; onClose: () => void; children: any; headerAction?: any }) {
    const ref = useRef(null as HTMLDialogElement | null);
    const titleId = sdk.React.useId();
    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (window.innerWidth <= 800 || window.matchMedia('(pointer: coarse)').matches
          || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229
          || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
          || event.key.toLowerCase() !== 'w') return;
        const editable = (target: EventTarget | null) => target instanceof Element
          && (target instanceof HTMLElement && target.isContentEditable
            || Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .cm-editor, .monaco-editor, .xterm')));
        if (event.composedPath().some(editable) || editable(document.activeElement)
          || document.querySelector('dialog[open], [aria-modal="true"]')) return;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(OPEN_WORKBENCH));
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
    useEffect(() => {
      const dialog = ref.current;
      if (!dialog) return;
      if (open && !dialog.open) dialog.showModal();
      if (!open && dialog.open) dialog.close();
      window.dispatchEvent(new CustomEvent('workbench:actions-state', { detail: { open } }));
    }, [open]);
    return h('dialog', {
      ref, className: 'workbench-actions-dialog', 'aria-labelledby': titleId,
      onCancel: onClose, onClose,
      onClick: (event: MouseEvent) => { if (event.target === ref.current) {
        const rect = ref.current!.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      } },
    }, h('header', null, h('h2', { id: titleId }, uiText('工作台', 'Workbench')), headerAction,
      h('button', { type: 'button', className: 'workbench-actions-close', 'aria-label': uiText('关闭工作台', 'Close workbench'), onClick: onClose }, '×')),
      children);
  };
}
