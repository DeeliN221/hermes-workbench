/** Pure URL mappings from kanban drawers to Workbench chat. */
import type { KanbanSessionLink } from './kanban-session-api';

export function workbenchPath(
  taskId: string,
  board: string,
  link?: KanbanSessionLink,
  selectedProfile = 'default',
): string {
  const url = new URL('/chat', 'https://dashboard.invalid');
  url.searchParams.set('profile', link?.profile || selectedProfile);
  url.searchParams.set('kanban_task', taskId);
  if (board) url.searchParams.set('kanban_board', board);
  if (link?.session_id) url.searchParams.set('session', link.session_id);
  return `${url.pathname}${url.search}`;
}

/** Continue a pinned session first; otherwise start a conversation with the drawer's selected agent. */
export function drawerConversationPath(
  taskId: string,
  board: string,
  selectedProfile: string,
  links: KanbanSessionLink[],
): string {
  return workbenchPath(taskId, board, links[0], selectedProfile || 'default');
}
