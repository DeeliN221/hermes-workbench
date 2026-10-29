import { uiText as sourceText } from './ui-locale';
import { currentProfile } from './profile-scope';
import { loadCodexModelCatalog, type ChatModelChoice } from './codex-api';
import { readHiddenModels, writeHiddenModels } from './model-visibility';
import {
  aliasConflict,
  MODEL_ALIAS_MAX_LENGTH,
  normalizeModelAlias,
  readModelAliases,
  writeModelAliases,
} from './model-aliases';
import type { FetchJSON } from './workbench-api';
const LINK_ATTR = 'data-workbench-version-link';
const MODEL_LINK_ATTR = 'data-workbench-model-link';
const PANEL_ATTR = 'data-workbench-version-panel';
const PRESERVED_ATTR = 'data-workbench-settings-preserved';

type SettingsRoute = 'versions' | 'models';

function shellManagesSettings(): boolean {
  return document.documentElement.dataset.workbenchShell === 'true'
    || Boolean((window as any).__HERMES_PLUGINS__);
}

function settingsRoute(): SettingsRoute | null {
  const url = new URL(window.location.href);
  if (url.pathname !== '/config') return null;
  const route = url.searchParams.get('workbench');
  if (route === 'versions' || route === 'settings') return 'versions';
  return route === 'models' ? 'models' : null;
}

