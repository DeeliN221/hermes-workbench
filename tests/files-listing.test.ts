// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearManagedListingError, installManagedFilesListing, normalizeManagedListing, settleFilesLoadingLabel } from '../dashboard/src/files-listing';
import { closeFilePreview, openFilePreview, showFilePreviewLoading } from '../dashboard/src/file-preview';

afterEach(() => { closeFilePreview(); vi.unstubAllGlobals(); delete (window as any).__HTI_FILES_LISTING__; });
describe('Files symlink and download regressions', () => {
  it('retains separate aliases with unique native React keys and removes identical duplicate rows', () => {
    const entry = { name: 'skill-library', path: '/opt/data/skill-library', is_directory: true };
    const listing = { path: '/opt/data', parent: '/opt', entries: [entry, { ...entry, name: 'skill-library-local' }, entry] };
    const result = normalizeManagedListing(listing) as typeof listing;
    expect(result.entries.map(e => e.path)).toEqual(['/opt/data/skill-library', '/opt/data/skill-library-local']);
    expect(result.entries.map(e => e.name)).toEqual(['skill-library', 'skill-library-local']);
    expect(listing.entries).toHaveLength(3);
    expect(normalizeManagedListing(result)).toEqual(result);
  });
  it('does not rewrite errors, cross-origin requests or file reads', async () => {
    window.history.replaceState(null, '', '/files');
    const raw = { path: '/data', entries: [{ name: 'alias', path: '/target' }] };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    installManagedFilesListing();
    expect((await (await fetch('/api/files')).json()).entries[0].path).toBe('/data/alias');
    for (const path of ['/api/files/read', 'https://elsewhere.test/api/files']) {
      expect(await (await fetch(path)).json()).toEqual(raw);
    }
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify(raw), { status: 403, headers: { 'content-type': 'application/json' } }));
    expect(await (await fetch('/api/files')).json()).toEqual(raw);
  });
  it('recovers a root listing rejected because a child link leaves the managed root', async () => {
    window.history.replaceState(null, '', '/files?profile=default');
    const failure = { detail: 'Path outside managed files root' };
    const recovered = {
      root: '/opt/data', locked_root: '/opt/data', can_change_path: false,
      path: '/opt/data', parent: null,
      entries: [{ name: 'workspace', path: '/opt/data/workspace', is_directory: true, size: null, mtime: 1, mime_type: null }],
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/plugins/workbench/managed-files') {
        return new Response(JSON.stringify(recovered), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(failure), { status: 403, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    installManagedFilesListing();

    const response = await fetch('/api/files');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(recovered);
    expect(fetcher).toHaveBeenLastCalledWith('/api/plugins/workbench/managed-files', undefined);
  });
  it('recovers an explicit /opt/data root before native metadata is known', async () => {
    window.history.replaceState(null, '', '/files');
    const failure = { detail: 'Path outside managed files root' };
    const recovered = {
      root: '/opt/data', locked_root: '/opt/data', can_change_path: false,
      path: '/opt/data', parent: null,
      entries: [
        { name: 'workspace', path: '/opt/data/workspace', is_directory: true, size: null, mtime: 1, mime_type: null },
      ],
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/plugins/workbench/managed-files')) {
        return new Response(JSON.stringify(recovered), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(failure), { status: 403, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    installManagedFilesListing();

    const response = await fetch('/api/files?path=%2Fopt%2Fdata');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(recovered);
    expect(fetcher).toHaveBeenLastCalledWith('/api/plugins/workbench/managed-files?path=%2Fopt%2Fdata', undefined);
  });
  it('discovers a configured dashboard.workbench.root instead of hardcoding /opt/data', async () => {
    window.history.replaceState(null, '', '/files');
    const failure = { detail: 'Path outside managed files root' };
    const recovered = {
      root: '/srv/hermes-workbench', locked_root: '/srv/hermes-workbench', can_change_path: false,
      path: '/srv/hermes-workbench', parent: null,
      entries: [{ name: 'configs', path: '/srv/hermes-workbench/configs', is_directory: true, size: null, mtime: 1, mime_type: null }],
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/plugins/workbench/managed-files')) {
        return new Response(JSON.stringify(recovered), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(failure), { status: 403, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    installManagedFilesListing();

    const response = await fetch('/api/files?path=%2Fsrv%2Fhermes-workbench');
    expect(response.status).toBe(200);
    expect((await response.json() as typeof recovered).root).toBe('/srv/hermes-workbench');
    expect(fetcher).toHaveBeenLastCalledWith('/api/plugins/workbench/managed-files?path=%2Fsrv%2Fhermes-workbench', undefined);
  });
  it('keeps real out-of-root and child paths rejected', async () => {
    window.history.replaceState(null, '', '/files');
    const failure = { detail: 'Path outside managed files root' };
    const childListing = { root: '/opt/data', locked_root: '/opt/data', path: '/opt/data/workspace', parent: '/opt/data', entries: [] };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/plugins/workbench/managed-files')
        && String(input).includes('path=%2Fopt%2Fdata%2Fworkspace')) {
        return new Response(JSON.stringify(childListing), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(failure), { status: 403, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    installManagedFilesListing();

    const statuses: Record<string, number> = {};
    for (const path of ['%2Fopt%2Fshared-auth', '%2Fetc', '%2Fopt%2Fdata%2Fworkspace', '..%2Foutside']) {
      const response = await fetch(`/api/files?path=${path}`);
      statuses[path] = response.status;
      expect(await response.json()).toEqual(failure);
    }
    expect(statuses).toEqual(Object.fromEntries(Object.keys(statuses).map(path => [path, 403])));
    expect(fetcher.mock.calls.some(([input]) => String(input).startsWith('/api/plugins/workbench/managed-files')
      && String(input).includes('path=..%2Foutside'))).toBe(false);
  });
  it('removes the stale managed-root banner after a successful recovery', async () => {
    window.history.replaceState(null, '', '/files');
    document.body.innerHTML = `
      <div role="alert"><div class="text-destructive">Path outside managed files root</div></div>
      <button aria-label="Upload files"><span title="">Loading</span></button>`;
    const failure = { detail: 'Path outside managed files root' };
    const recovered = { root: '/opt/data', locked_root: '/opt/data', path: '/opt/data', parent: null, entries: [] };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/plugins/workbench/managed-files')) {
        return new Response(JSON.stringify(recovered), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(failure), { status: 403, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    installManagedFilesListing();

    expect((await fetch('/api/files?path=%2Fopt%2Fdata')).status).toBe(200);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Upload files"] span')?.textContent).toBe('Loading');
  });
  it('ends the native loading label when a listing error is shown', () => {
    window.history.replaceState(null, '', '/files');
    document.body.innerHTML = `
      <div class="text-destructive">Path outside managed files root</div>
      <button aria-label="Upload files"><span title="">Loading</span></button>`;

    expect(settleFilesLoadingLabel()).toBe(true);
    expect(document.querySelector('button[aria-label="Upload files"] span')?.textContent).toBe('Unavailable');

    expect(clearManagedListingError()).toBe(true);
    expect(document.querySelector('div.text-destructive')).toBeNull();
    expect(document.querySelector('button[aria-label="Upload files"] span')?.textContent).toBe('Loading');

    document.body.innerHTML = '<button aria-label="Upload files"><span title="">Loading</span></button>';
    expect(settleFilesLoadingLabel()).toBe(false);
  });
  it.each(['README.md', 'notes.txt', 'picture.png', 'paper.pdf', 'archive.zip'])('offers original-byte download for %s', async name => {
    const create = vi.fn(() => 'blob:test-download');
    vi.spyOn(URL, 'createObjectURL').mockImplementation(create);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const blob = new Blob(['original bytes']);
    const body = showFilePreviewLoading(name);
    const overlay = document.getElementById('hti-file-preview')!;
    // happy-dom cannot navigate a blob PDF; native browser coverage checks attached UI.
    if (name.endsWith('.pdf')) overlay.remove();
    await openFilePreview(name, blob, '', body);
    const link = overlay.querySelector<HTMLAnchorElement>('header a[download]');
    expect(link?.download).toBe(name);
    expect(link?.href).toBe('blob:test-download');
    expect(create).toHaveBeenCalledWith(blob);
    closeFilePreview();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
    vi.restoreAllMocks();
  });
});
