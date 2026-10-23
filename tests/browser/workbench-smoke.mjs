/**
 * Load the built Workbench bundle in a real browser with the local fixture host.
 * This catches render-time failures that pure-function tests cannot observe.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost();
const browser = await chromium.launch({ headless: true });
try {
  for (const [route, selector] of [
    ['/sessions?profile=default', '.workbench-recent-home'],
    ['/chat?session=codex-preview&profile=default', '.codex-pane-slot'],
    ['/chat?session=codex-preview&profile=writer', '.codex-pane-slot'],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.goto(host.origin + route, { waitUntil: 'domcontentloaded' });
    await page.locator(selector).first().waitFor({ state: 'attached', timeout: 5000 });
    await page.waitForTimeout(300);
    const fixtureErrors = await page.evaluate(() => window.__smokeErrors);
    assert.deepEqual(errors, [], `Browser errors on ${route}:\n${errors.join('\n')}`);
    assert.deepEqual(fixtureErrors, [], `Fixture errors on ${route}:\n${fixtureErrors.join('\n')}`);
    await page.close();
  }

  const filesPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const fileErrors = [];
  filesPage.on('pageerror', error => fileErrors.push(error.stack || error.message));
  await filesPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await filesPage.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 5000 });
  await filesPage.evaluate(() => document.querySelector('.dashboard-workspace-button')?.click());
  await filesPage.waitForFunction(() => document.querySelectorAll('.hti-tree-row').length > 0, null, { timeout: 5000 });
  await filesPage.evaluate(() => {
    [...document.querySelectorAll('.hti-tree-row')]
      .find(row => row.textContent?.includes('README.md'))?.click();
  });
  await filesPage.locator('.hti-codex-file-modal-actions').waitFor({ state: 'visible', timeout: 5000 });
  const fileActions = await filesPage.evaluate(() =>
    [...document.querySelectorAll('.hti-codex-file-modal-actions button, .hti-codex-file-modal-actions a')]
      .map(action => ({
        text: action.textContent?.trim() || '',
        label: action.getAttribute('aria-label') || '',
        title: action.getAttribute('title') || '',
        hasIcon: Boolean(action.querySelector('svg')),
      })));
  assert.equal(fileActions.length, 5, 'File renderer should expose five action controls');
  for (const action of fileActions) {
    assert.equal(action.text, '', 'File renderer actions must not show text labels');
    assert.ok(action.label, 'Every file action needs an accessible label');
    assert.ok(action.title, 'Every file action needs a tooltip');
    assert.equal(action.hasIcon, true, 'Every file action must render an icon');
  }
  assert.deepEqual(fileErrors, [], `Browser errors in the file renderer:\n${fileErrors.join('\n')}`);
  await filesPage.close();

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(host.origin + '/profiles?profile=default&panel=1', { waitUntil: 'domcontentloaded' });
  await page.locator('.dashboard-owned-page').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.dashboard-settings-nav').waitFor({ state: 'visible', timeout: 5000 });
  const layout = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      if (!rect) throw new Error(`Missing ${selector}`);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      backdrop: box('.dashboard-accessory-backdrop'),
      settings: box('.dashboard-settings-nav'),
      page: box('.dashboard-owned-page'),
      navInert: Boolean(document.querySelector('.dashboard-global-nav')?.inert),
    };
  });
  const viewport = page.viewportSize();
  assert.equal(Math.round(layout.backdrop.left), 0, 'Backdrop must cover the navigation');
  assert.equal(Math.round(layout.backdrop.right), viewport.width, 'Backdrop must cover the viewport');
  assert.equal(Math.round(layout.backdrop.top), 0, 'Backdrop must start at the viewport top');
  assert.equal(Math.round(layout.backdrop.bottom), viewport.height, 'Backdrop must cover the viewport bottom');
  assert.ok(Math.abs((layout.settings.left + layout.page.right) / 2 - viewport.width / 2) <= 1, 'Floating panel must be horizontally centered');
  assert.ok(Math.abs((layout.settings.top + layout.page.bottom) / 2 - viewport.height / 2) <= 1, 'Floating panel must be vertically centered');
  assert.equal(layout.page.left, layout.settings.right, 'Settings navigation must sit against the panel content');
  assert.equal(layout.navInert, true, 'Navigation must be inert behind the floating panel');
  assert.deepEqual(errors, [], `Browser errors on the floating panel:\n${errors.join('\n')}`);
  await page.close();

  console.log('Workbench browser smoke passed: home, default/writer chat panes, icon-only file actions, and the centered floating panel rendered without page errors.');
} finally {
  await browser.close();
  await host.close();
}
