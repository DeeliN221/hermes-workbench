/**
 * A local Hermes plugin host backed by deterministic Workbench fixtures.
 * Preview mode and browser tests share this boundary so they exercise the same app.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ASSETS = new Map([
  ['/workbench.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'dashboard/dist/index.js') }],
  ['/style.css', { type: 'text/css; charset=utf-8', path: path.join(ROOT, 'dashboard/dist/style.css') }],
  ['/react.development.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'node_modules/react/umd/react.development.js') }],
  ['/react-dom.development.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'node_modules/react-dom/umd/react-dom.development.js') }],
]);

const fixture = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Workbench 本地预发布</title><link rel="stylesheet" href="/style.css">
<style>
  #preview-banner{position:fixed;z-index:2147483647;left:12px;bottom:12px;display:flex;gap:12px;align-items:center;
    padding:8px 12px;border:1px solid #5b6f61;border-radius:8px;background:#172019;color:#e9f2e9;
    font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px #0006}
  #preview-banner a{color:#a8e6bd;text-decoration:none} #preview-banner a:hover{text-decoration:underline}
  #preview-errors{position:fixed;z-index:2147483647;right:12px;bottom:12px;max-width:min(680px,calc(100vw - 24px));
    max-height:42vh;overflow:auto;padding:12px;border-radius:8px;background:#511;color:#fff;
    font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap} #preview-errors:empty{display:none}
</style></head>
<body><div id="root"></div><div id="preview-banner"><strong>本地预发布</strong><span>模拟 Hermes 数据</span>
<a href="/sessions?profile=default">首页</a><a href="/chat?session=codex-preview&profile=default">Codex 会话</a>
<a href="/chat?session=codex-preview&profile=writer">writer 会话</a></div><div id="preview-errors"></div>
<script src="/react.development.js"></script><script src="/react-dom.development.js"></script>
<script>
  const errors = [];
  const errorBox = document.getElementById('preview-errors');
  const report = value => { errors.push(String(value)); errorBox.textContent = errors.join(String.fromCharCode(10, 10)); };
  window.__smokeErrors = errors;
  addEventListener('error', event => report(event.error?.stack || event.message));
  addEventListener('unhandledrejection', event => report(event.reason?.stack || event.reason));

  class PreviewWebSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = PreviewWebSocket.CONNECTING;
    constructor() { super(); queueMicrotask(() => { this.readyState = PreviewWebSocket.OPEN; this.onopen?.(new Event('open')); }); }
    send() {}
    close() { this.readyState = PreviewWebSocket.CLOSED; }
  }
  window.WebSocket = PreviewWebSocket;

  async function fetchJSON(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(\`HTTP \${response.status}: \${url}\`);
    return response.json();
  }
  const Passthrough = ({ children }) => React.createElement(React.Fragment, null, children);
  window.__HERMES_PLUGIN_SDK__ = {
    React, hooks: React, sdkVersion: '1.1.0',
    components: { Dialog: Passthrough, DialogClose: Passthrough, DialogContent: Passthrough,
      DialogDescription: Passthrough, DialogTitle: Passthrough },
    fetchJSON, authedFetch: url => fetch(url),
  };
  const slots = {};
  window.__HERMES_PLUGINS__ = {
    register() {},
    registerSlot(plugin, slot, component) { (slots[plugin] ||= {})[slot] = component; },
  };
  window.__HERMES_SMOKE_SLOTS__ = slots;
</script><script src="/workbench.js"></script>
<script>
  addEventListener('load', () => {
    const App = window.__HERMES_SMOKE_SLOTS__.workbench?.overlay;
    if (!App) throw new Error('Workbench overlay was not registered');
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  });
</script></body></html>`;

/** Return preview sessions for one profile with stable IDs and recent timestamps. */
function codexSessions(profile) {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: 'codex-preview', threadId: 'codex-preview', title: `本机预发布验证 · ${profile}`, workspace: 'hermes-workbench',
      workspaceId: 'preview-workspace', workspacePath: '/home/preview/hermes-workbench', favorite: false, groupId: null,
      deleted: false, updatedAt: now - 90, createdAt: now - 3600, status: 'idle', lastCompletedSeq: 2, readSeq: 0, color: '#4f8f72' },
    { id: 'codex-regression', threadId: 'codex-regression', title: '首页渲染回归检查', workspace: 'hermes-workbench',
      workspaceId: 'preview-workspace', workspacePath: '/home/preview/hermes-workbench', favorite: false, groupId: null,
      deleted: false, updatedAt: now - 240, createdAt: now - 7200, status: 'idle', lastCompletedSeq: 1, readSeq: 1, color: '#6a7fa8' },
  ];
}

/** Return Hermes history cards backed by the endpoints below. */
function hermesSessions(profile) {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: 'hermes-preview', title: `发布流程演练 · ${profile}`, source: 'web', updated_at: now - 120, created_at: now - 3600, message_count: 2, status: 'idle' },
    { id: 'hermes-regression', title: '跨 profile 窗格说明', source: 'web', updated_at: now - 300, created_at: now - 7200, message_count: 1, status: 'idle' },
  ];
}

