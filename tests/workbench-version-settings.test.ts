// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { renderModelVisibilityPanel, renderVersionSettingsPanel, renderWorkbenchVersions } from '../dashboard/src/workbench-version-settings';
import type { ModelDisplay } from '../dashboard/src/model-display';
let saved: ModelDisplay;
function preferencesResponse(init?: RequestInit) {
  if (init?.body) saved = { ...JSON.parse(String(init.body)), revision: saved.revision + 1 };
  return new Response(JSON.stringify({ preferences: saved }));
}

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
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/model-display')) return preferencesResponse(init);
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
  await vi.waitFor(() => expect(showAll.disabled).toBe(false));
  showAll.click();
  await vi.waitFor(() => expect(target.querySelector('[data-model-visibility-status]')?.textContent).toContain('已恢复显示全部'));
  expect(showAll.disabled).toBe(true);
  expect(target.querySelector('input[value="deepseek/deepseek-flash"]')?.closest('.workbench-model-option')?.getAttribute('data-visible')).toBe('true');
});

it('saves a server chat display alias per profile and rejects duplicate aliases', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/model-display')) return preferencesResponse(init);
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
  let deepseekAlias = target.querySelector<HTMLInputElement>('[data-model-alias="deepseek/deepseek-flash"]')!;
  deepseekAlias.value = '  ds   flash  ';
  deepseekAlias.dispatchEvent(new Event('change'));
  expect(deepseekAlias.value).toBe('ds flash');
  await vi.waitFor(() => expect(saved.aliases).toEqual({ 'deepseek/deepseek-flash': 'ds flash' }));
  await vi.waitFor(() => expect(target.querySelector('[data-model-visibility-status]')?.textContent).toContain('ds flash'));
  expect(target.querySelector('[data-model-visibility-status]')?.textContent).toContain('ds flash');

  const gptAlias = target.querySelector<HTMLInputElement>('[data-model-alias="gpt-6.1-sol"]')!;
  gptAlias.value = 'DS FLASH';
  gptAlias.dispatchEvent(new Event('change'));
  expect(gptAlias.dataset.invalid).toBe('true');
  expect(target.querySelector('.workbench-model-alias-error')?.textContent).toContain('deepseek/deepseek-flash');
  await vi.waitFor(() => expect(saved.aliases).toEqual({ 'deepseek/deepseek-flash': 'ds flash' }));


  deepseekAlias = target.querySelector<HTMLInputElement>('[data-model-alias="deepseek/deepseek-flash"]')!;
  deepseekAlias.value = '';
  deepseekAlias.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(saved.aliases).toEqual({}));
  await vi.waitFor(() => expect(target.querySelector('[data-model-visibility-status]')?.textContent).toContain('已恢复原名'));
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

beforeEach(() => { document.documentElement.lang = 'zh-CN'; saved = { mode: 'hidden', visible: [], hidden: [], aliases: {}, revision: 1 }; });

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

it('waits for the background release check instead of claiming the runtime is current', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/codex-runtime/status')) {
      return new Response(JSON.stringify({ installed_version: '0.165.0', latest_version: null, update_available: false, busy: false, version_check_stale: true }));
    }
    return new Response(JSON.stringify(data));
  }));
  document.body.innerHTML = '<section></section>';
  const target = document.querySelector('section')!;
  await renderVersionSettingsPanel(target);
  await vi.waitFor(() => expect(target.querySelector('[data-codex-runtime-status]')!.textContent)
    .toContain('正在后台检查可更新版本'));
  expect(target.querySelector<HTMLButtonElement>('[data-codex-runtime-update]')!.hidden).toBe(true);
});

it.each(['alias', 'visibility', 'show-all'])('rolls back %s after a failed server save and enables retry', async kind => {
  saved = { mode: 'visible', visible: ['gpt-6-astra', 'gpt-6-luna'], hidden: [], aliases: { 'gpt-6-astra': 'astra' }, revision: 1 };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/model-display')) {
      if (init?.method === 'PUT') return new Response('unavailable', { status: 503 });
      return preferencesResponse();
    }
    if (url.includes('/models')) return new Response(JSON.stringify({ data: [{ model: 'gpt-6-astra' }, { model: 'gpt-6-luna' }, { model: 'gpt-hidden' }] }));
    return new Response('{}');
  }));
  const target = document.createElement('section');
  document.body.append(target);
  await renderModelVisibilityPanel(target, 'default');
  if (kind === 'alias') {
    const input = target.querySelector<HTMLInputElement>('[data-model-alias="gpt-6-astra"]')!;
    input.value = 'changed'; input.dispatchEvent(new Event('change'));
  } else if (kind === 'visibility') {
    const input = target.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    input.checked = false; input.dispatchEvent(new Event('change'));
  } else target.querySelector<HTMLButtonElement>('[data-model-show-all]')!.click();
  await vi.waitFor(() => expect(target.querySelector('[role=status]')?.textContent).toContain('保存失败'));
  expect(target.querySelector<HTMLInputElement>('[data-model-alias="gpt-6-astra"]')!.value).toBe('astra');
  expect(target.querySelector<HTMLInputElement>('input[value="gpt-6-astra"]')!.checked).toBe(true);
  expect(target.querySelector<HTMLInputElement>('input[value="gpt-hidden"]')!.checked).toBe(false);
  expect(target.querySelector<HTMLInputElement>('input')!.disabled).toBe(false);
  expect(localStorage.length).toBe(0);
});

it('renders release Markdown, plain paragraphs, and only safe external links', async () => {
  const notes = "## What's Changed\n\n* **Fix** `release` by @author in https://github.com/example/repo/pull/123\n* [commit](http://github.com/example/repo/commit/abc)\n\nBuilt from main commit abc.\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [data](data:text/html,evil) [mail](mailto:test@example.com) [relative](/config) [protocol-relative](//example.com) [encoded](javascript&#58;alert%281%29)\n\n![image](https://example.com/tracker.png)";
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ active: '1', versions: [{ version: '1', notes }] }))));
  const target = panel();
  await renderWorkbenchVersions(target);
  const body = target.querySelector('.workbench-version-notes > div')!;
  expect(body.querySelector('h2')?.textContent).toBe("What's Changed");
  expect(body.querySelectorAll('ul > li')).toHaveLength(2);
  expect(body.querySelector('strong')?.textContent).toBe('Fix');
  expect(body.querySelector('code')?.textContent).toBe('release');
  expect(Array.from(body.querySelectorAll('p')).some(p => p.textContent === 'Built from main commit abc.')).toBe(true);
  expect(body.querySelector('script, img')).toBeNull();
  expect(body.textContent).toContain('<script>alert(1)</script>');
  expect(body.querySelectorAll('a')).toHaveLength(2);
  for (const link of body.querySelectorAll('a')) {
    expect(link.href).toMatch(/^https?:\/\//);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  }
});

it('keeps plain release descriptions and empty-note fallback in paragraphs', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ active: '1', versions: [
    { version: '1', notes: 'Built from main commit abc.' }, { version: '2' },
  ] }))));
  const target = panel();
  await renderWorkbenchVersions(target);
  expect(Array.from(target.querySelectorAll('.workbench-version-notes p'), p => p.textContent))
    .toEqual(['Built from main commit abc.', '此版本暂无更新日志。']);
});
