import './quota-dashboard.css';
import { currentProfile } from './profile-scope';
import { uiText } from './ui-locale';

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
type Snapshot = {
  profile: string; providers: Provider[]; entries: Entry[]; revision: number; configured: boolean; presets: Entry[]; savedAt: string;
};

const CACHE_PREFIX = 'hermes.workbench.quota-cache.v1:';
const STATUS_LABELS: Record<string, string> = {
  available: 'Available', disabled: 'Disabled', timeout: 'Timed out', error: 'Refresh failed',
  login_required: 'Login required', configuration_error: 'Configuration required', command_missing: 'Install agy',
  empty: 'Empty response', invalid: 'Unrecognized response', subscription_required: 'Subscription required',
  access_denied: 'Access denied', unavailable: 'Unavailable',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}
function timestamp(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unavailable';
}
function updatedLabel(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable';
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function windowLabel(minutes: number): string {
  return minutes === 300 ? '5-hour window' : minutes === 10080 ? 'Weekly window' : minutes === 43200 ? 'Monthly window' : `${minutes}-minute window`;
}
function compactWindow(minutes: number): string {
  if (minutes === 300) return '5h';
  if (minutes === 10080) return uiText('周', 'Weekly');
  if (minutes === 43200) return uiText('月', 'Monthly');
  return `${minutes}m`;
}
function percent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}
function summary(provider: Provider): string {
  if (provider.manual?.amount !== null && provider.manual?.amount !== undefined) {
    const suffix = provider.manual.mode === 'used' ? 'used' : 'remaining';
    return `${provider.manual.amount} ${provider.manual.unit} ${suffix}`;
  }
  const windows = [...provider.windows].sort((a, b) => a.minutes - b.minutes);
  if (windows.length) return windows.map(window => `${compactWindow(window.minutes)} ${percent(window.remainingPercent)}`).join(' · ');
  return STATUS_LABELS[provider.status] || 'Unavailable';
}
function cacheKey(profile: string): string {
  return `${CACHE_PREFIX}${profile}`;
}
function readSnapshot(profile: string): Snapshot | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(profile)) || 'null') as Partial<Snapshot> | null;
    if (!value || value.profile !== profile || !Array.isArray(value.providers) || !Array.isArray(value.entries) || !Number.isInteger(value.revision)) return null;
    if (!value.providers.every(provider => provider && typeof provider.id === 'string' && typeof provider.name === 'string' && typeof provider.status === 'string' && Array.isArray(provider.windows))) return null;
    return {
      profile,
      providers: value.providers as Provider[],
      entries: value.entries as Entry[],
      revision: value.revision as number,
      configured: value.configured === true,
      presets: Array.isArray(value.presets) ? value.presets as Entry[] : [],
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString(),
    };
  } catch { return null; }
}
function writeSnapshot(snapshot: Snapshot): void {
  try { window.localStorage.setItem(cacheKey(snapshot.profile), JSON.stringify(snapshot)); } catch { /* Cache is optional. */ }
}

