/** Stable entry point: load the installed runtime and keep failures recoverable. */
import { installKanbanDeleteBoardScope } from './kanban-delete-board-scope';
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
  function registerStatus(message: string, canRetry: boolean) {
    registry!.register('workbench', () => h('main', { className: 'workbench-sidecar-status', role: canRetry ? 'alert' : 'status' },
      h('p', { key: 'message' }, message),
      canRetry ? h('button', { key: 'retry', type: 'button', onClick: requestAssets }, text('重新连接工作台', 'Reconnect to Workbench')) : null));
  }
  function requestAssets() {
    state.status = 'loading';
    registerStatus(text('正在连接工作台…', 'Connecting to Workbench…'), false);
    const stamp = String(Date.now());
    let stylesheet = document.querySelector<HTMLLinkElement>('link#hermes-workbench-sidecar-style');
    if (!stylesheet) {
      stylesheet = document.createElement('link'); stylesheet.id = 'hermes-workbench-sidecar-style'; stylesheet.rel = 'stylesheet';
      document.head.appendChild(stylesheet);
    }
    stylesheet.href = `/dashboard-plugins/workbench/dist/workbench.css?v=${stamp}`;
    document.getElementById('hermes-workbench-sidecar-script')?.remove();
    const script = document.createElement('script');
    script.id = 'hermes-workbench-sidecar-script'; script.src = `/dashboard-plugins/workbench/dist/workbench.js?v=${stamp}`; script.async = true;
    script.onerror = () => {
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
  requestAssets();
}
