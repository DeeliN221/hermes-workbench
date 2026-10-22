export type PaneTarget = { sessionId: string; hermesSessionId: string };

/** Keep the URL on a live pane so remounting cannot resurrect a closed pane. */
export function paneTargetUrl(href: string, target: PaneTarget): string {
  const url = new URL(href);
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
