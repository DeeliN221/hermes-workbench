/** Reconcile stale gateway states with the current channel enablement. */
interface Channel { id: string; enabled: boolean }
interface GatewayStatus { gateway_platforms?: Record<string, { state?: string }>; [key: string]: unknown }

export function reconcilePlatformStatus(status: GatewayStatus, channels: Channel[]): GatewayStatus {
  const disabled = new Set(channels.filter(channel => channel.enabled === false).map(channel => channel.id));
  if (!status.gateway_platforms) return status;
  return { ...status, gateway_platforms: Object.fromEntries(
    Object.entries(status.gateway_platforms).filter(([name, info]) => !disabled.has(name) && info?.state !== 'disabled'),
  ) };
}

export function installPlatformStatusReconciliation(): void {
  const target = window as unknown as Record<string, unknown>;
  const marker = '__HERMES_WORKBENCH_PLATFORM_STATUS__';
  if (target[marker]) return;
  target[marker] = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    const response = await nativeFetch(input, init);
    if (url.origin !== window.location.origin || url.pathname !== '/api/status'
      || (init?.method || request?.method || 'GET').toUpperCase() !== 'GET' || !response.ok) return response;
    try {
      const status = await response.clone().json() as GatewayStatus;
      if (!status.gateway_platforms || !Object.keys(status.gateway_platforms).length) return response;
      const channelsUrl = new URL('/api/messaging/platforms', url.origin);
      // Keep profile and authentication scope identical to the status request.
      channelsUrl.search = url.search;
      const headers = new Headers(init?.headers ?? request?.headers);
      const signal = AbortSignal.timeout(2500);
      const channelsResponse = await nativeFetch(channelsUrl, {
        method: 'GET', headers, credentials: init?.credentials ?? request?.credentials, signal,
      });
      if (!channelsResponse.ok) return response;
      const data = await channelsResponse.json();
      if (!Array.isArray(data.platforms)) return response;
      const body = reconcilePlatformStatus(status, data.platforms);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('content-length');
      responseHeaders.delete('content-encoding');
      return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers: responseHeaders });
    } catch {
      // A config lookup failure must never conceal a real connection failure.
      return response;
    }
  };
}

installPlatformStatusReconciliation();
