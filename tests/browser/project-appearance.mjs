import { openSessionNavigation } from './navigation-helpers.mjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const groups = [];
  await page.route('**/api/plugins/workbench/codex/groups**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/appearance')) {
      Object.assign(groups[0], route.request().postDataJSON());
      return route.fulfill({ json: { group: groups[0] } });
    }
    if (route.request().method() === 'POST') {
      groups.push({ id: 'custom', name: route.request().postDataJSON().name });
      return route.fulfill({ json: { group: groups[0] } });
    }
    return route.fulfill({ json: { items: groups } });
  });
  await page.route('**/api/plugins/workbench/codex/sessions?*', async route => {
    const response = await route.fetch(), data = await response.json();
    for (const session of data.items || []) if (session.id === 'codex-preview') { session.groupId = 'custom'; session.color = '#ff0000'; }
    await route.fulfill({ response, json: data });
  });
  await page.goto(host.origin + '/chat?session=codex-preview&profile=default');
  await openSessionNavigation(page);
  await page.locator('.project-temporary').waitFor();
  assert.equal(await page.locator('.project-navigation').count(), 1);
  assert.equal(await page.locator('.project-navigation-resizer').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'New project', exact: true }).count(), 0, 'Empty project lists keep the creation guard');
  groups.push({ id: 'custom', name: 'Custom project' });
  await page.reload();
  await openSessionNavigation(page);
  await page.locator('.project-folder').waitFor();
  await page.locator('.project-folder-heading').focus();
  await page.getByRole('button', { name: 'Edit project appearance: Custom project', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Project appearance', exact: true });
  await editor.getByLabel('Color', { exact: true }).selectOption('green');
  await editor.getByLabel('Icon', { exact: true }).selectOption('star');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.codex-project-color-mark')?.style.color === 'rgb(51, 155, 114)');
  assert.equal(await page.locator('.codex-center-header button').count(), 1);
  assert.equal(await page.locator('.codex-center-header input').count(), 0);
  await page.reload();
  await page.locator(".codex-pane-slot").first().waitFor();
  await openSessionNavigation(page);
  await page.locator('.project-folder').waitFor();
  assert.equal(await page.locator('.project-icon-edit .project-appearance-mark').textContent(), '☆');
  assert.equal(await page.locator('.project-icon-edit .project-appearance-mark').evaluate(n => getComputedStyle(n).color), 'rgb(51, 155, 114)');
  assert.equal(await page.locator('.codex-project-color-mark').evaluate(n => getComputedStyle(n).color), 'rgb(51, 155, 114)');
  if (process.env.WORKBENCH_SCREENSHOT_DIR) {
    const output = process.env.WORKBENCH_SCREENSHOT_DIR;
    await mkdir(output, { recursive: true });
    const toggle = page.locator('.dashboard-mobile-toggle').first();
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await page.addStyleTag({ content: '#preview-banner { display: none; }' });
    for (const [name, width, height, theme] of [['project-desktop-light', 1440, 1000, 'light'], ['project-desktop-dark', 1440, 1000, 'dark'], ['project-mobile-light', 390, 844, 'light']]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
      await page.screenshot({ path: `${output}/${name}.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: empty sidebar creation guard, appearance editing, persisted list/title after reload');
} finally { await browser.close(); await host.close(); }
