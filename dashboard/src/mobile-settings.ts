import { uiText } from './ui-locale';
import './mobile-settings.css';
import { findTabContent } from './tab-content';

/** Keep host-owned forms mounted; only their mobile presentation changes. */
export function installMobileSettings(): void {
  const media = matchMedia('(max-width: 800px)');
  const root = document.documentElement;
  let opened = location.pathname !== '/config' || new URLSearchParams(location.search).has('workbench');
  let selectedRoute = '';
  const routeKey = (url: URL) => url.pathname + '?' + (url.searchParams.get('workbench') || '');
  let trigger: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let frame = 0;
  const header = document.createElement('header');
  header.id = 'workbench-mobile-settings-header';
  header.className = 'workbench-mobile-settings-header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'workbench-mobile-settings-back';
  const title = document.createElement('strong');
  title.id = 'workbench-mobile-settings-title';
  header.append(back, title);
  const close = () => { selectedRoute = ''; opened = false; sync(); trigger?.focus(); };
  back.onclick = close;
  function sync(): void {
    frame = 0;
    const nav = document.querySelector<HTMLElement>('.dashboard-settings-nav');
    const active = media.matches && !!nav;
    const show = active && opened;
    const mode = active ? (show ? 'detail' : 'list') : '';
    if (root.dataset.mobileSettings !== mode) root.dataset.mobileSettings = mode;
    const next = show ? findTabContent() : null;
    if (panel !== next) {
      if (panel) { panel.classList.remove('workbench-mobile-settings-panel'); panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); panel.removeAttribute('aria-labelledby'); panel.removeAttribute('aria-owns'); }
      panel = next;
      if (panel) { panel.classList.add('workbench-mobile-settings-panel'); panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', title.id); panel.setAttribute('aria-owns', header.id); }
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
    } else header.remove();
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.dashboard-settings-nav a') : null;
    if (!media.matches || !target || (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey || (event as MouseEvent).shiftKey) return;
    selectedRoute = routeKey(new URL((target as HTMLAnchorElement).href));
    trigger = target;
    queueMicrotask(() => { opened = true; schedule(); requestAnimationFrame(() => back.focus()); });
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && root.dataset.mobileSettings === 'detail' && !event.defaultPrevented && !document.querySelector('dialog[open], [aria-modal="true"]')) { event.preventDefault(); close(); }
  });
  window.addEventListener('popstate', () => {
    const selected = selectedRoute === routeKey(new URL(location.href));
    if (!selected) selectedRoute = '';
    opened = selected || location.pathname !== '/config' || new URLSearchParams(location.search).has('workbench');
    schedule();
  });
  media.addEventListener('change', schedule);
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-workbench-view', 'lang'] });
  schedule();
}
