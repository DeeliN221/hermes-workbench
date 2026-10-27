import { uiText as sourceText } from './ui-locale';
/** Manual project navigation. Membership persists through the existing organization API. */
export interface ProjectSession {
  id: string;
  threadId?: string;
  groupId?: string | null;
  deleted?: boolean;
  favorite?: boolean;
  /** Prefer the numeric epoch supplied by the Codex session API. */
  updatedAtEpoch?: number;
  updatedAt?: string | number;
  createdAt?: number;
}
export interface SessionProject { id: string; name: string }
export const PANE_DRAG_TYPE = 'application/x-hermes-pane-sessions';
export const SESSION_DRAG_TYPE = 'application/x-hermes-project-session';

function sessionUpdatedAt(session: ProjectSession): number {
  const rawValues = [session.updatedAtEpoch, session.updatedAt, session.createdAt];
  for (const raw of rawValues) {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw < 1e12 ? raw * 1000 : raw;
    if (typeof raw === 'string' && raw.trim()) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function compareSessions<T extends ProjectSession>(a: T, b: T): number {
  const recent = sessionUpdatedAt(b) - sessionUpdatedAt(a);
  if (recent) return recent;
  return Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
}

function latestSessionUpdatedAt<T extends ProjectSession>(sessions: T[]): number {
  return sessions.reduce((latest, session) => Math.max(latest, sessionUpdatedAt(session)), 0);
}

export function partitionProjectSessions<T extends ProjectSession>(sessions: T[], projects: SessionProject[]) {
  const groups = [...new Map(projects.filter(project => project.id).map(project => [project.id, project])).values()]
    .map(project => ({ project, sessions: [] as T[] }));
  const byId = new Map(groups.map(group => [group.project.id, group]));
  const temporary: T[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (!session.id || session.deleted || seen.has(session.id)) continue;
    seen.add(session.id);
    const group = session.groupId ? byId.get(session.groupId) : undefined;
    (group ? group.sessions : temporary).push(session);
  }
  groups.forEach(group => group.sessions.sort(compareSessions));
  temporary.sort(compareSessions);
  groups.sort((a, b) => latestSessionUpdatedAt(b.sessions) - latestSessionUpdatedAt(a.sessions));
  return { groups, temporary };
}

/** Reject external drags, stale sessions, cross-profile drops, and redundant writes. */
export function projectDropSession<T extends ProjectSession>(
  payload: string, profile: string, projectId: string | null, sessions: T[], projects: SessionProject[],
): T | null {
  if (projectId !== null && !projects.some(project => project.id === projectId)) return null;
  try {
    const drag = JSON.parse(payload);
    if (drag?.profile !== profile || typeof drag?.sessionId !== 'string') return null;
    const session = sessions.find(item => item.id === drag.sessionId && !item.deleted);
    return session && (session.groupId || null) !== projectId ? session : null;
  } catch { return null; }
}

interface ProjectNavigationProps {
  profile: string;
  sessions: ProjectSession[];
  projects: SessionProject[];
  activeSessionId: string;
  renderSession: (session: ProjectSession, archived?: boolean) => any;
  onCreate: (trigger: HTMLElement) => void;
  onNewSession: () => void;
  onRename: (project: SessionProject, trigger: HTMLElement) => void;
  onDelete: (project: SessionProject) => void;
  onMove: (session: ProjectSession, projectId: string | null) => Promise<unknown>;
  onPaneDragStart?: (payload: string) => void;
  onPaneDragEnd?: () => void;
  history?: any;
}

export function createProjectNavigation(sdk: Record<string, any>) {
  const h = sdk.React.createElement;
  const { useState, useRef, useEffect } = sdk.hooks;
  const icon = (path: string) => h('svg', { viewBox: '0 0 24 24', width: 18, height: 18,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  h('path', { d: path }));
  const folderIcon = () => h('svg', { viewBox: '0 0 24 24', width: 22, height: 22,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  h('path', { d: 'M2 5h7l2 2h11v13H2z', fill: 'currentColor', fillOpacity: 0.22 }),
  h('path', { d: 'M2 9h20' }));
  const bubblePath = 'M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-5 4V4a1 1 0 0 1 1-1z';
  return function ProjectNavigation(props: ProjectNavigationProps) {
    const { profile, sessions, projects, renderSession, onMove } = props;
    const [dropTarget, setDropTarget] = useState(undefined);
    const [notice, setNotice] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const initialCollapsed = typeof document !== 'undefined'
      && document.documentElement.dataset.workbenchNavCollapsed === 'true';
    const [collapsed, setCollapsed] = useState(initialCollapsed);
    const [railProjectId, setRailProjectId] = useState(undefined as string | undefined);
    const [railTop, setRailTop] = useState(12);
    const historyTrigger = useRef(null);
    const railFlyout = useRef(null as HTMLElement | null);
    const historyId = sdk.React.useId();
    const moving = useRef(false);
    const folders = useRef(new Map<string, HTMLDetailsElement>());
    const activeProjectId = sessions.find(session => session.id === props.activeSessionId)?.groupId;
    useEffect(() => {
      const sync = () => setCollapsed(document.documentElement.dataset.workbenchNavCollapsed === 'true');
      window.addEventListener('workbench:nav-state', sync);
      return () => window.removeEventListener('workbench:nav-state', sync);
    }, []);
    useEffect(() => {
      if (!collapsed) return undefined;
      const close = (event: PointerEvent) => {
        const target = event.target as Element | null;
        if (target?.closest?.('[data-project-rail-folder]') || railFlyout.current?.contains(target as Node | null)) return;
        setRailProjectId(undefined);
      };
      const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setRailProjectId(undefined); };
      document.addEventListener('pointerdown', close);
      document.addEventListener('keydown', key);
      return () => {
        document.removeEventListener('pointerdown', close);
        document.removeEventListener('keydown', key);
      };
    }, [collapsed]);
    useEffect(() => {
      if (!collapsed) setRailProjectId(undefined);
    }, [collapsed]);
    useEffect(() => {
      if (activeProjectId) {
        const folder = folders.current.get(activeProjectId);
        if (folder) folder.open = true;
      }
    }, [activeProjectId, props.activeSessionId]);
    const { groups, temporary } = partitionProjectSessions(sessions, projects);
    const dropProps = (projectId: string | null) => ({
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer?.types.includes(SESSION_DRAG_TYPE) || moving.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(projectId);
      },
      onDragLeave: (event: DragEvent) => {
        if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setDropTarget(undefined);
      },
      onDrop: async (event: DragEvent) => {
        const payload = event.dataTransfer?.getData(SESSION_DRAG_TYPE);
        setDropTarget(undefined);
        if (!payload || moving.current) return;
        event.preventDefault();
        event.stopPropagation();
        const session = projectDropSession(payload, profile, projectId, sessions, projects);
        if (!session) return;
        const target = event.currentTarget as HTMLDetailsElement;
        moving.current = true;
        setNotice(sourceText("正在移动会话…", "Moving session…"));
        try {
          const saved = await onMove(session, projectId);
          setNotice(saved ? '' : sourceText("移动失败，请重试", "Move failed. Please retry."));
          if (saved && projectId !== null) target.open = true;
        } catch { setNotice(sourceText("移动失败，请重试", "Move failed. Please retry.")); }
        finally { moving.current = false; }
      },
    });
    const startPaneDrag = (event: DragEvent, sessionIds: string[]) => {
      const payload = JSON.stringify({ profile, sessionIds });
      event.dataTransfer?.setData(PANE_DRAG_TYPE, payload);
      props.onPaneDragStart?.(payload);
    };
    const endDrag = () => { setDropTarget(undefined); props.onPaneDragEnd?.(); };
    const row = (session: ProjectSession) => h('div', {
      key: session.id, className: 'project-session-drag', draggable: true, 'data-session-id': session.id,
      onDragStart: (event: DragEvent) => {
        if (!event.dataTransfer || moving.current) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData(SESSION_DRAG_TYPE, JSON.stringify({ profile, sessionId: session.id }));
        startPaneDrag(event, [session.id]);
      },
      onDragEnd: endDrag,
    }, renderSession(session, false));
    const railProject = groups.find(group => group.project.id === railProjectId);
    if (collapsed) {
      return h(sdk.React.Fragment, null,
        h('section', { className: 'project-rail', 'aria-label': sourceText("项目与临时会话", "Projects and temporary sessions") },
          groups.length ? h('div', { className: 'project-rail-section' }, ...groups.map(({ project, sessions: members }) =>
            h('button', {
              key: project.id, type: 'button', className: 'project-rail-folder', 'data-project-rail-folder': project.id,
              title: `${project.name} (${members.length})`, 'aria-label': sourceText(`项目：${project.name}，${members.length} 个会话`, `Project: ${project.name}, ${members.length} sessions`),
              'aria-expanded': railProjectId === project.id,
              onClick: (event: MouseEvent) => {
                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                const flyoutHeight = Math.min(520, window.innerHeight * 0.62);
                setRailTop(Math.max(12, Math.min(rect.top, window.innerHeight - flyoutHeight - 12)));
                setRailProjectId((current: string | undefined) => current === project.id ? undefined : project.id);
              },
            }, folderIcon(), members.length ? h('span', { className: 'project-rail-count' }, members.length) : null))) : null,
          h('div', { className: 'project-rail-section project-rail-temporary' },
            h('button', { type: 'button', className: 'project-rail-session-new', title: sourceText("新建临时会话", "New temporary session"),
              'aria-label': sourceText("新建临时会话", "New temporary session"), onClick: props.onNewSession },
              icon(`${bubblePath} M12 8v5 M9.5 10.5h5`)),
            ...temporary.map(session => h('div', { key: session.id, className: 'project-rail-session' },
              h('span', { className: 'project-rail-session-icon', 'aria-hidden': true }, icon(bubblePath)),
              renderSession(session, false))))),
        railProject ? h('div', { ref: railFlyout, className: 'project-rail-flyout', style: { top: `${railTop}px` },
          role: 'dialog', 'aria-label': railProject.project.name },
          h('header', null, h('strong', null, railProject.project.name), h('button', { type: 'button',
            'aria-label': sourceText("关闭项目列表", "Close project list"),
            onClick: () => setRailProjectId(undefined) }, '×')),
          h('div', { className: 'project-rail-flyout-list', onClickCapture: (event: MouseEvent) => {
            if ((event.target as Element | null)?.closest?.('.codex-session-row')) setRailProjectId(undefined);
          } }, railProject.sessions.length ? railProject.sessions.map(row)
            : h('p', { className: 'project-empty' }, sourceText("此项目还没有会话", "No sessions in this project")))) : null,
        notice ? h('p', { className: 'project-rail-notice', role: 'status' }, notice) : null);
    }
    return h(sdk.React.Fragment, null,
      h('section', { className: 'project-navigation', 'aria-label': sourceText("项目", "Projects") },
        h('div', { className: 'project-section-heading' }, h('span', null, sourceText("项目", "Projects")),
          h('div', { className: 'project-heading-actions' },
          h('button', { type: 'button', className: 'project-history-toggle', ref: historyTrigger,
            title: sourceText("历史与归档", "History and archive"), 'aria-label': sourceText("历史与归档", "History and archive"), 'aria-expanded': historyOpen,
            'aria-controls': historyId, onClick: () => setHistoryOpen((open: boolean) => !open) },
            icon('M5 12h.01M12 12h.01M19 12h.01')),
          h('button', { type: 'button', className: 'project-create', title: sourceText("新建项目", "New project"), 'aria-label': sourceText("新建项目", "New project"),
            onClick: (event: MouseEvent) => props.onCreate(event.currentTarget as HTMLElement) }, icon('M12 5v14M5 12h14')))),
        h('div', { id: historyId, className: 'project-history-panel', hidden: !historyOpen,
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.stopPropagation(); setHistoryOpen(false); historyTrigger.current?.focus(); }
          } }, props.history),
        h('div', { className: 'project-list' }, ...groups.map(({ project, sessions: members }) => h('div', {
          key: project.id, className: 'project-folder-row',
        }, h('details', { className: `project-folder${dropTarget === project.id ? ' is-drop-target' : ''}`,
          'data-project-id': project.id,
          ref: (node: HTMLDetailsElement | null) => { node ? folders.current.set(project.id, node) : folders.current.delete(project.id); },
          ...dropProps(project.id),
        }, h('summary', { className: 'project-folder-heading', draggable: true,
          title: sourceText("拖到右侧并排打开项目会话", "Drag right to open project sessions alongside"),
          onDragStart: (event: DragEvent) => {
            if (!event.dataTransfer || (event.target as HTMLElement).closest('button')) { event.preventDefault(); return; }
            event.dataTransfer.effectAllowed = 'copy';
            startPaneDrag(event, members.map(session => session.id));
          }, onDragEnd: endDrag },
          icon('M3 7V5h6l2 2h10v13H3z'),
          h('span', { className: 'project-name', title: project.name }, project.name),
          h('span', { className: 'project-count' }, members.length)),
          members.length ? members.map(row) : h('p', { className: 'project-empty' }, sourceText("拖拽会话到此项目", "Drag sessions into this project"))),
          // Keep independent actions beside the disclosure, outside its summary.
          h('span', { className: 'project-actions' },
            h('button', { type: 'button', title: sourceText("重命名项目", "Rename project"), 'aria-label': sourceText(`重命名项目：${project.name}`, `Rename project: ${project.name}`),
              onClick: (event: MouseEvent) => { event.preventDefault(); props.onRename(project, event.currentTarget as HTMLElement); } }, icon('m16 3 5 5-12 12H4v-5z')),
            h('button', { type: 'button', title: sourceText("删除项目", "Delete project"), 'aria-label': sourceText(`删除项目：${project.name}`, `Delete project: ${project.name}`),
              onClick: (event: MouseEvent) => { event.preventDefault(); props.onDelete(project); } }, icon('M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14'))))),
        groups.length ? null : h('p', { className: 'project-empty' }, sourceText("新建项目后，将会话拖入整理", "Create a project, then drag in sessions to organize them")))),
      h('section', { className: `project-temporary${dropTarget === null ? ' is-drop-target' : ''}`,
        'aria-label': sourceText("临时会话", "Temporary sessions"), ...dropProps(null) },
        h('div', { className: 'project-section-heading' }, h('span', null, sourceText("临时会话", "Temporary sessions")),
          h('button', { type: 'button', className: 'project-create', title: sourceText("新建临时会话", "New temporary session"), 'aria-label': sourceText("新建临时会话", "New temporary session"),
            onClick: props.onNewSession }, icon('M12 5v14M5 12h14'))),
        ...temporary.map(row),
        temporary.length ? null : h('p', { className: 'project-empty' }, sourceText("未加入项目的会话显示在这里", "Sessions outside projects appear here"))),
      notice ? h('p', { className: 'project-empty', role: 'status' }, notice) : null);
  };
}
