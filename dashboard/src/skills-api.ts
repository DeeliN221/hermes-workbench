/** Skill files use versioned writes and profile-scoped authenticated requests. */
import type { FetchJSON } from './workbench-api';
import { record, rows, text, type AuthedFetch } from './api-values';
import { uiText } from './ui-locale';

const API = '/api/plugins/workbench/skills/files';
const encode = encodeURIComponent;
const profileQuery = (profile: string) => `profile=${encode(profile)}`;
function fileQuery(profile: string, skill: string, path?: string) {
  return `skill=${encode(skill)}&${profileQuery(profile)}${path ? `&path=${encode(path)}` : ''}`;
}
export interface SkillSummary {
  name: string; description: string; category: string; enabled?: boolean;
  path?: string; source?: string; fileCount?: number; updatedAt?: string;
}
export interface SkillEntry {
  name: string; path: string; type: 'file' | 'directory'; size?: number; modifiedAt?: string;
}
export interface SkillDocument {
  content: string; path: string; version: string; size: number; contentType?: string;
}
export type SkillMutation =
  | { action: 'create-file'; path: string; content?: string }
  | { action: 'create-directory' | 'delete'; path: string }
  | { action: 'rename'; path: string; newPath: string }
  | { action: 'copy' | 'move'; path: string; destination: string };

