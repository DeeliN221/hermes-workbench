/**
 * Persist and restore the Codex multi-pane layout inside one profile.
 *
 * The layout lives in browser storage only: the backend never learns which
 * sessions a person placed side by side. Panes stay inside a single profile
 * (PR #49), so the profile name is part of the storage key instead of being
 * mixed into one shared record.
 */
import { listCodexSessions } from './codex-api';
import type { FetchJSON } from './workbench-api';

export type PaneTarget = { sessionId: string; hermesSessionId: string };

/** Pane identity handed to the pane component; drafts key off the same id. */
export type PaneSpec = { id: string; initialSessionId: string; initialHermesSessionId: string };

export type PaneLayoutState = {
  panes: PaneSpec[];
  targets: Record<string, PaneTarget>;
  activePaneId: string;
  startEmpty: boolean;
  /** True when the panes came from storage rather than from the route. */
  restored: boolean;
};

export type StoredPane = { id: string; sessionId: string; hermesSessionId: string };
export type StoredPaneLayout = { version: 1; panes: StoredPane[]; activePaneId: string };

export type LayoutStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type PaneTargetCheck = PaneTarget & { paneId: string };

export const PANE_LIMIT = 3;
const STORAGE_PREFIX = 'workbench.codex.pane-layout.v1:';
const PANE_ID_PATTERN = /^pane-(\d+)$/;
const HERMES_SESSION_PAGE = 100;
const EMPTY_TARGET: PaneTarget = { sessionId: '', hermesSessionId: '' };

/** Storage key scoped to one profile so layouts can never cross profiles. */
export function paneLayoutStorageKey(profile: string): string {
  return `${STORAGE_PREFIX}${profile || 'default'}`;
}

