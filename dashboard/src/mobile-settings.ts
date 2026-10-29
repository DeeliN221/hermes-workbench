import { uiText } from './ui-locale';
import './mobile-settings.css';

/** Keep host-owned forms mounted; only their mobile presentation changes. */
export function installMobileSettings(): void {
  const media = matchMedia('(max-width: 800px)');
  const root = document.documentElement;
  const returnKey = 'workbench.mobile-settings.return-chat';
  let opened = location.pathname !== '/config' || new URLSearchParams(location.search).has('workbench');
  let trigger: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let frame = 0;
  let returnTo = '';
  try { returnTo = sessionStorage.getItem(returnKey) || ''; } catch { /* optional */ }
  const rememberChat = () => {
    if (location.pathname !== '/chat') return;
    returnTo = `${location.pathname}${location.search}`;
    try { sessionStorage.setItem(returnKey, returnTo); } catch { /* optional */ }
  };
  rememberChat();
  const header = document.createElement('header');
  header.id = 'workbench-mobile-settings-header';
  header.className = 'workbench-mobile-settings-header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'workbench-mobile-settings-back';
  const title = document.createElement('strong');
  title.id = 'workbench-mobile-settings-title';
  const chat = document.createElement('button');
  chat.type = 'button';
  chat.className = 'workbench-mobile-settings-chat';
  header.append(back, title, chat);
  const close = () => { opened = false; sync(); trigger?.focus(); };
  back.onclick = close;
  chat.onclick = () => {
    const target = returnTo || '/chat';
    const url = new URL(target, location.origin);
    if (url.pathname !== '/chat') { location.assign(target); return; }
    close();
    history.pushState(null, '', `${url.pathname}${url.search}`);
    dispatchEvent(new PopStateEvent('popstate'));
  };
  function sync(): void {
    frame = 0;
    const nav = document.querySelector<HTMLElement>('.dashboard-settings-nav');
    const active = media.matches && !!nav;
    const show = active && opened;
    const mode = active ? (show ? 'detail' : 'list') : '';
    if (root.dataset.mobileSettings !== mode) root.dataset.mobileSettings = mode;
    const next = show ? document.querySelector<HTMLElement>('.dashboard-owned-page') || document.querySelector<HTMLElement>('#app-sidebar + div') : null;
    if (panel !== next) {
      if (panel) { panel.classList.remove('workbench-mobile-settings-panel'); panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); panel.removeAttribute('aria-labelledby'); panel.removeAttribute('aria-owns'); }
      panel = next;
      if (panel) { panel.classList.add('workbench-mobile-settings-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', title.id); panel.setAttribute('aria-owns', header.id); }
    }
    if (active) {
      if (!header.isConnected) document.body.append(header);
      back.hidden = !show;
      if (show) {
        const links = Array.from(nav!.querySelectorAll<HTMLAnchorElement>('a'));
        const rawTab = new URLSearchParams(location.search).get('workbench');
        const activeTab = rawTab === 'settings' ? 'versions' : rawTab;
        const current = links.find(a => new URL(a.href).pathname === location.pathname && new URL(a.href).searchParams.get('workbench') === activeTab);
        const label = current?.textContent || uiText('设置', 'Settings');
        if (title.textContent !== label) title.textContent = label;
        const backLabel = uiText('← 返回设置', '← Settings');
        if (back.textContent !== backLabel) back.textContent = backLabel;
      } else if (title.textContent !== uiText('设置', 'Settings')) {
        title.textContent = uiText('设置', 'Settings');
      }
      const chatLabel = uiText('返回对话', 'Back to chat');
      if (chat.textContent !== chatLabel) chat.textContent = chatLabel;
    } else header.remove();
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.dashboard-settings-nav a') : null;
    if (!media.matches || !target || (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey || (event as MouseEvent).shiftKey) return;
    trigger = target;
    queueMicrotask(() => { opened = true; schedule(); requestAnimationFrame(() => back.focus()); });
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && root.dataset.mobileSettings === 'detail' && panel && !document.querySelector('dialog[open]')) {
      const focusable = [back, ...Array.from(panel.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'))].filter(el => !el.matches(':disabled, [tabindex="-1"]') && el.getClientRects().length > 0);
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) { event.preventDefault(); back.focus(); }
    }
    if (event.key === 'Escape' && root.dataset.mobileSettings === 'detail' && !document.querySelector('dialog[open]')) { event.preventDefault(); close(); }
  });
  window.addEventListener('popstate', () => {
    rememberChat();
    opened = location.pathname !== '/config' || new URLSearchParams(location.search).has('workbench');
    schedule();
  });
  media.addEventListener('change', schedule);
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-workbench-view', 'lang'] });
  schedule();
}
