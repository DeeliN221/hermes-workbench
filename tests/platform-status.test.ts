// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { reconcilePlatformStatus, installPlatformStatusReconciliation } from '../dashboard/src/platform-status';

afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as Record<string, unknown>).__HERMES_WORKBENCH_PLATFORM_STATUS__; });

test('disabled channels disappear but enabled failures and unknown profiles remain', () => {
  const status = { gateway_state: 'running', gateway_platforms: {
    api_server: { state: 'disconnected' }, weixin: { state: 'fatal' },
    telegram: { state: 'disconnected' }, 'writer:weixin': { state: 'fatal' },
    slack: { state: 'disabled' },
  } };
  const result = reconcilePlatformStatus(status, [{ id: 'api_server', enabled: false }, { id: 'weixin', enabled: false }, { id: 'telegram', enabled: true }]);
  expect(Object.keys(result.gateway_platforms!)).toEqual(['telegram', 'writer:weixin']);
  expect(result.gateway_state).toBe('running');
  expect(Object.keys(status.gateway_platforms)).toHaveLength(5);
});

test('fetch uses current config, matching profile and auth; failed lookup preserves alerts', async () => {
  let enabled = false; let failure = false;
  const native = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.pathname === '/api/messaging/platforms') return failure ? new Response('', { status: 503 }) : Response.json({ platforms: [{ id: 'weixin', enabled }] });
    return Response.json({ gateway_platforms: { weixin: { state: 'disconnected' } } });
  });
  vi.stubGlobal('fetch', native); installPlatformStatusReconciliation();
  const input = new Request(new URL('/api/status?profile=writer', window.location.href), { headers: { Authorization: 'Bearer test' } });
  expect((await (await fetch(input)).json()).gateway_platforms).toEqual({});
  const [url, init] = native.mock.calls[1] as unknown as [URL, RequestInit];
  expect(url.searchParams.get('profile')).toBe('writer');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test');
  enabled = true;
  expect((await (await fetch(input)).json()).gateway_platforms.weixin.state).toBe('disconnected');
  enabled = false; failure = true;
  expect((await (await fetch(input)).json()).gateway_platforms.weixin.state).toBe('disconnected');
});
