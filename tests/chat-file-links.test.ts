// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localFilePath, installChatFileLinks, openChatFilePreview } from '../dashboard/src/chat-file-links';
import { closeFilePreview } from '../dashboard/src/file-preview';
import { readManagedFile } from '../dashboard/src/files-preview';
vi.mock('../dashboard/src/files-preview', async importOriginal => ({ ...await importOriginal<typeof import('../dashboard/src/files-preview')>(), readManagedFile: vi.fn() }));
afterEach(() => { closeFilePreview(); document.body.replaceChildren(); vi.resetAllMocks(); });

describe('file references without filesystem prefix restrictions', () => {
  const root = '/srv/project';
  it('resolves arbitrary roots, extensions, encoded names and line references', () => {
    for (const path of ['/srv/projects/README.md', '/etc/hosts', '/srv/LICENSE', '/opt/data/artifacts/report.md', '/custom/report.xyz']) {
      expect(localFilePath(path, root)).toBe(path);
      expect(localFilePath(`${path}:12:2`, root)).toBe(path);
      expect(localFilePath(`file://${path}`, root)).toBe(path);
    }
    expect(localFilePath('docs/../中文%20报告.md', root)).toBe('/srv/project/中文 报告.md');
    expect(localFilePath('../README.md', root)).toBe('/srv/README.md');
    expect(localFilePath('sandbox:/mnt/data/result.pdf', root)).toBe('/mnt/data/result.pdf');
    expect(localFilePath('file://localhost/etc/hosts', root)).toBe('/etc/hosts');
    expect(localFilePath('file:///config/README.md', root)).toBe('/config/README.md');
  });
  it('keeps web URLs, routes, fragments and invalid references out of file reads', () => {
    for (const href of ['https://example.com/a.md', 'http://localhost/chat', '//example.com/a.pdf', '#title', '?profile=a', '/chat', '/plugins/kanban', '/api/files/read', '/x/../chat', 'javascript:alert(1)', 'mailto:a@b.com', 'file://server/share', '%invalid', '/a%00b', 'blob:abc']) {
      expect(localFilePath(href, root), href).toBeNull();
    }
  });
  it('captures only content links and uses the nearest document base', () => {
    document.body.innerHTML = '<nav><a href="/srv/report.md">Nav</a></nav><section data-file-base="/other/project"><div class="hti-rich-markdown"><a href="../report.md"><span>Report</span></a><a href="/chat">Chat</a><a href="/srv/report.md" download>Download</a></div></section>';
    const open = vi.fn(); const router = vi.fn();
    const cleanup = installChatFileLinks(root, open);
    document.addEventListener('click', router);
    const dispatch = (selector: string) => document.querySelector(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    try {
      expect(dispatch('span')).toBe(false);
      expect(open).toHaveBeenCalledWith('/other/report.md', expect.any(HTMLElement));
      expect(router).not.toHaveBeenCalled();
      dispatch('nav a'); dispatch('a[href="/chat"]'); dispatch('a[download]');
      expect(open).toHaveBeenCalledTimes(1);
      expect(router).toHaveBeenCalledTimes(3);
    } finally { cleanup(); document.removeEventListener('click', router); }
  });
  it('does not reopen a preview closed before a file read finishes', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(readManagedFile).mockReturnValue(new Promise(r => { resolve = r; }));
    const pending = openChatFilePreview('/srv/slow.txt');
    closeFilePreview();
    resolve({ name: 'slow.txt', blob: new Blob(['late']), mime: 'text/plain' });
    await pending;
    expect(document.getElementById('hti-file-preview')).toBeNull();
  });
  it('keeps an older response from replacing a newer preview', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(readManagedFile).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = openChatFilePreview('/srv/old.txt');
    vi.mocked(readManagedFile).mockRejectedValueOnce(new Error('路径不存在'));
    await openChatFilePreview('/srv/new.txt');
    resolve({ name: 'old.txt', blob: new Blob(['old']), mime: 'text/plain' }); await first;
    expect(document.getElementById('hti-file-preview')?.textContent).toContain('路径不存在');
    expect(document.getElementById('hti-file-preview')?.textContent).toContain('/srv/new.txt');
  });
});
it('opens a verified directory in Files and closes its loading overlay', async () => {
  const { ManagedDirectory } = await import('../dashboard/src/files-preview');
  window.history.replaceState(null, '', '/chat?profile=default&session=example');
  vi.mocked(readManagedFile).mockRejectedValue(new ManagedDirectory('/repo.with.dots'));
  await openChatFilePreview('/repo.with.dots');
  expect(window.location.pathname).toBe('/files');
  expect(new URLSearchParams(window.location.search).get('path')).toBe('/repo.with.dots');
  expect(new URLSearchParams(window.location.search).get('profile')).toBe('default');
  expect(document.getElementById('hti-file-preview')).toBeNull();
});

