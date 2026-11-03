/** Localhost UI acceptance, using public synthetic fixtures. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const before = process.env.BEFORE === '1';
const shots = process.env.SHOT_DIR || 'node_modules/.cache/compact-ui';
await mkdir(shots, { recursive: true });
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.route('**/api/plugins/workbench/profile-overview', route => route.fulfill({ json: { profiles: ['default', 'writer', 'research'].map(name => ({ name, failed: [], projects: [{ id: 'project', name: 'A very long project name for layout verification without overflow' }], sessions: [{ id: 'codex-preview', title: 'Review the next iteration', groupId: 'project', unread: true, status: 'running', updatedAt: Date.now() }] })) } }));
    await page.goto(host.origin + '/');
    await page.locator('.profile-session-project').first().waitFor();
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    const prefix = `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}`;
    await page.screenshot({ path: `${prefix}-home.png` });
    if (!before) {
      assert.equal(await page.locator('.profile-session-project > *').count(), 0);
      for (const label of await page.locator('.profile-session-project').all()) {
        const shape = await label.evaluate(node => { const rect = node.getBoundingClientRect(), row = node.closest('.profile-session').getBoundingClientRect(); return { align: getComputedStyle(node).textAlign, ellipsis: getComputedStyle(node).textOverflow, clipped: node.scrollWidth > node.clientWidth, right: rect.right, rowRight: row.right }; });
        assert.equal(shape.align, 'right'); assert.equal(shape.ellipsis, 'ellipsis'); assert.equal(shape.clipped, true); assert.ok(Math.abs(shape.rowRight - shape.right - 10) < 2);
      }
      if (!mobile) assert.equal(await page.locator('.profile-overview-columns').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 3);
    }
    if (!before) {
      await page.locator('.profile-new-session').first().focus();
      await page.keyboard.press('w');
      await page.locator('.workbench-actions-dialog .codex-session-search-trigger').click();
      const homeSearch = page.locator('dialog.codex-session-search-dialog-backdrop');
      await homeSearch.waitFor({ state: 'visible' });
      assert.equal(await homeSearch.locator('input').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Escape');
    }
    // Start from a visible trigger to verify focus restoration.
    await page.goto(host.origin + '/chat?session=codex-preview&profile=default');
    await page.locator('.codex-pane-slot').first().waitFor();
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    const launcher = page.locator(mobile ? '.workbench-launcher:visible' : '.codex-pane-color-trigger:visible').first();
    const openMenu = async () => { await launcher.focus(); if (mobile) await launcher.click(); else await page.keyboard.press('w'); };
    if (before && mobile) { await page.close(); continue; }
    await openMenu();
    const menu = page.locator('.workbench-actions-dialog');
    await menu.waitFor({ state: 'visible' });
    await page.screenshot({ path: `${prefix}-menu.png` });
    if (before) { await page.close(); continue; }
    assert.equal(await menu.locator(':scope > *').count(), 1);
    const items = menu.locator('a, button');
    assert.equal(await items.count(), 9);
    assert.deepEqual(await items.evaluateAll(nodes => nodes.map(node => node.textContent.trim())), ['Home', 'Search sessions', 'Settings', 'Kanban', 'Scheduled jobs', 'Terminal', 'Files', 'Theme', 'Achievements']);
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height);
    assert.match(await items.nth(1).textContent(), /Search sessions/);
    assert.equal(await items.first().evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await items.last().evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await items.first().evaluate(node => node === document.activeElement), true);
    // Padding inside the grid does not dismiss the menu.
    await menu.click({ position: { x: 5, y: 5 } });
    assert.equal(await menu.isVisible(), true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await launcher.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('w');
    await menu.waitFor({ state: 'visible' });
    await page.evaluate(() => { window.__underlayClicks = 0; document.body.addEventListener('click', event => { if (!event.target.closest('dialog')) window.__underlayClicks++; }); });
    await page.mouse.click(2, 2);
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__underlayClicks), 0);
    await openMenu();
    await items.nth(1).click();
    const search = page.locator('dialog.codex-session-search-dialog-backdrop');
    await search.waitFor({ state: 'visible' });
    assert.equal(await menu.isVisible(), false);
    await search.locator('input').fill('iteration');
    await page.screenshot({ path: `${prefix}-search.png` });
    await page.keyboard.press('Escape');
    await openMenu();
    await menu.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.locator('[data-testid="version-settings"]').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('workbench'), 'versions');
    if (mobile) await page.locator('.workbench-mobile-settings-back').click();
    const general = page.locator('[data-settings-group="preferences"] button');
    await general.waitFor({ state: 'visible' });
    assert.equal(await general.getAttribute('aria-expanded'), 'false');
    const groups = await page.locator('[data-settings-group]').evaluateAll(nodes => nodes.map(n => n.dataset.settingsGroup));
    assert.deepEqual(groups.slice(0, 2), ['versions', 'preferences']);
    await page.screenshot({ path: `${prefix}-settings.png` });
    await general.click();
    assert.equal(await general.getAttribute('aria-expanded'), 'true');
    await page.reload();
    if (mobile) await page.locator('.workbench-mobile-settings-back').click();
    assert.equal(await general.getAttribute('aria-expanded'), 'true');
    await general.click();
    assert.equal(await general.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Compact UI localhost acceptance passed');
} finally { await browser.close(); await host.close(); }
