import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('真实主页、项目与 Fleet 看板', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const consoleLog: string[] = [];
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleLog.push(message.text().replace(/token=[^'& ]+/g, 'token=REDACTED')); });
  page.on('pageerror', error => errors.push(error.message));
  const assets = JSON.parse(readFileSync('dashboard/dist/build-provenance.json', 'utf8')).assets;
  const loaded: string[] = [];
  const checks: Promise<void>[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (!/^\/dashboard-plugins\/(?:@[^/]+\/)?workbench\//.test(url.pathname)) return;
    const name = url.pathname.endsWith('/dist/index.js') ? 'index.js' : url.pathname.endsWith('/dist/style.css') ? 'style.css' : '';
    if (name) checks.push(response.body().then(body => {
      expect(createHash('sha256').update(body).digest('hex')).toBe(assets[name]);
      loaded.push(name);
    }));
  });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(({ theme }) => {
    localStorage.setItem('hermes-dashboard-theme', `workbench-${theme}`);
    localStorage.setItem('hermes-dashboard-language', 'zh');
  }, { theme: testInfo.project.use.colorScheme as string });
  await page.goto('/workbench');
  await expect(page.locator('.profile-overview')).toBeVisible();
  await page.evaluate(async theme => {
    const sdk = (window as any).__HERMES_PLUGIN_SDK__;
    const response = await sdk.authedFetch('/api/dashboard/theme', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `workbench-${theme}` }),
    });
    if (!response.ok) throw new Error(`Theme update failed: ${response.status}`);
  }, testInfo.project.use.colorScheme);
  await page.reload();
  await expect(page.locator('.profile-session').first()).toContainText('验收');
  await page.addStyleTag({ url: '/__acceptance/fonts/400.css' });
  await page.addStyleTag({ url: '/__acceptance/fonts/700.css' });
  await page.addStyleTag({ content: '* { font-family: "Noto Sans SC", sans-serif !important; animation: none !important; transition: none !important; }' });
  await page.evaluate(async () => { await document.fonts.load('16px "Noto Sans SC"', '中文验收'); await document.fonts.ready; });
  expect(await page.evaluate(() => document.fonts.check('16px "Noto Sans SC"'))).toBe(true);
  await Promise.all(checks);
  expect(loaded).toEqual(expect.arrayContaining(['index.js', 'style.css']));
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.title()).toBeTruthy();
  await expect(page.locator('html')).toHaveAttribute('data-workbench-theme', testInfo.project.use.colorScheme as string);
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  await page.locator('.profile-new-session').first().focus();
  await page.keyboard.press('w');
  await expect(page.locator('.workbench-actions-dialog')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('menu.png') });
  await page.keyboard.press('Escape');
  await page.goto('/kanban');
  await expect(page.getByText('验收：长中文任务标题在桌面和手机屏幕上均可阅读且不会遮挡按钮', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.addStyleTag({ url: '/__acceptance/fonts/400.css' });
  await page.addStyleTag({ url: '/__acceptance/fonts/700.css' });
  await page.addStyleTag({ content: '* { font-family: "Noto Sans SC", sans-serif !important; }' });
  await page.screenshot({ path: testInfo.outputPath('kanban.png'), fullPage: true });
  await testInfo.attach('console.json', { body: JSON.stringify(consoleLog, null, 2), contentType: 'application/json' });
  expect(consoleLog.filter(line => !line.includes('WebSocket is closed before the connection is established.'))).toEqual([]);
  expect(errors).toEqual([]);
});
