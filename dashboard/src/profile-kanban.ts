import { uiText as sourceText } from './ui-locale';
type Board = { slug: string; default_assignee?: string; archived?: boolean };

export function profileBoard(boards: Board[], profile: string): string {
  const active = boards.filter(board => !board.archived);
  const matches = active.filter(board => board.default_assignee === profile);
  const exact = matches.find(board => board.slug === profile);
  if (exact) return exact.slug;
  if (matches.length === 1) return matches[0].slug;
  if (!matches.length) throw new Error(sourceText(`未找到 ${profile} 对应的看板，请先设置看板的默认负责人。`, `No board found for ${profile}. Set a board default assignee first.`));
  throw new Error(sourceText(`${profile} 对应多个看板，请在看板页选择。`, `${profile} has multiple boards. Select one on the board page.`));
}

/** The native board picker initializes from browser storage, not the profile URL. */
export async function prepareProfileKanban(
  fetchJSON: (url: string) => Promise<any>, profile: string,
  isCurrent: () => boolean,
): Promise<string | null> {
  const data = await fetchJSON('/api/plugins/kanban/boards');
  if (!isCurrent()) return null;
  const board = profileBoard(Array.isArray(data.boards) ? data.boards : [], profile);
  window.localStorage.setItem('hermes.kanban.selectedBoard', board);
  return board;
}
