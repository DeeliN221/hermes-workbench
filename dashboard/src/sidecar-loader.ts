/** Stable entry point: load the installed runtime and keep failures recoverable. */
import { installKanbanDeleteBoardScope } from './kanban-delete-board-scope';
import { loadCodexPreview } from './codex-snapshot-cache';

declare const __WORKBENCH_BUILD_VERSION__: string;

const BUILD_VERSION = typeof __WORKBENCH_BUILD_VERSION__ === 'string' ? __WORKBENCH_BUILD_VERSION__ : 'dev';
type SidecarState = { status: 'idle' | 'loading' | 'loaded' | 'error'; build?: string };
type LoaderHost = Window & {
  __HERMES_PLUGIN_SDK__?: { React: { createElement(type: string, props: object | null, ...children: unknown[]): unknown } };
  __HERMES_PLUGINS__?: { register(id: string, component: () => unknown): void };
  __HERMES_WORKBENCH_SIDECAR__?: SidecarState;
};
export function installSidecarLoader(): void {
  const host = window as LoaderHost;
  const sdk = host.__HERMES_PLUGIN_SDK__, registry = host.__HERMES_PLUGINS__;
  if (!sdk || !registry) return;
  const state = host.__HERMES_WORKBENCH_SIDECAR__ || { status: 'idle' };
  host.__HERMES_WORKBENCH_SIDECAR__ = state;
  if (state.status === 'loaded' || state.status === 'loading') return;
  installKanbanDeleteBoardScope();
  const text = (zh: string, en: string) => document.documentElement.lang.toLowerCase().startsWith('zh') ? zh : en;
  const h = sdk.React.createElement;
  const params = new URLSearchParams(window.location.search);
  const previewProfile = params.get('profile') || 'default';
  const previewSession = params.get('session') || '';
  const preview = previewSession ? loadCodexPreview(`${previewProfile}\0${previewSession}`) : [];
  function registerStatus(message: string, canRetry: boolean) {
    registry!.register('workbench', () => h('main', { className: 'workbench-sidecar-status', role: canRetry ? 'alert' : 'status' },
      h('p', { key: 'message' }, message),
      preview.length ? h('section', { key: 'preview', className: 'workbench-sidecar-preview' },
        h('p', { key: 'label', className: 'workbench-sidecar-preview-label' },
          text('上次消息 · 正在加载工作台…', 'Last messages · loading Workbench…')),
        ...preview.map((item, index) => h('article', {
          key: `message-${index}`,
          className: `workbench-sidecar-preview-message is-${item.role}`,
        }, h('strong', null, item.role === 'user' ? text('你', 'You') : text('Hermes', 'Hermes')), h('p', null, item.content)))) : null,
      canRetry ? h('button', { key: 'retry', type: 'button', onClick: requestAssets }, text('重新连接工作台', 'Reconnect to Workbench')) : null));
  }
  /** Prefer the sidecar's immutable release URL; the host plugin path remains a compatibility fallback. */
  const assetUrl = (kind: 'js' | 'css', cacheable: boolean) => cacheable
    ? `/workbench-sidecar/v/${encodeURIComponent(BUILD_VERSION)}/workbench.${kind}`
    : `/dashboard-plugins/workbench/dist/workbench.${kind}?v=${encodeURIComponent(BUILD_VERSION)}`;

  function loadScript(cacheable: boolean) {
    document.getElementById('hermes-workbench-sidecar-script')?.remove();
    const script = document.createElement('script');
    script.id = 'hermes-workbench-sidecar-script';
    script.src = assetUrl('js', cacheable);
    script.async = true;
    script.onerror = () => {
      if (cacheable) {
        // Older deployments may not route /workbench-sidecar/* yet.
        loadScript(false);
        return;
      }
      state.status = 'error';
      registerStatus(text('工作台暂时不可用，Hermes 对话仍在运行。', 'Workbench is temporarily unavailable. Hermes conversations are still running.'), true);
    };
    script.onload = () => {
      window.setTimeout(() => {
        if (state.status === 'loaded') return;
        state.status = 'error';
        registerStatus(text('工作台版本与当前 Hermes 不兼容。', 'This Workbench version is incompatible with the current Hermes host.'), true);
      }, 0);
    };
    document.head.appendChild(script);
  }

  function requestAssets() {
    state.status = 'loading';
    registerStatus(text('正在连接工作台…', 'Connecting to Workbench…'), false);
    let stylesheet = document.querySelector<HTMLLinkElement>('link#hermes-workbench-sidecar-style');
    if (!stylesheet) {
      stylesheet = document.createElement('link'); stylesheet.id = 'hermes-workbench-sidecar-style'; stylesheet.rel = 'stylesheet';
      document.head.appendChild(stylesheet);
    }
    stylesheet.onerror = () => {
      if (stylesheet!.dataset.workbenchFallback === 'true') return;
      stylesheet!.dataset.workbenchFallback = 'true';
      stylesheet!.href = assetUrl('css', false);
    };
    stylesheet.dataset.workbenchFallback = 'false';
    stylesheet.href = assetUrl('css', true);
    loadScript(true);
  }
  requestAssets();
}
