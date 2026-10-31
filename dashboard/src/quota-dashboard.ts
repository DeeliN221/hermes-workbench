import './quota-dashboard.css';

type WindowQuota = { minutes: number; remainingPercent: number; resetsAt: string | null };
type Provider = { id: string; status: string; reason: string; windows: WindowQuota[]; updatedAt: string | null; checkedAt: string | null };
const names: Record<string, string> = { opencode: 'OpenCode Go', gemini: 'Gemini AI Pro', openai: 'OpenAI ChatGPT Pro' };
const descriptions: Record<string, string> = {
  opencode: 'Per-model subscription allowance', gemini: 'Supported model quotas only',
  openai: 'User label: “200x” · Codex allowance only · Plan unverified',
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}
function timestamp(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unavailable';
}
function card(provider: Provider): HTMLElement {
  const article = element('article');
  article.className = 'quota-card';
  article.append(element('h3', names[provider.id]), element('p', descriptions[provider.id]));
  const badge = element('strong', provider.status === 'available' ? 'Available' : provider.status === 'timeout' ? 'Timed out' : provider.status === 'error' ? 'Refresh failed' : 'Unavailable');
  badge.className = `quota-status quota-${provider.status}`;
  article.append(badge);
  const windows = element('div');
  windows.className = 'quota-windows';
  const durations = [...new Set([300, 10080, ...provider.windows.map(w => w.minutes)])];
  for (const duration of durations) {
    const quota = provider.windows.find(w => w.minutes === duration);
    const row = element('section');
    row.append(element('h4', duration === 300 ? '5-hour window' : duration === 10080 ? 'Weekly window' : `${duration}-minute window`));
    row.append(element('strong', quota ? `${quota.remainingPercent}% remaining` : 'Unavailable'));
    if (quota) {
      const meter = element('meter');
      meter.min = 0; meter.max = 100; meter.value = quota.remainingPercent;
      meter.setAttribute('aria-label', `${duration}-minute remaining allowance`);
      row.append(meter);
    }
    row.append(element('small', `Reset: ${timestamp(quota?.resetsAt || null)}`));
    if (!quota) row.append(element('small', 'No verified data for this window.'));
    windows.append(row);
  }
  article.append(windows, element('p', provider.reason), element('small', `Updated: ${timestamp(provider.updatedAt)}`), element('small', `Last checked: ${timestamp(provider.checkedAt)}`));
  return article;
}

export function mountQuotaDashboard(container: HTMLElement, fetcher: typeof fetch = window.fetch.bind(window)): () => void {
  const heading = element('h2', 'Subscription allowances');
  const subtitle = element('p', 'Default Workbench profile · Provider-reported data only. Unavailable does not mean zero.');
  const refresh = element('button', 'Refresh');
  refresh.type = 'button';
  const status = element('p');
  status.setAttribute('role', 'status');
  const grid = element('div'); grid.className = 'quota-grid';
  const placeholder = (reason: string) => Object.keys(names).map(id => card({ id, status: 'unavailable', reason, windows: [], updatedAt: null, checkedAt: null }));
  grid.replaceChildren(...placeholder('Waiting for a quota check.'));
  container.append(heading, subtitle, refresh, status, grid);
  let controller: AbortController | undefined;
  let disposed = false;
  async function load(force = false): Promise<void> {
    if (controller || disposed) return;
    controller = new AbortController();
    const timeout = window.setTimeout(() => controller?.abort(), 12000);
    refresh.disabled = true;
    status.textContent = 'Refreshing…';
    container.setAttribute('aria-busy', 'true');
    try {
      const response = await fetcher(`/api/plugins/workbench/quotas?profile=default${force ? '&refresh=true' : ''}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json() as { providers: Provider[] };
      if (!Array.isArray(data.providers) || Object.keys(names).some(id => !data.providers.some(p => p.id === id && Array.isArray(p.windows)))) throw new Error('invalid');
      if (disposed) return;
      grid.replaceChildren(...Object.keys(names).map(id => card(data.providers.find(p => p.id === id)!)));
      status.textContent = `Refresh complete · ${data.providers.filter(p => p.status === 'available').length} of 3 providers available`;
    } catch {
      if (disposed) return;
      // Drop stale numbers after failed refresh, rather than showing them as current.
      grid.replaceChildren(...placeholder('Dashboard request failed or timed out. Retry using Refresh; no current allowance is confirmed.'));
      status.textContent = 'Refresh failed · Retry available';
    } finally {
      clearTimeout(timeout); controller = undefined;
      if (!disposed) { refresh.disabled = false; container.setAttribute('aria-busy', 'false'); }
    }
  }
  refresh.onclick = () => { void load(true); };
  void load();
  return () => { disposed = true; controller?.abort(); };
}

export function installQuotaDashboard(): void {
  let scheduled = false;
  const mount = () => {
    scheduled = false;
    const header = document.querySelector('.workbench-home-actions');
    if (!header || header.querySelector('[data-quota-open]')) return;
    const button = element('button', 'Allowances');
    button.type = 'button'; button.dataset.quotaOpen = 'true'; button.className = 'quota-open';
    button.onclick = () => {
      if (document.querySelector('.quota-dialog')) return;
      const dialog = element('dialog'); dialog.className = 'quota-dialog';
      dialog.setAttribute('aria-label', 'Subscription allowances');
      const close = element('button', 'Close'); close.type = 'button'; close.className = 'quota-close';
      close.onclick = () => dialog.close();
      const content = element('div'); dialog.append(close, content); document.body.append(dialog);
      const dispose = mountQuotaDashboard(content);
      dialog.addEventListener('close', () => { dispose(); dialog.remove(); button.focus(); }, { once: true });
      dialog.showModal();
    };
    header.append(button);
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(mount); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
}