/** Browser storage can be unavailable (private mode, blocked cookies); never throw. */
export function paneLayoutStorage(): LayoutStorage | null {
  try {
    const storage = window.localStorage;
    return storage ? storage : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTarget(target: PaneTarget | null | undefined): PaneTarget {
  const sessionId = text(target?.sessionId);
  const hermesSessionId = text(target?.hermesSessionId);
  // A pane loads a Codex session or a Hermes history, never both at once.
  return sessionId ? { sessionId, hermesSessionId: '' } : { sessionId: '', hermesSessionId };
}

function sameTarget(pane: StoredPane, target: PaneTarget): boolean {
  return Boolean(
    (target.sessionId && pane.sessionId === target.sessionId) ||
    (target.hermesSessionId && pane.hermesSessionId === target.hermesSessionId),
  );
}

/** Next free pane id; closed ids are never reused so stale drafts stay isolated. */
export function nextPaneId(panes: { id: string }[]): string {
  let highest = 0;
  for (const pane of panes) {
    const match = PANE_ID_PATTERN.exec(pane.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const taken = new Set(panes.map(pane => pane.id));
  let candidate = Math.max(highest + 1, 2);
  while (taken.has(`pane-${candidate}`)) candidate += 1;
  return `pane-${candidate}`;
}

export function emptyPaneLayout(startEmpty = false): PaneLayoutState {
  return {
    panes: [{ id: 'pane-1', initialSessionId: '', initialHermesSessionId: '' }],
    targets: { 'pane-1': { ...EMPTY_TARGET } },
    activePaneId: 'pane-1',
    startEmpty,
    restored: false,
  };
}

/**
 * Validate one stored record. Anything unexpected (corrupt JSON shapes, more
 * panes than the limit, duplicate ids) is rejected as a whole so a damaged
 * record can never produce a half-valid layout.
 */
export function normalizePaneLayout(value: unknown): StoredPaneLayout | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rawPanes = record.panes;
  if (!Array.isArray(rawPanes) || rawPanes.length === 0 || rawPanes.length > PANE_LIMIT) return null;
  const panes: StoredPane[] = [];
  for (const entry of rawPanes) {
    if (!entry || typeof entry !== 'object') return null;
    const pane = entry as Record<string, unknown>;
    const id = text(pane.id);
    if (!PANE_ID_PATTERN.test(id)) return null;
    const target = normalizeTarget({
      sessionId: typeof pane.sessionId === 'string' ? pane.sessionId : '',
      hermesSessionId: typeof pane.hermesSessionId === 'string' ? pane.hermesSessionId : '',
    });
    panes.push({ id, sessionId: target.sessionId, hermesSessionId: target.hermesSessionId });
  }
  if (new Set(panes.map(pane => pane.id)).size !== panes.length) return null;
  const requestedActive = text(record.activePaneId);
  const activePaneId = panes.some(pane => pane.id === requestedActive) ? requestedActive : panes[0].id;
  return { version: 1, panes, activePaneId };
}

export function readPaneLayout(profile: string, storage: LayoutStorage | null): StoredPaneLayout | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(paneLayoutStorageKey(profile));
    if (!raw) return null;
    return normalizePaneLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePaneLayout(profile: string, layout: StoredPaneLayout, storage: LayoutStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(paneLayoutStorageKey(profile), JSON.stringify(layout));
  } catch {
    // Quota or private mode: restoring later is a convenience, never a failure.
  }
}

/** Snapshot live pane state; the target map is authoritative over initial props. */
export function paneLayoutSnapshot(
  panes: PaneSpec[],
  targets: Record<string, PaneTarget | undefined>,
  activePaneId: string,
): StoredPaneLayout | null {
  if (!panes.length) return null;
  return normalizePaneLayout({
    version: 1,
    panes: panes.map(pane => {
      const target = normalizeTarget(targets[pane.id] ?? {
        sessionId: pane.initialSessionId,
        hermesSessionId: pane.initialHermesSessionId,
      });
      return { id: pane.id, sessionId: target.sessionId, hermesSessionId: target.hermesSessionId };
    }),
    activePaneId,
  });
}

export function savePaneLayout(
  profile: string,
  panes: PaneSpec[],
  targets: Record<string, PaneTarget | undefined>,
  activePaneId: string,
  storage: LayoutStorage | null,
): void {
  const layout = paneLayoutSnapshot(panes, targets, activePaneId);
  if (layout) writePaneLayout(profile, layout, storage);
}

function stateFromStored(layout: StoredPaneLayout, activePaneId: string): PaneLayoutState {
  const panes: PaneSpec[] = layout.panes.map(pane => ({
    id: pane.id,
    initialSessionId: pane.sessionId,
    initialHermesSessionId: pane.hermesSessionId,
  }));
  const targets: Record<string, PaneTarget> = {};
  for (const pane of layout.panes) {
    targets[pane.id] = { sessionId: pane.sessionId, hermesSessionId: pane.hermesSessionId };
  }
  return { panes, targets, activePaneId, startEmpty: false, restored: true };
}

/**
 * Choose the panes to mount on load.
 *
 * Order of authority: an explicit new-chat route wins over everything, a route
 * that names a session already open only moves focus, and a route naming an
 * unknown session opens beside the restored panes (replacing the rightmost one
 * when the workspace is already full). Without a route target the saved layout
 * is restored as-is.
 */
export function resolvePaneLayout(options: {
  profile: string;
  storage: LayoutStorage | null;
  startEmpty: boolean;
  routeTarget: PaneTarget;
}): PaneLayoutState {
  const { profile, storage, startEmpty } = options;
  const route = normalizeTarget(options.routeTarget);
  if (startEmpty) return emptyPaneLayout(true);
  const saved = readPaneLayout(profile, storage);
  if (!saved) {
    const paneId = 'pane-1';
    return {
      panes: [{ id: paneId, initialSessionId: route.sessionId, initialHermesSessionId: route.hermesSessionId }],
      targets: { [paneId]: route },
      activePaneId: paneId,
      startEmpty: false,
      restored: false,
    };
  }
  const state = stateFromStored(saved, saved.activePaneId);
  if (!route.sessionId && !route.hermesSessionId) return state;
  const match = saved.panes.find(pane => sameTarget(pane, route));
  if (match) {
    state.activePaneId = match.id;
    return state;
  }
  const pane: PaneSpec = {
    id: nextPaneId(state.panes),
    initialSessionId: route.sessionId,
    initialHermesSessionId: route.hermesSessionId,
  };
  if (state.panes.length < PANE_LIMIT) {
    state.panes = [...state.panes, pane];
  } else {
    const dropped = state.panes[state.panes.length - 1];
    state.panes = [...state.panes.slice(0, -1), pane];
    delete state.targets[dropped.id];
  }
  state.targets[pane.id] = route;
  state.activePaneId = pane.id;
  return state;
}

/**
 * Remove panes that can no longer be restored (deleted, trashed, or owned by
 * another profile). One empty pane always survives so the workspace stays
 * usable instead of collapsing.
 */
export function dropPaneIds(
  panes: PaneSpec[],
  targets: Record<string, PaneTarget | undefined>,
  activePaneId: string,
  droppedIds: string[],
): { panes: PaneSpec[]; targets: Record<string, PaneTarget>; activePaneId: string } {
  const drop = new Set(droppedIds);
  if (!panes.some(pane => drop.has(pane.id))) {
    const unchanged: Record<string, PaneTarget> = {};
    for (const pane of panes) unchanged[pane.id] = normalizeTarget(targets[pane.id] ?? EMPTY_TARGET);
    return { panes, targets: unchanged, activePaneId };
  }
  const activeIndex = panes.findIndex(pane => pane.id === activePaneId);
  const remaining = panes.filter(pane => !drop.has(pane.id));
  const nextTargets: Record<string, PaneTarget> = {};
  for (const pane of remaining) nextTargets[pane.id] = normalizeTarget(targets[pane.id] ?? EMPTY_TARGET);
  if (!remaining.length) {
    const paneId = nextPaneId(panes);
    return {
      panes: [{ id: paneId, initialSessionId: '', initialHermesSessionId: '' }],
      targets: { [paneId]: { ...EMPTY_TARGET } },
      activePaneId: paneId,
    };
  }
  let nextActive = activePaneId;
  if (drop.has(activePaneId)) {
    const after = remaining.filter(pane => panes.indexOf(pane) > activeIndex);
    nextActive = (after[0] ?? remaining[remaining.length - 1]).id;
  }
  return { panes: remaining, targets: nextTargets, activePaneId: nextActive };
}

type HermesSessionPage = { sessions?: Record<string, unknown>[]; total?: number };

/** Hermes history ids on the profile, or null while the first page is not the whole list. */
async function hermesSessionIds(read: FetchJSON, profile: string): Promise<Set<string> | null> {
  const response = await read<HermesSessionPage>(
    `/api/profiles/sessions?limit=${HERMES_SESSION_PAGE}&offset=0&archived=include&order=recent`
    + `&profile=${encodeURIComponent(profile)}&exclude_sources=cron`,
  );
  const rows = Array.isArray(response?.sessions) ? response.sessions : [];
  const total = Number(response?.total);
  if (!Number.isFinite(total) || rows.length < total) return null;
  const ids = new Set<string>();
  for (const row of rows) {
    const id = text(row?.id) || text(row?.session_id);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Report panes whose saved target no longer resolves inside this profile.
 * Only definite answers prune a pane: a failed or partial listing keeps the
 * layout untouched, because losing a pane is worse than a stale one.
 */
export async function verifyPaneTargets(
  read: FetchJSON,
  profile: string,
  entries: PaneTargetCheck[],
): Promise<string[]> {
  const codex = entries.filter(entry => entry.sessionId);
  const hermes = entries.filter(entry => !entry.sessionId && entry.hermesSessionId);
  const missing: string[] = [];
  if (codex.length) {
    const sessions = await listCodexSessions(read, profile).catch(() => null);
    if (sessions) {
      const ids = new Set(sessions.map(session => session.id));
      for (const entry of codex) if (!ids.has(entry.sessionId)) missing.push(entry.paneId);
    }
  }
  if (hermes.length) {
    const ids = await hermesSessionIds(read, profile).catch(() => null);
    if (ids) for (const entry of hermes) if (!ids.has(entry.hermesSessionId)) missing.push(entry.paneId);
  }
  return missing;
}
