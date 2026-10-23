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
  console.log('Workbench browser smoke passed: home and default/writer chat panes rendered without page errors.');
} finally {
  await browser.close();
  await host.close();
}
