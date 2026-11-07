import { uiText as tr } from './ui-locale';
import type { FetchJSON } from './workbench-api';
import './execution-settings.css';

export type ExecutionMode = 'foreground' | 'background';
type Preferences = { mode: ExecutionMode };

function preferencesUrl(profile: string): string {
  return `/api/plugins/workbench/execution-preferences?profile=${encodeURIComponent(profile)}`;
}

/** A server-owned setting; stale browser storage cannot silently enable dispatch. */
export async function renderExecutionSettings(panel: HTMLElement, read: FetchJSON, profile: string): Promise<void> {
  panel.innerHTML = `
    <header class="workbench-settings-subpage-header">
      <h1>${tr('任务执行', 'Task execution')}</h1>
      <p>${tr('设置只影响当前配置档案，从下一条消息起生效。', 'Applies to this profile from the next message, in new and existing conversations.')}</p>
      <p data-profile></p>
    </header>
    <fieldset class="workbench-execution-options" disabled>
      <legend>${tr('默认执行方式', 'Default execution mode')}</legend>
    </fieldset>
    <p class="workbench-chat-display-status" role="status"></p>
    <button type="button" class="workbench-execution-retry" hidden>${tr('重新加载', 'Retry loading')}</button>
    <p class="workbench-execution-note">${tr('消息中明确指定的方式优先。切换不影响已派发的任务。', 'Explicit requests in your messages take priority. Switching leaves already dispatched tasks unchanged.')}</p>`;
  panel.querySelector('[data-profile]')!.textContent = tr('当前配置档案：', 'Current profile: ') + profile;
  const fields = panel.querySelector<HTMLFieldSetElement>('fieldset')!;
  const status = panel.querySelector<HTMLElement>('[role="status"]')!;
  const retry = panel.querySelector<HTMLButtonElement>('button')!;
  const inputs = new Map<ExecutionMode, HTMLInputElement>();
  let saved: ExecutionMode | null = null;
  const sync = () => inputs.forEach((input, mode) => { input.checked = mode === saved; });
  const options: { mode: ExecutionMode; title: string; description: string }[] = [
    {
      mode: 'foreground', title: tr('前台执行（默认）', 'Foreground (default)'),
      description: tr('在当前会话中完成任务，持续展示进度并返回结果。', 'Work through tasks here, with progress and results in the conversation.'),
    },
    {
      mode: 'background', title: tr('后台派发', 'Background dispatch'),
      description: tr('将适合后台执行的较长任务交给工作智能体，派发后返回任务入口。', 'Send substantial tasks to background workers and return a task reference after dispatch.'),
    },
  ];
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'workbench-execution-option';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'workbench-execution-mode'; input.value = option.mode;
    input.setAttribute('data-testid', `execution-mode-${option.mode}`);
    label.innerHTML = `<span><strong>${option.title}</strong><span>${option.description}</span></span>`;
    label.prepend(input); fields.append(label);
    inputs.set(option.mode, input);
    input.addEventListener('change', async () => {
      if (!input.checked || fields.disabled || saved === option.mode) return;
      fields.disabled = true;
      status.textContent = tr('正在保存…', 'Saving…');
      try {
        const value = await read<Preferences>(preferencesUrl(profile), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: option.mode }),
        });
        saved = value.mode === 'background' ? 'background' : 'foreground';
        status.textContent = tr('已保存，从下一条消息起生效。', 'Saved. Applies from the next message.');
      } catch {
        status.textContent = tr('保存未确认，请重新加载设置后确认。', 'Save was not confirmed. Reload settings to check the current mode.');
        retry.hidden = false;
      } finally {
        sync(); fields.disabled = !retry.hidden;
      }
    });
  }
  const load = async () => {
    fields.disabled = true; retry.hidden = true;
    status.textContent = tr('正在加载…', 'Loading…');
    try {
      const value = await read<Preferences>(preferencesUrl(profile), { cache: 'no-store' });
      if (!panel.contains(fields)) return;
      saved = value.mode === 'background' ? 'background' : 'foreground';
      sync(); fields.disabled = false; status.textContent = '';
    } catch {
      status.textContent = tr('设置加载失败，请重试。', 'Settings could not be loaded. Retry.');
      retry.hidden = false;
    }
  };
  retry.addEventListener('click', () => { void load(); });
  await load();
}

export function createExecutionSettings(sdk: any) {
  const h = sdk.React.createElement;
  const { useEffect, useRef } = sdk.hooks;
  return function ExecutionSettings({ profile }: { profile: string }) {
    const ref = useRef(null as HTMLElement | null);
    useEffect(() => {
      const panel = ref.current;
      if (!panel) return;
      const render = () => { void renderExecutionSettings(panel, sdk.fetchJSON, profile); };
      render();
      const observer = new MutationObserver(render);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      return () => observer.disconnect();
    }, [profile]);
    return h('section', { ref, className: 'workbench-settings-subpage', 'data-testid': 'execution-settings' });
  };
}
