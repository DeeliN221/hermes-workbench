/** Verify the phone action rail starts at Home without a workbench entry or divider. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const shots = process.env.SHOT_DIR || 'artifacts/mobile-action-rail-20261104';
await mkdir(shots, { recursive: true });
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  for (const width of [390, 430]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(host.origin + '/');
    await page.locator('.profile-session-project').first().waitFor();
    await page.evaluate(theme => {
      document.documentElement.dataset.workbenchTheme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, theme);

    const rail = page.locator('.dashboard-action-rail');
    assert.equal(await rail.locator('.workbench-launcher').count(), 0);
    assert.equal(await rail.locator('a[href*="/workbench"]').count(), 0);
    assert.equal(await rail.locator('.dashboard-rail-top').evaluate(node => getComputedStyle(node).borderBottomWidth), '0px');
    assert.deepEqual(await rail.locator('a, button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), [
      'Open navigation', 'Home', 'Search', 'Settings', 'Kanban', 'Scheduled jobs', 'Terminal', 'Files',
      'Switch to dark theme', 'Achievements',
    ]);
    const home = await rail.locator('a[aria-label="Home"]').boundingBox();
    const search = await rail.locator('button[aria-label="Search"]').boundingBox();
    assert.ok(home && search && search.y >= home.y + home.height && search.y - (home.y + home.height) <= 4);
    await page.screenshot({ path: `${shots}/mobile-${width}-${theme}.png` });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Mobile action rail localhost acceptance passed');
} finally { await browser.close(); await host.close(); }
