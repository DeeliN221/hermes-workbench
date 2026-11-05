import { createProjectEditor, projectMark } from './project-appearance';
import { uiText as sourceText } from './ui-locale';
/** Manual project navigation. Membership persists through the existing organization API. */
export interface ProjectSession {
  id: string;
  threadId?: string;
  groupId?: string | null;
  deleted?: boolean;
  favorite?: boolean;
  /** Display-only activity timestamps; they never decide the list order. */
  updatedAtEpoch?: number;
  updatedAt?: string | number;
  /** Creation time from the Codex session API (Unix seconds or milliseconds). */
  createdAt?: number | string;
}
export interface SessionProject { color?: string; icon?: string; id: string; name: string }
export const PANE_DRAG_TYPE = 'application/x-hermes-pane-sessions';
export const SESSION_DRAG_TYPE = 'application/x-hermes-project-session';
export const PROJECT_SPLIT_DEFAULT = 0.56;
export const PROJECT_SPLIT_MIN = 0.18;
export const PROJECT_SPLIT_MAX = 1 - PROJECT_SPLIT_MIN;
const PROJECT_SPLIT_STORAGE_KEY = 'hermes-workbench-project-session-split';
const PROJECT_SPLIT_RESIZER_HEIGHT = 11;
const PROJECT_SPLIT_PANE_MIN_HEIGHT = 72;

/** Keep the divider usable while leaving both sections room to scroll. */
export function clampProjectSplit(value: number): number {
  if (!Number.isFinite(value)) return PROJECT_SPLIT_DEFAULT;
  return Math.min(PROJECT_SPLIT_MAX, Math.max(PROJECT_SPLIT_MIN, value));
}

function readProjectSplit(): number {
  try {
    const stored = Number.parseFloat(window.localStorage.getItem(PROJECT_SPLIT_STORAGE_KEY) || '');
    return Number.isFinite(stored) ? clampProjectSplit(stored) : PROJECT_SPLIT_DEFAULT;
  } catch { return PROJECT_SPLIT_DEFAULT; }
}

function storeProjectSplit(value: number): void {
  try { window.localStorage.setItem(PROJECT_SPLIT_STORAGE_KEY, String(value)); } catch { /* storage is optional */ }
}

