import { currentProfile } from './profile-scope';
import { PANE_LIMIT, nextPaneId, paneLayoutStorage, readPaneLayout, writePaneLayout, type LayoutStorage, type PaneLayoutState, type StoredPaneLayout } from './codex-pane-layout';

export type HomeSession = { profile: string; sessionId: string; hermesSessionId: string };
const OWNER_KEY = 'workbench.home-pane-owner';
export const HOME_OPEN_PARAM = 'homeOpen';
export function sessionKey(session: HomeSession): string {
  return JSON.stringify([session.profile, session.sessionId, session.hermesSessionId]);
}
export function mergeHomeSessions(selected: HomeSession[], opened: HomeSession[]): HomeSession[] | null {
  const unique = [...new Map([...opened, ...selected].map(session => [sessionKey(session), session])).values()];
  return unique.length <= PANE_LIMIT ? unique : null;
}
export function openedHomeSessions(storage: LayoutStorage | null = paneLayoutStorage()): HomeSession[] {
  try {
    const owner = storage?.getItem(OWNER_KEY) || (typeof window !== 'undefined' ? currentProfile() : 'default');
    return (readPaneLayout(owner, storage)?.panes || []).filter(pane => pane.sessionId || pane.hermesSessionId)
      .map(pane => ({ profile: pane.profile || owner, sessionId: pane.sessionId, hermesSessionId: pane.hermesSessionId }));
  } catch { return []; }
}
/** A one-shot route request also reaches a chat shell already mounted behind home. */
export function homeSessionsPath(sessions: HomeSession[], active = sessions[0]): string {
  const first = sessions[0];
  const params = new URLSearchParams({ profile: first.profile, paneOwner: first.profile, homeActive: String(sessions.findIndex(session => sessionKey(session) === sessionKey(active))), [HOME_OPEN_PARAM]: JSON.stringify(sessions) });
  params.set(first.sessionId ? 'session' : 'hermesSession', first.sessionId || first.hermesSessionId);
  return `/chat?${params}`;
}
export function requestedHomeLayout(href: string, storage: LayoutStorage | null): PaneLayoutState | null {
  try {
    const url = new URL(href, 'http://localhost');
    const raw: unknown = JSON.parse(url.searchParams.get(HOME_OPEN_PARAM) || 'null');
    if (!Array.isArray(raw) || !raw.length || raw.length > PANE_LIMIT) return null;
    if (!raw.every(row => row && typeof row.profile === 'string' && row.profile && typeof row.sessionId === 'string' && typeof row.hermesSessionId === 'string' && Boolean(row.sessionId) !== Boolean(row.hermesSessionId))) return null;
    const sessions = raw as HomeSession[];
    if (new Set(sessions.map(sessionKey)).size !== sessions.length) return null;
    const owner = sessions[0].profile;
    const activeIndex = Math.max(0, Math.min(sessions.length - 1, Number(url.searchParams.get('homeActive')) || 0));
    const previous = readPaneLayout(owner, storage)?.panes.filter(pane => pane.sessionId || pane.hermesSessionId) || [];
    const allocated = [...previous];
    const panes = sessions.map((session, index) => {
      const existing = previous.find(pane => sessionKey({ ...pane, profile: pane.profile || owner }) === sessionKey(session));
      const id = existing?.id || (previous.length ? nextPaneId(allocated) : `pane-${index + 1}`);
      const pane = { ...session, id };
      if (!existing) allocated.push(pane);
      return pane;
    });
    const layout: StoredPaneLayout = { version: 1, activePaneId: panes[Math.trunc(activeIndex)].id, panes };
    writePaneLayout(owner, layout, storage);
    try { storage?.setItem(OWNER_KEY, owner); } catch { /* Optional persistence. */ }
    return { panes: layout.panes.map(pane => ({ id: pane.id, profile: pane.profile, initialSessionId: pane.sessionId, initialHermesSessionId: pane.hermesSessionId })), targets: Object.fromEntries(layout.panes.map(pane => [pane.id, { sessionId: pane.sessionId, hermesSessionId: pane.hermesSessionId }])), activePaneId: layout.activePaneId, startEmpty: false, restored: false };
  } catch { return null; }
}
export function consumeHomeRequest(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has(HOME_OPEN_PARAM)) return;
  url.searchParams.delete(HOME_OPEN_PARAM);
  url.searchParams.delete('homeActive');
  history.replaceState(null, '', url);
}

export function paneWorkspaceProfile(): string {
  const params = new URLSearchParams(location.search);
  return (location.pathname === '/chat' && params.get('paneOwner')) || currentProfile();
}

export function rememberHomePaneOwner(profile: string, storage: LayoutStorage | null): void {
  try { storage?.setItem(OWNER_KEY, profile); } catch { /* Optional persistence. */ }
}

/** Mobile keeps the existing horizontal pane strip; reveal the requested conversation. */
export function revealActiveHomePane(includeSessionRoutes = false): void {
  if (location.pathname !== '/chat' || (!includeSessionRoutes && !new URLSearchParams(location.search).has('paneOwner')) || !matchMedia('(max-width: 800px)').matches) return;
  document.querySelector<HTMLElement>('.codex-multi-pane .codex-pane-slot.is-active')?.scrollIntoView({ block: 'nearest', inline: 'start' });
}
