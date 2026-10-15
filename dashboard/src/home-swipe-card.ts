import { uiText as sourceText } from './ui-locale';
/** OZW-style horizontal acknowledgement, with vertical scrolling left to the browser. */
export function createHomeSwipeCard(React: any) {
  const { createElement: h, useRef, useState } = React;
  return function HomeSwipeCard({ href, onNavigate, onRead, children, disabled = false }: {
    disabled?: boolean; href: string; onNavigate: () => void; onRead: () => Promise<void>; children: any;
  }) {
    const gesture = useRef(null as { id: number; x: number; y: number; axis: string } | null);
    const moved = useRef(0);
    const suppressed = useRef(false);
    const submitting = useRef(false);
    const [offset, setOffset] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const update = (x: number) => { moved.current = x; setOffset(x); };
    const read = async () => {
      if (submitting.current || disabled) return;
      submitting.current = true; setBusy(true); setError('');
      try { await onRead(); }
      catch { setError(sourceText("标记已读失败，请重试。", "Could not mark as read. Please retry.")); }
      finally { submitting.current = false; setBusy(false); update(0); }
    };
    return h('div', { className: 'workbench-home-swipe' },
      h('div', { className: 'workbench-home-read-background', 'aria-hidden': true }, sourceText("✓ 已读", "✓ Read")),
      h('div', { className: 'workbench-home-swipe-surface', style: { transform: `translateX(${offset}px)` },
        onPointerDown: (event: any) => {
          if (disabled || submitting.current || !event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
          suppressed.current = false;
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: 'pending' };
        },
        onPointerMove: (event: any) => {
          const g = gesture.current;
          if (!g || g.id !== event.pointerId) return;
          const dx = event.clientX - g.x, dy = event.clientY - g.y;
          if (g.axis === 'pending' && Math.hypot(dx, dy) >= 8) {
            g.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
            if (g.axis === 'horizontal') event.currentTarget.setPointerCapture(event.pointerId);
          }
          if (g.axis !== 'horizontal') return;
          suppressed.current = true;
          update(dx >= 0 ? dx : Math.max(-28, dx * 0.18));
        },
        onPointerUp: (event: any) => {
          const g = gesture.current;
          if (!g || g.id !== event.pointerId) return;
          gesture.current = null;
          const threshold = Math.min(150, Math.max(92, event.currentTarget.getBoundingClientRect().width * 0.28));
          if (g.axis === 'horizontal' && moved.current >= threshold) void read();
          else update(0);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        },
        onPointerCancel: () => { gesture.current = null; suppressed.current = true; update(0); },
        onLostPointerCapture: (event: any) => {
          // Touch starts with implicit capture on a child. Its bubbling loss
          // when the surface takes capture must not cancel our horizontal drag.
          if (event.target === event.currentTarget) { gesture.current = null; update(0); }
        },
      }, h('a', { className: 'workbench-home-card', href,
        onDragStart: (event: any) => event.preventDefault(),
        onClick: (event: any) => {
          if (suppressed.current || submitting.current) { event.preventDefault(); suppressed.current = false; return; }
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); onNavigate();
        },
        onKeyDown: (event: any) => {
          if (event.key === 'ArrowRight') { event.preventDefault(); void read(); }
          if (event.key === 'Enter') suppressed.current = false;
        },
      }, ...children),
      h('button', { className: 'workbench-home-read-button', type: 'button', disabled: busy || disabled,
        onClick: () => void read(), 'aria-label': sourceText("标记已读", "Mark as read"), title: sourceText("右滑或点击标记已读", "Swipe right or click to mark as read") }, busy ? sourceText("保存中…", "Saving…") : sourceText("右滑已读 →", "Swipe right to mark read →")),
      error ? h('p', { className: 'workbench-home-read-error', role: 'alert' }, error) : null));
  };
}
