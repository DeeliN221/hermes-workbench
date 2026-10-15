import { uiText as sourceText } from './ui-locale';
/**
 * Compose the session sidebar, TUI/transcript chat area, and file/terminal workspace.
 * Use only each session's backend-bound workspace without modifying Hermes core state.
 */
import type { WorkbenchTranscript } from './session-api';
import {
  listSessions,
  loadRecentTranscript,
  loadTranscript,
  searchSessions,
  sessionLoadErrorMessage,
  validateSession,
} from './session-api';
import { loadCachedTranscript, saveCachedTranscript } from './transcript-cache';
import { requestSessionDeletion, sessionDeletionAvailable } from './session-delete';
import { createTerminalPanel } from './terminal-panel';
import { createTranscriptComponents } from './transcript-components';
import { scrollTranscriptToEnd } from './transcript-scroll';
import { uiText } from './ui-locale';
import { linkKanbanSession } from './kanban-session-api';
import { mobileWorkbenchViewportHeight } from './mobile-viewport';
import { clampPanelWidth } from './panel-resize';
import {
  loadWorkspace,
  workspaceForNewSession,
  workspaceForSession,
  type Workspace,
} from './workbench-api';

import { createSessionOrganizer } from './session-organizer';
import { sessionActivityDecision, shouldRefreshTranscript } from './session-events';
import { loadSessionOrganization, saveSessionOrganization } from './session-organization-api';
import {
  collectionNames,
  defaultExpandedSessionGroups,
  emptySessionOrganization,
  groupSessionRows,
  mergeSessionRows,
  organizeSessionRows,
  sessionDisplayTitle,
  sessionMatchesView,
  sessionNativeTitle,
  sessionRowId,
  sessionViewForRows,
  type SessionCollectionGroup,
  type SessionOrganization,
  type SessionOrganizationMap,
} from './session-organization';

type SDK = Record<string, any>;
type CenterMode = 'chat' | 'render';
type Drawer = 'sessions' | null;

const COLLAPSE_STORAGE_KEYS = {
  sessions: 'hermes-workbench.sessions-collapsed',
} as const;

const WIDTH_STORAGE_KEYS = {
  hostSidebar: 'hermes-workbench.host-sidebar-width',
  sessions: 'hermes-workbench.session-sidebar-width',
} as const;

function readPanelWidth(key: string, fallback: number, minimum: number, maximum: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? clampPanelWidth(value, minimum, maximum) : fallback;
  } catch {
    return fallback;
  }
}

function writePanelWidth(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Resizing remains available for the current page when storage is blocked.
  }
}

/** Show lightweight transcripts for historical sessions and editable chat for new sessions. */
function defaultCenterMode(sessionId: string): CenterMode {
  return sessionId ? 'render' : 'chat';
}

/** Read desktop sidebar preferences safely, defaulting to expanded when storage is unavailable or invalid. */
function readCollapsedPreference(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

/** Save sidebar preferences best-effort without interrupting UI operations on privacy or quota errors. */
function writeCollapsedPreference(key: string, collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(collapsed));
  } catch {
    // The current page still collapses correctly when local storage is unavailable.
  }
}

/** Create elements with the host React instance instead of bundling another runtime. */
function element(React: any, type: any, props?: Record<string, any> | null, ...children: any[]): any {
  return React.createElement(type, props, ...children);
}

/**
 * Deliver cached or recent messages first, then replace and persist them with complete compression lineage.
 * The caller does not await this promise; full transcripts load after the initial view in the background.
 */
export async function loadProgressiveTranscript(
  fetchJSON: SDK['fetchJSON'],
  profile: string,
  sessionId: string,
  publish: (transcript: WorkbenchTranscript) => void,
  isActive: () => boolean = () => true,
): Promise<void> {
  const cached = await loadCachedTranscript(profile, sessionId);
  if (!isActive()) return;

  if (cached) {
    publish(cached);
  } else {
    try {
      const recent = await loadRecentTranscript(fetchJSON, profile, sessionId);
      if (!isActive()) return;
      publish(recent);
    } catch {
      // Full lineage may still succeed; a failed fast preview must not block the authoritative transcript.
    }
  }

  if (!isActive()) return;
  const complete = await loadTranscript(fetchJSON, profile, sessionId);
  if (!isActive()) return;
  publish(complete);
  await saveCachedTranscript(profile, sessionId, complete);
}

/** Format session timestamps without inventing values for unrecognized input. */
function sessionTime(row: Record<string, any>): string {
  const raw = row.updated_at ?? row.last_active ?? row.created_at ?? row.timestamp;
  const numeric = typeof raw === 'number' && raw < 1_000_000_000_000 ? raw * 1000 : raw;
  const date = new Date(numeric ?? 0);
  return Number.isFinite(date.getTime()) && date.getTime() > 0
    ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
}

function sessionTimeGroupLabel(group: string): string {
  if (group === 'today') return uiText('今天', 'Today');
  if (group === 'week') return uiText('近 7 天', 'Previous 7 days');
  if (group === 'month') return uiText('近 30 天', 'Previous 30 days');
  return uiText('更早', 'Older');
}

