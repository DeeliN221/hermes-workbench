/** A real local host SDK for the complete Workbench application. */
// @ts-expect-error The existing SDK intentionally uses the host's untyped React dependency.
import React from 'react';
// @ts-expect-error The existing SDK intentionally uses the host's untyped React dependency.
import { createRoot } from 'react-dom/client';
import type { FetchJSON } from './workbench-api';
import './standalone-host.css';
import { createStandalonePages } from './standalone-pages';
import { createWorkbenchLauncher } from './workbench-launcher';
import { currentProfile } from './profile-scope';

const h = React.createElement;
const slots = new Map<string, any>();
const root = createRoot(document.getElementById('root')!);
const fetchJSON: FetchJSON = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await authedFetch(url, init);
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.detail || `HTTP ${response.status}`), { status: response.status });
  return value as T;
};
async function authedFetch(url: string, init: RequestInit = {}) {
  const target = new URL(url, location.origin);
  if (target.origin !== location.origin) throw new Error('Workbench APIs must be same-origin');
  if (target.pathname.startsWith('/api/plugins/workbench/') && !target.searchParams.has('profile') && !target.searchParams.has('profile_id')) target.searchParams.set('profile', currentProfile());
  const headers = new Headers(init.headers);
  headers.set('X-Workbench-Request', '1');
  return fetch(target, { ...init, headers, credentials: 'same-origin' });
}
let locale = 'en';
const localeListeners = new Set<() => void>();
function setLocale(value: string) {
  locale = value === 'zh' ? 'zh' : 'en';
  document.documentElement.lang = locale;
  localStorage.setItem('hermes-locale', locale);
  localeListeners.forEach(listener => listener());
  void saveBrowserPreferences().catch(showPreferenceError);
}
function useI18n() {
  const [, refresh] = React.useState(0);
  React.useEffect(() => {
    const listener = () => refresh((n: number) => n + 1);
    localeListeners.add(listener);
    return () => localeListeners.delete(listener);
  }, []);
  return { locale, setLocale, t: (key: string) => key };
}
let browserPreferences: Record<string, unknown> = {};
const preferenceKeys = new Set(['hermes-workbench.chat-detail', 'hermes.workbench.send-shortcut',
  'workbench.user-message-ball.v1', 'hermes.workbench.settings-more-open', 'hermes.workbench.nav-collapsed']);
function installPreferenceCache() {
  const saved = browserPreferences.cache && typeof browserPreferences.cache === 'object'
    ? browserPreferences.cache as Record<string, unknown> : {};
  for (const key of preferenceKeys) {
    if (typeof saved[key] === 'string') localStorage.setItem(key, saved[key] as string);
    else localStorage.removeItem(key);
  }
  const native = Storage.prototype.setItem;
  // Only user-editable UI preferences are cached; no credentials or transcripts.
  Storage.prototype.setItem = function(key: string, value: string) {
    native.call(this, key, value);
    if (this !== localStorage || !preferenceKeys.has(key)) return;
    const previous = browserPreferences.cache as Record<string, string> | undefined;
    if (previous?.[key] === value) return;
    browserPreferences.cache = { ...previous, [key]: value };
    void saveBrowserPreferences().catch(showPreferenceError);
  };
}

let preferenceWrite: Promise<unknown> = Promise.resolve();
async function saveBrowserPreferences() {
  browserPreferences = { ...browserPreferences, locale, theme: document.documentElement.dataset.workbenchTheme || 'light' };
  const body = JSON.stringify(browserPreferences);
  preferenceWrite = preferenceWrite.catch(() => {}).then(() => fetchJSON('/api/plugins/workbench/preferences?profile=default', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }));
  await preferenceWrite;
}
const DialogContext = React.createContext(null);
function Dialog({ open, onOpenChange, children }: any) { return h(DialogContext.Provider, { value: { open, onOpenChange } }, children); }
function DialogContent({ children, className = '' }: any) {
  const context = React.useContext(DialogContext);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    if (context?.open && !ref.current.open) ref.current.showModal();
    else if (!context?.open && ref.current.open) ref.current.close();
  }, [context?.open]);
  return h('dialog', { className, ref, onCancel: (event: Event) => { event.preventDefault(); context.onOpenChange(false); } }, children);
}
function DialogClose({ children, ...props }: any) { const context = React.useContext(DialogContext); return h('button', { ...props, type: 'button', onClick: () => context.onOpenChange(false) }, children); }
function tag(name: string) { return ({ children, ...props }: any) => h(name, props, children); }

