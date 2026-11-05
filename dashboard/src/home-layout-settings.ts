import {
  HOME_LAYOUT_COLUMNS,
  HOME_LAYOUT_DEFAULTS,
  HOME_LAYOUT_SESSIONS,
  announceHomeLayout,
  loadHomeLayout,
  saveHomeLayout,
  type HomeLayout,
} from './home-layout';
import { currentProfile } from './profile-scope';
import { uiText as tr } from './ui-locale';
import type { FetchJSON } from './workbench-api';

type LayoutKey = 'columns' | 'sessionsPerProfile';

const FIELD_COPY: Record<LayoutKey, {
  label: () => string;
  hint: () => string;
  minimum: number;
  maximum: number;
  testId: string;
}> = {
  columns: {
    label: () => tr('每行 Profile 列数（1–6）', 'Profiles per row (1–6)'),
    hint: () => tr('桌面端首页每行展示的 Profile 卡片数；手机端始终为单列。', 'Profile cards per row on desktop home. Phones always stay single-column.'),
    minimum: HOME_LAYOUT_COLUMNS.min,
    maximum: HOME_LAYOUT_COLUMNS.max,
    testId: 'home-layout-columns',
  },
  sessionsPerProfile: {
    label: () => tr('每个 Profile 展示会话数（1–20）', 'Sessions per profile (1–20)'),
    hint: () => tr('卡片中展示的最近会话条数，较旧会话仍可在会话列表中打开。', 'Recent sessions kept on each card. Older conversations remain available in the session list.'),
    minimum: HOME_LAYOUT_SESSIONS.min,
    maximum: HOME_LAYOUT_SESSIONS.max,
    testId: 'home-layout-sessions',
  },
};

function invalidMessage(key: LayoutKey): string {
  const field = FIELD_COPY[key];
  const fallback = HOME_LAYOUT_DEFAULTS[key];
  return tr(
    `输入需为 ${field.minimum}–${field.maximum} 的整数；已恢复默认值 ${fallback} 并保存。`,
    `Enter a whole number from ${field.minimum}–${field.maximum}. Default ${fallback} restored and saved.`,
  );
}

export async function renderHomeLayoutSettings(panel: HTMLElement, fetchJSON: FetchJSON): Promise<void> {
  const section = document.createElement('section');
  section.className = 'home-layout-settings';
  section.setAttribute('data-testid', 'home-layout-settings');

  const title = document.createElement('h2');
  title.textContent = tr('首页布局', 'Home layout');
  const description = document.createElement('p');
  description.className = 'home-layout-description';
  description.textContent = tr(
    '控制桌面首页的卡片密度。设置只影响当前 Profile，手机端保持单列。',
    'Choose desktop home density. Settings apply to the current profile; phones stay single-column.',
  );
  const fields = document.createElement('div');
  fields.className = 'home-layout-fields';
  const status = document.createElement('p');
  status.className = 'home-layout-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  section.append(title, description, fields, status);
  panel.append(section);

  const profile = currentProfile();
  let layout: HomeLayout = { ...HOME_LAYOUT_DEFAULTS };
  let busy = false;
  const inputs = {} as Record<LayoutKey, HTMLInputElement>;

  const setInputs = () => {
    for (const key of Object.keys(FIELD_COPY) as LayoutKey[]) inputs[key].value = String(layout[key]);
  };
  const setDisabled = (disabled: boolean) => {
    for (const input of Object.values(inputs)) input.disabled = disabled;
  };

  for (const key of Object.keys(FIELD_COPY) as LayoutKey[]) {
    const copy = FIELD_COPY[key];
    const label = document.createElement('label');
    label.className = 'home-layout-field';
    const name = document.createElement('span');
    name.textContent = copy.label();
    const hint = document.createElement('small');
    hint.textContent = copy.hint();
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = String(copy.minimum);
    input.max = String(copy.maximum);
    input.step = '1';
    input.value = String(layout[key]);
    input.disabled = true;
    input.setAttribute('data-testid', copy.testId);
    input.addEventListener('change', async () => {
      if (busy) return;
      const parsed = Number(input.value.trim());
      const valid = Number.isInteger(parsed) && parsed >= copy.minimum && parsed <= copy.maximum;
      const value = valid ? parsed : HOME_LAYOUT_DEFAULTS[key];
      input.value = String(value);
      if (value === layout[key] && valid) return;
      const next = { ...layout, [key]: value };
      busy = true;
      setDisabled(true);
      try {
        layout = await saveHomeLayout(fetchJSON, profile, next);
        setInputs();
        status.textContent = valid
          ? tr('已保存，返回首页即生效。', 'Saved. The home page updates when you return.')
          : invalidMessage(key);
        announceHomeLayout(layout);
      } catch {
        setInputs();
        status.textContent = tr('保存失败，请重试。', 'Save failed. Retry.');
      } finally {
        busy = false;
        setDisabled(false);
      }
    });
    inputs[key] = input;
    label.append(name, hint, input);
    fields.append(label);
  }

  try {
    const loaded = await loadHomeLayout(fetchJSON, profile);
    layout = loaded.layout;
    setInputs();
    if (loaded.invalid.length) status.textContent = tr('已保存的设置无效，已回退默认值。', 'Saved values were invalid. Defaults restored.');
    setDisabled(false);
  } catch {
    status.textContent = tr('首页布局设置加载失败，请重新打开。', 'Home layout settings are unavailable. Reopen to retry.');
  }
}
