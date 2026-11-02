/** Synthetic image fixtures only; exercises the real message and search-preview renderers. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shots = process.env.SHOT_DIR || '/tmp/message-image-preview';
await mkdir(shots, { recursive: true });
const svg = (width, height) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#3978bc"/><circle cx="50%" cy="50%" r="90" fill="#ffdc78"/><text x="20" y="45" fill="white" font-size="28">Synthetic image fixture</text></svg>`).toString('base64');
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route(/\/api\/plugins\/workbench\/codex\/session(?:\/preview)?\?/, async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.turns = [{ id: 'image-turn', status: 'completed', items: [{ id: 'image-message', type: 'userMessage', content: [{ type: 'text', text: 'Inspect the synthetic image details.' }], attachments: [
      { id: 'wide', name: 'wide.svg', src: svg(3000, 400) },
      { id: 'tall', name: 'tall.svg', src: svg(400, 3000) },
    ] }] }];
    await route.fulfill({ json: data });
  });
  for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.goto(host.origin + '/chat?session=codex-preview&profile=default');
      await page.evaluate(theme => { localStorage.setItem('hermes-dashboard-theme', theme); document.documentElement.dataset.theme = theme; }, theme);
      await page.reload();
      assert.match(page.url(), /localhost/);
      assert.match(await page.title(), /Workbench|default/);
      const buttons = page.locator('.codex-message-image-button');
      await expect(buttons).toHaveCount(2);
      await page.screenshot({ path: `${shots}/${device}-${theme}-thumbnails.png` });
      for (let index = 0; index < 2; index++) {
        const button = buttons.nth(index);
        await button.focus();
        await button.press(index ? 'Space' : 'Enter');
        const dialog = page.getByRole('dialog', { name: 'Image preview', exact: true });
        await expect(dialog).toBeVisible();
        const image = dialog.locator('img');
        await expect(image).toBeVisible();
        const box = await image.boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button', { name: 'Close preview' })).toBeFocused();
        await page.screenshot({ path: `${shots}/${device}-${theme}-${index ? 'tall' : 'wide'}.png` });
        if (index) await page.locator('#hti-file-preview').click({ position: { x: 3, y: 3 } });
        else await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(button).toBeFocused();
      }
      await buttons.first().click();
      await page.locator('#hti-file-preview img').evaluate(image => { image.src = 'data:image/png;base64,broken'; });
      await expect(page.locator('#hti-file-preview [role="alert"]')).toHaveText('Unable to load image');
      await page.screenshot({ path: `${shots}/${device}-${theme}-error.png` });
      await page.getByRole('button', { name: 'Close preview', exact: true }).click();
      await expect(buttons.first()).toBeFocused();
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__smokeErrors), []);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.querySelector('.codex-session-search-trigger').click());
  await page.locator('.codex-session-search-result[data-result-id="codex-preview"]').click();
  const previewButton = page.locator('.session-search-transcript .codex-message-image-button').first();
  await previewButton.click();
  await expect(page.getByRole('dialog', { name: 'Image preview', exact: true })).toBeVisible();
  await expect(page.locator('#hti-file-preview img')).toBeVisible();
  await page.screenshot({ path: `${shots}/desktop-search-preview.png` });
  await page.keyboard.press('Escape');
  await expect(previewButton).toBeFocused();
  await expect(page.locator('.codex-session-search-dialog')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: localhost message thumbnails, click/Enter/Space, Escape/backdrop/close button, focus, Tab, wide/tall fit, desktop/mobile, light/dark, failure state and console health.');
} finally { await browser.close(); await host.close(); }
