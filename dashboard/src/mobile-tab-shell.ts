import { uiText } from './ui-locale';
import { isMobileTabRoute, readMobileChat, rememberMobileChat } from './mobile-tab-route';
import './mobile-tab-shell.css';

/** A page header, not a modal: keep host forms, scroll containers and dialogs mounted. */
export function installMobileTabShell(): void {
  const root = document.documentElement;
  const media = matchMedia('(max-width: 800px)');
  const header = document.createElement('header');
  header.className = 'workbench-mobile-tab-header';
  const chat = document.createElement('a');
  chat.className = 'workbench-mobile-tab-chat';
  header.append(chat);
  let frame = 0;
  const remember = () => {
    try { rememberMobileChat(location.pathname + location.search + location.hash, sessionStorage); } catch { /* optional */ }
  };
  const destination = () => {
    try { return readMobileChat(sessionStorage); } catch { return '/chat'; }
  };
  function sync(): void {
    frame = 0;
    remember();
    const active = media.matches && root.dataset.workbenchShell === 'true' && isMobileTabRoute(location.href);
    if (root.dataset.mobileTab !== String(active)) root.dataset.mobileTab = String(active);
    if (!active) { header.remove(); return; }
    if (!header.isConnected) document.body.append(header);
    chat.href = destination();
    const label = uiText('← 对话', '← Chat');
    if (chat.textContent !== label) chat.textContent = label;
    chat.setAttribute('aria-label', uiText('返回对话', 'Back to chat'));
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
  chat.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const target = destination();
    if (!dispatchEvent(new CustomEvent('workbench:before-navigate', { cancelable: true, detail: { path: target, profile: new URL(target, location.origin).searchParams.get('profile') || '' } }))) return;
    history.pushState(null, '', target);
    dispatchEvent(new PopStateEvent('popstate'));
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.codex-center-panel textarea, .codex-composer textarea')?.focus({ preventScroll: true }));
  });
  // Capture both sides of SPA transitions, including replaceState session selection.
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (...args: Parameters<History[typeof method]>) {
      remember();
      original.apply(this, args);
      remember();
      schedule();
    };
  }
  window.addEventListener('popstate', schedule);
  media.addEventListener('change', schedule);
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-workbench-shell', 'data-workbench-view', 'lang'] });
  sync();
}
