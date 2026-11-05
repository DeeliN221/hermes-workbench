/** Keep native Files React keys unique without changing server access policy. */
export function normalizeManagedListing(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const listing = value as { path?: unknown; entries?: unknown };
  if (typeof listing.path !== 'string' || !Array.isArray(listing.entries)) return value;
  const base = listing.path;
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const seen = new Set<string>();
  return { ...listing, entries: listing.entries.flatMap(entry => {
    if (!entry || typeof entry.name !== 'string' || typeof entry.path !== 'string'
      || !entry.name || entry.name === '.' || entry.name === '..'
      || /[/\\]/.test(entry.name)) return [entry];
    // The server resolves symlinks. Using that target as React's key caused
    // skill-library and skill-library-local to share a key and leave stale rows.
    const path = `${base}${base.endsWith('/') || base.endsWith('\\') ? '' : separator}${entry.name}`;
    if (seen.has(path)) return [];
    seen.add(path);
    return [{ ...entry, path }];
  }) };
}

const WORKBENCH_MANAGED_FILES = '/api/plugins/workbench/managed-files';
const OUTSIDE_MANAGED_ROOT = /path outside managed files root/i;
const LOADING_LABELS = new Set(['Loading', '正在加载']);
const UNAVAILABLE_LABELS = new Set(['Unavailable', '不可用']);
const ROOT_STORAGE_KEY = 'hermes.workbench.managedRoot';
// The default host root is only a fallback hint. Any root returned by the API,
// exposed by the host page, or discovered through the Workbench endpoint wins.
const DEFAULT_MANAGED_ROOTS = ['/opt/data'];
const ROOT_HINTS: Array<[string, string]> = [
  ['[data-workbench-root]', 'data-workbench-root'],
  ['[data-managed-files-root]', 'data-managed-files-root'],
  ['[data-files-root]', 'data-files-root'],
];
const ROOT_GLOBALS = ['__HERMES_WORKBENCH_ROOT__', '__HERMES_MANAGED_FILES_ROOT__'];
const rememberedRoots = new Set<string>();

/** Canonicalize a display path for equality checks without resolving '..'. */
export function normalizeManagedRoot(value: unknown): string {
  if (typeof value !== 'string') return '';
  let path = value.trim().replace(/\\/g, '/');
  if (!path) return '';
  if (path.split('/').includes('..')) return path;
  path = path.replace(/\/\.(?=\/|$)/g, '').replace(/\/{2,}/g, '/');
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

function rememberRoot(value: unknown): string {
  const root = normalizeManagedRoot(value);
  if (!root || !root.startsWith('/') || root === '/') return '';
  rememberedRoots.add(root);
  try {
    const previous = JSON.parse(sessionStorage.getItem(ROOT_STORAGE_KEY) || '[]') as unknown;
    const roots = Array.isArray(previous) ? previous.filter((item): item is string => typeof item === 'string') : [];
    if (!roots.includes(root)) sessionStorage.setItem(ROOT_STORAGE_KEY, JSON.stringify([...roots, root].slice(-8)));
  } catch { /* Storage is optional; in-memory hints still work. */ }
  return root;
}

function rootHints(): string[] {
  const roots = [...rememberedRoots];
  const host = window as typeof window & Record<string, unknown>;
  for (const key of ROOT_GLOBALS) {
    const value = host[key];
    if (typeof value === 'string') roots.push(value);
  }
  for (const [selector, attribute] of ROOT_HINTS) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      const value = node.getAttribute(attribute);
      if (value) roots.push(value);
    }
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(ROOT_STORAGE_KEY) || '[]') as unknown;
    if (Array.isArray(stored)) roots.push(...stored.filter((item): item is string => typeof item === 'string'));
  } catch { /* Ignore corrupt or unavailable storage. */ }
  roots.push(...DEFAULT_MANAGED_ROOTS);
  return roots.map(normalizeManagedRoot).filter(root => root.startsWith('/') && root !== '/');
}

function isRootRequest(path: string, roots: string[]): boolean {
  if (!path || path === '.' || path === '/') return true;
  return roots.includes(normalizeManagedRoot(path));
}

function requestInit(init: RequestInit | undefined, request: Request | undefined): RequestInit | undefined {
  if (!request) return init;
  return { method: request.method, headers: request.headers, credentials: request.credentials };
}

function fallbackURL(path: string): string {
  const url = new URL(WORKBENCH_MANAGED_FILES, window.location.origin);
  if (path) url.searchParams.set('path', path);
  return `${url.pathname}${url.search}`;
}