function navigate(url: string): void {
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function renderCodexRuntime(panel: HTMLElement): Promise<void> {
  const status = panel.querySelector<HTMLElement>('[data-codex-runtime-status]');
  const button = panel.querySelector<HTMLButtonElement>('[data-codex-runtime-update]');
  if (!status || !button) return;
  try {
    const response = await fetch('/api/plugins/workbench/codex-runtime/status', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as {
      installed_version: string; latest_version: string; update_available: boolean; busy: boolean; last_updated_at?: string | null;
    };
    status.textContent = data.update_available
      ? sourceText(`当前 ${data.installed_version}，可更新至 ${data.latest_version}${data.busy ? sourceText("；自动更新会等当前任务结束", "; automatic updates wait for active tasks to finish") : ''}`, `Current ${data.installed_version}; update available: ${data.latest_version}${data.busy ? sourceText("；自动更新会等当前任务结束", "; automatic updates wait for active tasks to finish") : ''}`)
      : sourceText(`当前版本 ${data.installed_version}，已是最新版本`, `Current version ${data.installed_version} is up to date`);
    button.hidden = !data.update_available;
    button.textContent = data.update_available ? sourceText("立即更新并重启", "Update and restart now") : sourceText("已是最新版本", "Up to date");
    button.onclick = async () => {
      if (!window.confirm(sourceText("更新会重启 Codex App Server，正在运行的 Codex 任务可能中断。继续吗？", "Updating restarts Codex App Server and may interrupt active tasks. Continue?"))) return;
      button.disabled = true;
      button.textContent = sourceText("正在下载、验证并重启…", "Downloading, verifying, and restarting…");
      status.textContent = sourceText("正在更新 Codex App Server…", "Updating Codex App Server…");
      try {
        const updated = await fetch('/api/plugins/workbench/codex-runtime/update', {
          method: 'POST', credentials: 'same-origin',
        });
        const result = await updated.json() as { installed_version?: string; detail?: string };
        if (!updated.ok) throw new Error(result.detail || `HTTP ${updated.status}`);
        status.textContent = sourceText(`更新完成，当前版本 ${result.installed_version || data.latest_version}`, `Update complete. Current version: ${result.installed_version || data.latest_version}`);
        button.hidden = true;
        button.textContent = sourceText("已是最新版本", "Up to date");
      } catch (error) {
        status.textContent = sourceText(`更新失败：${String(error)}`, `Update failed: ${String(error)}`);
        button.disabled = false;
        button.textContent = sourceText("重试更新", "Retry update");
      }
    };
  } catch (error) {
    status.textContent = sourceText(`Codex 版本检查失败：${String(error)}`, `Codex version check failed: ${String(error)}`);
    button.hidden = true;
  }
}

function addSettingsLink(nav: HTMLElement, attr: string, href: string, label: string): void {
  const existing = nav.querySelector<HTMLAnchorElement>(`[${attr}]`);
  if (existing) {
    if (existing.textContent !== label) existing.textContent = label;
    if (existing.getAttribute('href') !== href) existing.setAttribute('href', href);
    return;
  }
  const link = document.createElement('a');
  link.setAttribute(attr, 'true');
  link.href = href;
  link.textContent = label;
  link.addEventListener('click', event => {
    event.preventDefault();
    navigate(link.href);
  });
  nav.append(link);
}

function addSettingsLinks(): void {
  const nav = document.querySelector<HTMLElement>('.dashboard-settings-nav');
  if (!nav) return;
  const profile = encodeURIComponent(currentProfile());
  addSettingsLink(nav, MODEL_LINK_ATTR, `/config?workbench=models&profile=${profile}`, sourceText("模型显示", "Model visibility"));
  addSettingsLink(nav, LINK_ATTR, `/config?workbench=versions&profile=${profile}`, sourceText("版本切换", "Version switching"));
}

async function renderModelVisibility(panel: HTMLElement, explicitProfile?: string): Promise<void> {
  const profile = explicitProfile?.trim() || currentProfile();
  const list = panel.querySelector<HTMLElement>('[data-model-visibility-list]');
  const status = panel.querySelector<HTMLElement>('[data-model-visibility-status]');
  const showAll = panel.querySelector<HTMLButtonElement>('[data-model-show-all]');
  if (!list || !status || !showAll) return;
  const read: FetchJSON = async (url, init) => {
    const response = await fetch(url, { credentials: 'same-origin', ...init });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  try {
    const models = await loadCodexModelCatalog(read, profile);
    if (!models.length) {
      list.textContent = sourceText("当前没有可用模型。", "No models are currently available.");
      status.textContent = sourceText("没有可显示的模型", "No models to show");
      return;
    }
    const known = new Set(models.map(model => model.id));
    let hidden = readHiddenModels(profile);
    let aliases = readModelAliases(profile);
    const stale = [...hidden].filter(id => !known.has(id));
    if (stale.length) hidden = writeHiddenModels(profile, [...hidden].filter(id => known.has(id)));
    const visibleCount = () => models.filter(model => !hidden.has(model.id)).length;
    const syncShowAll = () => {
      showAll.disabled = hidden.size === 0;
    };
    const render = () => {
      syncShowAll();
      const groups = new Map<string, ChatModelChoice[]>();
      for (const model of models) {
        const slash = model.id.lastIndexOf('/');
        const provider = slash > 0 ? model.id.slice(0, slash) : 'Codex';
        const group = groups.get(provider) || [];
        group.push(model);
        groups.set(provider, group);
      }
      list.replaceChildren(...[...groups].map(([provider, rows]) => {
        const section = document.createElement('section');
        section.className = 'workbench-model-group';
        const header = document.createElement('header');
        header.className = 'workbench-model-group-header';
        const heading = document.createElement('h3');
        heading.textContent = provider;
        const groupCount = document.createElement('span');
        groupCount.className = 'workbench-model-group-count';
        const updateGroupCount = () => {
          const activeInGroup = rows.filter(row => !hidden.has(row.id)).length;
          groupCount.textContent = `${activeInGroup} / ${rows.length}`;
        };
        updateGroupCount();
        header.append(heading, groupCount);
        const options = document.createElement('div');
        options.className = 'workbench-model-options';
        for (const model of rows) {
          const option = document.createElement('div');
          option.className = 'workbench-model-option';
          const toggle = document.createElement('label');
          toggle.className = 'workbench-model-toggle';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = !hidden.has(model.id);
          checkbox.value = model.id;
          option.dataset.visible = String(checkbox.checked);
          const copy = document.createElement('span');
          copy.className = 'workbench-model-copy';
          const titleRow = document.createElement('span');
          titleRow.className = 'workbench-model-title-row';
          const name = document.createElement('strong');
          name.textContent = model.label;
          titleRow.append(name);
          if (model.isDefault) {
            const badge = document.createElement('span');
            badge.className = 'workbench-model-tag is-default';
            badge.textContent = sourceText('默认', 'Default');
            titleRow.append(badge);
          }
          if (model.supportsFast) {
            const fastBadge = document.createElement('span');
            fastBadge.className = 'workbench-model-tag';
            fastBadge.textContent = 'Fast';
            titleRow.append(fastBadge);
          }
          const id = document.createElement('small');
          id.textContent = model.id;
          copy.append(titleRow, id);
          toggle.append(checkbox, copy);

          const aliasField = document.createElement('label');
          aliasField.className = 'workbench-model-alias';
          const aliasLabel = document.createElement('span');
          aliasLabel.className = 'workbench-model-alias-label';
          aliasLabel.textContent = sourceText('聊天显示名', 'Chat display name');
          const aliasInput = document.createElement('input');
          aliasInput.type = 'text';
          aliasInput.className = 'workbench-model-alias-input';
          aliasInput.dataset.modelAlias = model.id;
          aliasInput.value = aliases.get(model.id) || '';
          aliasInput.placeholder = model.label;
          aliasInput.maxLength = MODEL_ALIAS_MAX_LENGTH;
          aliasInput.spellcheck = false;
          aliasInput.autocomplete = 'off';
          aliasInput.setAttribute('aria-label', `${sourceText('聊天显示名', 'Chat display name')}: ${model.label}`);
          aliasInput.title = sourceText('留空则使用模型原名', 'Leave empty to use the original model name');
          const aliasError = document.createElement('span');
          aliasError.className = 'workbench-model-alias-error';
          aliasError.setAttribute('role', 'alert');
          aliasError.hidden = true;
          aliasField.append(aliasLabel, aliasInput, aliasError);
          option.append(toggle, aliasField);

          aliasInput.addEventListener('input', () => {
            delete aliasInput.dataset.invalid;
            aliasError.hidden = true;
            aliasError.textContent = '';
          });
          aliasInput.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
              aliasInput.value = aliases.get(model.id) || '';
              aliasInput.blur();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              aliasInput.blur();
            }
          });
          aliasInput.addEventListener('change', () => {
            const candidate = normalizeModelAlias(aliasInput.value);
            aliasInput.value = candidate;
            const conflict = aliasConflict(aliases, model.id, candidate);
            if (conflict) {
              aliasInput.dataset.invalid = 'true';
              aliasError.hidden = false;
              aliasError.textContent = sourceText(`该名称已被 ${conflict} 使用`, `Already used by ${conflict}`);
              status.textContent = sourceText('别名与另一个模型重复，未保存。', 'That alias is already used by another model; not saved.');
              return;
            }
            if (candidate) aliases.set(model.id, candidate);
            else aliases.delete(model.id);
            aliases = writeModelAliases(profile, aliases);
            status.textContent = candidate
              ? sourceText(`已保存别名：${candidate}`, `Alias saved: ${candidate}`)
              : sourceText(`已恢复原名：${model.label}`, `Using the original name: ${model.label}`);
          });
          checkbox.addEventListener('change', () => {
            if (!checkbox.checked && visibleCount() <= 1) {
              checkbox.checked = true;
              option.dataset.visible = 'true';
              status.textContent = sourceText("至少保留一个可见模型。", "Keep at least one model visible.");
              return;
            }
            if (checkbox.checked) hidden.delete(model.id);
            else hidden.add(model.id);
            hidden = writeHiddenModels(profile, hidden);
            option.dataset.visible = String(checkbox.checked);
            updateGroupCount();
            syncShowAll();
            status.textContent = sourceText(`已保存：聊天框显示 ${visibleCount()}/${models.length} 个模型`, `Saved: ${visibleCount()}/${models.length} models visible in chat`);
          });
          options.append(option);
        }
        section.append(header, options);
        return section;
      }));
      status.textContent = sourceText(`聊天框显示 ${visibleCount()}/${models.length} 个模型`, `${visibleCount()}/${models.length} models visible in chat`);
    };
    showAll.onclick = () => {
      hidden = writeHiddenModels(profile, []);
      render();
      status.textContent = sourceText("已恢复显示全部模型。", "All models are visible again.");
    };
    render();
  } catch (error) {
    list.textContent = sourceText(`模型列表读取失败：${String(error)}`, `Could not load models: ${String(error)}`);
    status.textContent = sourceText("读取失败", "Load failed");
  }
}

