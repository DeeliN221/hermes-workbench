/** Desktop board with profile-scoped server geometry. */
import { createTaskControlTower } from './task-control-tower';
import { shouldHandleKanbanShortcut } from './kanban-shortcut';
import { uiText } from './ui-locale';
import './kanban-floating.css';
import { defaultGeometry, restoreGeometry, resizeGeometry, type BoardGeometry } from './kanban-geometry';

export function createKanbanFloatingBoard(sdk: Record<string, any>, navigate: (path: string, profile: string) => void) {
  const h = sdk.React.createElement;
  const { useEffect, useRef, useState } = sdk.hooks;
  const Tower = createTaskControlTower(sdk as any, navigate);
  return function KanbanFloatingBoard({ profile }: { profile: string }) {
    const [open, setOpen] = useState(false);
    const [geometry, setGeometry] = useState(defaultGeometry);
    const [loadedProfile, setLoadedProfile] = useState('');
    const drag = useRef(null as { edge: string; x: number; y: number; start: BoardGeometry } | null);
    const currentGeometry = useRef(geometry);
    const saveQueue = useRef(Promise.resolve());
    const endpoint = `/api/plugins/workbench/kanban-geometry?profile=${encodeURIComponent(profile)}`;
    useEffect(() => {
      let active = true;
      setLoadedProfile('');
      drag.current = null;
      sdk.fetchJSON(endpoint).then((data: any) => {
        if (active) { const value = restoreGeometry(data.geometry, innerWidth, innerHeight); currentGeometry.current = value; setGeometry(value); setLoadedProfile(profile); }
      }).catch(() => { if (active) { currentGeometry.current = defaultGeometry(); setGeometry(defaultGeometry()); setLoadedProfile(profile); } });
      return () => { active = false; };
    }, [profile]);
    useEffect(() => {
      const resize = () => { const value = restoreGeometry(currentGeometry.current, innerWidth, innerHeight); currentGeometry.current = value; setGeometry(value); };
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }, []);
    const finishResize = () => {
      if (!drag.current) return;
      drag.current = null;
      const value = currentGeometry.current;
      saveQueue.current = saveQueue.current.catch(() => {}).then(() => sdk.fetchJSON(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), keepalive: true,
      })).catch(() => { /* Keep the usable local geometry if the server is temporarily unavailable. */ });
    };
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
      if (!open || loadedProfile !== profile) return;
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
    }, [open, loadedProfile, profile]);
    if (!open || loadedProfile !== profile) return null;
    return h('div', {
      className: 'hti-kanban-float-backdrop',
      onClick: (event: MouseEvent) => { if (event.target === event.currentTarget) setOpen(false); },
    }, h('section', {
      ref: panel, className: 'hti-kanban-float-panel', role: 'dialog',
      style: { position: 'absolute', left: `${geometry.x * 100}%`, top: `${geometry.y * 100}%`, width: `${geometry.width * 100}%`, height: `${geometry.height * 100}%` },
      'aria-label': uiText('看板', 'Kanban'), 'aria-modal': 'false', tabIndex: -1,
    }, h('div', { className: 'hti-kanban-float-content' }, h(Tower, { profile })),
    ...['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se'].map(edge => h('div', {
      key: edge, className: `hti-kanban-resize hti-kanban-resize-${edge}`, 'data-edge': edge,
      onPointerDown: (event: PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { edge, x: event.clientX, y: event.clientY, start: geometry };
      },
      onPointerMove: (event: PointerEvent) => {
        if (!drag.current) return;
        const d = drag.current;
        const value = resizeGeometry(d.start, d.edge, event.clientX - d.x, event.clientY - d.y, innerWidth, innerHeight);
        currentGeometry.current = value; setGeometry(value);
      },
      onPointerUp: finishResize, onPointerCancel: finishResize, onLostPointerCapture: finishResize,
      onClick: (event: MouseEvent) => event.stopPropagation(),
    }))));
  };
}
