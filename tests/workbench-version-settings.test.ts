// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { renderModelVisibilityPanel, renderWorkbenchVersions } from '../dashboard/src/workbench-version-settings';
import { readModelAliases } from '../dashboard/src/model-aliases';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); });
function panel() {
  document.body.innerHTML = '<section><div class="workbench-version-list"></div></section>';
  return document.querySelector('section')!;
}
const data = { active: '0.6.43-codex.14', versions: [
  { version: '0.7.0', ready: false, source: 'github', notes: '<img src=x onerror=alert(1)>\nRelease notes' },
  { version: '0.6.43-codex.14', ready: true },
] };
it('shows release notes safely and performs no update until clicked', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
  vi.stubGlobal('fetch', fetcher);
  const target = panel();
  await renderWorkbenchVersions(target);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(target.querySelector('img')).toBeNull();
  expect(target.querySelector('details')!.textContent).toContain('Release notes');
  expect(target.querySelector('button')!.textContent).toBe('更新到此版本');
  expect(target.querySelectorAll('button')).toHaveLength(1);
});
it('reports update errors and restores controls for retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data)))
    .mockRejectedValueOnce(new Error('offline')));
  const target = panel();
  const reload = vi.fn();
  await renderWorkbenchVersions(target, reload);
  target.querySelector('button')!.click();
  await vi.waitFor(() => expect(target.querySelector('[role=status]')!.textContent).toContain('offline'));
  expect(target.querySelector('button')!.disabled).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});
it('switches exactly the chosen version and refreshes after success', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal('fetch', fetcher);
  const target = panel();
  const reload = vi.fn();
  await renderWorkbenchVersions(target, reload);
  target.querySelector('button')!.click();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ version: '0.7.0' });
});

it('waits through backend restart and reloads only after full activation', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...data, update_mode: 'release' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ pending: true, job_id: 'job' })))
      .mockRejectedValueOnce(new Error('backend restarting'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job', phase: 'succeeded' })));
    vi.stubGlobal('fetch', fetcher);
    const target = panel();const reload = vi.fn();
    await renderWorkbenchVersions(target, reload);
    target.querySelector('button')!.click();
    await vi.advanceTimersByTimeAsync(1300);
    expect(reload).not.toHaveBeenCalled();
    expect(target.querySelector('button')!.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1300);
    expect(reload).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it('renders grouped model visibility cards, updates counts, and disables Show all when none are hidden', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/codex/models')) {
      return new Response(JSON.stringify({
        data: [
          { model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', isDefault: true, supportsFast: true },
          { model: 'deepseek/deepseek-flash', displayName: 'DeepSeek Flash', isDefault: false, supportsFast: false },
        ],
      }));
    }
    return new Response(JSON.stringify({ model: 'gpt-6.1-sol' }));
  }));
  const target = document.createElement('section');
  document.body.append(target);
  await renderModelVisibilityPanel(target, 'writer');
  expect(target.querySelector('[data-model-profile]')?.textContent).toBe('writer');
  const showAll = target.querySelector<HTMLButtonElement>('[data-model-show-all]')!;
  expect(showAll.disabled).toBe(true);
  const secondCheckbox = target.querySelector<HTMLInputElement>('input[value="deepseek/deepseek-flash"]')!;
  secondCheckbox.checked = false;
  secondCheckbox.dispatchEvent(new Event('change'));
  expect(secondCheckbox.closest('.workbench-model-option')?.getAttribute('data-visible')).toBe('false');
  expect(showAll.disabled).toBe(false);
  showAll.click();
  expect(showAll.disabled).toBe(true);
  expect(target.querySelector('input[value="deepseek/deepseek-flash"]')?.closest('.workbench-model-option')?.getAttribute('data-visible')).toBe('true');
});

it('saves a shared chat display alias per model and rejects duplicate aliases', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/codex/models')) {
      return new Response(JSON.stringify({
        data: [
          { model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', isDefault: true },
          { model: 'deepseek/deepseek-flash', displayName: 'DeepSeek Flash', isDefault: false },
        ],
      }));
    }
    return new Response(JSON.stringify({ model: 'gpt-6.1-sol' }));
  }));
  const target = document.createElement('section');
  document.body.append(target);
  await renderModelVisibilityPanel(target, 'writer');
  const deepseekAlias = target.querySelector<HTMLInputElement>('[data-model-alias="deepseek/deepseek-flash"]')!;
  deepseekAlias.value = '  ds   flash  ';
  deepseekAlias.dispatchEvent(new Event('change'));
  expect(deepseekAlias.value).toBe('ds flash');
  expect([...readModelAliases()]).toEqual([['deepseek/deepseek-flash', 'ds flash']]);
  expect(target.querySelector('[data-model-visibility-status]')?.textContent).toContain('ds flash');

  const gptAlias = target.querySelector<HTMLInputElement>('[data-model-alias="gpt-6.1-sol"]')!;
  gptAlias.value = 'DS FLASH';
  gptAlias.dispatchEvent(new Event('change'));
  expect(gptAlias.dataset.invalid).toBe('true');
  expect(target.querySelector('.workbench-model-alias-error')?.textContent).toContain('deepseek/deepseek-flash');
  expect([...readModelAliases()]).toEqual([['deepseek/deepseek-flash', 'ds flash']]);

  deepseekAlias.value = '';
  deepseekAlias.dispatchEvent(new Event('change'));
  expect([...readModelAliases()]).toEqual([]);
  expect(target.querySelector('[data-model-visibility-status]')?.textContent).toContain('已恢复原名');
});

it('shows rollback and re-enables controls without claiming success', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ pending: true, job_id: 'job' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job', phase: 'failed', error: '已回滚原版本' }))));
    const target = panel();const reload = vi.fn();
    await renderWorkbenchVersions(target, reload);target.querySelector('button')!.click();
    await vi.advanceTimersByTimeAsync(1300);
    expect(target.querySelector('[role=status]')!.textContent).toContain('已回滚');
    expect(target.querySelector('button')!.disabled).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

beforeEach(() => { document.documentElement.lang = 'zh-CN'; });

it('shows byte progress while the switch request is still downloading', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/versions')) return new Response(JSON.stringify({ ...data, update_mode: 'release' }));
      if (url.endsWith('/switch')) return new Promise<Response>(resolve => { finish = resolve; });
      return new Response(JSON.stringify({ id: 'job', version: '0.7.0', phase: 'preparing', stage: 'downloading', received: 1048576, total: 2097152 }));
    }));
    const target = panel();const reload = vi.fn();
    await renderWorkbenchVersions(target, reload);target.querySelector('button')!.click();
    await vi.advanceTimersByTimeAsync(800);
    expect(target.querySelector('progress')!.value).toBe(50);
    expect(target.querySelector('[role=status]')!.textContent).toContain('1.0 MB / 2.0 MB');
    expect(target.querySelector('button')!.disabled).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    finish(new Response(JSON.stringify({ ok: true })));
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