export async function renderModelVisibilityPanel(panel: HTMLElement, explicitProfile?: string): Promise<void> {
  const profileName = explicitProfile?.trim() || currentProfile();
  panel.setAttribute(PANEL_ATTR, 'true');
  panel.dataset.workbenchSettingsRoute = 'models';
  panel.innerHTML = sourceText(
    '<header class="workbench-settings-subpage-header"><h1>聊天模型显示</h1><p class="workbench-version-muted">当前档案 <strong class="workbench-model-profile-chip" data-model-profile>default</strong>。可隐藏聊天框里的模型，并为每个模型设置简短别名；设置只保存在当前浏览器，不会修改 Codex 配置或后端模型目录。</p></header><div class="workbench-model-toolbar"><span class="workbench-model-status" data-model-visibility-status role="status">正在读取模型…</span><button type="button" data-model-show-all>全部显示</button></div><div class="workbench-model-list" data-model-visibility-list>正在读取模型…</div>',
    '<header class="workbench-settings-subpage-header"><h1>Chat model visibility</h1><p class="workbench-version-muted">Profile <strong class="workbench-model-profile-chip" data-model-profile>default</strong>. Hide models from the chat menu and give each one a short alias. Both are stored in this browser and do not change Codex configuration or the backend catalog.</p></header><div class="workbench-model-toolbar"><span class="workbench-model-status" data-model-visibility-status role="status">Loading models…</span><button type="button" data-model-show-all>Show all</button></div><div class="workbench-model-list" data-model-visibility-list>Loading models…</div>',
  );
  const profile = panel.querySelector<HTMLElement>('[data-model-profile]');
  if (profile) profile.textContent = profileName;
  await renderModelVisibility(panel, profileName);
}

