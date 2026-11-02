import './quota-dashboard.css';

type Entry = {
  id: string; name: string; service: string; plan: string; adapter: 'manual' | 'codex' | 'unsupported';
  preset: string | null; enabled: boolean; minutes: number; resetsAt: string | null;
  amount: number | null; limit: number | null; mode: 'remaining' | 'used'; unit: string; observedAt: string | null;
};
type WindowQuota = { label?: string; minutes: number; remainingPercent: number; resetsAt: string | null };
type Provider = Pick<Entry, 'id' | 'name' | 'service' | 'plan' | 'adapter' | 'enabled'> & {
  description?: string; source?: string; status: string; reason: string; windows: WindowQuota[]; updatedAt: string | null; checkedAt: string | null;
  manual?: Pick<Entry, 'amount' | 'limit' | 'mode' | 'unit' | 'minutes' | 'resetsAt'>;
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
  article.append(element('h3', provider.name || provider.id), element('p', [provider.service, provider.plan].filter(Boolean).join(' · ')));
  if (provider.description) article.append(element('p', provider.description));
  if (provider.source) article.append(element('p', `Source: ${provider.source}`));
  const statuses: Record<string, string> = { available: 'Available', disabled: 'Disabled', timeout: 'Timed out',
    error: 'Refresh failed', login_required: 'Login required', configuration_error: 'Configuration required',
    command_missing: 'Install agy', empty: 'Empty response', invalid: 'Unrecognized response', subscription_required: 'Subscription required', access_denied: 'Access denied' };
  const badge = element('strong', statuses[provider.status] || 'Unavailable');
  badge.className = `quota-status quota-${provider.status}`;
  article.append(badge);
  if (provider.status !== 'available') article.append(element('p', provider.reason));
  const windows = element('div');
  windows.className = 'quota-windows';
  const durations = provider.adapter === 'manual' || provider.status === 'disabled' ? [] : [...new Set([300, 10080, ...(provider.source?.startsWith('OpenCode Go') ? [43200] : []), ...provider.windows.map(w => w.minutes)])];
  if (provider.manual) {
    const manual = provider.manual;
    const row = element('section');
    row.append(element('h4', windowLabel(manual.minutes)), element('strong', `${manual.amount} ${manual.unit} ${manual.mode === 'used' ? 'used' : 'remaining'}`));
    if (manual.limit !== null) row.append(element('small', `Total allowance: ${manual.limit} ${manual.unit}`));
    row.append(element('small', `Reset: ${timestamp(manual.resetsAt)}`));
    windows.append(row);
  }
  for (const duration of durations) {
    const quota = provider.windows.find(w => w.minutes === duration);
    const row = element('section');
    row.append(element('h4', quota?.label || (duration === 300 && provider.source?.startsWith('OpenCode Go') ? 'Rolling window' : windowLabel(duration))));
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
  article.append(windows);
  if (provider.status === 'available') article.append(element('p', provider.reason));
  article.append(element('small', `Updated: ${timestamp(provider.updatedAt)}`), element('small', `Last checked: ${timestamp(provider.checkedAt)}`));
  return article;
}

function windowLabel(minutes: number): string {
  return minutes === 300 ? '5-hour window' : minutes === 10080 ? 'Weekly window' : minutes === 43200 ? 'Monthly window' : `${minutes}-minute window`;
}

export function mountQuotaDashboard(container: HTMLElement, fetcher: typeof fetch = window.fetch.bind(window)): () => void {
  const heading = element('h2', 'Subscription allowances');
  const subtitle = element('p', 'Default Workbench profile · Provider reports and clearly labeled manual entries. Unavailable does not mean zero.');
  const refresh = element('button', 'Refresh'); refresh.type = 'button';
  const add = element('button', 'Add subscription'); add.type = 'button'; add.disabled = true;
  const toolbar = element('div'); toolbar.className = 'quota-actions'; toolbar.append(refresh, add);
  const status = element('p'); status.setAttribute('role', 'status');
  const editor = element('div');
  const grid = element('div'); grid.className = 'quota-grid';
  container.append(heading, subtitle, toolbar, status, editor, grid);
  let controller: AbortController | undefined;
  let disposed = false;
  let entries: Entry[] = [];
  let presets: Entry[] = [];
  let providers: Provider[] = [];
  let revision = 0;
  let configured = false;
  const endpoint = '/api/plugins/workbench/quotas';

  function button(label: string, action: () => void): HTMLButtonElement {
    const node = element('button', label); node.type = 'button'; node.onclick = action; return node;
  }
  function busy(value: boolean) {
    container.setAttribute('aria-busy', String(value));
    container.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = value; });
    add.disabled = value || !configured;
  }
  function render() {
    grid.replaceChildren(...providers.map(provider => {
      const article = card(provider);
      const entry = entries.find(e => e.id === provider.id);
      if (entry) {
        const actions = element('div'); actions.className = 'quota-actions';
        actions.append(button('Edit', () => edit(entry)), button(entry.enabled ? 'Disable' : 'Enable', () => {
          void save(entries.map(e => e.id === entry.id ? { ...e, enabled: !e.enabled } : e));
        }), button('Delete', () => {
          const confirm = element('div'); confirm.className = 'quota-actions';
          confirm.append(element('span', `Delete ${entry.name}?`), button('Confirm delete', () => {
            void save(entries.filter(e => e.id !== entry.id));
          }), button('Cancel', render));
          actions.replaceChildren(confirm);
        }));
        const index = entries.indexOf(entry);
        const move = (delta: number) => {
          const next = [...entries];
          [next[index], next[index + delta]] = [next[index + delta], next[index]];
          void save(next);
        };
        if (index > 0) actions.append(button('Move up', () => move(-1)));
        if (index < entries.length - 1) actions.append(button('Move down', () => move(1)));
        article.append(actions);
      }
      return article;
    }));
    if (!providers.length) grid.append(element('p', 'No subscriptions. Add an entry to track an allowance.'));
  }
  function edit(existing?: Entry, template?: Entry, sourceId = 'manual') {
    const entry: Entry = existing || template || { id: crypto.randomUUID(), name: '', service: '', plan: '', adapter: 'manual', preset: null,
      enabled: true, minutes: 300, resetsAt: null, amount: null, limit: null, mode: 'remaining', unit: 'credits', observedAt: null };
    const form = element('form'); form.className = 'quota-editor';
    form.append(element('h3', existing ? 'Edit subscription' : 'New subscription'));
    const field = (name: string, value: string, type = 'text', required = false, maxLength = 120) => {
      const label = element('label', name); const input = element('input');
      input.type = type; input.value = value; input.required = required; input.maxLength = maxLength;
      if (type === 'number') { input.min = '0'; input.step = 'any'; }
      label.append(input); form.append(label); return input;
    };
    const select = (name: string, options: [string, string][], value: string) => {
      const label = element('label', name); const input = element('select');
      input.setAttribute('aria-label', name);
      for (const [key, text] of options) { const option = element('option', text); option.value = key; input.append(option); }
      input.value = value; label.append(input); form.append(label); return input;
    };
    if (!existing && presets.length) {
      const source = select('Entry source', [['manual', 'Custom manual entry'], ...presets.map(p => [p.id, p.name] as [string, string])], sourceId);
      source.onchange = () => {
        const preset = presets.find(p => p.id === source.value);
        edit(undefined, preset ? { ...preset, id: crypto.randomUUID() } : undefined, preset?.id);
      };
    }
    const name = field('Display name', entry.name, 'text', true);
    const service = field('Provider / service', entry.service, 'text', true);
    const plan = field('Plan / account label', entry.plan);
    form.append(element('p', entry.adapter === 'manual' ? 'Manual values only. Never enter credentials or API keys.' :
      'Built-in adapter. Entries use existing server connections; labels do not switch accounts.'));
    let minutes: HTMLSelectElement | undefined, reset: HTMLInputElement | undefined, amount: HTMLInputElement | undefined;
    let limit: HTMLInputElement | undefined, mode: HTMLSelectElement | undefined, unit: HTMLInputElement | undefined;
    if (entry.adapter === 'manual') {
      minutes = select('Allowance window', [['300', '5 hours'], ['10080', 'Weekly'], ['43200', 'Monthly']], String(entry.minutes));
      reset = field('Reset time (local time)', entry.resetsAt ? localTime(entry.resetsAt) : '', 'datetime-local');
      mode = select('Value represents', [['remaining', 'Remaining balance'], ['used', 'Used allowance']], entry.mode);
      amount = field('Manual value', entry.amount === null ? '' : String(entry.amount), 'number');
      limit = field('Total allowance (optional)', entry.limit === null ? '' : String(entry.limit), 'number');
      unit = field('Unit', entry.unit, 'text', true, 40);
      form.append(element('p', 'Empty value means unavailable. After the reset time, the value is hidden until you update it. Monthly is a label; reset dates are explicit.'));
    }
    const enabled = field('Enabled', '', 'checkbox'); enabled.checked = entry.enabled;
    const actions = element('div'); actions.className = 'quota-actions';
    const submit = element('button', 'Save subscription'); submit.type = 'submit';
    actions.append(submit, button('Cancel', () => { editor.replaceChildren(); add.focus(); })); form.append(actions);
    form.onsubmit = event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const updated: Entry = { ...entry, name: name.value.trim(), service: service.value.trim(), plan: plan.value.trim(), enabled: enabled.checked };
      if (amount && limit && mode && unit && minutes && reset) {
        Object.assign(updated, { amount: amount.value === '' ? null : Number(amount.value), limit: limit.value === '' ? null : Number(limit.value),
          mode: mode.value, unit: unit.value.trim(), minutes: Number(minutes.value), resetsAt: reset.value ? new Date(reset.value).toISOString() : null });
      }
      void save(existing ? entries.map(e => e.id === entry.id ? updated : e) : [...entries, updated]);
    };
    editor.replaceChildren(form); name.focus();
  }
  async function save(next: Entry[]) {
    if (controller || disposed) return;
    controller = new AbortController(); busy(true);
    const timeout = window.setTimeout(() => controller?.abort(), 12000);
    status.textContent = 'Saving…';
    let saved = false;
    try {
      const response = await fetcher(`${endpoint}/entries?profile=default`, {
        method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, entries: next }),
      });
      if (response.status === 409) { status.textContent = 'Subscriptions changed in another tab. Refresh before saving again.'; return; }
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (disposed) return;
      entries = data.entries; revision = data.revision; editor.replaceChildren(); saved = true;
    } catch {
      if (!disposed) status.textContent = 'Save failed. Check values and connection. Refresh to verify before retrying.';
    } finally { clearTimeout(timeout); controller = undefined; if (!disposed) busy(false); }
    if (saved) await load(true);
  }
  async function load(force = false): Promise<void> {
    if (controller || disposed) return;
    controller = new AbortController();
    const timeout = window.setTimeout(() => controller?.abort(), 30000);
    busy(true); status.textContent = 'Refreshing…';
    try {
      const response = await fetcher(`${endpoint}?profile=default${force ? '&refresh=true' : ''}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.providers) || !data.providers.every((p: Provider) => typeof p.id === 'string' && Array.isArray(p.windows))) throw new Error();
      if (disposed) return;
      providers = data.providers;
      configured = Array.isArray(data.entries) && Number.isInteger(data.revision);
      if (configured) { entries = data.entries; revision = data.revision; presets = Array.isArray(data.presets) ? data.presets : []; }
      editor.replaceChildren(); render();
      status.textContent = `Refresh complete · ${providers.filter(p => p.status === 'available').length} of ${providers.length} providers available`;
    } catch {
      if (disposed) return;
      // Drop all stale numerical values, including manually entered balances.
      providers = providers.map(p => ({ ...p, status: 'unavailable', reason: 'Dashboard request failed or timed out. Retry using Refresh.', windows: [], manual: undefined, updatedAt: null, checkedAt: null }));
      render(); status.textContent = 'Refresh failed · Retry available';
    } finally { clearTimeout(timeout); controller = undefined; if (!disposed) busy(false); }
  }
  refresh.onclick = () => { void load(true); };
  add.onclick = () => edit();
  void load();
  return () => { disposed = true; controller?.abort(); };
}

function localTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Use the existing settings route lifecycle to abort requests when leaving the page. */
export function createQuotaSettings(sdk: any) {
  const { useEffect, useRef } = sdk.hooks;
  return function QuotaSettings() {
    const ref = useRef(null as HTMLElement | null);
    useEffect(() => {
      const node = ref.current;
      if (!node) return;
      const dispose = mountQuotaDashboard(node);
      return () => { dispose(); node.replaceChildren(); };
    }, []);
    return sdk.React.createElement('section', { ref, className: 'workbench-settings-subpage quota-settings' });
  };
}
