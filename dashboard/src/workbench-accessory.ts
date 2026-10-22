/** Floating Workbench tabs share one route marker so reloads keep the panel open. */
export const ACCESSORY_QUERY_PARAM = 'panel';

export type AccessoryKind = 'settings' | 'kanban' | 'cron' | 'terminal' | 'achievements';

const SETTINGS_PATHS = new Set([
  '/config', '/profiles', '/models', '/env', '/plugins', '/mcp', '/channels',
  '/webhooks', '/pairing', '/system', '/logs', '/docs', '/skills',
]);

export function accessoryPanelOpen(search: string): boolean {
  return new URLSearchParams(search).get(ACCESSORY_QUERY_PARAM) === '1';
}

/** The five crafting-grid tabs, plus settings sub-pages opened from inside the panel. */
export function accessoryKind(path: string, search: string): AccessoryKind | '' {
  if (!accessoryPanelOpen(search)) return '';
  if (path === '/chat' && new URLSearchParams(search).get('workbench') === 'terminal') return 'terminal';
  if (path === '/kanban') return 'kanban';
  if (path === '/cron') return 'cron';
  if (path === '/achievements') return 'achievements';
  return SETTINGS_PATHS.has(path) ? 'settings' : '';
}

/** Keep the panel marker when a navigation starts inside the floating window. */
export function withAccessoryPanel(href: string, enabled = true): string {
  const url = new URL(href, 'http://localhost');
  if (enabled) url.searchParams.set(ACCESSORY_QUERY_PARAM, '1');
  else url.searchParams.delete(ACCESSORY_QUERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Remove only the panel marker, preserving profile, session and settings parameters. */
export function withoutAccessoryPanel(href: string): string {
  return withAccessoryPanel(href, false);
}
