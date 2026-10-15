/**
 * Keep a stable Hermes loader and load Workbench assets from their installed route.
 * Loading failures show a retry page without interrupting native Hermes chat.
 */
(function loadHermesWorkbenchSidecar() {
  const text = (zh, en) => document.documentElement.lang.toLowerCase().startsWith('zh') ? zh : en;
  const sdk = window.__HERMES_PLUGIN_SDK__;
  const registry = window.__HERMES_PLUGINS__;
  if (!sdk || !registry) return;

  const state = window.__HERMES_WORKBENCH_SIDECAR__ || { status: 'idle' };
  window.__HERMES_WORKBENCH_SIDECAR__ = state;
  if (state.status === 'loaded' || state.status === 'loading') return;

  // Native Kanban omits `board` on DELETE. Without this, a card on a
  // non-default board is looked up in the default board and falsely 404s.
  function installKanbanDeleteBoardScope() {
    const marker = '__HERMES_WORKBENCH_KANBAN_DELETE_BOARD_SCOPE__';
    if (window[marker]) return;
    window[marker] = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function scopedKanbanDelete(input, init) {
      const request = input instanceof Request ? input : null;
      const method = String((init && init.method) || (request && request.method) || 'GET').toUpperCase();
      if (method === 'DELETE') {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, window.location.href);
        if (url.origin === window.location.origin
          && /^\/api\/plugins\/kanban\/tasks\/[^/]+$/.test(url.pathname)
          && !url.searchParams.has('board')) {
          const explicit = new URLSearchParams(window.location.search).get('board');
          const board = (explicit || window.localStorage.getItem('hermes.kanban.selectedBoard') || '').trim();
          if (board) {
            url.searchParams.set('board', board);
            return nativeFetch(url.toString(), init);
          }
        }
      }
      return nativeFetch(input, init);
    };
  }

  installKanbanDeleteBoardScope();

  /** Register a lightweight status page while the sidecar is loading. */
  function registerStatus(message, canRetry) {
    /** Render loading and error states. */
    function WorkbenchSidecarStatus() {
      const children = [
        sdk.React.createElement('p', { key: 'message' }, message),
      ];
      if (canRetry) {
        children.push(sdk.React.createElement(
          'button',
          { key: 'retry', type: 'button', onClick: requestAssets },
          text("重新连接工作台", "Reconnect to Workbench"),
        ));
      }
      return sdk.React.createElement(
        'main',
        { className: 'workbench-sidecar-status', role: canRetry ? 'alert' : 'status' },
        children,
      );
    }

    registry.register('workbench', WorkbenchSidecarStatus);
  }

  /** Load same-origin assets with a per-page cache stamp without forcing open pages to refresh. */
  function requestAssets() {
    state.status = 'loading';
    registerStatus(text("正在连接工作台…", "Connecting to Workbench\u2026"), false);

    const cacheStamp = String(Date.now());
    let stylesheet = document.getElementById('hermes-workbench-sidecar-style');
    if (!stylesheet) {
      stylesheet = document.createElement('link');
      stylesheet.id = 'hermes-workbench-sidecar-style';
      stylesheet.rel = 'stylesheet';
      document.head.appendChild(stylesheet);
    }
    stylesheet.href = `/dashboard-plugins/workbench/dist/workbench.css?v=${cacheStamp}`;

    const previousScript = document.getElementById('hermes-workbench-sidecar-script');
    if (previousScript) previousScript.remove();
    const script = document.createElement('script');
    script.id = 'hermes-workbench-sidecar-script';
    script.src = `/dashboard-plugins/workbench/dist/workbench.js?v=${cacheStamp}`;
    script.async = true;
    script.onerror = function handleLoadFailure() {
      state.status = 'error';
      registerStatus(text("工作台暂时不可用，Hermes 对话仍在运行。", "Workbench is temporarily unavailable. Hermes conversations are still running."), true);
    };
    script.onload = function verifyRegistration() {
      window.setTimeout(function verifyLoadedState() {
        if (state.status === 'loaded') return;
        state.status = 'error';
        registerStatus(text("工作台版本与当前 Hermes 不兼容。", "This Workbench version is incompatible with the current Hermes host."), true);
      }, 0);
    };
    document.head.appendChild(script);
  }

  requestAssets();
}());
