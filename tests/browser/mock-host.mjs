/**
 * A local Hermes plugin host backed by deterministic Workbench fixtures.
 * Preview mode and browser tests share this boundary so they exercise the same app.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const ASSETS = new Map([
  ['/workbench.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'dashboard/dist/index.js') }],
  ['/style.css', { type: 'text/css; charset=utf-8', path: path.join(ROOT, 'dashboard/dist/style.css') }],
  ['/dashboard-plugins/workbench/dist/index.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'dashboard/dist/loader.js') }],
  ['/dashboard-plugins/workbench/dist/workbench.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'dashboard/dist/index.js') }],
  ['/dashboard-plugins/workbench/dist/workbench.css', { type: 'text/css; charset=utf-8', path: path.join(ROOT, 'dashboard/dist/style.css') }],
  ['/loader.css', { type: 'text/css; charset=utf-8', path: path.join(ROOT, 'dashboard/loader.css') }],
  ['/dashboard-plugins/workbench/dist/pele.global.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'dashboard/dist/pele.global.js') }],
  ['/react.development.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'node_modules/react/umd/react.development.js') }],
  ['/react-dom.development.js', { type: 'text/javascript; charset=utf-8', path: path.join(ROOT, 'node_modules/react-dom/umd/react-dom.development.js') }],
]);

const fixture = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Workbench local preview</title><link rel="stylesheet" href="/style.css">
<style>
  #preview-banner{position:fixed;z-index:2147483647;left:12px;bottom:12px;display:flex;gap:12px;align-items:center;
    padding:8px 12px;border:1px solid #5b6f61;border-radius:8px;background:#172019;color:#e9f2e9;
    font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px #0006}
  #preview-banner a{color:#a8e6bd;text-decoration:none} #preview-banner a:hover{text-decoration:underline}
  #preview-errors{position:fixed;z-index:2147483647;right:12px;bottom:12px;max-width:min(680px,calc(100vw - 24px));
    max-height:42vh;overflow:auto;padding:12px;border-radius:8px;background:#511;color:#fff;
    font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap} #preview-errors:empty{display:none}
</style></head>
<body><div id="root"></div><div id="preview-banner"><strong>Local preview</strong><span>Mock Hermes data</span>
<a href="/sessions?profile=default">Home</a><a href="/chat?session=codex-preview&profile=default">Codex chat</a>
<a href="/chat?session=codex-preview&profile=writer">writer chat</a></div><div id="preview-errors"></div>
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
    fetchJSON, authedFetch: (url, init) => fetch(url, init),
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

const loaderFixture = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Workbench loader preview</title>
<link rel="stylesheet" href="/loader.css">
<style>html,body,#root{margin:0;min-height:100%;background:#071414;color:#e9f2e9}</style></head>
<body><div id="root"></div><script src="/react.development.js"></script>
<script src="/react-dom.development.js"></script>
<script>
  window.__smokeErrors = [];
  addEventListener('error', event => window.__smokeErrors.push(event.error?.stack || event.message));
  addEventListener('unhandledrejection', event => window.__smokeErrors.push(event.reason?.stack || event.reason));
  class PreviewWebSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = PreviewWebSocket.CONNECTING;
    constructor() { super(); queueMicrotask(() => { this.readyState = PreviewWebSocket.OPEN; this.onopen?.(new Event('open')); }); }
    send() {} close() { this.readyState = PreviewWebSocket.CLOSED; }
  }
  window.WebSocket = PreviewWebSocket;
  async function fetchJSON(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url);
    return response.json();
  }
  const slots = {}, components = {};
  const root = ReactDOM.createRoot(document.getElementById('root'));
  function render() {
    const App = slots.workbench?.overlay || components.workbench;
    if (App) root.render(React.createElement(App));
  }
  window.__HERMES_PLUGINS__ = {
    register(name, component) { components[name] = component; render(); },
    registerSlot(plugin, slot, component) { (slots[plugin] ||= {})[slot] = component; render(); },
  };
  window.__HERMES_PLUGIN_SDK__ = { React, hooks: React, components: {}, sdkVersion: '1.1.0', fetchJSON,
    authedFetch: (url, init) => fetch(url, init) };
  window.__HERMES_WORKBENCH_SIDECAR__ = { status: 'idle' };
</script><script src="/dashboard-plugins/workbench/dist/index.js"></script></body></html>`;

const configFixture = fixture.replace(
  '<body><div id="root"></div>',
  `<body><style>
    .host-shell{display:flex;min-height:100dvh;width:100%;font:14px/1.5 system-ui,sans-serif}
    .host-page{display:flex;flex:1 1 auto;min-width:0;min-height:0;flex-direction:column;overflow:hidden}
    .host-banner{z-index:1;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent)}
    .host-banner h1{margin:0;font-size:15px;font-weight:700}
    .host-banner input{height:32px;min-width:180px;padding:0 10px;border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:6px;background:transparent;color:inherit}
    .host-main{display:flex;flex:1 1 auto;min-width:0;min-height:0;flex-direction:column;overflow-y:auto;overflow-x:hidden}
    .host-route-column{position:relative;z-index:2;display:flex;flex:1 1 0%;min-width:0;min-height:0;flex-direction:column;padding:12px 16px}
    .host-config-path{padding:8px 12px;margin-bottom:12px;border-radius:6px;background:color-mix(in srgb,currentColor 8%,transparent);font:12px/1.4 ui-monospace,monospace}
    .host-config-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:12px}
    .host-config-toolbar button{height:32px;padding:0 12px;border:1px solid color-mix(in srgb,currentColor 28%,transparent);border-radius:4px;background:transparent;color:inherit;font:inherit}
    .host-config-toolbar button.is-save{background:var(--mc-ink,#222);color:var(--mc-surface,#fff);border-color:transparent;font-weight:600}
    .host-config-tabs{display:flex;gap:12px;padding:8px 10px;margin-bottom:12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:6px;font-size:12px}
    .host-config-card{border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:8px;padding:14px;display:grid;gap:12px}
    .host-config-card label{display:grid;gap:6px;font-size:13px}
    .host-config-card input{height:36px;padding:0 10px;border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:6px;background:transparent;color:inherit;font:12px ui-monospace,monospace}
    .fixed{position:fixed}.inset-0{inset:0}[class~="z-[100]"]{z-index:100}[class~="z-[200]"]{z-index:200}.z-2{z-index:2}
  </style><div class="host-shell"><aside id="app-sidebar"></aside><div class="host-page"><header class="host-banner" role="banner"><h1>Configuration</h1><input type="search" placeholder="Search..." aria-label="Search configuration"></header><main class="host-main"><div class="host-route-column z-2" data-testid="host-config-form"><div class="host-config-path">/workspace/profiles/default/config.yaml</div><div class="host-config-toolbar"><button type="button">&lt;/&gt; YAML</button><button type="button" class="is-save">Save</button></div><div class="host-config-tabs"><span>General 27</span><span>Terminal 34</span><span>Display 9</span></div><div class="host-config-card"><strong>General · 27 fields</strong><label><span>Default model (e.g. anthropic/claude-sonnet-4-6)</span><input type="text" value="gpt-6.1-sol" readonly></label><label><span>MODEL CONTEXT LENGTH</span><input type="text" value="0" readonly></label><label><span>FALLBACK PROVIDERS</span><input type="text" value="comma-separated values" readonly></label></div></div></main></div></div><div id="root"></div>`,
);

/** Return preview sessions for one profile with stable IDs and recent timestamps. */
function codexSessions(profile) {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: 'codex-preview', threadId: 'codex-preview', title: `Local preview validation · ${profile}`, workspace: 'hermes-workbench',
      workspaceId: 'preview-workspace', workspacePath: '/home/preview/hermes-workbench', favorite: false, groupId: null,
      deleted: false, updatedAt: now - 90, createdAt: now - 3600, status: 'idle', lastCompletedSeq: 2, readSeq: 0, color: '#4f8f72' },
    { id: 'codex-regression', threadId: 'codex-regression', title: 'Home rendering regression', workspace: 'hermes-workbench',
      workspaceId: 'preview-workspace', workspacePath: '/home/preview/hermes-workbench', favorite: false, groupId: null,
      deleted: false, updatedAt: now - 240, createdAt: now - 7200, status: 'idle', lastCompletedSeq: 1, readSeq: 1, color: '#6a7fa8' },
  ];
}