/** Remove the stale red banner after a successful root recovery. */
export function clearManagedListingError(root: ParentNode = document): boolean {
  if (window.location.pathname !== '/files') return false;
  let cleared = false;
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[class*="text-destructive"]'))) {
    if (!OUTSIDE_MANAGED_ROOT.test(node.textContent?.trim() || '')) continue;
    let container = node.closest<HTMLElement>('[role="alert"], [data-files-error]');
    for (let parent = node.parentElement, depth = 0; !container && parent && parent !== root && depth < 3;
      parent = parent.parentElement, depth += 1) {
      const classes = typeof parent.className === 'string' ? parent.className : '';
      if (/bg-destructive|border-destructive/.test(classes)) container = parent;
    }
    (container || node).remove();
    cleared = true;
  }
  if (cleared) {
    const label = root.querySelector<HTMLElement>(
      'button[aria-label="Upload files"] [title], button[aria-label="上传文件"] [title]',
    );
    const original = label?.dataset.htiFilesOriginalLabel;
    if (label && original && UNAVAILABLE_LABELS.has(label.textContent?.trim() || '')) {
      label.textContent = original;
      delete label.dataset.htiFilesOriginalLabel;
    }
  }
  return cleared;
}

function scheduleErrorCleanup(): void {
  const clean = () => { clearManagedListingError(); };
  clean();
  requestAnimationFrame(clean);
  for (const delay of [50, 250, 1000]) setTimeout(clean, delay);
}

/**
 * Recover only the managed root listing from hosts that reject the whole
 * directory when one child symlink points outside that root. Non-root paths
 * deliberately stay on the host validator so real traversal remains rejected.
 */
async function recoverRootListing(
  response: Response,
  url: URL,
  init: RequestInit | undefined,
  request: Request | undefined,
  nativeFetch: typeof fetch,
): Promise<Response> {
  if (response.status !== 403) return response;
  const failure = await response.clone().json().catch(() => null) as { detail?: unknown } | null;
  if (!OUTSIDE_MANAGED_ROOT.test(String(failure?.detail || ''))) return response;

  const requested = url.searchParams.get('path')?.trim() || '';
  if (requested.split('/').includes('..')) return response;
  const roots = rootHints();
  const knownRoot = isRootRequest(requested, roots);
  // Relative child paths are never recovered. An unknown absolute path may be
  // the configured dashboard.workbench.root, so probe it and require the
  // Workbench response to identify that exact path as its managed root.
  if (requested && !knownRoot && !requested.startsWith('/')) return response;
  const explicitPath = requested && requested !== '.' && requested !== '/' ? requested : '';

  const fallback = await nativeFetch(fallbackURL(explicitPath), requestInit(init, request));
  if (!fallback.ok || !fallback.headers.get('content-type')?.includes('application/json')) {
    return response;
  }
  const listing = await fallback.json().catch(() => null) as { root?: unknown; locked_root?: unknown; path?: unknown } | null;
  const reportedRoot = rememberRoot(listing?.root) || rememberRoot(listing?.locked_root);
  if (explicitPath && reportedRoot !== normalizeManagedRoot(explicitPath)) return response;

  const payload = normalizeManagedListing(listing);
  if (!payload || typeof payload !== 'object'
    || typeof (payload as { path?: unknown }).path !== 'string'
    || !Array.isArray((payload as { entries?: unknown }).entries)) {
    return response;
  }
  if (explicitPath && normalizeManagedRoot((payload as { path?: unknown }).path) !== normalizeManagedRoot(explicitPath)) {
    return response;
  }
  scheduleErrorCleanup();
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Replace the native fallback label once an unrecovered listing error is visible. */
export function settleFilesLoadingLabel(root: ParentNode = document): boolean {
  if (window.location.pathname !== '/files') return false;
  const error = Array.from(root.querySelectorAll<HTMLElement>('div.text-destructive'))
    .some(node => Boolean(node.textContent?.trim()));
  if (!error) return false;
  const label = root.querySelector<HTMLElement>(
    'button[aria-label="Upload files"] [title], button[aria-label="上传文件"] [title]',
  );
  const text = label?.textContent?.trim() || '';
  if (!label || !LOADING_LABELS.has(text)) return false;
  label.dataset.htiFilesOriginalLabel = text;
  label.textContent = /[\u4e00-\u9fff]/.test(text) ? '不可用' : 'Unavailable';
  return true;
}

/** Adapt only successful same-origin directory JSON; reads and mutations stay native. */
export function installManagedFilesListing(): void {
  const host = window as typeof window & { __HTI_FILES_LISTING__?: boolean };
  if (host.__HTI_FILES_LISTING__) return;
  host.__HTI_FILES_LISTING__ = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url || String(input), window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== '/api/files'
      || (init?.method || request?.method || 'GET').toUpperCase() !== 'GET') return response;
    const recovered = await recoverRootListing(response, url, init, request, nativeFetch);
    if (recovered !== response) return recovered;
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
    const readJSON = response.json.bind(response);
    response.json = async () => {
      const payload = await readJSON();
      const listing = payload as { root?: unknown; locked_root?: unknown } | null;
      rememberRoot(listing?.root);
      rememberRoot(listing?.locked_root);
      return normalizeManagedListing(payload);
    };
    return response;
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => { scheduled = false; settleFilesLoadingLabel(); });
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  schedule();
}
