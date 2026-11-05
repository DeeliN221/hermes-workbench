/** First-click regression with the host router mounted before Workbench. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';
import { openSessionNavigation } from './navigation-helpers.mjs';

const result = await build({ configFile: false, logLevel: 'error',
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../fixtures/hermes-host/entry.jsx', import.meta.url)),
    name: 'HermesHostFixture', formats: ['iife'],
  } },
});
const hostScript = result[0].output.find(asset => asset.type === 'chunk').code;
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const output = process.env.SHOT_DIR || 'node_modules/.cache/home-selection';
await mkdir(output, { recursive: true });
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(theme => localStorage.setItem('hermes-dashboard-theme', theme), theme);
    await page.route('**/react.development.js', route => route.fulfill({ body: hostScript, contentType: 'text/javascript' }));
    await page.route('**/react-dom.development.js', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
    const home = async () => {
      await page.evaluate(() => { history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
      await expect(page.locator('.profile-overview')).toBeVisible();
      await expect(page.locator('.profile-overview')).toHaveAttribute('aria-busy', 'false');
    };
    const card = (profile, source) => page.locator(`[data-profile="${profile}"] .profile-session[href*="${source === 'codex' ? 'session=codex-preview' : 'hermesSession=hermes-preview'}"]`);
    const selected = page.locator('.profile-session.is-selected');
    const open = page.getByRole('button', { name: /Open selected|打开选中/ });
    const clear = page.getByRole('button', { name: /Clear selection|清空选择/ });
    await page.goto(host.origin + '/');
    await expect(card('writer', 'hermes')).toBeVisible();
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    if (!mobile) {
      const before = await card('writer', 'hermes').boundingBox();
      await card('writer', 'hermes').click();
      assert.equal(new URL(page.url()).pathname, '/');
      await expect(selected).toHaveCount(1);
      const after = await card('writer', 'hermes').boundingBox();
      assert.deepEqual([after.width, after.height], [before.width, before.height], 'Selection preserves card size');
      await card('writer', 'hermes').click(); await expect(selected).toHaveCount(0);
      await card('writer', 'hermes').click(); await clear.click(); await expect(selected).toHaveCount(0);
      await card('writer', 'hermes').focus(); await page.keyboard.press('Space'); await expect(selected).toHaveCount(1);
      await page.keyboard.press('Escape'); await expect(selected).toHaveCount(0);
      await card('writer', 'hermes').click();
      await page.reload(); await expect(card('writer', 'hermes')).toBeVisible(); await expect(selected).toHaveCount(0);
      await card('writer', 'hermes').click();
      await card('default', 'codex').click();
      await card('writer', 'codex').click();
      await expect(open).toHaveText(/\(3\)/);
      await card('default', 'hermes').click();
      await expect(selected).toHaveCount(3);
      await expect(page.locator('.profile-overview [role="alert"]')).toContainText(/3/);
      await page.screenshot({ path: `${output}/desktop-${theme}-selected.png`, fullPage: true });
      await open.click();
    } else {
      await page.screenshot({ path: `${output}/mobile-${theme}-home.png`, fullPage: true });
      await card('writer', 'hermes').click();
      await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '1');
      await home(); await card('default', 'codex').click();
      await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '2');
      await home(); await card('writer', 'codex').click();
    }
    await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '3');
    const paneTargets = () => page.locator('.codex-workbench').evaluateAll(nodes => nodes.map(node => [node.dataset.profile, node.dataset.sessionId, node.dataset.hermesSessionId]));
    const expected = [['writer', '', 'hermes-preview'], ['default', 'codex-preview', ''], ['writer', 'codex-preview', '']];
    await expect.poll(paneTargets).toEqual(expected);
    await page.waitForTimeout(500);
    if (mobile) await expect.poll(async () => {
      const box = await page.locator('.codex-pane-slot.is-active').boundingBox();
      return Boolean(box && box.x >= -1 && box.x + box.width <= 391);
    }).toBe(true);
    assert.equal(new URL(page.url()).pathname, '/chat');
    assert.equal(new URL(page.url()).searchParams.has('homeOpen'), false);
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-${theme}-opened.png`, fullPage: true });
    await page.reload();
    await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '3');
    await expect.poll(paneTargets).toEqual(expected);
    await home(); await expect(selected).toHaveCount(0); await expect(open).toHaveCount(0);
    await expect(page.locator('.profile-session[data-opened="true"]')).toHaveCount(3);
    await card('default', 'hermes').click();
    await expect(page.locator('.profile-overview [role="alert"]')).toContainText(/3/);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await expect(selected).toHaveCount(0);
    // Reopening an existing target focuses it without duplicating a pane.
    await card('default', 'codex').click(); if (!mobile) await open.click();
    await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '3');
    await expect(page.locator('.codex-pane-slot.is-active .codex-workbench')).toHaveAttribute('data-profile', 'default');
    await page.locator('.codex-pane-slot.is-active .codex-pane-close').click();
    await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '2');
    await page.reload();
    await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '2');
    await expect.poll(paneTargets).toEqual([expected[0], expected[2]]);
    await home();
    await expect(page.locator('.profile-session[data-opened="true"]')).toHaveCount(2);
    await card('default', 'hermes').click();
    if (!mobile) await open.click();
    await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '3');
    await expect.poll(paneTargets).toEqual([expected[0], expected[2], ['default', '', 'hermes-preview']]);
    if (!mobile && theme === 'light') {
      const dragSession = async () => {
        const restore = await openSessionNavigation(page);
        const transfer = await page.evaluateHandle(() => new DataTransfer());
        await page.locator('.project-session-drag[data-session-id="codex-regression"]').dispatchEvent('dragstart', { dataTransfer: transfer });
        await expect(page.locator('.codex-pane-drop-zone')).toBeVisible();
        await page.locator('.codex-pane-drop-zone').dispatchEvent('drop', { dataTransfer: transfer });
        await transfer.dispose();
        await restore();
      };
      await dragSession();
      await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '3');
      await expect(page.locator('.codex-pane-drop-notice')).toContainText(/three|三个/);
      await page.locator('.codex-pane-slot.is-active .codex-pane-close').click();
      await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '2');
      await dragSession();
      await expect(page.locator('.codex-multi-pane')).toHaveAttribute('data-pane-count', '3');
      await expect.poll(paneTargets).toEqual([expected[0], expected[2], ['writer', 'codex-regression', '']]);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS home selection: desktop light/dark, 390px light/dark; ordered cross-profile panes, selection controls, cap, reload, opened markers, no overflow or runtime errors');
} finally { await browser.close(); await host.close(); }
