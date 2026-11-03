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

function isRootListingRequest(url: URL): boolean {
  const path = url.searchParams.get('path')?.trim();
  return !path || path === '.' || path === '/';
}

function requestInit(init: RequestInit | undefined, request: Request | undefined): RequestInit | undefined {
  if (!request) return init;
  return { method: request.method, headers: request.headers, credentials: request.credentials };
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
  if (response.status !== 403 || !isRootListingRequest(url)) return response;
  const failure = await response.clone().json().catch(() => null) as { detail?: unknown } | null;
  if (!OUTSIDE_MANAGED_ROOT.test(String(failure?.detail || ''))) return response;

  const fallback = await nativeFetch(WORKBENCH_MANAGED_FILES, requestInit(init, request));
  if (!fallback.ok || !fallback.headers.get('content-type')?.includes('application/json')) {
    return response;
  }
  const listing = await fallback.json().catch(() => null);
  const payload = normalizeManagedListing(listing);
  if (!payload || typeof payload !== 'object'
    || typeof (payload as { path?: unknown }).path !== 'string'
    || !Array.isArray((payload as { entries?: unknown }).entries)) {
    return response;
  }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Replace the native fallback label once a listing error is visible. */
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
    response.json = async () => normalizeManagedListing(await readJSON());
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
