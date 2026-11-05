/** Shared desktop launcher; reuse the tower's data and refresh lifecycle. */
import { createTaskControlTower } from './task-control-tower';
import { shouldHandleKanbanShortcut } from './kanban-shortcut';
import { uiText } from './ui-locale';
import './kanban-floating.css';

export function createKanbanFloatingBoard(sdk: Record<string, any>, navigate: (path: string, profile: string) => void) {
  const h = sdk.React.createElement;
  const { useEffect, useRef } = sdk.hooks;
  const Tower = createTaskControlTower(sdk as any, navigate);
  return function KanbanFloatingBoard({ profile, open, onOpenChange: setOpen, returnFocusRef }: { profile: string; open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef: { current: HTMLElement | null } }) {
    const panel = useRef(null as HTMLElement | null);
    const opener = useRef(null as HTMLElement | null);
    useEffect(() => {
      const media = window.matchMedia('(max-width: 800px)');
      const resize = () => { if (media.matches) setOpen(false); };
      const keydown = (event: KeyboardEvent) => {
        if (!shouldHandleKanbanShortcut(event, !media.matches)) return;
        event.preventDefault();
        setOpen(!open);
      };
      window.addEventListener('keydown', keydown);
      media.addEventListener('change', resize);
      return () => {
        window.removeEventListener('keydown', keydown);
        media.removeEventListener('change', resize);
      };
    }, [open, setOpen]);
    useEffect(() => {
      if (!open) return;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // The crafting grid lives in a native modal which closes after launching.
      // Return to the workbench opener rather than a button in the closed dialog.
      if (opener.current?.closest('dialog')) opener.current = returnFocusRef.current;
      const focusFrame = requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
      // Bubble after the tower's search/drawer handlers so their Escape behavior survives.
      const escape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
        event.preventDefault();
        setOpen(false);
      };
      const outside = (event: MouseEvent) => {
        const target = event.target;
        if (target instanceof Element && !panel.current?.contains(target) && !target.closest('[data-kanban-floating-trigger], .workbench-launcher, .workbench-actions-dialog')) setOpen(false);
      };
      window.addEventListener('click', outside);
      window.addEventListener('keydown', escape);
      return () => {
        cancelAnimationFrame(focusFrame);
        window.removeEventListener('click', outside);
        window.removeEventListener('keydown', escape);
        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      };
    }, [open, setOpen]);
    if (!open) return null;
    return h('div', {
      className: 'hti-kanban-float-backdrop',
    }, h('section', {
      ref: panel, className: 'hti-kanban-float-panel', role: 'dialog',
      'aria-label': uiText('看板', 'Kanban'), 'aria-modal': 'false', tabIndex: -1,
    }, h(Tower, { profile })));
  };
}