export async function renderVersionSettingsPanel(panel: HTMLElement): Promise<void> {
  panel.setAttribute(PANEL_ATTR, 'true');
  panel.dataset.workbenchSettingsRoute = 'versions';
  panel.innerHTML = sourceText(
    '<header class="workbench-settings-subpage-header"><h1>版本切换</h1></header><h2>Codex App Server</h2><p class="workbench-version-muted">每天自动检查稳定版更新。更新会重启 App Server，正在运行的 Codex 任务可能中断。</p><div class="workbench-version-row"><strong data-codex-runtime-status role="status">正在检查 Codex 版本…</strong><button type="button" data-codex-runtime-update hidden>立即更新并重启</button></div><h2>Workbench 版本切换</h2><p class="workbench-version-muted" data-workbench-version-description>正在读取更新方式…</p><div class="workbench-version-list" role="list">正在读取版本…</div>',
    '<header class="workbench-settings-subpage-header"><h1>Version switching</h1></header><h2>Codex App Server</h2><p class="workbench-version-muted">Checks stable releases daily. Updating restarts App Server and may interrupt active Codex tasks.</p><div class="workbench-version-row"><strong data-codex-runtime-status role="status">Checking Codex version…</strong><button type="button" data-codex-runtime-update hidden>Update and restart now</button></div><h2>Workbench version switching</h2><p class="workbench-version-muted" data-workbench-version-description>Loading update mode…</p><div class="workbench-version-list" role="list">Loading releases…</div>',
  );
  void renderCodexRuntime(panel);
  await renderWorkbenchVersions(panel);
}

export function createModelVisibilitySettings(sdk: any) {
  const h = sdk.React.createElement;
  const { useEffect, useRef } = sdk.hooks;
  return function ModelVisibilitySettings({ profile }: { profile?: string }) {
    const ref = useRef(null as HTMLElement | null);
    useEffect(() => {
      const node = ref.current;
      if (!node) return;
      const render = () => { void renderModelVisibilityPanel(node, profile); };
      render();
      const observer = new MutationObserver(render);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      return () => observer.disconnect();
    }, [profile]);
    return h('section', {
      ref,
      className: 'workbench-settings-subpage',
      'data-testid': 'model-visibility-settings',
    });
  };
}

