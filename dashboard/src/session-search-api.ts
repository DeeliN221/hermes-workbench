/**
 * Cross-profile session search that streams profile/source results as they arrive.
 * Every request is bounded and shares one abort scope so changing or closing the
 * search cannot leave stale work running against the sidecar.
 */
import type { FetchJSON } from './workbench-api';
import { searchCodexSessions, type CodexSessionSearchHit } from './codex-api';
import { searchSessions } from './session-api';
import type { HermesRecord } from './hermes-transcript';
import { loadSessionOrganization } from './session-organization-api';
import type { SessionOrganizationMap } from './session-organization';
import { uiText as text } from './ui-locale';

export interface SearchResult {
  id: string; profile: string; kind: 'session' | 'hermes' | 'archived';
  title: string; snippet?: string; groupName?: string; updatedAt?: string | number;
  session?: any;
}

export interface SearchSnapshot {
  results: SearchResult[];
  failures: string[];
  complete: boolean;
  timedOut: boolean;
}

export interface SearchOptions {
  signal?: AbortSignal;
  onUpdate?: (snapshot: SearchSnapshot) => void;
  /** Per profile/source deadline. Defaults to 2.5 seconds. */
  sourceTimeoutMs?: number;
  /** Overall deadline for the whole cross-profile fan-out. Defaults to 4.8 seconds. */
  totalTimeoutMs?: number;
}

export const searchResultKey = (row: SearchResult) => JSON.stringify([row.profile, row.kind, row.id]);

const DEFAULT_SOURCE_TIMEOUT_MS = 2500;
const DEFAULT_TOTAL_TIMEOUT_MS = 4800;
const PROFILE_CACHE_MS = 5 * 60_000;
const ORGANIZATION_CACHE_MS = 2 * 60_000;

let profileCache: { expires: number; names: string[] } | undefined;
const organizationCache = new Map<string, { expires: number; value: SessionOrganizationMap }>();

/** Clear read caches between searches in tests or after profile configuration changes. */
export function clearSessionSearchCaches(): void {
  profileCache = undefined;
  organizationCache.clear();
}

class SearchTimeoutError extends Error {
  constructor() { super('Session search timed out'); this.name = 'SearchTimeoutError'; }
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException('Session search aborted', 'AbortError');
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

type SourceOutcome<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown; timedOut: boolean };

/** Race one source against its deadline while aborting the underlying read. */
async function runSource<T>(
  parent: AbortSignal,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<SourceOutcome<T>> {
  if (parent.aborted) return { status: 'rejected', reason: abortError(parent), timedOut: false };
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const forward = () => controller.abort(parent.reason);
  parent.addEventListener('abort', forward, { once: true });
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(abortError(controller.signal)), { once: true });
  });
  timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new SearchTimeoutError());
  }, timeoutMs);
  try {
    const value = await Promise.race([task(controller.signal), aborted]);
    return { status: 'fulfilled', value };
  } catch (reason) {
    return { status: 'rejected', reason, timedOut };
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', forward);
  }
}

async function profileNames(read: FetchJSON, signal?: AbortSignal): Promise<string[]> {
  if (profileCache && profileCache.expires > Date.now()) return profileCache.names;
  const roster = await (signal
    ? read<{ profiles: { name: string }[] }>('/api/profiles', { signal })
    : read<{ profiles: { name: string }[] }>('/api/profiles'));
  if (!Array.isArray(roster.profiles)) throw new Error('Invalid profile list');
  const names = roster.profiles.map(row => String(row.name || '').trim()).filter(Boolean);
  profileCache = { expires: Date.now() + PROFILE_CACHE_MS, names };
  return names;
}

async function organizationFor(read: FetchJSON, profile: string, signal?: AbortSignal): Promise<SessionOrganizationMap> {
  const cached = organizationCache.get(profile);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = await loadSessionOrganization(read, profile, signal);
  organizationCache.set(profile, { expires: Date.now() + ORGANIZATION_CACHE_MS, value });
  return value;
}

function codexResults(hits: CodexSessionSearchHit[], profile: string): SearchResult[] {
  return hits.map(row => ({ ...row, profile, kind: (row.deleted ? 'archived' : 'session') as SearchResult['kind'] }));
}