/** Build representative turns for both the chat reader and its preview card. */
function codexTurns() {
  return [{
    id: 'preview-turn', status: 'completed',
    items: [
      { id: 'preview-user', type: 'userMessage', content: [{ type: 'text', text: '请验证本机预发布环境能否正常打开。' }] },
      { id: 'preview-agent', type: 'agentMessage', content: [{ type: 'text', text: '本机宿主已启动。这里是模拟数据，不会访问 NAS、生产凭据或真实 Codex 会话。' }] },
    ],
  }];
}

/** Return deterministic plugin API data for the fixture routes. */
function apiPayload(url, method) {
  const pathname = url.pathname;
  const profile = url.searchParams.get('profile') || 'default';
  const codex = codexSessions(profile), hermes = hermesSessions(profile);
  if (pathname.endsWith('/capabilities')) return {
    codexChat: true, codexUserInput: true, codexThreadReasoningConfig: true,
    newChatProviders: ['codex'], historyOnlyProviders: [], supportsExternalContinuation: false,
  };
  if (pathname.endsWith('/profile-names')) return { profiles: [{ name: 'default' }, { name: 'writer' }] };
  if (pathname === '/api/profiles') return { profiles: [{ name: 'default' }, { name: 'writer' }] };
  if (pathname.endsWith('/home-read-state')) return method === 'GET' ? { items: [] } : { ok: true };
  if (pathname === '/api/plugins/workbench/codex/sessions') {
    if (method === 'POST') return { session: { ...codex[0], id: `codex-new-${Date.now()}`, title: '新会话' } };
    return { items: url.searchParams.get('deleted') === 'true' ? [] : codex };
  }
  if (pathname === '/api/plugins/workbench/codex/session' || pathname === '/api/plugins/workbench/codex/session/preview') {
    return { cached: true, turns: codexTurns() };
  }
  if (pathname === '/api/plugins/workbench/codex/session/read') return { ok: true };
  if (pathname === '/api/plugins/workbench/codex/groups') return { items: [] };
  if (pathname === '/api/plugins/workbench/codex/workspaces') return { items: [{ id: 'preview-workspace', name: 'hermes-workbench', path: '/home/preview/hermes-workbench' }] };
  if (pathname === '/api/plugins/workbench/codex/models') return { data: [{
    model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', isDefault: true, defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
  }] };
  if (pathname === '/api/config') return { model: 'gpt-6.1-sol', agent: { reasoning_effort: 'medium' } };
  if (pathname === '/api/plugins/workbench/workspace') return { workspace: {
    id: 'preview-workspace', name: 'hermes-workbench', path: '/home/preview/hermes-workbench', profile,
  } };
  if (pathname === '/api/plugins/workbench/session-prompts') return { first: '请验证本机预发布环境。', latest: '确认首页与会话窗格可以正常打开。' };
  if (pathname === '/api/profiles/sessions') return { sessions: hermes, total: hermes.length };
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/latest-descendant')) return {
    session_id: pathname.split('/')[3], path: [pathname.split('/')[3]],
  };
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/messages')) return {
    session_id: pathname.split('/')[3], messages: [
      { role: 'user', content: '请验证本机预发布环境的 Hermes 会话。' },
      { role: 'assistant', content: '这是只读的本地模拟会话，页面加载和切换可以在这里检查。' },
    ],
  };
  if (pathname.startsWith('/api/sessions/')) return { id: pathname.split('/')[3], title: '本地模拟会话' };
  if (pathname === '/api/plugins/workbench/files') return { files: [
    { name: 'README.md', path: '/home/preview/hermes-workbench/README.md', type: 'file', size: 120 },
    { name: 'src', path: '/home/preview/hermes-workbench/src', type: 'directory' },
  ] };
  if (pathname === '/api/plugins/workbench/file') return {
    path: url.searchParams.get('path') || '/home/preview/hermes-workbench/README.md',
    content: '# 本地预发布\n\n这是模拟文件，不会读取本机或 NAS 的真实工作区。\n', version: 'preview', size: 72,
  };
  return { items: [], profiles: [{ name: 'default' }, { name: 'writer' }], sessions: [], boards: [],
    entries: [], turns: [], files: [], children: [], total: 0, current: '', ok: true };
}

/** Start a same-origin preview host or an ephemeral server for browser tests. */
export async function createMockHost({ host = '127.0.0.1', port = 0 } = {}) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${host}`);
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const body = JSON.stringify(apiPayload(url, request.method || 'GET'));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      response.end(body);
      return;
    }
    if (['/', '/sessions', '/chat', '/workbench'].includes(url.pathname)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(fixture);
      return;
    }
    const asset = ASSETS.get(url.pathname);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(asset.path);
      response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': body.length });
      response.end(body);
    } catch {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Run pnpm build before starting the local preview.');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Mock host did not bind a TCP port');
  return {
    origin: `http://${host}:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
