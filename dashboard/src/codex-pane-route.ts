export type PaneTarget = { sessionId: string; hermesSessionId: string; profile?: string };

/** Keep an explicit empty pane empty; only fall back to the route for an unspecified pane. */
export function paneInitialSession(
  initialSessionId: string | undefined,
  routeSession: string | null | undefined,
): string {
  return initialSessionId ?? routeSession ?? '';
}

/**
 * Start a fresh chat from any dashboard page without inheriting a running
 * conversation from the destination page. Return null when the chat shell is
 * already visible, so the caller can create a pane in place.
 */
export function temporarySessionTarget(href: string, profile: string): string | null {
  const url = new URL(href, 'http://localhost');
  if (url.pathname === '/chat' && url.searchParams.get('workbench') !== 'terminal') return null;
  const target = new URL('/chat', url.origin);
  if (profile) target.searchParams.set('profile', profile);
  target.searchParams.set('new', '1');
  return `${target.pathname}${target.search}`;
}

/** True while the chat shell is consuming a one-shot request for a new pane. */
export function isNewSessionRoute(href: string): boolean {
  const url = new URL(href, 'http://localhost');
  return url.pathname === '/chat' && url.searchParams.get('new') === '1';
}

/** Consume the new-pane marker so refreshing later restores the active pane. */
export function clearNewSessionRoute(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('new');
  return url.toString();
}

/** Keep the URL on a live pane so remounting cannot resurrect a closed pane. */
export function paneTargetUrl(href: string, target: PaneTarget): string {
  const url = new URL(href);
  if (target.profile) url.searchParams.set('profile', target.profile);
  if (target.sessionId) {
    url.searchParams.set('session', target.sessionId);
    url.searchParams.delete('hermesSession');
  } else if (target.hermesSessionId) {
    url.searchParams.delete('session');
    url.searchParams.set('hermesSession', target.hermesSessionId);
  } else {
    url.searchParams.delete('session');
    url.searchParams.delete('hermesSession');
  }
  return url.toString();
}