export function mountQuotaDashboard(
  container: HTMLElement,
  fetcher: typeof fetch = window.fetch.bind(window),
  options: { profile?: string } = {},
): () => void {
  const profile = options.profile || currentProfile();
  const heading = element('h2', 'Subscription allowances');
  const subtitle = element('p', `${profile} profile · Provider reports and clearly labeled manual entries. Unavailable does not mean zero.`);
  subtitle.className = 'quota-subtitle';
  const refresh = element('button', 'Refresh'); refresh.type = 'button';
  const add = element('button', 'Add subscription'); add.type = 'button';
  const toolbar = element('div'); toolbar.className = 'quota-toolbar'; toolbar.append(refresh, add);
  const status = element('p'); status.className = 'quota-statusline'; status.setAttribute('role', 'status');
  const errorBar = element('div'); errorBar.className = 'quota-error'; errorBar.hidden = true;
  const errorText = element('span');
  const retry = element('button', 'Retry'); retry.type = 'button';
  errorBar.append(errorText, retry);
  const editor = element('div');
  const updated = element('p'); updated.className = 'quota-updated'; updated.hidden = true;
  const list = element('div'); list.className = 'quota-list'; list.setAttribute('role', 'list');
  const drawerHost = element('div'); drawerHost.className = 'quota-drawer-host'; drawerHost.hidden = true;
  container.append(heading, subtitle, toolbar, status, errorBar, editor, updated, list, drawerHost);

  let controller: AbortController | undefined;
  let disposed = false;
  let entries: Entry[] = [];
  let presets: Entry[] = [];
  let providers: Provider[] = [];
  let revision = 0;
  let configured = false;
  let loading = false;
  let saving = false;
  let loaded = false;
  let lastUpdated: string | null = null;
  let error: string | null = null;
  let notice: string | null = null;
  const endpoint = '/api/plugins/workbench/quotas';
  const snapshot = readSnapshot(profile);
  if (snapshot) {
    providers = snapshot.providers;
    entries = snapshot.entries;
    revision = snapshot.revision;
    configured = snapshot.configured;
    presets = snapshot.presets;
    lastUpdated = snapshot.savedAt;
    loaded = true;
  }

  function button(label: string, action: () => void): HTMLButtonElement {
    const node = element('button', label); node.type = 'button'; node.onclick = action; return node;
  }
  function closeMenus(): void {
    container.querySelectorAll<HTMLElement>('.quota-menu').forEach(menu => { menu.hidden = true; });
    container.querySelectorAll<HTMLButtonElement>('.quota-row-menu-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
  }
  function statusLabel(provider: Provider): string {
    return STATUS_LABELS[provider.status] || 'Unavailable';
  }
  function renderChrome(): void {
    refresh.disabled = loading || saving;
    add.disabled = !configured || saving;
    updated.hidden = !lastUpdated || providers.length === 0;
    if (!updated.hidden) updated.textContent = `Updated ${updatedLabel(lastUpdated)}`;
    errorBar.hidden = !error;
    errorText.textContent = error || '';
    if (notice) { status.textContent = notice; return; }
    if (loading) { status.textContent = providers.length ? 'Refreshing in background…' : 'Loading subscriptions…'; return; }
    if (error) { status.textContent = providers.length ? `Refresh failed · Showing cached data from ${updatedLabel(lastUpdated)}` : 'Could not load subscriptions'; return; }
    if (!loaded) { status.textContent = 'Loading subscriptions…'; return; }
    status.textContent = `Refresh complete · ${providers.filter(provider => provider.status === 'available').length} of ${providers.length} providers available`;
  }
  function skeleton(): HTMLElement[] {
    return Array.from({ length: 3 }, (_, index) => {
      const rowItem = element('div'); rowItem.className = 'quota-skeleton-row'; rowItem.setAttribute('role', 'listitem'); rowItem.setAttribute('aria-hidden', 'true');
      const name = element('span'); name.className = 'quota-skeleton-line'; name.style.width = index === 1 ? '34%' : '42%';
      const value = element('span'); value.className = 'quota-skeleton-line quota-skeleton-value'; value.style.width = index === 2 ? '26%' : '32%';
      rowItem.append(name, value);
      return rowItem;
    });
  }
  function action(label: string, run: () => void, disabled = false): HTMLButtonElement {
    const item = button(label, () => { closeMenus(); run(); });
    item.className = 'quota-menu-item'; item.setAttribute('role', 'menuitem'); item.disabled = disabled;
    return item;
  }
  function row(provider: Provider, entry: Entry | undefined): HTMLElement {
    const item = element('div'); item.className = 'quota-row'; item.setAttribute('role', 'listitem');
    const open = element('button'); open.type = 'button'; open.className = 'quota-row-open';
    open.setAttribute('aria-label', `${provider.name || provider.id}: ${summary(provider)}. Open details.`);
    const name = element('strong', provider.name || provider.id); name.className = 'quota-row-name';
    const value = element('span', summary(provider)); value.className = 'quota-row-summary';
    open.append(name, value);
    open.onclick = () => openDrawer(provider, entry);
    const menuButton = element('button', '…'); menuButton.type = 'button'; menuButton.className = 'quota-row-menu-button';
    menuButton.setAttribute('aria-label', `Actions for ${provider.name || provider.id}`);
    menuButton.setAttribute('aria-haspopup', 'menu'); menuButton.setAttribute('aria-expanded', 'false');
    const menu = element('div'); menu.className = 'quota-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    const fillMenu = () => {
      if (menu.childElementCount || !entry) return;
      const index = entries.indexOf(entry);
      menu.append(
        action('Edit', () => edit(entry)),
        action(entry.enabled ? 'Disable' : 'Enable', () => { void save(entries.map(value => value.id === entry.id ? { ...value, enabled: !value.enabled } : value)); }),
        action('Move up', () => move(entry, -1), index <= 0),
        action('Move down', () => move(entry, 1), index < 0 || index >= entries.length - 1),
        action('Delete…', () => openDrawer(provider, entry, true)),
      );
    };
    menuButton.onclick = event => {
      event.stopPropagation();
      const opening = menu.hidden;
      closeMenus();
      if (opening) fillMenu();
      menu.hidden = !opening; menuButton.setAttribute('aria-expanded', String(opening));
      if (opening) (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
    };
    menuButton.onkeydown = event => { if (event.key === 'Escape') { closeMenus(); menuButton.focus(); } };
    if (!entry) {
      menu.append(action('Details', () => openDrawer(provider, entry)));
    }
    item.append(open, menuButton, menu);
    return item;
  }
  function render(): void {
    closeMenus();
    if (providers.length) list.replaceChildren(...providers.map(provider => row(provider, entries.find(entry => entry.id === provider.id))));
    else if (loading || !loaded) list.replaceChildren(...skeleton());
    else {
      const empty = element('p', 'No subscriptions. Add an entry to track an allowance.'); empty.className = 'quota-empty';
      list.replaceChildren(empty);
    }
    renderChrome();
  }
  function move(entry: Entry, delta: number): void {
    const index = entries.indexOf(entry);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    void save(next);
  }
  function closeDrawer(): void {
    drawerHost.hidden = true; drawerHost.replaceChildren();
  }
  function windowDetails(provider: Provider): HTMLElement {
    const details = element('div'); details.className = 'quota-drawer-windows';
    const windows = provider.manual ? [{
      minutes: provider.manual.minutes,
      resetsAt: provider.manual.resetsAt,
      text: `${provider.manual.amount} ${provider.manual.unit} ${provider.manual.mode === 'used' ? 'used' : 'remaining'}`,
    }] : [...provider.windows].sort((a, b) => a.minutes - b.minutes).map(window => ({
      minutes: window.minutes, resetsAt: window.resetsAt, text: `${percent(window.remainingPercent)} remaining`,
    }));
    if (!windows.length) {
      details.append(element('p', statusLabel(provider)));
      return details;
    }
    for (const window of windows) {
      const section = element('section');
      section.append(element('h4', windowLabel(window.minutes)), element('strong', window.text));
      section.append(element('small', `Reset: ${timestamp(window.resetsAt)}`));
      details.append(section);
    }
    return details;
  }
  function openDrawer(provider: Provider, entry: Entry | undefined, confirmDelete = false): void {
    closeMenus();
    drawerHost.hidden = false;
    const backdrop = element('div'); backdrop.className = 'quota-drawer-backdrop';
    backdrop.onclick = closeDrawer;
    const drawer = element('aside'); drawer.className = 'quota-drawer'; drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-labelledby', 'quota-drawer-title');
    const close = element('button', '×'); close.type = 'button'; close.className = 'quota-drawer-close'; close.setAttribute('aria-label', 'Close details');
    close.onclick = closeDrawer;
    const title = element('h3', confirmDelete ? 'Delete subscription?' : (provider.name || provider.id)); title.id = 'quota-drawer-title';
    drawer.append(close, title);
    if (confirmDelete && entry) {
      const text = element('p', `Delete ${entry.name}? This cannot be undone.`);
      const actions = element('div'); actions.className = 'quota-drawer-actions';
      actions.append(
        button('Cancel', () => openDrawer(provider, entry)),
        button('Confirm delete', () => { closeDrawer(); void save(entries.filter(value => value.id !== entry.id)); }),
      );
      drawer.append(text, actions);
    } else {
      const meta = element('p', [provider.service, provider.plan].filter(Boolean).join(' · ')); meta.className = 'quota-drawer-meta';
      drawer.append(meta, windowDetails(provider));
      if (provider.status !== 'available' || provider.reason) drawer.append(element('p', provider.reason));
      if (provider.source) drawer.append(element('p', `Source: ${provider.source}`));
      if (provider.description) drawer.append(element('p', provider.description));
      drawer.append(element('small', `Updated: ${timestamp(provider.updatedAt)}`));
      drawer.append(element('small', `Last checked: ${timestamp(provider.checkedAt)}`));
      if (entry) {
        const actions = element('div'); actions.className = 'quota-drawer-actions';
        actions.append(
          button('Edit', () => { closeDrawer(); edit(entry); }),
          button(entry.enabled ? 'Disable' : 'Enable', () => { closeDrawer(); void save(entries.map(value => value.id === entry.id ? { ...value, enabled: !value.enabled } : value)); }),
          button('Delete…', () => openDrawer(provider, entry, true)),
          button('Move up', () => { closeDrawer(); move(entry, -1); }),
          button('Move down', () => { closeDrawer(); move(entry, 1); }),
        );
        const index = entries.indexOf(entry);
        (actions.children[3] as HTMLButtonElement).disabled = index <= 0;
        (actions.children[4] as HTMLButtonElement).disabled = index < 0 || index >= entries.length - 1;
        drawer.append(actions);
      }
    }
    drawerHost.replaceChildren(backdrop, drawer);
    close.focus();
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
    const actions = element('div'); actions.className = 'quota-drawer-actions';
    const submit = element('button', 'Save subscription'); submit.type = 'submit';
    actions.append(submit, button('Cancel', () => { editor.replaceChildren(); add.focus(); })); form.append(actions);
    form.onsubmit = event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const updatedEntry: Entry = { ...entry, name: name.value.trim(), service: service.value.trim(), plan: plan.value.trim(), enabled: enabled.checked };
      if (amount && limit && mode && unit && minutes && reset) {
        Object.assign(updatedEntry, { amount: amount.value === '' ? null : Number(amount.value), limit: limit.value === '' ? null : Number(limit.value),
          mode: mode.value, unit: unit.value.trim(), minutes: Number(minutes.value), resetsAt: reset.value ? new Date(reset.value).toISOString() : null });
      }
      void save(existing ? entries.map(value => value.id === entry.id ? updatedEntry : value) : [...entries, updatedEntry]);
    };
    editor.replaceChildren(form); name.focus();
  }
  async function save(next: Entry[]) {
    if (controller || disposed) return;
    controller = new AbortController(); saving = true; notice = null; renderChrome();
    const timeout = window.setTimeout(() => controller?.abort(), 12000);
    status.textContent = 'Saving…';
    let saved = false;
    try {
      const response = await fetcher(`${endpoint}/entries?profile=${encodeURIComponent(profile)}`, {
        method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, entries: next }),
      });
      if (response.status === 409) { notice = 'Subscriptions changed in another tab. Refresh before saving again.'; return; }
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (disposed) return;
      entries = data.entries; revision = data.revision; editor.replaceChildren(); saved = true;
    } catch {
      if (!disposed) notice = 'Save failed. Check values and connection. Refresh to verify before retrying.';
    } finally {
      clearTimeout(timeout); controller = undefined; saving = false;
      if (!disposed) renderChrome();
    }
    if (saved) await load(true);
  }
  async function load(force = false): Promise<void> {
    if (controller || disposed) return;
    controller = new AbortController();
    const timeout = window.setTimeout(() => controller?.abort(), 20000);
    loading = true; error = null; notice = null; render();
    try {
      const response = await fetcher(`${endpoint}?profile=${encodeURIComponent(profile)}${force ? '&refresh=true' : ''}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.providers) || !data.providers.every((provider: Provider) => typeof provider.id === 'string' && Array.isArray(provider.windows))) throw new Error();
      if (disposed) return;
      providers = data.providers;
      configured = Array.isArray(data.entries) && Number.isInteger(data.revision);
      if (configured) { entries = data.entries; revision = data.revision; presets = Array.isArray(data.presets) ? data.presets : []; }
      lastUpdated = new Date().toISOString(); loaded = true; error = null;
      writeSnapshot({ profile, providers, entries, revision, configured, presets, savedAt: lastUpdated });
    } catch {
      if (disposed) return;
      loaded = true;
      error = providers.length ? 'Refresh failed. Showing saved data; use Retry.' : 'Could not load subscriptions. Use Retry. Unavailable does not mean zero.';
    } finally {
      clearTimeout(timeout); controller = undefined; loading = false;
      if (!disposed) render();
    }
  }
  const onDocumentClick = (event: MouseEvent) => {
    if (!(event.target as Element | null)?.closest('.quota-row')) closeMenus();
  };
  document.addEventListener('click', onDocumentClick);
  refresh.onclick = () => { void load(true); };
  retry.onclick = () => { void load(true); };
  add.onclick = () => edit();
  render();
  if (snapshot) renderChrome();
  void load();
  return () => {
    disposed = true; controller?.abort(); closeDrawer(); closeMenus();
    document.removeEventListener('click', onDocumentClick);
  };
}

function localTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Use the existing settings route lifecycle to abort requests when leaving the page. */
export function createQuotaSettings(sdk: any) {
  const { useEffect, useRef } = sdk.hooks;
  return function QuotaSettings(props: { profile?: string } = {}) {
    const ref = useRef(null as HTMLElement | null);
    const profile = props.profile || currentProfile();
    useEffect(() => {
      const node = ref.current;
      if (!node) return;
      const dispose = mountQuotaDashboard(node, window.fetch.bind(window), { profile });
      return () => { dispose(); node.replaceChildren(); };
    }, [profile]);
    return sdk.React.createElement('section', { ref, className: 'workbench-settings-subpage quota-settings' });
  };
}
