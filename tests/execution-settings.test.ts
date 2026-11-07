// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { renderExecutionSettings } from '../dashboard/src/execution-settings';
import type { FetchJSON } from '../dashboard/src/workbench-api';

afterEach(() => { document.body.replaceChildren(); document.documentElement.lang = 'en'; });

it('loads server defaults, persists changes and restores the previous option after a failed save', async () => {
  const panel = document.createElement('section'); document.body.append(panel);
  let mode = 'foreground', fail = false;
  const read = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/plugins/workbench/execution-preferences?profile=writer');
    if (init?.method === 'PUT') {
      if (fail) throw new Error('Unavailable');
      mode = JSON.parse(String(init.body)).mode;
    }
    return { mode };
  }) as unknown as FetchJSON;
  await renderExecutionSettings(panel, read, 'writer');
  const foreground = panel.querySelector<HTMLInputElement>('[value="foreground"]')!;
  const background = panel.querySelector<HTMLInputElement>('[value="background"]')!;
  expect(foreground.checked).toBe(true);
  background.click();
  await vi.waitFor(() => expect(panel.textContent).toContain('Saved. Applies from the next message.'));
  expect(mode).toBe('background');
  expect(background.checked).toBe(true);
  fail = true; foreground.click();
  await vi.waitFor(() => expect(panel.textContent).toContain('Save was not confirmed.'));
  expect(background.checked).toBe(true);
  expect(foreground.checked).toBe(false);
  expect(panel.querySelector('fieldset')!.disabled).toBe(true);
  await renderExecutionSettings(panel, read, 'writer');
  expect(panel.querySelector<HTMLInputElement>('[value="background"]')!.checked).toBe(true);
});

it('does not present an unverified default when loading fails, and supports retry', async () => {
  const panel = document.createElement('section'); document.body.append(panel);
  let fail = true;
  const read = (async () => { if (fail) throw new Error('Unavailable'); return { mode: 'background' }; }) as FetchJSON;
  await renderExecutionSettings(panel, read, 'default');
  expect(panel.querySelector('fieldset')!.disabled).toBe(true);
  expect(panel.querySelector('input:checked')).toBeNull();
  fail = false; panel.querySelector<HTMLButtonElement>('button')!.click();
  await vi.waitFor(() => expect(panel.querySelector('fieldset')!.disabled).toBe(false));
  expect(panel.querySelector<HTMLInputElement>('[value="background"]')!.checked).toBe(true);
});

it('renders Chinese labels and treats a legacy unset value as foreground', async () => {
  document.documentElement.lang = 'zh-CN';
  const panel = document.createElement('section'); document.body.append(panel);
  await renderExecutionSettings(panel, (async () => ({})) as FetchJSON, 'default');
  expect(panel.textContent).toContain('前台执行（默认）');
  expect(panel.textContent).toContain('后台派发');
  expect(panel.querySelector<HTMLInputElement>('[value="foreground"]')!.checked).toBe(true);
});