export function createVersionSettings(sdk: any) {
  const h = sdk.React.createElement;
  const { useEffect, useRef } = sdk.hooks;
  return function VersionSettings() {
    const ref = useRef(null as HTMLElement | null);
    useEffect(() => {
      const node = ref.current;
      if (!node) return;
      const render = () => { void renderVersionSettingsPanel(node); };
      render();
      const observer = new MutationObserver(render);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      return () => observer.disconnect();
    }, []);
    return h('section', {
      ref,
      className: 'workbench-settings-subpage',
      'data-testid': 'version-settings',
    });
  };
}

function cleanupFallbackPanel(): void {
  document.querySelectorAll<HTMLElement>(`[${PRESERVED_ATTR}]`).forEach(node => {
    node.style.display = '';
    node.removeAttribute(PRESERVED_ATTR);
  });
  document.querySelectorAll<HTMLElement>(`main:not(.dashboard-owned-page) > [${PANEL_ATTR}]`).forEach(node => node.remove());
}

async function renderPanel(): Promise<void> {
  if (shellManagesSettings()) {
    cleanupFallbackPanel();
    return;
  }
  const main = document.querySelector<HTMLElement>('.dashboard-owned-page') || document.querySelector<HTMLElement>('main');
  if (!main) return;
  let panel = main.querySelector<HTMLElement>(`[${PANEL_ATTR}]`);
  const route = settingsRoute();
  if (!route) {
    const otherCustomActive = new URL(window.location.href).pathname === '/config'
      && new URL(window.location.href).searchParams.get('workbench') === 'display';
    main.querySelectorAll<HTMLElement>(`[${PRESERVED_ATTR}]`).forEach(node => {
      if (!otherCustomActive) node.style.display = '';
      node.removeAttribute(PRESERVED_ATTR);
    });
    panel?.remove();
    return;
  }
  if (panel?.dataset.workbenchSettingsRoute === route) return;
  panel?.remove();
  const preserved = Array.from(main.children).filter(node => !(node as HTMLElement).hasAttribute(PANEL_ATTR));
  preserved.forEach(node => {
    const element = node as HTMLElement;
    element.setAttribute(PRESERVED_ATTR, 'true');
    element.style.display = 'none';
  });
  panel = document.createElement('section');
  panel.setAttribute(PANEL_ATTR, 'true');
  panel.dataset.workbenchSettingsRoute = route;
  main.append(panel);
  if (route === 'models') {
    await renderModelVisibilityPanel(panel);
  } else {
    await renderVersionSettingsPanel(panel);
  }

}

export type ReleaseProgress = { id?: string; version?: string; phase?: string; stage?: string; received?: number; total?: number; attempt?: number; error?: string };
export function releaseProgressText(job: ReleaseProgress): string {
  if (job.phase === 'activating') return sourceText('正在启动新版本并检查健康状态，失败会自动回滚…', 'Starting the new version and checking health; failures roll back automatically…');
  if (job.phase === 'queued') return sourceText('校验通过，准备切换并重新连接…', 'Verified. Preparing to switch and reconnect…');
  if (job.stage === 'downloading') {
    const size = (n: number) => (n / 1048576).toFixed(1) + ' MB';
    const amount = job.total ? `${size(job.received || 0)} / ${size(job.total)} · ${Math.min(100, Math.floor((job.received || 0) / job.total * 100))}%` : size(job.received || 0);
    return sourceText(`正在下载 ${amount}`, `Downloading ${amount}`) + ((job.attempt || 1) > 1 ? sourceText(`（第 ${job.attempt} 次尝试）`, ` (attempt ${job.attempt})`) : '');
  }
  if (job.stage === 'extracting') return sourceText('正在解包并核对前后端文件…', 'Extracting and checking frontend/backend files…');
  if (job.stage === 'verifying') return sourceText('下载完成，正在校验文件…', 'Download complete. Verifying files…');
  return sourceText('正在检查任务状态和版本信息…', 'Checking active tasks and release information…');
}
function friendlyUpdateError(message: string): string {
  if (/Another operation/.test(message)) return sourceText('有保存操作或终端连接尚未结束，请关闭终端并稍后重试。', 'A save operation or terminal connection is still active. Close terminals and retry shortly.');
  if (/Tasks are running/.test(message)) return sourceText('会话任务仍在运行，请等任务结束后再切换版本。', 'Conversation tasks are running. Wait for them to finish before switching.');
  if (/Another version/.test(message)) return sourceText('已有版本更新正在进行，请等待进度完成，不要重复提交。', 'A version update is already in progress. Wait for it to finish without submitting again.');
  return message;
}

