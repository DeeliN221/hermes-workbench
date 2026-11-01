/** Mobile page navigation is independent of desktop accessory panels. */
export const MOBILE_CHAT_KEY = 'workbench.mobile-tabs.return-chat';
const base = 'https://workbench.invalid';

export function isMobileTabRoute(route: string): boolean {
  try { return new URL(route, base).pathname.replace(/\/+$/, '') !== '/chat'; }
  catch { return false; }
}

/** Only local conversation URLs may be restored from optional browser storage. */
export function chatReturnUrl(route: string | null): string {
  if (!route?.startsWith('/') || route.startsWith('//')) return '/chat';
  try {
    const url = new URL(route, base);
    if (url.origin !== base || url.pathname !== '/chat' || url.searchParams.has('workbench')) return '/chat';
    url.searchParams.delete('panel');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/chat'; }
}

export function rememberMobileChat(route: string, storage: Pick<Storage, 'setItem'>): void {
  const url = new URL(route, base);
  if (url.pathname !== '/chat' || url.searchParams.has('workbench')) return;
  try { storage.setItem(MOBILE_CHAT_KEY, chatReturnUrl(route)); } catch { /* Storage is optional. */ }
}

export function readMobileChat(storage: Pick<Storage, 'getItem'>): string {
  try { return chatReturnUrl(storage.getItem(MOBILE_CHAT_KEY)); } catch { return '/chat'; }
}