/** Return Hermes history cards backed by the endpoints below. */
function hermesSessions(profile) {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: 'hermes-preview', title: `Release workflow drill · ${profile}`, source: 'web', updated_at: now - 120, created_at: now - 3600, message_count: 2, status: 'idle' },
    { id: 'hermes-regression', title: 'Pane session regression', source: 'web', updated_at: now - 300, created_at: now - 7200, message_count: 1, status: 'idle' },
  ];
}

/** Build representative turns for both the chat reader and its preview card. */
function codexTurns() {
  return [{
    id: 'preview-turn', status: 'completed', startedAt: Math.floor(Date.now() / 1000) - 60, durationMs: 1000,
    quota: { kind: 'google', label: 'Claude', subscription: true, fiveHourRemaining: 0, weeklyRemaining: 47.2 },
    items: [
      { id: 'preview-user', type: 'userMessage', content: [{ type: 'text', text: 'Please verify that the local preview opens correctly.' }] },
      {
        id: 'preview-reasoning', type: 'reasoning', status: 'completed',
        summary: [Array.from({ length: 15 }, (_, index) => `Reasoning check ${index + 1}: inspect the local fixture boundary.`).join('\n')],
      },
      {
        id: 'preview-command', type: 'commandExecution', status: 'completed', exitCode: 0, durationMs: 1200,
        command: 'printf "preview output\\n"',
        aggregatedOutput: Array.from({ length: 12 }, (_, index) => `preview output line ${index + 1}`).join('\n'),
      },
      { id: 'preview-agent', type: 'agentMessage', content: [{ type: 'text', text: 'The local host is running. This is mock data and does not access production credentials or real Codex sessions.\n\n```mermaid\nflowchart LR\n  Chat --> Pele\n  Pele --> SVG\n```' }] },
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
    if (method === 'POST') return { session: { ...codex[0], id: `codex-new-${Date.now()}`, title: 'New chat' } };
    return { items: url.searchParams.get('deleted') === 'true' ? [] : codex };
  }
  if (pathname === '/api/plugins/workbench/codex/search') {
    return { results: [{
      session_id: 'codex-regression', thread_id: 'codex-regression', title: 'Home rendering regression',
      snippet: 'Server-side content needle: the render pipeline recovered after a stale snapshot.',
      matched: 'content', updated_at: codex[1].updatedAt, deleted: false, group_name: 'Preview Project 1', status: 'idle',
    }], contentSearch: true, contentError: '', truncated: false };
  }
  if (pathname === '/api/plugins/workbench/codex/session') {
    if (method === 'POST') return { request: { status: 'accepted', turn_id: 'preview-turn' } };
    return { cached: true, turns: codexTurns() };
  }
  if (pathname === '/api/plugins/workbench/codex/session/preview') return { cached: true, turns: codexTurns() };
  if (pathname === '/api/plugins/workbench/codex/session/read') return { ok: true };
  if (pathname === '/api/plugins/workbench/codex/groups') {
    const count = url.searchParams.get('profile') === 'writer' ? 2 : 6;
    return { items: Array.from({ length: count }, (_, index) => ({
      id: `preview-project-${index + 1}`,
      name: `Preview Project ${index + 1}`,
      workspaceId: 'preview-workspace',
      workspacePath: '/home/preview/hermes-workbench',
    })) };
  }
  if (pathname === '/api/plugins/workbench/codex/workspaces') return { items: [{ id: 'preview-workspace', name: 'hermes-workbench', path: '/home/preview/hermes-workbench' }] };
  if (pathname === '/api/plugins/workbench/codex/models') return { data: [
    { model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', isDefault: true, supportsFast: true, fastServiceTier: 'priority',
      defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
    { model: 'gpt-6-astra', displayName: 'GPT-6 Astra', isDefault: false, supportsFast: true, fastServiceTier: 'priority',
      defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
    { model: 'gpt-6-luna', displayName: 'GPT-6 Luna', isDefault: false, supportsFast: false,
      defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] },
    { model: 'deepseek/deepseek-flash', displayName: 'DeepSeek Flash', isDefault: false, supportsFast: true,
      defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] },
  ] };
  if (pathname === '/api/plugins/workbench/codex-runtime/status') return {
    installed_version: '0.24.0', latest_version: '0.24.0', update_available: false, busy: false,
  };
  if (pathname === '/api/plugins/workbench/versions') return {
    active: '20261029-1', update_mode: 'release',
    versions: [
      { version: '20261029-1', ready: true, source: 'github', published_at: '2026-10-29T00:00:00Z', notes: 'Current stable release.' },
      { version: '20261028-1', ready: true, source: 'github', published_at: '2026-10-28T00:00:00Z', notes: 'Previous stable release.' },
    ],
  };
  if (pathname === '/api/plugins/workbench/codex/attachments/folder' && method === 'POST') return { attachment: {
    id: 'folder-preview', name: 'project', size: 19, fileCount: 2, mimeType: 'inode/directory', kind: 'folder',
  } };
  if (pathname === '/api/plugins/workbench/codex/attachments' && method === 'POST') return { attachment: {
    id: 'file-preview', name: 'notes.txt', size: 5, mimeType: 'text/plain', kind: 'file', fileCount: 0,
  } };
  if (pathname === '/api/config') return { model: 'gpt-6.1-sol', agent: { reasoning_effort: 'medium' } };
  if (pathname === '/api/plugins/workbench/workspace') return { workspace: {
    id: 'preview-workspace', name: 'hermes-workbench', path: '/home/preview/hermes-workbench', profile,
  } };
  if (pathname === '/api/plugins/workbench/session-prompts') return { first: 'Verify the local preview.', latest: 'Confirm that the home page and chat panes open correctly.' };
  if (pathname === '/api/profiles/sessions') return { sessions: hermes, total: hermes.length };
  if (pathname === '/api/sessions/search') return { results: [{
    session_id: 'hermes-preview', snippet: 'Server-side content needle: release workflow drill notes.',
    role: 'user', source: 'web', model: 'preview-model', session_started: hermes[0].updated_at,
  }] };
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/latest-descendant')) return {
    session_id: pathname.split('/')[3], path: [pathname.split('/')[3]],
  };
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/messages')) return {
    session_id: pathname.split('/')[3], messages: [
      { role: 'user', content: 'Please verify the Hermes session in the local preview.' },
      { role: 'assistant', content: 'This is a read-only local mock session for checking page loads and switching.' },
    ],
  };
  if (pathname.startsWith('/api/sessions/')) return { id: pathname.split('/')[3], title: 'Local mock session' };
  if (pathname === '/api/plugins/workbench/files') return { files: [
    { name: 'README.md', path: '/home/preview/hermes-workbench/README.md', type: 'file', size: 120 },
    { name: 'src', path: '/home/preview/hermes-workbench/src', type: 'directory' },
  ] };
  if (pathname === '/api/plugins/workbench/file') return {
    path: url.searchParams.get('path') || '/home/preview/hermes-workbench/README.md',
    content: '# Local preview\n\nThis is a mock file. It never reads a real local or NAS workspace.\n', version: 'preview', size: 72,
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
      request.resume();
      const body = JSON.stringify(apiPayload(url, request.method || 'GET'));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      response.end(body);
      return;
    }
    if (url.pathname === '/config' || url.pathname === '/models') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(configFixture);
      return;
    }
    if (url.pathname === '/loader-preview' || (url.pathname === '/chat' && url.searchParams.get('loader') === '1')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(loaderFixture);
      return;
    }
    const versioned = /^\/workbench-sidecar\/v\/([^/]+)\/workbench\.(js|css)$/.exec(url.pathname);
    if (versioned) {
      if (versioned[1] !== VERSION) {
        response.writeHead(404).end();
        return;
      }
      const filename = versioned[2] === 'js' ? 'dashboard/dist/index.js' : 'dashboard/dist/style.css';
      try {
        const body = await readFile(path.join(ROOT, filename));
        response.writeHead(200, {
          'Content-Type': versioned[2] === 'js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        response.end(body);
      } catch {
        response.writeHead(503).end();
      }
      return;
    }
    if (['/', '/sessions', '/chat', '/workbench', '/profiles', '/cron'].includes(url.pathname)) {
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