export async function waitForReleaseJob(id: string, report: (message: string, job?: ReleaseProgress) => void): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    let result: ReleaseProgress;
    try {
      const response = await fetch('/api/plugins/workbench/versions/update-status', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
      if (!response.ok) { report(sourceText('正在等待服务重新连接…', 'Waiting for the service to reconnect…')); continue; } // The backend is briefly unavailable during activation/rollback.
      result = await response.json();
    } catch { report(sourceText("正在等待服务重新连接…", "Waiting for the service to reconnect…")); continue; }
    if (result.id !== id) throw new Error(sourceText("更新状态已变化，请刷新页面确认当前版本。", "Update state changed. Refresh to confirm the current version."));
    if (result.phase === 'succeeded') return;
    if (result.phase === 'failed') throw new Error(friendlyUpdateError(result.error || sourceText("更新失败，已保留原版本。", "Update failed. The previous version was retained.")));
    report(releaseProgressText(result), result);
  }
  throw new Error(sourceText("更新状态暂不可确认，请稍后刷新查看；不要重复提交更新。", "Update state is temporarily unknown. Refresh later; do not submit again."));
}

export async function renderWorkbenchVersions(panel: HTMLElement, reload = () => window.location.reload()): Promise<void> {
  const list = panel.querySelector<HTMLElement>('.workbench-version-list')!;
  const status = document.createElement('p');
  status.className = 'workbench-version-muted';
  status.setAttribute('role', 'status');
  const progress = document.createElement('progress');
  progress.max = 100;
  progress.hidden = true;
  progress.setAttribute('aria-label', sourceText('版本更新进度', 'Release update progress'));
  progress.style.cssText = 'width:100%;height:14px;accent-color:var(--accent,#7ca65c)';
  list.before(status, progress);
  const report = (message: string, job?: ReleaseProgress) => {
    status.textContent = message;
    progress.hidden = false;
    if (job?.stage === 'downloading' && job.phase === 'preparing' && job.total) progress.value = Math.min(100, (job.received || 0) / job.total * 100);
    else progress.removeAttribute('value');
  };
  try {
    const response = await fetch('/api/plugins/workbench/versions', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as {
      active: string; warning?: string; update_mode?: string; update?: ReleaseProgress;
      versions: Array<{ version: string; ready?: boolean; notes?: string; prerelease?: boolean; published_at?: string; source?: string }>;
    };
    const description = panel.querySelector('[data-workbench-version-description]');
    if (description) description.textContent = data.update_mode === 'release'
      ? sourceText("用户版：手动选择 GitHub 正式版本，前后端一起更新。任务运行中不能切换，启动失败自动回滚。", "Managed instance: choose a GitHub release to update the matching frontend and backend. Switching is blocked during active tasks, and startup failures roll back automatically.")
      : sourceText("开发版：运行可编辑源码；这里仅切换界面资源，后端由开发者构建和实测。", "Development instance: editable source is in use. This control switches browser assets only; developers build and validate the backend separately.");
    status.textContent = data.warning || (data.update?.error ? friendlyUpdateError(data.update.error) : '') || sourceText(`当前版本 ${data.active} · 按版本从新到旧排列`, `Current version ${data.active} · Newest releases first`);
    list.replaceChildren(...data.versions.map(item => {
      const card = document.createElement('article');
      card.className = 'workbench-version-card';
      card.setAttribute('role', 'listitem');
      const row = document.createElement('div');
      row.className = 'workbench-version-row';
      const heading = document.createElement('div');
      const label = document.createElement('strong');
      label.textContent = item.version;
      const meta = document.createElement('small');
      meta.className = 'workbench-version-muted';
      meta.textContent = [item.prerelease ? sourceText("预发布", "Prerelease") : item.source === 'github' ? sourceText("正式发布", "Stable release") : sourceText("本地版本", "Local version"),
        item.published_at ? new Date(item.published_at).toLocaleDateString() : '',
        item.ready ? sourceText("已缓存", "Cached") : sourceText("点击更新时下载", "Downloads when you update")].filter(Boolean).join(' · ');
      heading.append(label, meta);
      row.append(heading);
      if (item.version === data.active) {
        const badge = document.createElement('span');
        badge.className = 'workbench-version-active';
        badge.textContent = sourceText("当前版本", "Current version");
        row.append(badge);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        const caption = item.ready ? sourceText("切换到此版本", "Switch to this version") : sourceText("更新到此版本", "Update to this version");
        button.textContent = caption;
        button.addEventListener('click', async () => {
          const controls = list.querySelectorAll<HTMLButtonElement>('button');
          controls.forEach(control => { control.disabled = true; });
          button.textContent = sourceText("校验并切换中…", "Verifying and switching…");
          status.textContent = sourceText(`正在准备 ${item.version}，请稍候…`, `Preparing ${item.version}. Please wait…`);
          report(releaseProgressText({}));
          let reading = false;
          const timer = window.setInterval(async () => {
            if (reading || !panel.isConnected) return;
            reading = true;
            try {
              const response = await fetch('/api/plugins/workbench/versions/update-status', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
              if (response.ok) {
                const job: ReleaseProgress = await response.json();
                if (job.version === item.version && ['preparing', 'queued', 'activating'].includes(job.phase || '')) report(releaseProgressText(job), job);
              }
            } catch { /* The enqueue request below reports errors. */ }
            finally { reading = false; }
          }, 700);
          try {
            const switched = await fetch('/api/plugins/workbench/versions/switch', {
              method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ version: item.version }),
            });
            const result = await switched.json() as { detail?: string; pending?: boolean; job_id?: string };
            if (!switched.ok) throw new Error(friendlyUpdateError(result.detail || `HTTP ${switched.status}`));
            window.clearInterval(timer);
            if (result.pending && result.job_id) await waitForReleaseJob(result.job_id, report);
            status.textContent = sourceText("切换完成，正在刷新…", "Switched successfully. Refreshing…");
            reload();
          } catch (error) {
            progress.hidden = true;
            status.textContent = sourceText(`切换失败：${error instanceof Error ? error.message : String(error)}`, `Switch failed: ${error instanceof Error ? error.message : String(error)}`);
            controls.forEach(control => { control.disabled = false; });
            button.textContent = caption;
          } finally { window.clearInterval(timer); }
        });
        row.append(button);
      }
      const details = document.createElement('details');
      details.className = 'workbench-version-notes';
      const summary = document.createElement('summary');
      summary.textContent = sourceText("更新日志", "Release notes");
      const notes = document.createElement('div');
      // GitHub release text is untrusted; never inject it as HTML.
      notes.textContent = item.notes || sourceText("此版本暂无更新日志。", "No release notes for this version.");
      details.append(summary, notes);
      card.append(row, details);
      return card;
    }));
    if (data.update?.id && ['preparing', 'queued', 'activating'].includes(data.update.phase || '')) {
      list.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
      try {
        await waitForReleaseJob(data.update.id, report);
        reload();
      } catch (error) {
        progress.hidden = true;
        status.textContent = String(error);
        list.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
      }
    }
    if (!data.versions.length) list.textContent = sourceText("暂无可用版本。", "No versions available.");
  } catch (error) {
    list.textContent = sourceText(`版本列表读取失败：${String(error)}`, `Could not load releases: ${String(error)}`);
  }
}

export function installWorkbenchVersionSettings(): void {
  if ((window as any).__HERMES_WORKBENCH_VERSION_SETTINGS__) return;
  (window as any).__HERMES_WORKBENCH_VERSION_SETTINGS__ = true;
  const schedule = () => window.requestAnimationFrame(() => {
    if (shellManagesSettings()) {
      cleanupFallbackPanel();
      return;
    }
    addSettingsLinks();
    void renderPanel();
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["lang", "data-workbench-shell"] });
  window.addEventListener('popstate', schedule);
  schedule();
}
