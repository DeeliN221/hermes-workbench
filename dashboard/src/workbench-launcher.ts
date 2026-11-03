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
  return function WorkbenchDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: any }) {
    const ref = useRef(null as HTMLDialogElement | null);
    const trigger = useRef(null as HTMLElement | null);
    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229
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
      const dialog = ref.current as HTMLDialogElement | null;
      if (!dialog) return;
      if (open && !dialog.open) {
        trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
        dialog.querySelector<HTMLElement>('a[href], button:not(:disabled)')?.focus();
      }
      if (!open && dialog.open) {
        dialog.close();
        trigger.current?.focus({ preventScroll: true });
      }
      window.dispatchEvent(new CustomEvent('workbench:actions-state', { detail: { open } }));
    }, [open]);
    return h('dialog', {
      ref, className: 'workbench-actions-dialog', 'aria-label': uiText('工作台', 'Workbench'),
      onCancel: (event: Event) => { event.preventDefault(); onClose(); },
      // Native close is a notification from the effect, not another state update.
      // Cancellation, backdrop clicks and actions already request dismissal explicitly.
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== 'Tab' || (event.target instanceof Element && event.target.closest('dialog') !== ref.current)) return;
        const dialog = ref.current as HTMLDialogElement | null;
        const nodes = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') || [])
          .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      },
      onClick: (event: MouseEvent) => { if (event.target === ref.current) {
        event.preventDefault(); event.stopPropagation();
        const rect = ref.current!.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      } },
    }, children);
  };
}
