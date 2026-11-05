import { uiText as tr } from './ui-locale';
import type { FetchJSON } from './workbench-api';
import { currentProfile } from './profile-scope';

/** User-owned preferences; profile appearance data is never rewritten here. */
export async function renderHomeSettings(panel: HTMLElement, fetchJSON: FetchJSON): Promise<void> {
  const section = document.createElement('section');
  section.className = 'home-settings workbench-settings-section';
  const title = document.createElement('h2');
  title.textContent = tr('首页显示', 'Home display');
  const status = document.createElement('p');
  status.className = 'workbench-settings-status';
  status.setAttribute('role', 'status');
  section.append(title, status); panel.append(section);
  const profile = currentProfile();
  try {
    const [prefs, saved, roster] = await Promise.all([
      fetchJSON<{labels: Record<string, boolean>}>('/api/plugins/workbench/home-preferences'),
      fetchJSON<{order: string[]}>('/api/plugins/workbench/profile-order'),
      fetchJSON<{profiles: {name: string}[]}>('/api/plugins/workbench/profile-names'),
    ]);
    if (!section.isConnected) return;
    const label = document.createElement('label'), checkbox = document.createElement('input');
    label.className = 'home-settings-label-row';
    checkbox.type = 'checkbox'; checkbox.checked = prefs.labels[profile] !== false;
    const labelCopy = document.createElement('span');
    labelCopy.textContent = tr('显示会话项目标签', 'Show session project labels') + ` · ${profile}`;
    label.append(labelCopy, checkbox);
    section.append(label);
    const put = (url: string, body: unknown) => fetchJSON(url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    checkbox.onchange = async () => {
      checkbox.disabled = true;
      try { await put(`/api/plugins/workbench/home-preferences?profile=${encodeURIComponent(profile)}`, {show_project_labels: checkbox.checked}); status.textContent = tr('已保存', 'Saved'); }
      catch { checkbox.checked = !checkbox.checked; status.textContent = tr('保存失败，请重试', 'Save failed. Retry.'); }
      finally { checkbox.disabled = false; }
    };
    const names = roster.profiles.map(p => p.name);
    let order = [...saved.order.filter(p => names.includes(p)), ...names.filter(p => !saved.order.includes(p))];
    const orderTitle = document.createElement('h3');
    orderTitle.textContent = tr('Profile 排序', 'Profile order');
    const list = document.createElement('div');
    list.className = 'home-settings-order-list';
    list.setAttribute('aria-label', tr('Profile 排序', 'Profile order'));
    section.append(orderTitle, list);
    const render = () => {
      list.replaceChildren(...order.map((name, index) => {
        const row = document.createElement('div');
        row.className = 'home-settings-order-row';
        const nameLabel = document.createElement('span');
        nameLabel.textContent = name;
        nameLabel.title = name;
        row.append(nameLabel);
        const controls = document.createElement('div');
        controls.className = 'home-settings-order-actions';
        for (const direction of [-1, 1]) {
          const button = document.createElement('button'); button.type = 'button';
          button.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${direction < 0 ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
          button.setAttribute('aria-label', name + ' ' + (direction < 0 ? tr('上移', 'Move up') : tr('下移', 'Move down')));
          button.disabled = index + direction < 0 || index + direction >= order.length;
          button.onclick = async () => {
            const next = [...order]; [next[index], next[index + direction]] = [next[index + direction], next[index]];
            list.querySelectorAll('button').forEach(b => b.disabled = true);
            try { await put('/api/plugins/workbench/profile-order', {order: next}); order = next; status.textContent = tr('顺序已保存', 'Order saved'); }
            catch { status.textContent = tr('保存失败，请重试', 'Save failed. Retry.'); }
            finally { render(); }
          };
          controls.append(button);
        }
        row.append(controls);
        return row;
      }));
    };
    render();
  } catch { status.textContent = tr('首页设置加载失败，请重新打开', 'Home settings unavailable. Reopen to retry.'); }
}