/** Render a compact localized segmented control. */
function Segmented({ React, value, onChange, items }: {
  React: any;
  value: string;
  onChange: (value: any) => void;
  items: Array<{ value: string; label: string }>;
}): any {
  return element(React, 'div', { className: 'hti-segmented', role: 'tablist' },
    ...items.map(item => element(React, 'button', {
      key: item.value,
      type: 'button',
      role: 'tab',
      'aria-selected': value === item.value,
      className: value === item.value ? 'active' : '',
      onClick: () => onChange(item.value),
    }, item.label)));
}

/** Create the complete Workbench component registered over the Dashboard chat route. */
export function createWorkbenchView(sdk: SDK): () => any {
  const React = sdk.React;
  const { useEffect, useMemo, useRef, useState } = sdk.hooks;
  const { TranscriptTimeline } = createTranscriptComponents(sdk);
  const TerminalPanel = createTerminalPanel(sdk);

  const SessionOrganizer = createSessionOrganizer(sdk);

  return function HermesWorkbench(): any {
    /** Render historical transcripts first while validating the workspace and warming the PTY in the background. */
    const params = new URLSearchParams(window.location.search);
    const initialSessionId = params.get('session') || '';
    // The native sidebar ProfileSwitcher is the single agent selector.
    const profile = params.get('profile') || 'default';
    const [kanbanContext, setKanbanContext] = useState(() => ({
      taskId: params.get('kanban_task') || '',
      board: params.get('kanban_board') || '',
    }));
    const kanbanTaskId = kanbanContext.taskId;
    const kanbanBoard = kanbanContext.board;
    // Automation transcripts open from their owning Cron card; this sidebar is
    // permanently scoped to human-started conversations.
    const [activeSessionIsCron, setActiveSessionIsCron] = useState(initialSessionId.startsWith('cron_'));
    const [expandedCollections, setExpandedCollections] = useState(defaultExpandedSessionGroups);
    const [sessionId, setSessionId] = useState(initialSessionId);
    const kanbanInitialInput = !sessionId && kanbanTaskId
      ? sourceText(`我从看板打开了任务 ${kanbanTaskId}${kanbanBoard ? sourceText(`（看板：${kanbanBoard}）`, ` (board: ${kanbanBoard})`) : ''}。请先读取这张卡的详情、评论和运行记录，再与我讨论下一步。在我明确确认前，不要派发或推进子任务；当我说“定稿/回写工单”时，将确认后的目标、范围、约束和验收标准改写进该任务正文，并用评论记录关键决策。`, `I opened task ${kanbanTaskId}${kanbanBoard ? sourceText(`（看板：${kanbanBoard}）`, ` (board: ${kanbanBoard})`) : ''} from the board. Read the card details, comments, and run history, then discuss next steps with me. Do not dispatch or advance subtasks until I explicitly confirm. When I ask to finalize or write back, update the task body with the agreed goals, scope, constraints, and acceptance criteria, and record key decisions in a comment.`)
      : '';
    const sessionIdRef = useRef(initialSessionId);
    const [terminalInstanceId, setTerminalInstanceId] = useState(
      () => initialSessionId || `new-${Date.now()}`,
    );
    const [terminalResumeSessionId, setTerminalResumeSessionId] = useState(initialSessionId);
    const pendingChatSessionIdRef = useRef('');
    const lastSessionProbeAtRef = useRef(0);
    const [sessionListRefreshEpoch, setSessionListRefreshEpoch] = useState(0);
    const [transcriptRefreshEpoch, setTranscriptRefreshEpoch] = useState(0);
    const [search, setSearch] = useState('');
    const [baseSessions, setBaseSessions] = useState([] as Array<Record<string, any>>);
    const [sessionTotal, setSessionTotal] = useState(0);
    const [sessionListComplete, setSessionListComplete] = useState(true);
    const [searchRows, setSearchRows] = useState([] as Array<Record<string, any>>);
    const [organization, setOrganization] = useState({} as SessionOrganizationMap);
    const [organizingSessionId, setOrganizingSessionId] = useState('');
    const [pinSavingId, setPinSavingId] = useState('');
    const [deletingSessionId, setDeletingSessionId] = useState('');
    const [transcript, setTranscript] = useState(null as WorkbenchTranscript | null);
    const transcriptPaneRef = useRef(null as HTMLElement | null);
    const [workspace, setWorkspace] = useState(null as Workspace | null);
    const initialCenterMode = defaultCenterMode(initialSessionId);
    const [centerMode, setCenterMode] = useState(initialCenterMode);
    const attachmentInputRef = useRef(null as HTMLInputElement | null);
    const [attachmentUploading, setAttachmentUploading] = useState(false);
    const [drawer, setDrawer] = useState(null as Drawer);
    const [sessionsCollapsed, setSessionsCollapsed] = useState(
      () => readCollapsedPreference(COLLAPSE_STORAGE_KEYS.sessions),
    );
    const [sessionColumnWidth, setSessionColumnWidth] = useState(
      () => readPanelWidth(WIDTH_STORAGE_KEYS.sessions, 208, 160, 480),
    );

    const [rawOpen, setRawOpen] = useState(false);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);
    const [sessionLoading, setSessionLoading] = useState(true);
    const [error, setError] = useState('');
    const workbenchRootRef = useRef(null as HTMLElement | null);
    sessionIdRef.current = sessionId;

    /** Remove the host page gutters while this route owns the complete content canvas. */
    useEffect(() => {
      const root = workbenchRootRef.current;
      if (!root) return undefined;
      let shell: HTMLElement | null = root.parentElement;
      while (shell?.parentElement) {
        const siblings = Array.from(shell.parentElement.children);
        if (siblings.some(child => (child as HTMLElement).id === 'app-sidebar')) break;
        shell = shell.parentElement;
      }
      if (!shell?.parentElement) return undefined;
      let contentHost: HTMLElement = root;
      while (contentHost.parentElement && contentHost.parentElement !== shell) {
        contentHost = contentHost.parentElement;
      }
      shell.classList.add('hti-workbench-host-shell');
      contentHost.classList.add('hti-workbench-host-content');
      return () => {
        shell?.classList.remove('hti-workbench-host-shell');
        contentHost.classList.remove('hti-workbench-host-content');
      };
    }, []);

    /** Restore a manual desktop width; otherwise let CSS size the host sidebar to content. */
    useEffect(() => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(WIDTH_STORAGE_KEYS.hostSidebar);
      } catch {
        // CSS fit-content remains the default when storage is unavailable.
      }
      const width = Number(stored);
      if (stored && Number.isFinite(width) && width > 0) {
        document.documentElement.style.setProperty('--hti-host-sidebar-width', `${clampPanelWidth(width, 184, 420)}px`);
      } else {
        document.documentElement.style.removeProperty('--hti-host-sidebar-width');
      }
    }, []);

    const applyHostSidebarWidth = (width: number) => {
      const next = clampPanelWidth(width, 184, 420);
      document.documentElement.style.setProperty('--hti-host-sidebar-width', `${next}px`);
      return next;
    };

    const beginResize = (
      event: any,
      startWidth: number,
      minimum: number,
      maximum: number,
      apply: (width: number) => void,
      storageKey: string,
    ) => {
      if (event.button !== 0 || window.matchMedia('(max-width: 800px)').matches) return;
      event.preventDefault();
      const startX = Number(event.clientX);
      let latest = clampPanelWidth(startWidth, minimum, maximum);
      const move = (nextEvent: PointerEvent) => {
        latest = clampPanelWidth(startWidth + nextEvent.clientX - startX, minimum, maximum);
        apply(latest);
      };
      const stop = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
        document.documentElement.classList.remove('hti-is-resizing');
        writePanelWidth(storageKey, latest);
      };
      document.documentElement.classList.add('hti-is-resizing');
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop, { once: true });
    };

    const resizeHostSidebar = (event: any) => {
      const sidebar = document.getElementById('app-sidebar');
      if (!sidebar) return;
      beginResize(
        event,
        sidebar.getBoundingClientRect().width,
        184,
        420,
        width => { applyHostSidebarWidth(width); },
        WIDTH_STORAGE_KEYS.hostSidebar,
      );
    };

    const resizeSessionSidebar = (event: any) => {
      beginResize(event, sessionColumnWidth, 160, 480, setSessionColumnWidth, WIDTH_STORAGE_KEYS.sessions);
    };

    const resizeByKeyboard = (event: any, target: 'host' | 'sessions') => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -16 : 16;
      if (target === 'host') {
        const current = document.getElementById('app-sidebar')?.getBoundingClientRect().width ?? 224;
        const next = applyHostSidebarWidth(current + delta);
        writePanelWidth(WIDTH_STORAGE_KEYS.hostSidebar, next);
      } else {
        const next = clampPanelWidth(sessionColumnWidth + delta, 160, 480);
        setSessionColumnWidth(next);
        writePanelWidth(WIDTH_STORAGE_KEYS.sessions, next);
      }
    };

    /** Keep the helper-key row above Android's software keyboard. */
    useEffect(() => {
      let frame = 0;
      const update = () => {
        frame = 0;
        const root = workbenchRootRef.current;
        if (!root) return;
        if (!window.matchMedia('(max-width: 800px)').matches) {
          root.style.removeProperty('--hti-mobile-viewport-height');
          return;
        }
        const viewport = window.visualViewport;
        const height = mobileWorkbenchViewportHeight(root.getBoundingClientRect().top, {
          height: viewport?.height ?? window.innerHeight,
          offsetTop: viewport?.offsetTop ?? 0,
        });
        root.style.setProperty('--hti-mobile-viewport-height', `${height}px`);
      };
      const schedule = () => {
        if (frame) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(update);
      };
      schedule();
      window.addEventListener('resize', schedule);
      window.visualViewport?.addEventListener('resize', schedule);
      window.visualViewport?.addEventListener('scroll', schedule);
      return () => {
        if (frame) window.cancelAnimationFrame(frame);
        window.removeEventListener('resize', schedule);
        window.visualViewport?.removeEventListener('resize', schedule);
        window.visualViewport?.removeEventListener('scroll', schedule);
      };
    }, []);

    /** Synchronize the session deep link; ordinary creation or switching explicitly leaves kanban context. */
    const writeSessionDeepLink = (
      nextId: string,
      keepKanbanContext = true,
      targetProfile = profile,
    ) => {
      const next = new URL(window.location.href);
      next.searchParams.set('profile', targetProfile);
      if (nextId) next.searchParams.set('session', nextId);
      else next.searchParams.delete('session');
      if (!keepKanbanContext) {
        next.searchParams.delete('kanban_task');
        next.searchParams.delete('kanban_board');
      }
      window.history.replaceState(null, '', next);
    };

    const leaveKanbanContext = () => {
      setKanbanContext({ taskId: '', board: '' });
    };

    /** Adopt newly persisted chat IDs without rebuilding the active PTY. */
    const adoptChatSession = (nextId: string) => {
      pendingChatSessionIdRef.current = '';
      sessionIdRef.current = nextId;
      setSessionId(nextId);
      writeSessionDeepLink(nextId);
      if (kanbanTaskId) {
        void linkKanbanSession(sdk.fetchJSON, {
          board: kanbanBoard,
          task_id: kanbanTaskId,
          profile,
          session_id: nextId,
        }).then(link => {
          // Ignore a binding response after the user has switched agent/session/source.
          if (sessionIdRef.current !== nextId) return;
          // Two tabs may race to create the first task discussion. The server's
          // first binding is authoritative; immediately resume that singleton.
          if (link.session_id === nextId) return;
          sessionIdRef.current = link.session_id;
          setSessionId(link.session_id);
          setCenterMode('render');
          setTerminalInstanceId(link.session_id);
          setTerminalResumeSessionId(link.session_id);
          writeSessionDeepLink(link.session_id);
        }).catch(reason => {
          if (sessionIdRef.current === nextId) {
            setError(sourceText(`看板会话关联保存失败 / Could not save task link: ${String(reason)}`, `Could not save task link: ${String(reason)}`));
          }
        });
      }
    };


    useEffect(() => {
      let active = true;
      setSessionsLoading(true);
      setError('');
      Promise.all([
        listSessions(sdk.fetchJSON, profile),
        loadSessionOrganization(sdk.fetchJSON, profile).catch(reason => {
          if (active) setError(sourceText(`会话组织信息不可用 / Organization unavailable: ${String(reason)}`, `Organization unavailable: ${String(reason)}`));
          return {} as SessionOrganizationMap;
        }),
      ])
        .then(([nextSessionList, nextOrganization]) => {
          if (!active) return;
          setBaseSessions(nextSessionList.sessions);
          setSessionTotal(nextSessionList.total);
          setSessionListComplete(nextSessionList.complete);
          setOrganization(nextOrganization);
          const pendingId = pendingChatSessionIdRef.current;
          if (
            !sessionIdRef.current
            && pendingId
            && nextSessionList.sessions.some(row => sessionRowId(row) === pendingId)
          ) {
            adoptChatSession(pendingId);
          }
        })
        .catch(reason => active && setError(String(reason)))
        .finally(() => active && setSessionsLoading(false));
      return () => { active = false; };
    }, [profile, sessionListRefreshEpoch]);

    useEffect(() => {
      const normalizedSearch = search.trim();
      if (!normalizedSearch) {
        setSearchRows([]);
        setSearchLoading(false);
        return undefined;
      }
      let active = true;
      setSearchLoading(true);
      const timer = window.setTimeout(() => {
        searchSessions(sdk.fetchJSON, profile, normalizedSearch)
          .then(value => active && setSearchRows(value))
          .catch(reason => active && setError(String(reason)))
          .finally(() => active && setSearchLoading(false));
      }, 180);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }, [profile, search, sessionListRefreshEpoch]);

    const collections = useMemo(() => collectionNames(organization), [organization]);
    const visibleSearchRows = useMemo(
      () => searchRows.filter((row: Record<string, any>) => sessionMatchesView(row, 'conversations')),
      [searchRows],
    );
    const serverMatchIds = useMemo(
      () => new Set(visibleSearchRows.map((row: Record<string, any>) => sessionRowId(row))),
      [visibleSearchRows],
    );
    const mergedSessionRows = useMemo(
      () => mergeSessionRows(baseSessions, visibleSearchRows)
        .filter(row => sessionMatchesView(row, 'conversations')),
      [baseSessions, visibleSearchRows],
    );
    const sessionsById = useMemo(() => {
      const index = new Map<string, Record<string, any>>();
      for (const row of mergedSessionRows) index.set(sessionRowId(row), row);
      return index;
    }, [mergedSessionRows]);
    const sessions = useMemo(
      () => organizeSessionRows(mergedSessionRows, organization, search, serverMatchIds),
      [mergedSessionRows, organization, search, serverMatchIds],
    );
    const sessionGroups = useMemo(
      () => groupSessionRows(sessions),
      [sessions],
    );
    const activeWorkspace = workspaceForSession(workspace, profile, sessionId);

    /** Prefer cached content; otherwise show recent messages before merging and caching full lineage in the background. */
    useEffect(() => {
      setTranscript(null);
      setRawOpen(false);
      if (!sessionId) return undefined;
      let active = true;
      setError('');
      void loadProgressiveTranscript(
        sdk.fetchJSON,
        profile,
        sessionId,
        nextTranscript => {
          setTranscript(nextTranscript);
          if (sessionIdRef.current === sessionId) {
            const cronTranscript = sessionViewForRows(nextTranscript.lineage) === 'cron';
            setActiveSessionIsCron(cronTranscript);
            if (cronTranscript) {
              setCenterMode('render');
              setTerminalResumeSessionId('');
              setWorkspace(null);
            }
          }
        },
        () => active,
      ).catch(reason => active && setError(sessionLoadErrorMessage(reason)));
      return () => { active = false; };
    }, [profile, sessionId, transcriptRefreshEpoch]);

    /** Scroll to the bottom after transcript layout so historical sessions open at the latest content. */
    useEffect(() => {
      if (centerMode !== 'render' || !transcript) return undefined;
      const frame = window.requestAnimationFrame(() => scrollTranscriptToEnd(transcriptPaneRef.current));
      return () => window.cancelAnimationFrame(frame);
    }, [centerMode, transcript]);

    /** Mount the TUI when the workspace is ready; validate history in the background without blocking message recovery. */
    useEffect(() => {
      if (activeSessionIsCron) {
        setWorkspace(null);
        setSessionLoading(false);
        return undefined;
      }
      let active = true;
      setWorkspace(null);
      setSessionLoading(true);
      setError('');
      loadWorkspace(sdk.fetchJSON, profile, sessionId)
        .then(nextWorkspace => {
          if (active) setWorkspace(nextWorkspace);
        })
        .catch(reason => {
          if (!active) return;
          setWorkspace(null);
          setTerminalResumeSessionId('');
          setError(sessionLoadErrorMessage(reason));
        })
        .finally(() => active && setSessionLoading(false));

      if (sessionId) {
        void validateSession(sdk.fetchJSON, profile, sessionId).catch(reason => {
          if (!active) return;
          setTerminalResumeSessionId('');
          setError(sessionLoadErrorMessage(reason));
        });
      }
      return () => { active = false; };
    }, [profile, sessionId, activeSessionIsCron]);

    /** Select an ordinary session and clear any stale kanban binding in the URL. */
    const selectSession = (nextId: string) => {
      const nextMode = defaultCenterMode(nextId);
      pendingChatSessionIdRef.current = '';
      sessionIdRef.current = nextId;
      setSessionId(nextId);
      setActiveSessionIsCron(false);
      setCenterMode(nextMode);
      setTerminalInstanceId(nextId);
      setTerminalResumeSessionId(nextId);
      setDrawer(null);
      leaveKanbanContext();
      writeSessionDeepLink(nextId, false);
    };


    /** Start a fresh TUI in the current profile workspace; a task deep-link must never hijack it. */
    const startNewSession = () => {
      const retainedWorkspace = workspaceForNewSession(workspace, profile);
      pendingChatSessionIdRef.current = '';
      lastSessionProbeAtRef.current = 0;
      sessionIdRef.current = '';
      setSessionId('');
      setTranscript(null);
      setRawOpen(false);
      setWorkspace(retainedWorkspace);
      setSessionLoading(!retainedWorkspace);
      setActiveSessionIsCron(false);
      setExpandedCollections(defaultExpandedSessionGroups());
      const nextMode = defaultCenterMode('');
      setCenterMode(nextMode);
      setTerminalInstanceId(`new-${Date.now()}`);
      setTerminalResumeSessionId('');
      setDrawer(null);
      leaveKanbanContext();
      writeSessionDeepLink('', false, profile);
    };

    /** Ignore internal PTY IDs for historical chats; new chats adopt only IDs confirmed by the persisted session list. */
    const handleChatSessionActivity = (activeSessionId: string) => {
      const normalized = String(activeSessionId || '').trim();
      if (shouldRefreshTranscript(sessionIdRef.current, normalized)) {
        // session.info is re-emitted when a turn settles; refresh the persisted
        // transcript so the Record tab catches up without a page reload.
        setTranscriptRefreshEpoch((value: number) => value + 1);
        return;
      }
      const decision = sessionActivityDecision(
        sessionIdRef.current,
        normalized,
        sessionsById.has(normalized),
      );
      if (decision === 'adopt') {
        adoptChatSession(normalized);
      } else if (decision === 'probe') {
        pendingChatSessionIdRef.current = normalized;
        const now = Date.now();
        if (now - lastSessionProbeAtRef.current >= 2_000) {
          lastSessionProbeAtRef.current = now;
          setSessionListRefreshEpoch((value: number) => value + 1);
        }
      }
    };

    /** Reload immediately on entering transcript view, keeping the chat PTY mounted for completion events. */
    const changeCenterMode = (value: CenterMode) => {
      const nextMode: CenterMode = activeSessionIsCron || value === 'render' ? 'render' : 'chat';
      setCenterMode(nextMode);
      if (nextMode === 'render') {
        setTranscriptRefreshEpoch((current: number) => current + 1);
      }
    };

    /** Apply one persisted metadata result without refetching the session transcript. */
    const applyOrganization = (value: SessionOrganization | null, targetSessionId: string) => {
      setOrganization((current: SessionOrganizationMap) => {
        const next = { ...current };
        if (value) next[targetSessionId] = value;
        else delete next[targetSessionId];
        return next;
      });
    };

    /** Toggle pin state directly from the list while preserving every other metadata field. */
    const togglePinned = async (targetSessionId: string) => {
      const current = organization[targetSessionId]
        || emptySessionOrganization(profile, targetSessionId);
      setPinSavingId(targetSessionId);
      setError('');
      try {
        const saved = await saveSessionOrganization(sdk.fetchJSON, {
          ...current,
          pinned: !current.pinned,
        });
        applyOrganization(saved, targetSessionId);
      } catch (reason) {
        setError(String(reason));
      } finally {
        setPinSavingId('');
      }
    };

    /** Confirm and delete one ordinary conversation without allowing the row action to select it. */
    const deleteSessionRow = async (
      event: any,
      row: Record<string, any>,
      visibleTitle: string,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const targetSessionId = sessionRowId(row);
      const ownerProfile = String(row.profile || profile);
      setDeletingSessionId(targetSessionId);
      setError('');
      try {
        await requestSessionDeletion({
          fetchJSON: sdk.fetchJSON,
          profile: ownerProfile,
          sessionId: targetSessionId,
          title: visibleTitle,
          currentSessionId: sessionIdRef.current,
          view: 'conversations',
          confirm: message => window.confirm(message),
          onCurrentDeleted: startNewSession,
          onRefresh: () => setSessionListRefreshEpoch((value: number) => value + 1),
          onError: setError,
        });
      } finally {
        setDeletingSessionId('');
      }
    };



    const toggleCollection = (collection: string) => {
      setExpandedCollections((current: Set<string>) => {
        const next = new Set(current);
        if (next.has(collection)) next.delete(collection);
        else next.add(collection);
        return next;
      });
    };

    /** Toggle and persist the desktop session sidebar independently of the mobile drawer. */
    const toggleSessionsCollapsed = () => {
      const nextCollapsed = !sessionsCollapsed;
      setSessionsCollapsed(nextCollapsed);
      writeCollapsedPreference(COLLAPSE_STORAGE_KEYS.sessions, nextCollapsed);
    };


    const sessionsToggleLabel = sessionsCollapsed
      ? sourceText("展开会话栏 / Expand sessions sidebar", "Expand sessions sidebar")
      : sourceText("折叠会话栏 / Collapse sessions sidebar", "Collapse sessions sidebar");

    const renderSessionRow = (row: Record<string, any>) => {
      const id = sessionRowId(row);
      const meta = organization[id] || emptySessionOrganization(profile, id);
      const visibleTitle = sessionDisplayTitle(row, meta);
      return element(React, 'div', {
        key: id,
        className: `hti-session-row${id === sessionId ? ' active' : ''}${meta.pinned ? ' is-pinned' : ''}`,
        'data-session-id': id,
      },
        element(React, 'button', {
          type: 'button', className: 'hti-session-open',
          'aria-current': id === sessionId ? 'page' : undefined,
          onClick: () => selectSession(id),
        },
        element(React, 'span', { className: 'hti-session-title-line' },
          element(React, 'span', { className: 'hti-session-title' }, visibleTitle),
          row._lineage_root_id ? element(React, 'span', {
            className: 'hti-lineage-chip',
            title: sourceText("较早记录已合并到当前压缩续写链 / Earlier transcript is merged", "Earlier transcript is merged"),
          }, uiText('续写', 'Continued')) : null,
          row.archived ? element(React, 'span', {
            className: 'hti-archived-chip', title: sourceText("已归档会话 / Archived conversation", "Archived conversation"),
          }, uiText('归档', 'Archived')) : null),
        meta.tags.length > 0 ? element(React, 'span', { className: 'hti-tag-list' },
          ...meta.tags.map((tag: string) => element(React, 'span', { key: tag }, tag))) : null,
        meta.summary ? element(React, 'span', { className: 'hti-session-summary' }, meta.summary) : null,
        element(React, 'span', { className: 'hti-session-subtitle' },
          element(React, 'code', null, id),
          element(React, 'time', null, sessionTime(row)))),
        element(React, 'div', { className: 'hti-session-row-actions' },
          element(React, 'button', {
            type: 'button', className: 'hti-session-pin', disabled: pinSavingId === id,
            'aria-label': meta.pinned ? sourceText("取消固定 / Unpin session", "Unpin session") : sourceText("固定会话 / Pin session", "Pin session"),
            'aria-pressed': meta.pinned,
            title: meta.pinned ? sourceText("取消固定 / Unpin session", "Unpin session") : sourceText("固定会话 / Pin session", "Pin session"),
            onClick: () => togglePinned(id),
          }, pinSavingId === id ? '…' : meta.pinned ? '★' : '☆'),
          element(React, 'button', {
            type: 'button', className: 'hti-session-organize',
            'aria-label': uiText(`整理会话 ${visibleTitle}`, `Organize session ${visibleTitle}`),
            title: uiText('显示名称、集合、标签与摘要', 'Display name, collection, tags and summary'),
            onClick: () => setOrganizingSessionId(id),
          }, '✎'),
          sessionDeletionAvailable('conversations') ? element(React, 'button', {
            type: 'button',
            className: 'hti-session-delete',
            disabled: deletingSessionId === id,
            'aria-label': uiText(`删除会话 ${visibleTitle}`, `Delete session ${visibleTitle}`),
            'aria-busy': deletingSessionId === id,
            title: uiText('删除会话', 'Delete session'),
            onClick: (event: any) => void deleteSessionRow(event, row, visibleTitle),
          }, deletingSessionId === id ? '…' : '🗑') : null));
    };

    /** Build the shared list used by the desktop sidebar and mobile session drawer. */
    const sessionSidebar = element(React, 'aside', {
      id: 'hti-session-sidebar',
      className: `hti-session-sidebar${drawer === 'sessions' ? ' is-mobile-open' : ''}`,
      'aria-label': sourceText("会话 / Sessions", "Sessions"),
    },
      element(React, 'header', { className: 'hti-pane-header hti-session-heading' },
        element(React, 'div', { className: 'hti-pane-title' },
          element(React, 'button', {
            type: 'button', className: 'hti-header-new-session', onClick: startNewSession,
          }, uiText('＋ 新会话', '＋ New chat'))),
        element(React, 'div', { className: 'hti-pane-header-actions' },
          element(React, 'button', {
            type: 'button',
            className: 'hti-pane-collapse',
            onClick: toggleSessionsCollapsed,
            'aria-label': sessionsToggleLabel,
            'aria-controls': 'hti-session-sidebar-body',
            'aria-expanded': !sessionsCollapsed,
            title: sessionsToggleLabel,
          }, element(React, 'span', { 'aria-hidden': true }, sessionsCollapsed ? '›' : '‹')),
          element(React, 'button', {
            type: 'button', className: 'hti-drawer-close', onClick: () => setDrawer(null),
            'aria-label': sourceText("关闭会话栏 / Close sessions sidebar", "Close sessions sidebar"),
            title: sourceText("关闭会话栏 / Close sessions sidebar", "Close sessions sidebar"),
          }, '×'))),
      element(React, 'div', { id: 'hti-session-sidebar-body', className: 'hti-session-sidebar-body' },
        element(React, 'div', { className: 'hti-session-controls' },
          element(React, 'label', { className: 'hti-visually-hidden', htmlFor: 'hti-search' }, sourceText("搜索 / Search", "Search")),
          element(React, 'input', {
            id: 'hti-search', value: search, placeholder: sourceText("搜索会话 / Search sessions", "Search sessions"),
            onChange: (event: any) => setSearch(event.target.value),
          })),
        element(React, 'div', { className: 'hti-session-meta' },
          sessionsLoading || searchLoading
            ? sourceText("加载中… / Loading…", "Loading…")
            : search.trim()
              ? uiText(`${sessions.length} 个匹配对话`, `${sessions.length} matches`)
              : sessionListComplete
                ? uiText(`${sessionTotal} 个对话`, `${sessionTotal} conversations`)
                : uiText(`${baseSessions.length}/${sessionTotal} 个对话`, `${baseSessions.length}/${sessionTotal} conversations`)),
        element(React, 'nav', { className: 'hti-session-list' },
          sessions.length === 0 && !sessionsLoading && !searchLoading
            ? element(React, 'div', { className: 'hti-session-list-empty' }, uiText('暂无对话', 'No conversations'))
            : null,
          ...sessionGroups.map((group: SessionCollectionGroup) => {
            const groupKey = group.collection;
            const collapsed = !search.trim() && !expandedCollections.has(groupKey);
            const label = sessionTimeGroupLabel(group.collection);
            return element(React, 'section', {
              key: groupKey,
              className: 'hti-session-group',
              'data-time-group': group.collection,
            },
              element(React, 'button', {
                type: 'button', className: 'hti-session-group-toggle',
                'aria-expanded': !collapsed,
                onClick: () => toggleCollection(groupKey),
              },
                element(React, 'span', { className: 'hti-session-group-chevron', 'aria-hidden': true }, collapsed ? '›' : '⌄'),
                element(React, 'span', { className: 'hti-session-group-folder', 'aria-hidden': true }, '▰'),
                element(React, 'span', { className: 'hti-session-group-name' }, label),
                element(React, 'span', { className: 'hti-session-group-count' }, String(group.rows.length))),
              collapsed ? null : element(React, 'div', { className: 'hti-session-group-rows' },
                ...group.rows.map(renderSessionRow)));
          }))));

    /** Build the central TUI/transcript dual view. */
    const centerPanel = element(React, 'section', { className: 'hti-center-pane' },
      element(React, 'header', { className: 'hti-pane-header hti-chat-header' },
        element(React, 'button', {
          type: 'button', className: 'hti-mobile-action is-left', onClick: () => setDrawer('sessions'),
          'aria-label': sourceText("打开会话 / Open sessions", "Open sessions"),
          'aria-controls': 'hti-session-sidebar',
          'aria-expanded': drawer === 'sessions',
          title: sourceText("打开会话 / Open sessions", "Open sessions"),
        }, '☰'),
        element(React, 'div', { className: 'hti-active-session' },
          element(React, 'strong', null, sessionId
            ? sessionDisplayTitle(sessionsById.get(sessionId) || { id: sessionId }, organization[sessionId])
            : sourceText("新会话 / New chat", "New chat")),
          element(React, 'span', null, activeWorkspace
            ? activeWorkspace.path
            : sessionLoading
              ? uiText('正在加载工作区…', 'Loading workspace…')
              : uiText('工作区不可用', 'Workspace unavailable'))),
        element(React, Segmented, {
          React,
          value: centerMode,
          onChange: changeCenterMode,
          items: activeSessionIsCron
            ? [{ value: 'render', label: sourceText("记录 / Transcript", "Transcript") }]
            : [
                { value: 'chat', label: sourceText("聊天 / Chat", "Chat") },
                { value: 'render', label: sourceText("记录 / Transcript", "Transcript") },
              ],
        }),
        element(React, 'button', {
          type: 'button',
          className: 'hti-chat-upload',
          disabled: !activeWorkspace || attachmentUploading,
          'aria-label': attachmentUploading
            ? uiText('文件上传中', 'Uploading file')
            : uiText('上传图片或文件', 'Upload image or file'),
          'aria-busy': attachmentUploading,
          title: attachmentUploading
            ? uiText('上传中…', 'Uploading…')
            : uiText('上传图片或文件', 'Upload image or file'),
          onClick: () => attachmentInputRef.current?.click(),
        }, attachmentUploading ? '…' : '📎')),
      error ? element(React, 'div', { className: 'hti-page-error', role: 'alert' }, error) : null,
      activeWorkspace && !activeSessionIsCron ? element(React, TerminalPanel, {
        mode: 'chat', profile, instanceId: terminalInstanceId,
        resumeSessionId: terminalResumeSessionId,
        initialInput: kanbanInitialInput,
        onSessionActivity: handleChatSessionActivity,
        workspaceId: activeWorkspace.id, workspacePath: activeWorkspace.path,
        attachmentInputRef,
        onAttachmentUploadState: setAttachmentUploading,
        visible: centerMode === 'chat',
      }) : centerMode === 'chat' ? element(React, 'div', { className: 'hti-panel-empty' },
            element(React, 'strong', null, sessionLoading ? sourceText("正在加载… / Loading…", "Loading…") : sourceText("工作区不可用 / Workspace unavailable", "Workspace unavailable")),
            element(React, 'span', null, sessionLoading
              ? uiText('正在准备当前 Profile 的工作区。', 'Preparing this profile workspace.')
              : uiText('请刷新页面；若仍失败，请检查 Workbench sidecar。', 'Reload the page; if this persists, check the Workbench sidecar.'))) : null,
      centerMode === 'render' ? !sessionId ? element(React, 'div', { className: 'hti-panel-empty' },
            element(React, 'strong', null, uiText('新会话尚无记录', 'No transcript yet')),
            element(React, 'span', null, uiText('先在聊天视图发送消息。', 'Send a message in Chat first.')))
          : transcript ? element(React, 'div', { className: 'hti-transcript-pane', ref: transcriptPaneRef },
            element(React, 'div', { className: 'hti-transcript-toolbar' },
              element(React, 'div', { className: 'hti-lineage' },
                element(React, 'span', null, sourceText("压缩链 / Compression lineage", "Compression lineage")),
                element(React, 'code', null, transcript.lineage.map((row: Record<string, any>) => row.id).join(' → '))),
              element(React, 'button', { type: 'button', onClick: () => setRawOpen((value: boolean) => !value) },
                rawOpen ? sourceText("隐藏原始记录 / Hide raw", "Hide raw") : sourceText("原始记录 / Raw", "Raw"))),
            element(React, TranscriptTimeline, {
              key: `${profile}:${sessionId}`,
              turns: transcript.turns,
              rawOpen,
            }))
            : element(React, 'div', { className: 'hti-panel-empty' },
              element(React, 'strong', null, sourceText("正在合并记录… / Loading transcript…", "Loading transcript…")),
              element(React, 'span', null, sourceText("正在读取 compression lineage。 / Reading compression lineage.", "Reading compression lineage."))) : null);


    const organizingRow = organizingSessionId
      ? sessionsById.get(organizingSessionId)
      : null;
    const organizer = organizingSessionId ? element(React, SessionOrganizer, {
      key: organizingSessionId,
      nativeSessionTitle: sessionNativeTitle(organizingRow || { id: organizingSessionId }),
      value: organization[organizingSessionId]
        || emptySessionOrganization(profile, organizingSessionId),
      collections,
      onClose: () => setOrganizingSessionId(''),
      onSaved: applyOrganization,
    }) : null;

    return element(React, 'main', {
      ref: workbenchRootRef,
      className: 'hti-root hti-workbench',
      style: { '--hti-session-column-expanded': `${sessionColumnWidth}px` },
      'data-component': 'HermesWorkbench',
      'data-session-layout': 'compact',
      'data-left-collapsed': String(sessionsCollapsed),
    },
      element(React, 'div', {
        className: 'hti-host-sidebar-resizer', role: 'separator', tabIndex: 0,
        'aria-label': uiText('调整左侧导航栏宽度', 'Resize navigation sidebar'),
        'aria-orientation': 'vertical',
        onPointerDown: resizeHostSidebar,
        onKeyDown: (event: any) => resizeByKeyboard(event, 'host'),
      }),
      sessionSidebar,
      element(React, 'div', {
        className: 'hti-session-sidebar-resizer', role: 'separator', tabIndex: 0,
        'aria-label': uiText('调整会话栏宽度', 'Resize sessions sidebar'),
        'aria-orientation': 'vertical',
        onPointerDown: resizeSessionSidebar,
        onKeyDown: (event: any) => resizeByKeyboard(event, 'sessions'),
      }),
      centerPanel,
      organizer,
      drawer ? element(React, 'button', {
        type: 'button', className: 'hti-drawer-backdrop', onClick: () => setDrawer(null),
        'aria-label': sourceText("关闭抽屉 / Close drawer", "Close drawer"),
      }) : null);
  };
}