export function normalizeSkills(value: unknown): SkillSummary[] {
  return rows(value, 'items', 'skills', 'entries', 'files', 'children', 'data').flatMap((value): SkillSummary[] => {
    if (typeof value === 'string') return [{ name: value, description: '', category: '' }];
    const row = record(value), name = text(row.name ?? row.skill_name ?? row.id).trim();
    if (!name) return [];
    const count = Number(row.file_count ?? row.fileCount);
    return [{ name, description: text(row.description ?? row.desc), category: text(row.category ?? row.group),
      enabled: typeof row.enabled === 'boolean' ? row.enabled : undefined,
      path: text(row.path ?? row.root) || undefined, source: text(row.source ?? row.origin) || undefined,
      fileCount: Number.isFinite(count) ? count : undefined, updatedAt: text(row.updated_at ?? row.updatedAt) || undefined }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export function normalizeSkillEntries(value: unknown, parent = ''): SkillEntry[] {
  return rows(value, 'items', 'skills', 'entries', 'files', 'children', 'data').flatMap((value): SkillEntry[] => {
    if (typeof value === 'string') {
      const path = parent && !value.includes('/') ? `${parent}/${value}` : value;
      return [{ name: path.split('/').filter(Boolean).at(-1) || path, path, type: value.endsWith('/') ? 'directory' : 'file' }];
    }
    const row = record(value), raw = text(row.path ?? row.relative_path ?? row.name).trim();
    if (!raw) return [];
    const explicitPath = row.path !== undefined || row.relative_path !== undefined;
    const path = parent && !explicitPath ? `${parent}/${raw}` : raw;
    const kind = text(row.type ?? row.kind).toLowerCase(), size = Number(row.size);
    return [{ name: text(row.name ?? path.split('/').filter(Boolean).at(-1) ?? path), path,
      type: row.is_directory === true || row.directory === true || kind === 'directory' || kind === 'dir' ? 'directory' : 'file',
      size: Number.isFinite(size) ? size : undefined,
      modifiedAt: text(row.modified_at ?? row.modifiedAt ?? row.updated_at) || undefined }];
  }).sort((a, b) => a.type !== b.type ? a.type === 'directory' ? -1 : 1 : a.name.localeCompare(b.name));
}
export async function listSkills(read: FetchJSON, profile: string) {
  return normalizeSkills(await read(`${API}?${profileQuery(profile)}`));
}
export async function listSkillEntries(read: FetchJSON, profile: string, skill: string, path = '') {
  return normalizeSkillEntries(await read(`${API}/tree?${fileQuery(profile, skill, path)}`), path);
}
export async function readSkillFile(read: FetchJSON, profile: string, skill: string, path: string): Promise<SkillDocument> {
  const row = record(await read(`${API}/file?${fileQuery(profile, skill, path)}`));
  return { content: text(row.content ?? row.text), path: text(row.path ?? path), version: text(row.version),
    size: Number(row.size ?? 0), contentType: text(row.content_type ?? row.contentType) || undefined };
}
export async function readSkillDescription(read: FetchJSON, profile: string, skill: string) {
  const file = await readSkillFile(read, profile, skill, 'SKILL.md');
  return { ...file, contentType: file.contentType || 'text/markdown' };
}
export async function saveSkillFile(read: FetchJSON, profile: string, skill: string, path: string, content: string, version?: string) {
  const row = record(await read(`${API}/text?${profileQuery(profile)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, skill, path, content, mode: 'replace', version: version || null }),
  }));
  return { version: text(row.version) };
}
export async function mutateSkillFile(read: FetchJSON, profile: string, skill: string, change: SkillMutation): Promise<void> {
  const base = { profile, skill, path: change.path };
  let endpoint: string, method: string, body: object;
  switch (change.action) {
    case 'create-file': endpoint = 'text'; method = 'PUT'; body = { ...base, content: change.content ?? '', mode: 'create' }; break;
    case 'create-directory': endpoint = 'mkdir'; method = 'POST'; body = { ...base, mode: 'create' }; break;
    case 'delete': endpoint = 'node'; method = 'DELETE'; body = base; break;
    default: endpoint = change.action; method = 'POST'; body = { profile, skill, source: change.path,
      destination: change.action === 'rename' ? change.newPath : change.destination, mode: 'create' };
  }
  await read(`${API}/${endpoint}?${profileQuery(profile)}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
export function skillPreviewUrl(profile: string, skill: string, path: string) { return `${API}/preview?${fileQuery(profile, skill, path)}`; }
export function skillArchiveUrl(profile: string, skill: string) { return `${API}/archive?${fileQuery(profile, skill)}`; }
export function isSkillTextPath(path: string) {
  return /\.(?:md|markdown|mdown|mdx|txt|log|csv|json|ya?ml|toml|ini|cfg|conf|xml|py|ts|tsx|js|jsx|mjs|cjs|sh|bash|zsh|fish|css|html?|sql|c|cc|cpp|h|hpp|rs|go|java|rb|php|vue|svelte)$/i.test(path) || !/\.[^/]+$/.test(path);
}
export function skillPreviewKind(path: string, contentType = '') {
  if (contentType.startsWith('image/') || /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path)) return 'image';
  if (contentType === 'application/pdf' || path.toLowerCase().endsWith('.pdf')) return 'pdf';
  return isSkillTextPath(path) ? 'text' : 'download';
}
async function responseError(response: Response) {
  let message = '';
  try { const row = record(await response.clone().json()); message = text(row.detail ?? row.error ?? row.message); } catch { /* Non-JSON host errors use the status. */ }
  return new Error(message || uiText(`请求失败（${response.status}）`, `Request failed (${response.status})`));
}
export async function downloadSkillFile(fetch: AuthedFetch, profile: string, skill: string, path: string) {
  const response = await fetch(skillPreviewUrl(profile, skill, path));
  if (!response.ok) throw await responseError(response);
  return { blob: await response.blob(), contentType: response.headers.get('content-type') || '' };
}
async function upload(fetch: AuthedFetch, endpoint: string, profile: string, skill: string, file: File, path?: string) {
  const form = new FormData();
  form.append('file', file, file.name); form.append('profile', profile); form.append('skill', skill);
  form.append('mode', endpoint === 'archive' ? 'replace' : 'create');
  if (path !== undefined) form.append('path', path ? `${path}/${file.name}` : file.name);
  const response = await fetch(`${API}/${endpoint}`, { method: 'POST', body: form });
  if (!response.ok) throw await responseError(response);
}
export function uploadSkillArchive(fetch: AuthedFetch, profile: string, skill: string, file: File) { return upload(fetch, 'archive', profile, skill, file); }
export function uploadSkillFile(fetch: AuthedFetch, profile: string, skill: string, path: string, file: File) { return upload(fetch, 'upload', profile, skill, file, path); }
