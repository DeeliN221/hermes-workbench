// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readManagedFile } from '../dashboard/src/files-preview';
beforeEach(() => { document.documentElement.lang = 'zh-CN'; });
afterEach(() => { delete (window as any).__HERMES_PLUGIN_SDK__; vi.unstubAllGlobals(); vi.useRealTimers(); });
function respond(response: unknown) {
  (window as any).__HERMES_PLUGIN_SDK__ = { authedFetch: vi.fn().mockResolvedValue(response) };
}
it.each([[401, '登录已失效'], [403, '没有读取权限'], [404, '路径不存在'], [413, '文件过大']])('reports HTTP %s without navigation', async (status, message) => {
  respond({ ok: false, status });
  await expect(readManagedFile('/any/path')).rejects.toThrow(message as string);
});
it('rejects a login HTML response and a non-data content URL', async () => {
  respond({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) });
  await expect(readManagedFile('/any/path')).rejects.toThrow('文件接口未返回有效数据');
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  respond({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ name: 'report.md', data_url: 'https://elsewhere.test/content' }) });
  await expect(readManagedFile('/any/path')).rejects.toThrow('文件内容无效');
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps the timeout active while reading the response body', async () => {
  vi.useFakeTimers();
  (window as any).__HERMES_PLUGIN_SDK__ = { authedFetch: async (_url: string, { signal }: { signal: AbortSignal }) => ({
    ok: true, headers: new Headers({ 'content-type': 'application/json' }),
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  }) };
  const check = expect(readManagedFile('/slow/file')).rejects.toThrow('文件读取超时');
  await vi.advanceTimersByTimeAsync(15000); await check;
});
it('classifies directories only after successful native directory listing', async () => {
  const { ManagedDirectory } = await import('../dashboard/src/files-preview');
  const authedFetch = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ detail: 'Path is not a file' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ path: '/repo.with.dots', entries: [] }) });
  (window as any).__HERMES_PLUGIN_SDK__ = { authedFetch };
  await expect(readManagedFile('/repo.with.dots')).rejects.toBeInstanceOf(ManagedDirectory);
  expect(authedFetch.mock.calls[1][0]).toBe('/api/files?path=%2Frepo.with.dots');
});
it('does not open Files when directory listing is forbidden', async () => {
  const authedFetch = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ detail: 'Path is not a file' }) })
    .mockResolvedValueOnce({ ok: false, status: 403 });
  (window as any).__HERMES_PLUGIN_SDK__ = { authedFetch };
  await expect(readManagedFile('/restricted')).rejects.toThrow('目录读取失败（403）');
});
