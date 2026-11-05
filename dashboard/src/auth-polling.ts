/** Stop Workbench network polling after expiry; only an explicit retry probes auth. */
export function installAuthPollingGuard(): void {
  const host = window as Window & { __workbenchAuthGuard?: boolean };
  if (host.__workbenchAuthGuard) return;
  host.__workbenchAuthGuard = true;
  const nativeFetch = window.fetch.bind(window);
  let paused = false;
  let notice: HTMLElement | undefined;
  const expired = () => new Error('auth_required: 登录已失效，请重新登录');
  const show = () => {
    if (notice) return;
    notice = document.createElement('aside');
    notice.id = 'workbench-auth-required';
    notice.setAttribute('role', 'alert');
    notice.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#222;color:white;padding:16px;border:1px solid #aaa;border-radius:8px';
    const message = document.createElement('span');
    message.textContent = '登录已失效，请重新登录';
    const login = document.createElement('a');
    login.href = '/'; login.target = '_blank'; login.rel = 'noopener';
    login.textContent = '重新登录'; login.style.margin = '0 12px';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = '手动重试';
    retry.onclick = async () => {
      retry.disabled = true;
      try {
        const response = await nativeFetch('/api/plugins/workbench/capabilities', {
          credentials: 'same-origin', redirect: 'manual', signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          paused = false; notice?.remove(); notice = undefined;
          window.dispatchEvent(new Event('workbench:auth-restored'));
        }
      } catch { /* Keep the single notice and let the user retry. */ }
      finally { retry.disabled = false; }
    };
    notice.append(message, login, retry);
    (document.body || document.documentElement).append(notice);
  };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin || !/^\/api\/plugins\/workbench(?:\/|$)/.test(url.pathname)) return nativeFetch(input, init);
    if (paused) throw expired();
    const response = await nativeFetch(input, { credentials: 'same-origin', ...init, redirect: 'manual' });
    // Authelia may redirect fetches to login instead of returning a JSON 401.
    if (response.status === 401 || response.type === 'opaqueredirect' || [301, 302, 303, 307, 308].includes(response.status)) {
      paused = true; show(); throw expired();
    }
    return response;
  };
}
