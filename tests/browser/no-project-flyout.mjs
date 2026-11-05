/** Localhost regression: project sessions stay in navigation, never over the chat. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shots = process.env.SHOT_DIR || '/tmp/no-project-flyout-evidence';
await mkdir(shots, { recursive: true });
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const size = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const page = await browser.newPage({ viewport: size, isMobile: mobile, hasTouch: mobile, colorScheme: theme });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('hermes.workbench.nav-collapsed', 'true'));
    await page.route('**/api/plugins/workbench/codex/sessions?**', async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.items = data.items.map(item => ({ ...item, groupId: 'preview-project-1' }));
      await route.fulfill({ json: data });
    });
    // Record transient mounts too, including hidden intercepting nodes.
    await page.addInitScript(() => {
      window.__flyoutMounts = 0;
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('.project-rail-flyout') || node.querySelector('.project-rail-flyout'))) window.__flyoutMounts++;
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(host.origin + '/chat?session=codex-preview&profile=default');
    await page.locator('[data-workbench-user-message-ball]').first().waitFor();
    assert.match(page.url(), /localhost/);
    assert.equal(await page.title(), 'default');
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    const absent = async () => {
      await expect(page.locator('.project-rail-flyout')).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.__flyoutMounts), 0);
    };
    await absent();
    if (mobile) await page.locator('.dashboard-mobile-toggle').first().click();
    else {
      const folder = page.locator('[data-project-rail-folder]').first();
      await folder.hover(); await absent();
      await folder.click();
      await expect(page.locator('.dashboard-global-nav')).not.toHaveClass(/is-collapsed/);
    }
    const project = page.locator('details.project-folder').first();
    await expect(project).toHaveAttribute('open', '');
    await project.locator('.codex-session-row').nth(1).click();
    await expect(page.locator('.codex-pane-slot')).toHaveCount(2);
    if (mobile) {
      const toggle = page.locator('.dashboard-mobile-toggle').first();
      if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    } else await page.locator('.dashboard-nav-collapse').click();
    await absent();
    for (let index = 0; index < 2; index++) {
      const pane = page.locator('.codex-pane-slot').nth(index);
      const ball = pane.locator('[data-workbench-user-message-ball]');
      await ball.scrollIntoViewIfNeeded();
      await ball.hover(); await absent();
      await ball.click();
      const panel = pane.locator('[data-workbench-user-message-panel]');
      await expect(panel).toBeVisible();
      const ballBox = await ball.boundingBox(), panelBox = await panel.boundingBox();
      assert.ok(panelBox.y + panelBox.height <= ballBox.y, 'legitimate navigator stays above its bottom corner ball');
      await panel.locator('[data-user-message-item]').first().click();
      await expect(pane.locator('.is-user-message-jump-target')).toHaveCount(1);
      await expect(panel).toBeHidden();
      await pane.locator('.codex-message-list').evaluate(list => { list.scrollTop = 100; list.dispatchEvent(new Event('scroll')); });
      await page.keyboard.press('Escape'); await absent();
    }
    await page.setViewportSize({ width: size.width + 10, height: size.height - 10 });
    await page.setViewportSize(size);
    await absent();
    await expect(page.locator('vite-error-overlay, #preview-errors:not(:empty)')).toHaveCount(0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}.png` });
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}-${theme}: ${page.url()}`);
    await page.close();
  }
} finally { await browser.close(); await host.close(); }