const hostSDK = { React, hooks: React, fetchJSON, buildWsUrl: async (path: string, params: Record<string, string> = {}) => {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || url.pathname !== '/api/plugins/workbench/shell') throw new Error('Unsupported standalone socket');
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const profile = params.profile || currentProfile();
  url.searchParams.set('profile', profile);
  const selected = new URLSearchParams(location.search);
  for (const key of ['project_id', 'session']) { const value = selected.get(key); if (value) url.searchParams.set(key, value); }
  return url.href;
} };
const { MemoryPage, MCPPage, Configuration, ModelsPage, FilesPage, ShellPage, IntegrationsPage } = createStandalonePages(hostSDK);
const Launcher = createWorkbenchLauncher(hostSDK);
function Host() {
  const [, update] = React.useState(0);
  React.useEffect(() => {
    const changed = () => update((n: number) => n + 1);
    addEventListener('popstate', changed);
    return () => removeEventListener('popstate', changed);
  }, []);
  const Overlay = slots.get('overlay');
  const Header = slots.get('header-right');
  const path = location.pathname;
  const home = ['/', '/home', '/sessions', '/kanban'].includes(path);
  const terminal = path === '/chat' && new URLSearchParams(location.search).get('workbench') === 'terminal';
  const native = terminal || ['/config', '/models', '/memory', '/mcp', '/plugins', '/files'].includes(path);
  const Page = terminal ? ShellPage : path === '/models' ? ModelsPage : path === '/memory' ? MemoryPage : path === '/mcp' ? MCPPage : path === '/plugins' ? IntegrationsPage : path === '/files' ? FilesPage : Configuration;
  return h(React.Fragment, null,
    home ? h('header', { className: 'standalone-overview-header' }, h(Launcher), h('strong', null, 'Workbench'), h('a', { href: '/chat?profile=' + encodeURIComponent(currentProfile()) + '&new=1' }, 'New conversation'), h('a', { href: '/profiles' }, 'Profiles')) : null,
    native ? h('div', { className: 'standalone-shell' },
      h('aside', { id: 'app-sidebar' }, h('a', { href: '/' }, 'Workbench')),
      h('div', { className: 'standalone-page' }, h('header', { role: 'banner' }, !terminal && Header ? h(Header) : null),
        h('main', null, h('div', { className: 'standalone-config z-2' }, h(Page, { key: path + location.search }))))) : null,
    path === '/terminal' ? h(ShellPage) : null,
    Overlay ? h(Overlay) : null);
}
async function boot() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const token = hash.get('token');
  if (token) {
    // Remove the credential before loading the application or any linked resources.
    history.replaceState(null, '', location.pathname + location.search);
    await fetchJSON('/api/standalone/bootstrap', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  }
  document.documentElement.dataset.standalone = 'true';
  const identity = await fetchJSON<{ user_id: string }>('/api/standalone/context');
  Object.assign(window, { __WORKBENCH_USER_ID__: identity.user_id });
  if (sessionStorage.getItem('workbench.host.user') !== identity.user_id) {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('workbench.profile.')) sessionStorage.removeItem(key);
    sessionStorage.setItem('workbench.host.user', identity.user_id);
  }
  browserPreferences = await fetchJSON<Record<string, unknown>>('/api/plugins/workbench/preferences?profile=default');
  locale = browserPreferences.locale === 'zh' ? 'zh' : 'en';
  localStorage.setItem('hermes-locale', locale);
  document.documentElement.lang = locale;
  const theme = browserPreferences.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.workbenchTheme = theme;
  localStorage.setItem('hermes-dashboard-theme', theme);
  // The legacy SDK global is only a UI integration seam; no agent runtime is loaded.
  Object.assign(window, {
    __HERMES_PLUGIN_SDK__: { ...hostSDK, sdkVersion: '1.1.0', authedFetch, useI18n,
      components: { Dialog, DialogContent, DialogClose, DialogTitle: tag('h2'), DialogDescription: tag('p') } },
    __HERMES_PLUGINS__: { register() {}, registerSlot(_plugin: string, slot: string, component: any) { slots.set(slot, component); } },
  });
  installPreferenceCache();
  await import('./index');
  root.render(h(Host));
  const observer = new MutationObserver(() => { void saveBrowserPreferences().catch(showPreferenceError); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-workbench-theme'] });
}
function showPreferenceError(error: unknown) {
  const alert = document.getElementById('standalone-preference-error') || document.body.appendChild(document.createElement('p'));
  alert.id = 'standalone-preference-error'; alert.setAttribute('role', 'alert'); alert.textContent = 'Preference save failed: ' + String(error);
}
void boot().catch(error => root.render(h('main', { className: 'standalone-auth', role: 'alert' }, h('h1', null, 'Workbench'), h('p', null, String(error)), h('p', null, 'Open the bootstrap URL printed by the local Workbench host.'))));
