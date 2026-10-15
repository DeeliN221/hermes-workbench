/**
 * Wrap workspace, file-tree, file read/write, and image-resource APIs for Hermes Workbench.
 * Use only the authenticated client supplied by the Dashboard SDK; do not read private host state.
 */

export type FetchJSON = <T>(url: string, init?: RequestInit) => Promise<T>;
const WORKBENCH_API = '/api/plugins/workbench';
const IMAGE_PATH_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const workspaceCache = new Map<string, Workspace>();

export type Workspace = {
  id: string;
  name: string;
  path: string;
  profile: string;
  sessionId: string;
};

export type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
};

export type FileDocument = {
  content: string;
  version: string;
  path: string;
  size: number;
};

/** Encode path and identity parameters so workspace paths cannot change request structure. */
function query(value: string): string {
  return encodeURIComponent(value);
}

/** Normalize workspace responses from different backend versions into a stable frontend shape. */
function normalizeWorkspace(value: any): Workspace | null {
  const row = value?.workspace ?? value;
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id ?? row.workspace_id ?? row.path ?? '');
  const path = String(row.path ?? row.root ?? row.root_path ?? '');
  if (!id && !path) return null;
  return {
    id: id || path,
    name: String(row.name ?? row.label ?? path.split('/').filter(Boolean).at(-1) ?? id),
    path,
    profile: String(row.profile ?? ''),
    sessionId: String(row.session_id ?? row.sessionId ?? ''),
  };
}

/** Read the single workspace bound to a session, returning null when none is bound. */
export async function loadWorkspace(
  fetchJSON: FetchJSON,
  profile: string,
  sessionId: string,
): Promise<Workspace | null> {
  const cached = workspaceCache.get(profile);
  if (cached) return { ...cached, profile, sessionId };
  const response = await fetchJSON<any>(
    `${WORKBENCH_API}/workspace?profile=${query(profile)}&session=${query(sessionId)}`,
  );
  const workspace = normalizeWorkspace(response);
  if (!workspace) return null;
  const normalized = { ...workspace, profile, sessionId: '' };
  workspaceCache.set(profile, normalized);
  return { ...normalized, sessionId };
}

/** Return a workspace only when it belongs to the currently selected session. */
export function workspaceForSession(
  workspace: Workspace | null,
  profile: string,
  sessionId: string,
): Workspace | null {
  return workspace?.profile === profile && workspace.sessionId === sessionId
    ? workspace
    : null;
}

/** Reuse the selected profile's single configured root when starting a fresh session. */
export function workspaceForNewSession(
  workspace: Workspace | null,
  profile: string,
): Workspace | null {
  return workspace?.profile === profile
    ? { ...workspace, sessionId: '' }
    : null;
}

/** Normalize flat or nested directory responses into immediate children of the current directory. */
function normalizeFiles(value: any, parentPath: string): FileEntry[] {
  const rows = Array.isArray(value) ? value : value?.files ?? value?.entries ?? value?.children ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: any): FileEntry[] => {
    if (typeof row === 'string') {
      const name = row.split('/').filter(Boolean).at(-1) || row;
      const path = parentPath && !row.includes('/') ? `${parentPath}/${row}` : row;
      return [{ name, path, type: row.endsWith('/') ? 'directory' : 'file' }];
    }
    if (!row || typeof row !== 'object') return [];
    const rawPath = String(row.path ?? row.relative_path ?? row.name ?? '');
    if (!rawPath) return [];
    const hasExplicitPath = row.path !== undefined || row.relative_path !== undefined;
    const path = parentPath && !hasExplicitPath ? `${parentPath}/${rawPath}` : rawPath;
    const rawType = String(row.type ?? row.kind ?? '');
    const isDirectory = row.is_directory === true || row.directory === true || rawType === 'directory' || rawType === 'dir';
    return [{
      name: String(row.name ?? path.split('/').filter(Boolean).at(-1) ?? path),
      path,
      type: isDirectory ? 'directory' : 'file',
      size: Number.isFinite(Number(row.size)) ? Number(row.size) : undefined,
    }];
  }).sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/** Browse one directory within a workspace. */
export async function listFiles(
  fetchJSON: FetchJSON,
  path: string,
): Promise<FileEntry[]> {
  const response = await fetchJSON<any>(
    `${WORKBENCH_API}/files?path=${query(path)}`,
  );
  return normalizeFiles(response, path);
}

/** Read UTF-8 text; browser replacement characters handle invalid binary sequences. */
export async function readFile(
  fetchJSON: FetchJSON,
  path: string,
): Promise<FileDocument> {
  const payload = await fetchJSON<any>(`${WORKBENCH_API}/file?path=${query(path)}`);
  return {
    content: String(payload?.content ?? ''),
    version: String(payload?.version ?? ''),
    path: String(payload?.path ?? path),
    size: Number(payload?.size ?? 0),
  };
}

/** Save the complete UTF-8 editor content with PUT. */
export async function writeFile(
  fetchJSON: FetchJSON,
  path: string,
  content: string,
  version: string,
): Promise<{ version: string }> {
  return await fetchJSON<{ version: string }>(`${WORKBENCH_API}/file?path=${query(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, version }),
  });
}

/** Return a same-origin workspace image URL for the browser to load as an image response. */
export function getAssetUrl(path: string): string {
  return `${WORKBENCH_API}/asset?path=${query(path)}`;
}

/** Identify files for read-only image previews without reading them as UTF-8 text. */
export function isImagePath(path: string): boolean {
  return IMAGE_PATH_PATTERN.test(path);
}

/** Determine whether a file supports Markdown preview. */
export function isMarkdownPath(path: string): boolean {
  return /(?:^|\/)readme(?:\.[^/]*)?$|\.(?:md|mdown|markdown)$/i.test(path);
}