/** Normalize a creation timestamp to milliseconds; missing or invalid values return null. */
function sessionCreatedAt(session: ProjectSession): number | null {
  const raw = session.createdAt;
  const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Fixed list order: favorites first, then newest creation time first.
 * Activity timestamps are ignored so sending or receiving a message never moves a row;
 * sessions without a usable createdAt fall back to their id and settle below dated rows.
 */
export function compareSessions<T extends ProjectSession>(a: T, b: T): number {
  const favorite = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
  if (favorite) return favorite;
  const left = sessionCreatedAt(a);
  const right = sessionCreatedAt(b);
  if (left !== null && right !== null) {
    if (left !== right) return right - left;
  } else if (left !== null) return -1;
  else if (right !== null) return 1;
  return compareIds(a.id ?? '', b.id ?? '');
}

function latestSessionCreatedAt<T extends ProjectSession>(sessions: T[]): number {
  return sessions.reduce((latest, session) => Math.max(latest, sessionCreatedAt(session) ?? 0), 0);
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
  // Folders follow their newest-created member so folder order matches member order.
  groups.sort((a, b) => latestSessionCreatedAt(b.sessions) - latestSessionCreatedAt(a.sessions));
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
  const bubblePath = 'M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-5 4V4a1 1 0 0 1 1-1z';
  const ProjectEditor = createProjectEditor(sdk);
  function ProjectActions({ project, onRename, onDelete }: any) {
    const menu = useRef(null as HTMLDivElement | null);
    const trigger = useRef(null as HTMLButtonElement | null);
    const [open, setOpen] = useState(false);
    const id = sdk.React.useId();
    useEffect(() => {
      const node = menu.current!;
      const sync = () => setOpen(node.matches(':popover-open'));
      node.addEventListener('toggle', sync);
      return () => node.removeEventListener('toggle', sync);
    }, []);
    const close = () => menu.current?.hidePopover();
    const focusItem = (index: number) => (menu.current?.querySelectorAll('button')[index] as HTMLButtonElement | undefined)?.focus();
    return h('span', { className: 'project-actions' },
      h('button', { type: 'button', ref: trigger, 'aria-label': sourceText('更多项目操作', 'More project actions') + ': ' + project.name,
        'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id,
        onClick: () => {
          const rect = trigger.current!.getBoundingClientRect();
          Object.assign(menu.current!.style, { left: `${Math.max(8, Math.min(rect.right - 180, window.innerWidth - 188))}px`, top: `${Math.min(rect.bottom + 4, window.innerHeight - 112)}px` });
          menu.current?.togglePopover(); focusItem(0);
        } }, icon('M5 12h.01M12 12h.01M19 12h.01')),
      h('div', { ref: menu, id, popover: 'auto', role: 'menu', className: 'project-action-menu',
        'aria-label': project.name,
        onKeyDown: (event: KeyboardEvent) => {
          const items = Array.from(menu.current!.querySelectorAll('button'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          }
          if (event.key === 'Escape') { event.preventDefault(); close(); trigger.current?.focus(); }
          if (event.key === 'Tab') close();
        } },
        h('button', { type: 'button', role: 'menuitem', onClick: () => { close(); onRename(project, trigger.current); } }, sourceText('重命名项目', 'Rename project')),
        h('button', { type: 'button', role: 'menuitem', onClick: () => { close(); trigger.current?.focus(); onDelete(project); } }, sourceText('删除项目', 'Delete project'))));
  }
  return function ProjectNavigation(props: ProjectNavigationProps) {
    const { profile, sessions, renderSession, onMove } = props;
    const [styles, setStyles] = useState({} as Record<string, Pick<SessionProject, 'color' | 'icon'>>);
    const [editing, setEditing] = useState(null as SessionProject | null);
    const projects = props.projects.map(project => ({ ...project, ...styles[profile + ':' + project.id] }));
    const editor = editing ? h(ProjectEditor, { key: profile + editing.id, profile, project: editing, onClose: () => setEditing(null), onSaved: (saved: SessionProject) => { setStyles((current: any) => ({ ...current, [profile + ':' + saved.id]: { color: saved.color, icon: saved.icon } })); setNotice(sourceText('项目外观已保存', 'Project appearance saved')); } }) : null;
    const projectHeading = () => h('span', { className: 'project-heading-label' }, sourceText('项目', 'Projects'));
    const createButton = () => projects.some(project => project.id) ? h('button', {
      type: 'button', className: 'project-create',
      title: sourceText('新建项目', 'New project'), 'aria-label': sourceText('新建项目', 'New project'),
      onClick: (event: MouseEvent) => { if (projects.some(project => project.id)) props.onCreate(event.currentTarget as HTMLElement); },
    }, icon('M12 5v14M5 12h14')) : null;

    const [dropTarget, setDropTarget] = useState(undefined);
    const [notice, setNotice] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const [projectSplit, setProjectSplit] = useState(readProjectSplit());
    const [resizingSplit, setResizingSplit] = useState(false);
    const initialCollapsed = typeof document !== 'undefined'
      && document.documentElement.dataset.workbenchNavCollapsed === 'true';
    const [collapsed, setCollapsed] = useState(initialCollapsed);
    const historyTrigger = useRef(null);
    const splitLayout = useRef(null as HTMLDivElement | null);
    const splitValue = useRef(projectSplit);
    const splitDrag = useRef(null as { pointerId: number; startY: number; startRatio: number; usable: number } | null);
    const historyId = sdk.React.useId();
    const moving = useRef(false);
    const folders = useRef(new Map<string, HTMLDetailsElement>());
    const activeProjectId = sessions.find(session => session.id === props.activeSessionId)?.groupId;
    const activeProjectAvailable = projects.some(project => project.id === activeProjectId);
    useEffect(() => {
      const sync = () => setCollapsed(document.documentElement.dataset.workbenchNavCollapsed === 'true');
      window.addEventListener('workbench:nav-state', sync);
      return () => window.removeEventListener('workbench:nav-state', sync);
    }, []);
    useEffect(() => {
      if (activeProjectId && activeProjectAvailable) {
        const folder = folders.current.get(activeProjectId);
        if (folder) folder.open = true;
      }
    }, [activeProjectId, props.activeSessionId, profile, activeProjectAvailable, collapsed]);
    const { groups, temporary } = partitionProjectSessions(sessions, projects);
    splitValue.current = projectSplit;
    const applyProjectSplit = (value: number) => {
      const next = clampProjectSplit(value);
      splitValue.current = next;
      setProjectSplit(next);
      return next;
    };
    const startSplitDrag = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const layout = splitLayout.current;
      if (!layout) return;
      const height = layout.getBoundingClientRect().height - PROJECT_SPLIT_RESIZER_HEIGHT;
      if (height <= 0) return;
      event.preventDefault();
      splitDrag.current = {
        pointerId: event.pointerId, startY: event.clientY, startRatio: splitValue.current, usable: height,
      };
      setResizingSplit(true);
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    };
    const moveSplitDrag = (event: PointerEvent) => {
      const drag = splitDrag.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const edge = Math.min(0.45, PROJECT_SPLIT_PANE_MIN_HEIGHT / drag.usable);
      applyProjectSplit(Math.min(1 - edge, Math.max(edge, drag.startRatio + (event.clientY - drag.startY) / drag.usable)));
    };
    const endSplitDrag = (event: PointerEvent) => {
      const drag = splitDrag.current;
      if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
      storeProjectSplit(splitValue.current);
      splitDrag.current = null;
      setResizingSplit(false);
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    };
    const keyProjectSplit = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 0.08 : 0.03;
      let next: number | null = null;
      if (event.key === 'ArrowUp') next = splitValue.current - step;
      else if (event.key === 'ArrowDown') next = splitValue.current + step;
      if (next === null) return;
      event.preventDefault();
      storeProjectSplit(applyProjectSplit(next));
    };
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
    if (collapsed) {
      return h(sdk.React.Fragment, null,
        h('section', { className: 'project-rail', 'aria-label': sourceText("项目与临时会话", "Projects and temporary sessions") },
          projectHeading(), createButton(),
          groups.length ? h('div', { className: 'project-rail-section' }, ...groups.map(({ project, sessions: members }) =>
            h('button', {
              key: project.id, type: 'button', className: `project-rail-folder${activeProjectId === project.id ? ' is-active' : ''}`, 'data-project-rail-folder': project.id,
              'aria-current': activeProjectId === project.id ? 'true' : undefined,
              title: `${project.name} (${members.length})`, 'aria-label': sourceText(`项目：${project.name}，${members.length} 个会话`, `Project: ${project.name}, ${members.length} sessions`),
              onClick: () => {
                // Keep project sessions in the sidebar instead of overlaying the chat.
                document.querySelector<HTMLButtonElement>('.dashboard-nav-collapse')?.click();
                window.requestAnimationFrame(() => {
                  const folder = folders.current.get(project.id);
                  if (folder) {
                    folder.open = true;
                    folder.scrollIntoView?.({ block: 'nearest' });
                  }
                });
              },
            }, projectMark(h, project), members.length ? h('span', { className: 'project-rail-count' }, members.length) : null))) : null,
          h('div', { className: 'project-rail-section project-rail-temporary' },
            h('button', { type: 'button', className: 'project-rail-session-new', title: sourceText("新建临时会话", "New temporary session"),
              'aria-label': sourceText("新建临时会话", "New temporary session"), onClick: props.onNewSession },
              icon(`${bubblePath} M12 8v5 M9.5 10.5h5`)),
            ...temporary.map(session => h('div', { key: session.id, className: 'project-rail-session' },
              h('span', { className: 'project-rail-session-icon', 'aria-hidden': true }, icon(bubblePath)),
              renderSession(session, false))))),
        editor, notice ? h('p', { className: 'project-rail-notice', role: 'status' }, notice) : null);
    }
    return h(sdk.React.Fragment, null,
      h('div', { className: `project-navigation-split${resizingSplit ? ' is-resizing' : ''}`, ref: splitLayout },
      h('section', { className: 'project-navigation', 'aria-label': sourceText("项目", "Projects"),
        style: { flexBasis: groups.length ? `calc((100% - ${PROJECT_SPLIT_RESIZER_HEIGHT}px) * ${projectSplit})` : 'auto' } },
        h('div', { className: 'project-section-heading' }, projectHeading(),
          h('div', { className: 'project-heading-actions' }, createButton(),
          h('button', { type: 'button', className: 'project-history-toggle', ref: historyTrigger,
            title: sourceText("历史与归档", "History and archive"), 'aria-label': sourceText("历史与归档", "History and archive"), 'aria-expanded': historyOpen,
            'aria-controls': historyId, onClick: () => setHistoryOpen((open: boolean) => !open) },
            icon('M5 12h.01M12 12h.01M19 12h.01')),
          )),
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
          h('span', { className: 'project-name', title: project.name }, project.name)),
          members.length ? members.map(row) : h('p', { className: 'project-empty' }, sourceText("拖拽会话到此项目", "Drag sessions into this project"))),
          // Sibling controls avoid nesting interactive elements inside summary.
          h('button', { type: 'button', className: 'project-icon-edit',
            'aria-label': sourceText('编辑项目外观', 'Edit project appearance') + ': ' + project.name,
            title: sourceText('图标与颜色', 'Icon and color'), onClick: () => setEditing(project) }, projectMark(h, project)),
          h(ProjectActions, { project, onRename: props.onRename, onDelete: props.onDelete }))),
        groups.length ? null : h('p', { className: 'project-empty' }, sourceText("请让智能体创建第一个项目，再将会话拖入整理", "Ask the agent to create the first project, then drag in sessions")))),
      groups.length ? h('div', { className: 'project-navigation-resizer', role: 'separator', 'aria-orientation': 'horizontal',
        'aria-label': sourceText("调整项目与临时会话的高度", "Resize projects and temporary sessions"),
        'aria-valuemin': Math.round(PROJECT_SPLIT_MIN * 100), 'aria-valuemax': Math.round(PROJECT_SPLIT_MAX * 100),
        'aria-valuenow': Math.round(projectSplit * 100), tabIndex: 0,
        title: sourceText("拖动调整项目与临时会话的高度", "Drag to resize projects and temporary sessions"),
        onPointerDown: startSplitDrag, onPointerMove: moveSplitDrag, onPointerUp: endSplitDrag,
        onPointerCancel: endSplitDrag, onLostPointerCapture: endSplitDrag, onKeyDown: keyProjectSplit },
        h('span', { className: 'project-navigation-resizer-grip', 'aria-hidden': true })) : null,
      h('section', { className: `project-temporary${dropTarget === null ? ' is-drop-target' : ''}`,
        'aria-label': sourceText("临时会话", "Temporary sessions"), ...dropProps(null) },
        h('div', { className: 'project-section-heading' }, h('span', null, sourceText("临时会话", "Temporary sessions")),
          h('button', { type: 'button', className: 'project-create', title: sourceText("新建临时会话", "New temporary session"), 'aria-label': sourceText("新建临时会话", "New temporary session"),
            onClick: props.onNewSession }, icon('M12 5v14M5 12h14'))),
        ...temporary.map(row),
        temporary.length ? null : h('p', { className: 'project-empty' }, sourceText("未加入项目的会话显示在这里", "Sessions outside projects appear here")))),
      editor, notice ? h('p', { className: 'project-empty', role: 'status' }, notice) : null);
  };
}
