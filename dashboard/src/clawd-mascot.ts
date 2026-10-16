import { uiText } from './ui-locale';
import './clawd-mascot.css';

const STORAGE_KEY = 'hermes.workbench.clawd-mascot';
const MASCOT_ATTR = 'data-workbench-clawd-mascot';
const PANEL_ATTR = 'data-workbench-clawd-settings';
const LINK_ATTR = 'data-workbench-clawd-settings-link';

export function readClawdMascotEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { return true; }
}

function setClawdMascotEnabled(value: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* best effort */ }
  document.documentElement.dataset.workbenchClawd = value ? 'on' : 'off';
  document.dispatchEvent(new Event('workbench-clawd-change'));
}

const crab = `<svg viewBox="0 0 64 48" aria-hidden="true" focusable="false" class="workbench-clawd-svg"><g fill="currentColor"><path d="M16 8h32v4h8v20h-8v4H16v-4H8V12h8z"/><path d="M12 32h8v12h-8zm12 0h8v16h-8zm16 0h8v16h-8zm12 0h8v12h-8z"/></g><g fill="#242820"><rect x="20" y="16" width="8" height="8"/><rect x="36" y="16" width="8" height="8"/></g></svg>`;

function mascotMarkup(): string {
  return `<div ${MASCOT_ATTR} class="workbench-clawd" title="${uiText('Clawd 吉祥物', 'Clawd mascot')}"><span class="workbench-clawd-art">${crab}</span><span class="workbench-clawd-label">Clawd</span></div>`;
}

function mountMascot(): void {
  const sidebar = document.getElementById('app-sidebar');
  if (!sidebar || !readClawdMascotEnabled() || sidebar.querySelector(`[${MASCOT_ATTR}]`)) return;
  const host = document.createElement('div');
  host.innerHTML = mascotMarkup();
  const mascot = host.firstElementChild as HTMLElement;
  const nav = sidebar.querySelector('nav');
  (nav || sidebar).prepend(mascot);
}

function addSettingsLink(): void {
  const nav = document.querySelector<HTMLElement>('.dashboard-settings-nav');
  if (!nav || nav.querySelector(`[${LINK_ATTR}]`)) return;
  const link = document.createElement('a');
  link.setAttribute(LINK_ATTR, 'true');
  link.href = '/config?workbench=appearance';
  link.textContent = uiText('外观', 'Appearance');
  link.addEventListener('click', event => { event.preventDefault(); history.pushState(null, '', link.href); renderSettingsPanel(); });
  nav.append(link);
}

function renderSettingsPanel(): void {
  const main = document.querySelector<HTMLElement>('.dashboard-owned-page') || document.querySelector<HTMLElement>('main');
  if (!main || location.pathname !== '/config' || new URLSearchParams(location.search).get('workbench') !== 'appearance') return;
  if (main.querySelector(`[${PANEL_ATTR}]`)) return;
  Array.from(main.children).forEach(node => { (node as HTMLElement).style.display = 'none'; });
  const panel = document.createElement('section');
  panel.setAttribute(PANEL_ATTR, 'true');
  panel.className = 'workbench-clawd-settings';
  panel.innerHTML = `<h2>${uiText('外观', 'Appearance')}</h2><p>${uiText('控制左侧栏顶部的 Clawd 吉祥物。', 'Control the Clawd mascot at the top of the sidebar.')}</p>`;
  const label = document.createElement('label');
  label.className = 'workbench-clawd-toggle';
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = readClawdMascotEnabled(); input.setAttribute('aria-label', uiText('显示 Clawd 吉祥物', 'Show Clawd mascot'));
  input.addEventListener('change', () => setClawdMascotEnabled(input.checked));
  label.append(input, document.createTextNode(uiText('显示 Clawd 吉祥物', 'Show Clawd mascot')));
  panel.append(label); main.append(panel);
}

export function installClawdMascot(): void {
  if ((window as any).__HERMES_WORKBENCH_CLAWD__) return;
  (window as any).__HERMES_WORKBENCH_CLAWD__ = true;
  document.documentElement.dataset.workbenchClawd = readClawdMascotEnabled() ? 'on' : 'off';
  const refresh = () => requestAnimationFrame(() => { mountMascot(); addSettingsLink(); renderSettingsPanel(); });
  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('workbench-clawd-change', () => { document.querySelector(`[${MASCOT_ATTR}]`)?.remove(); mountMascot(); });
  window.addEventListener('popstate', refresh);
  refresh();
}