function hermesResults(rows: HermesRecord[], organization: SessionOrganizationMap | undefined, profile: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const row of rows) {
    if (!row.session_id || String(row.source).toLowerCase() === 'codex') continue;
    const metadata = organization?.[String(row.session_id)];
    results.push({
      id: String(row.session_id), profile, kind: 'hermes',
      title: String(metadata?.displayName || row.title || row.session_title || row.snippet || row.session_id),
      snippet: String(row.snippet || ''),
      groupName: String(metadata?.collection || row.group_name || row.project_name || ''),
      updatedAt: row.session_started,
    });
  }
  return results;
}

function mergeCodex(metadata: SearchResult[], content: SearchResult[]): SearchResult[] {
  const merged = new Map<string, SearchResult>();
  for (const row of [...metadata, ...content]) {
    const key = searchResultKey(row), prior = merged.get(key);
    merged.set(key, prior
      ? { ...prior, ...row, title: prior.title || row.title, snippet: prior.snippet || row.snippet,
        groupName: prior.groupName || row.groupName, updatedAt: prior.updatedAt ?? row.updatedAt }
      : row);
  }
  return [...merged.values()];
}

type ProfileState = {
  profile: string;
  metadata: SearchResult[];
  content: SearchResult[];
  hermes: HermesRecord[];
  organization?: SessionOrganizationMap;
  done: boolean;
};

function profileRows(state: ProfileState): SearchResult[] {
  return [
    ...mergeCodex(state.metadata, state.content),
    ...hermesResults(state.hermes, state.organization, state.profile),
  ];
}

/** Search one profile with independent source deadlines and lazy Codex content. */
async function searchProfile(
  read: FetchJSON,
  state: ProfileState,
  query: string,
  signal: AbortSignal,
  sourceTimeoutMs: number,
  onSource: (profile: string, resultSource: boolean) => void,
  onFailure: (message: string) => void,
): Promise<void> {
  const { profile } = state;
  const label = (source: string, outcome: SourceOutcome<unknown>) => `${profile} / ${source}${
    (outcome.status === 'rejected' && outcome.timedOut) || signal.reason instanceof SearchTimeoutError
      ? ` ${text('（超时）', '(timed out)')}` : ''}`;

  const metadataTask = runSource(signal, sourceTimeoutMs, source =>
    searchCodexSessions(read, profile, query, 100, { signal: source, content: false }));
  const hermesTask = runSource(signal, sourceTimeoutMs, source =>
    searchSessions(read, profile, query, true, source));
  const organizationTask = runSource(signal, sourceTimeoutMs, source =>
    organizationFor(read, profile, source));

  const metadata = await metadataTask;
  const metadataFailed = metadata.status === 'rejected';
  if (metadata.status === 'fulfilled') state.metadata = codexResults(metadata.value, profile);
  else onFailure(label('Codex', metadata));
  onSource(profile, true);

  // Content search is deliberately deferred until title/ID results are available.
  let contentError = '';
  const contentRead: FetchJSON = async <T,>(url: string, init?: RequestInit) => {
    const response = await read<T>(url, init);
    const error = (response as { contentError?: string }).contentError;
    if (error) contentError = error;
    return response;
  };
  const content = await runSource(signal, sourceTimeoutMs, source =>
    searchCodexSessions(contentRead, profile, query, 100, { signal: source, content: true }));
  if (content.status === 'fulfilled') state.content = codexResults(content.value, profile);
  else if (!metadataFailed) onFailure(label(text('Codex 正文搜索', 'Codex content search'), content));
  if (content.status === 'fulfilled' && contentError && !metadataFailed) {
    onFailure(`${profile} / ${text('Codex 正文搜索', 'Codex content search')}`);
  }
  onSource(profile, true);

  const [hermes, organization] = await Promise.all([hermesTask, organizationTask]);
  if (hermes.status === 'fulfilled') state.hermes = hermes.value;
  else onFailure(label('Hermes', hermes));
  if (organization.status === 'fulfilled') state.organization = organization.value;
  else onFailure(label(text('项目信息', 'project metadata'), organization));
  onSource(profile, true);
  state.done = true;
}