it('returns through nested files with scroll, document base and downloads intact', async () => {
  vi.mocked(readManagedFile).mockImplementation(async path => ({
    name: path, blob: new Blob(['# Document\n\n[Next](child.md)']), mime: 'text/markdown',
  }));
  await openChatFilePreview('/srv/docs/root.md');
  const root = document.querySelector<HTMLElement>('.hti-file-preview-body')!;
  root.scrollTop = 240;
  const rootDownload = document.querySelector<HTMLAnchorElement>('a[download]')!.href;
  await openChatFilePreview('/srv/docs/child.md', root.querySelector('a')!);
  const child = document.querySelector<HTMLElement>('.hti-file-preview-body')!;
  await openChatFilePreview('/srv/docs/deeper.md', child.querySelector('a')!);
  document.querySelector<HTMLButtonElement>('.hti-file-preview-back')!.click();
  expect(document.querySelector('.hti-file-preview-body')).toBe(child);
  document.querySelector<HTMLButtonElement>('.hti-file-preview-back')!.click();
  expect(document.querySelector('.hti-file-preview-body')).toBe(root);
  expect(root.scrollTop).toBe(240);
  expect(root.dataset.fileBase).toBe('/srv/docs');
  expect(document.querySelector<HTMLAnchorElement>('a[download]')!.href).toBe(rootDownload);
  expect(document.querySelector('.hti-file-preview-back')).toBeNull();
  expect(readManagedFile).toHaveBeenCalledTimes(3);
});

it('can return from failed and pending reads without a late response replacing the parent', async () => {
  vi.mocked(readManagedFile).mockResolvedValueOnce({ name: 'root.md', blob: new Blob(['[Next](child.md)']), mime: 'text/markdown' });
  await openChatFilePreview('/srv/root.md');
  const root = document.querySelector<HTMLElement>('.hti-file-preview-body')!;
  vi.mocked(readManagedFile).mockRejectedValueOnce(new Error('Unavailable'));
  await openChatFilePreview('/srv/missing.md', root.querySelector('a')!);
  expect(document.querySelector('.hti-file-preview-body')?.textContent).toContain('Unavailable');
  document.querySelector<HTMLButtonElement>('.hti-file-preview-back')!.click();
  let resolve!: (value: any) => void;
  vi.mocked(readManagedFile).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const pending = openChatFilePreview('/srv/slow.md', root.querySelector('a')!);
  document.querySelector<HTMLButtonElement>('.hti-file-preview-back')!.click();
  resolve({ name: 'slow.md', blob: new Blob(['late']), mime: 'text/markdown' });
  await pending;
  expect(document.querySelector('.hti-file-preview-body')).toBe(root);
  closeFilePreview();
  vi.mocked(readManagedFile).mockRejectedValueOnce(new Error('Unavailable'));
  await openChatFilePreview('/srv/new.md');
  expect(document.querySelector('.hti-file-preview-back')).toBeNull();
});
