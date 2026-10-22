/** Pure responsive geometry for the portal-mounted global terminal workspace. */
type RectLike = { bottom: number };
type ViewportLike = {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
};

export function terminalWorkspaceGeometry(
  header: RectLike,
  viewport: ViewportLike,
  mobile: boolean,
  desktopLeft = 0,
  floating = false,
): Record<string, string> {
  if (floating) {
    const right = 24;
    const available = viewport.width - desktopLeft - 32;
    const desired = Math.max(320, Math.min(1180, Math.max(640, Math.round(viewport.width * 0.66)), available));
    const minimumLeft = viewport.offsetLeft + (mobile ? 12 : desktopLeft + 8);
    const left = Math.max(minimumLeft, viewport.offsetLeft + viewport.width - desired - right);
    const width = Math.max(320, viewport.offsetLeft + viewport.width - left - right);
    const top = viewport.offsetTop + Math.max(56, Math.round(viewport.height * 0.07));
    const height = Math.max(300, viewport.offsetTop + viewport.height - top - 24);
    return {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(width)}px`,
      height: `${Math.round(height)}px`,
    };
  }
  const top = Math.max(header.bottom, viewport.offsetTop);
  const left = mobile ? viewport.offsetLeft : Math.max(viewport.offsetLeft, desktopLeft);
  const width = Math.max(0, viewport.width - (left - viewport.offsetLeft));
  const height = Math.max(160, viewport.height - (top - viewport.offsetTop));
  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`,
  };
}

/**
 * Critical layout is inline so host utility classes or a delayed plugin CSS
 * fetch can never collapse the terminal back into the header-sized dialog.
 */
export function terminalWorkspaceCriticalStyle(
  geometry: Record<string, string>,
  floating = false,
): Record<string, string> {
  return {
    ...geometry,
    position: 'fixed',
    zIndex: '1001',
    display: 'grid',
    pointerEvents: 'auto',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    maxWidth: 'none',
    minWidth: '0',
    minHeight: '0',
    gap: '0',
    overflow: 'hidden',
    borderRadius: '0',
    padding: '0',
    transform: 'none',
    translate: 'none',
    ...(floating ? {
      borderRadius: '12px',
      border: '3px solid #493523',
      boxShadow: '0 24px 64px #0007',
    } : {}),
  };
}

export function terminalWorkspaceReady(
  open: boolean,
  geometry: Record<string, string>,
): boolean {
  return open && Boolean(geometry.width && geometry.height && geometry.left && geometry.top);
}
