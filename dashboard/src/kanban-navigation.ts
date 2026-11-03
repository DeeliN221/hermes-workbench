/** Keep the exact foreground route, including pane identity and an unsent new chat. */
export function rememberKanbanReturn(destination: string): void {
  if (destination.split('?')[0] !== '/kanban' || location.pathname !== '/chat') return;
  try { sessionStorage.setItem('hermes.workbench.accessory-return', location.pathname + location.search + location.hash); }
  catch { /* The mounted conversation remains usable when browser storage is unavailable. */ }
}