function sortResults(results: SearchResult[], current: string): SearchResult[] {
  const kindOrder = { session: 0, hermes: 1, archived: 2 };
  return results.sort((a, b) => Number(b.profile === current) - Number(a.profile === current)
    || a.profile.localeCompare(b.profile) || kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id));
}

/**
 * Stream cross-profile results: the current profile publishes first, then each
 * other profile appends independently. A slow source cannot hold the dialog open
 * past its deadline or the overall search budget.
 */
export async function searchAllProfiles(
  read: FetchJSON,
  current: string,
  rawQuery: string,
  options: SearchOptions = {},
): Promise<SearchSnapshot> {
  const query = rawQuery.trim();
  if (!query) return { results: [], failures: [], complete: true, timedOut: false };

  const sourceTimeoutMs = Math.max(1, options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS);
  const totalTimeoutMs = Math.max(sourceTimeoutMs, options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
  const userSignal = options.signal;
  const total = new AbortController();
  let totalTimedOut = false;
  const forward = () => total.abort(userSignal?.reason);
  userSignal?.addEventListener('abort', forward, { once: true });
  if (userSignal?.aborted) total.abort(userSignal.reason);
  const timer = setTimeout(() => {
    totalTimedOut = true;
    total.abort(new SearchTimeoutError());
  }, totalTimeoutMs);

  const states = new Map<string, ProfileState>();
  const failures: string[] = [];
  let currentReady = false;
  let resolveCurrentReady!: () => void;
  const currentReadyPromise = new Promise<void>(resolve => { resolveCurrentReady = resolve; });
  const ensureState = (profile: string) => {
    let state = states.get(profile);
    if (!state) states.set(profile, state = {
      profile, metadata: [], content: [], hermes: [], done: false,
    });
    return state;
  };
  const allResults = () => sortResults([...states.values()].flatMap(profileRows), current);
  const snapshot = (complete: boolean): SearchSnapshot => ({
    results: allResults(), failures: [...failures], complete,
    timedOut: totalTimedOut && !complete,
  });
  const publish = (complete: boolean) => {
    if (!currentReady) return;
    options.onUpdate?.(snapshot(complete));
  };
  const onSource = (profile: string, resultSource: boolean) => {
    if (profile === current && resultSource && !currentReady) {
      currentReady = true;
      resolveCurrentReady();
    }
    publish(false);
  };
  const onFailure = (message: string) => {
    failures.push(message);
    publish(false);
  };

  try {
    throwIfCancelled(userSignal);
    const currentState = ensureState(current);
    const currentSearch = searchProfile(read, currentState, query, total.signal, sourceTimeoutMs, onSource, onFailure);
    // The roster may reject first during cancellation; keep the parallel profile
    // promise observed until Promise.all can collect it below.
    currentSearch.catch(() => {});
    const roster = profileNames(read, total.signal).catch(reason => {
      throwIfCancelled(userSignal);
      failures.push(text('档案列表', 'Profile list'));
      return [] as string[];
    });
    roster.catch(() => {});

    await currentReadyPromise;
    throwIfCancelled(userSignal);
    publish(false);

    const names = await roster;
    throwIfCancelled(userSignal);
    const others = [...new Set([current, ...names])].filter(profile => profile !== current);
    for (const profile of others) ensureState(profile);

    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, others.length) }, async () => {
      while (true) {
        throwIfCancelled(userSignal);
        if (total.signal.aborted) return;
        const index = cursor++;
        if (index >= others.length) return;
        await searchProfile(read, ensureState(others[index]), query, total.signal, sourceTimeoutMs, onSource, onFailure);
        publish(false);
      }
    });

    await Promise.all([currentSearch, ...workers]);
    throwIfCancelled(userSignal);

    if (totalTimedOut) {
      const pending = [...states.values()].filter(state => !state.done).map(state => state.profile);
      for (const profile of pending) failures.push(`${profile} / ${text('搜索超时', 'search timed out')}`);
      if (!pending.length) failures.push(text('全部档案搜索超时', 'Search timed out'));
    }
    failures.splice(0, failures.length, ...new Set(failures));
    const final = snapshot(true);
    final.timedOut = totalTimedOut;
    options.onUpdate?.(final);
    return final;
  } finally {
    clearTimeout(timer);
    userSignal?.removeEventListener('abort', forward);
    if (!total.signal.aborted) total.abort();
  }
}
