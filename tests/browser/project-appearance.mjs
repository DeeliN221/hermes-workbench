import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  await page.goto(host.origin + '/chat?session=codex-preview&profile=default');
  await page.locator('.project-temporary').waitFor();
  assert.equal(await page.locator('.project-navigation').count(), 0);
  assert.equal(await page.locator('.project-navigation-resizer').count(), 0);
  await page.locator('.project-temporary').getByRole('button', { name: 'New temporary session', exact: true }).click({ button: 'right' });
  const name = page.locator('input[name="project-name"]');
  await name.fill('Custom project');
  await name.press('Enter');
  await page.locator('.project-folder').waitFor();
  await page.locator('.project-folder-heading').focus();
  await page.getByRole('button', { name: 'Edit project appearance: Custom project', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Project appearance', exact: true });
  await editor.getByLabel('Color', { exact: true }).selectOption('green');
  await editor.getByLabel('Icon', { exact: true }).selectOption('star');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  await page.reload();
  await page.locator('.project-folder').waitFor();
  assert.equal(await page.locator('.project-folder-heading .project-appearance-mark').textContent(), '☆');
  assert.equal(await page.locator('.project-folder-heading .project-appearance-mark').evaluate(n => getComputedStyle(n).color), 'rgb(51, 155, 114)');
  assert.deepEqual(errors, []);
  console.log('PASS: empty sidebar, right-click project creation, appearance editing, persisted list/title after reload');
} finally { await browser.close(); await host.close(); }
