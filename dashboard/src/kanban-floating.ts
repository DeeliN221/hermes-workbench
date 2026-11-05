/** Phase 1: fixed-size desktop launcher; reuse the tower's data and refresh lifecycle. */
import { createTaskControlTower } from './task-control-tower';
import { shouldHandleKanbanShortcut } from './kanban-shortcut';
import { uiText } from './ui-locale';
import './kanban-floating.css';

export function createKanbanFloatingBoard(sdk: Record<string, any>, navigate: (path: string, profile: string) => void) {
  const h = sdk.React.createElement;
  const { useEffect, useRef, useState } = sdk.hooks;
  const Tower = createTaskControlTower(sdk as any, navigate);
  return function KanbanFloatingBoard({ profile }: { profile: string }) {
    const [open, setOpen] = useState(false);
    const panel = useRef(null as HTMLElement | null);
    const opener = useRef(null as HTMLElement | null);
    useEffect(() => {
      const media = window.matchMedia('(max-width: 800px)');
      const resize = () => { if (media.matches) setOpen(false); };
      const keydown = (event: KeyboardEvent) => {
        if (open || !shouldHandleKanbanShortcut(event, !media.matches)) return;
        event.preventDefault();
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
      };
      window.addEventListener('keydown', keydown);
      media.addEventListener('change', resize);
      return () => {
        window.removeEventListener('keydown', keydown);
        media.removeEventListener('change', resize);
      };
    }, [open]);
    useEffect(() => {
      if (!open) return;
      panel.current?.focus({ preventScroll: true });
      // Bubble after the tower's search/drawer handlers so their Escape behavior survives.
      const escape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
        event.preventDefault();
        setOpen(false);
      };
      window.addEventListener('keydown', escape);
      return () => {
        window.removeEventListener('keydown', escape);
        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      };
    }, [open]);
    if (!open) return null;
    return h('div', {
      className: 'hti-kanban-float-backdrop',
      onClick: (event: MouseEvent) => { if (event.target === event.currentTarget) setOpen(false); },
    }, h('section', {
      ref: panel, className: 'hti-kanban-float-panel', role: 'dialog',
      'aria-label': uiText('看板', 'Kanban'), 'aria-modal': 'false', tabIndex: -1,
    }, h(Tower, { profile })));
  };
}
