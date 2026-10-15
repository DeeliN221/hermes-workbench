import { uiText as sourceText } from './ui-locale';
const LINK_ATTR = 'data-workbench-version-link';
const PANEL_ATTR = 'data-workbench-version-panel';

function versionRoute(): boolean {
  const url = new URL(window.location.href);
  return url.pathname === '/config' && url.searchParams.get('workbench') === 'versions';
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

function addSettingsLink(): void {
  const nav = document.querySelector<HTMLElement>('.dashboard-settings-nav');
  if (!nav) return;
  const existing = nav.querySelector(`[${LINK_ATTR}]`);
  if (existing) {
    const label = sourceText("版本切换", "Version switching");
    if (existing.textContent !== label) existing.textContent = label;
    return;
  }
  const link = document.createElement('a');
  link.setAttribute(LINK_ATTR, 'true');
  link.href = '/config?workbench=versions';
  link.textContent = sourceText("版本切换", "Version switching");
  link.addEventListener('click', event => {
    event.preventDefault();
    navigate(link.href);
  });
  nav.append(link);
}

async function renderPanel(): Promise<void> {
  const main = document.querySelector<HTMLElement>('.dashboard-owned-page') || document.querySelector<HTMLElement>('main');
  if (!main) return;
  let panel = main.querySelector<HTMLElement>(`[${PANEL_ATTR}]`);
  if (!versionRoute()) {
    main.querySelectorAll<HTMLElement>('[data-workbench-settings-preserved]').forEach(node => {
      node.style.display = '';
      node.removeAttribute('data-workbench-settings-preserved');
    });
    panel?.remove();
    return;
  }
  if (panel) return;
  const preserved = Array.from(main.children).filter(node => !(node as HTMLElement).hasAttribute(PANEL_ATTR));
  preserved.forEach(node => {
    const element = node as HTMLElement;
    element.setAttribute('data-workbench-settings-preserved', 'true');
    element.style.display = 'none';
  });
  panel = document.createElement('section');
  panel.setAttribute(PANEL_ATTR, 'true');
  panel.innerHTML = sourceText("<h2>Codex App Server</h2><p class=\"workbench-version-muted\">每天自动检查稳定版更新。更新会重启 App Server，正在运行的 Codex 任务可能中断。</p><div class=\"workbench-version-row\"><strong data-codex-runtime-status role=\"status\">正在检查 Codex 版本…</strong><button type=\"button\" data-codex-runtime-update hidden>立即更新并重启</button></div><h2>Workbench 版本切换</h2><p class=\"workbench-version-muted\" data-workbench-version-description>正在读取更新方式…</p><div class=\"workbench-version-list\" role=\"list\">正在读取版本…</div>", "<h2>Codex App Server</h2><p class=\"workbench-version-muted\">Checks stable releases daily. Updating restarts App Server and may interrupt active Codex tasks.</p><div class=\"workbench-version-row\"><strong data-codex-runtime-status role=\"status\">Checking Codex version\u2026</strong><button type=\"button\" data-codex-runtime-update hidden>Update and restart now</button></div><h2>Workbench version switching</h2><p class=\"workbench-version-muted\" data-workbench-version-description>Loading update mode\u2026</p><div class=\"workbench-version-list\" role=\"list\">Loading releases\u2026</div>");
  main.append(panel);
  void renderCodexRuntime(panel);
  await renderWorkbenchVersions(panel);

}

export async function waitForReleaseJob(id: string, report: (message: string) => void): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    let result: { id?: string; phase?: string; error?: string };
    try {
      const response = await fetch('/api/plugins/workbench/versions/update-status', { credentials: 'same-origin' });
      if (!response.ok) continue; // The backend is briefly unavailable during activation/rollback.
      result = await response.json();
    } catch { continue; }
    if (result.id !== id) throw new Error(sourceText("更新状态已变化，请刷新页面确认当前版本。", "Update state changed. Refresh to confirm the current version."));
    if (result.phase === 'succeeded') return;
    if (result.phase === 'failed') throw new Error(result.error || sourceText("更新失败，已保留原版本。", "Update failed. The previous version was retained."));
    report(result.phase === 'activating' ? sourceText("正在启动新版本；失败会自动回滚…", "Starting the new version; failures roll back automatically…") : sourceText("正在准备完整版本…", "Preparing the full release…"));
  }
  throw new Error(sourceText("更新状态暂不可确认，请稍后刷新查看；不要重复提交更新。", "Update state is temporarily unknown. Refresh later; do not submit again."));
}

export async function renderWorkbenchVersions(panel: HTMLElement, reload = () => window.location.reload()): Promise<void> {
  const list = panel.querySelector<HTMLElement>('.workbench-version-list')!;
  const status = document.createElement('p');
  status.className = 'workbench-version-muted';
  status.setAttribute('role', 'status');
  list.before(status);
  try {
    const response = await fetch('/api/plugins/workbench/versions', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as {
      active: string; warning?: string; update_mode?: string; update?: { id?: string; phase?: string; error?: string };
      versions: Array<{ version: string; ready?: boolean; notes?: string; prerelease?: boolean; published_at?: string; source?: string }>;
    };
    const description = panel.querySelector('[data-workbench-version-description]');
    if (description) description.textContent = data.update_mode === 'release'
      ? sourceText("用户版：手动选择 GitHub 正式版本，前后端一起更新。任务运行中不能切换，启动失败自动回滚。", "Managed instance: choose a GitHub release to update the matching frontend and backend. Switching is blocked during active tasks, and startup failures roll back automatically.")
      : sourceText("开发版：运行可编辑源码；这里仅切换界面资源，后端由开发者构建和实测。", "Development instance: editable source is in use. This control switches browser assets only; developers build and validate the backend separately.");
    status.textContent = data.warning || data.update?.error || sourceText(`当前版本 ${data.active} · 按版本从新到旧排列`, `Current version ${data.active} · Newest releases first`);
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
          try {
            const switched = await fetch('/api/plugins/workbench/versions/switch', {
              method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ version: item.version }),
            });
            const result = await switched.json() as { detail?: string; pending?: boolean; job_id?: string };
            if (!switched.ok) throw new Error(result.detail || `HTTP ${switched.status}`);
            if (result.pending && result.job_id) await waitForReleaseJob(result.job_id, message => { status.textContent = message; });
            status.textContent = sourceText("切换完成，正在刷新…", "Switched successfully. Refreshing…");
            reload();
          } catch (error) {
            status.textContent = sourceText(`切换失败：${error instanceof Error ? error.message : String(error)}`, `Switch failed: ${error instanceof Error ? error.message : String(error)}`);
            controls.forEach(control => { control.disabled = false; });
            button.textContent = caption;
          }
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
        await waitForReleaseJob(data.update.id, message => { status.textContent = message; });
        reload();
      } catch (error) {
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
  const schedule = () => window.requestAnimationFrame(() => { addSettingsLink(); void renderPanel(); });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["lang"] });
  window.addEventListener('popstate', schedule);
  schedule();
}
