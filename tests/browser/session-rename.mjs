/**
 * Verify session renaming from the sidebar card menu and the pane header.
 * Covers instant two-way sync, persistence across reload, the first-message
 * default after clearing, readable errors, and mobile dialog layout.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '';
const HEADER = '.codex-center-title';
const dialogOpen = (page) => page.locator('dialog.codex-navigation-dialog-backdrop[open]');
const firstTitle = 'Local preview validation · default';

/** Wait until the card and the pane header agree on a title. */
async function waitForTitle(page, expected, timeout = 8000) {
  await page.waitForFunction(
    (value) => {
      const card = document.querySelector('.codex-session-row.is-active .codex-session-title');
      const header = document.querySelector('.codex-center-title');
      return (card?.textContent || '').trim() === value && (header?.textContent || '').trim() === value;
    },
    expected,
    { timeout },
  );
}

/** Read the sidebar card title of the session the pane shows. */
async function cardTitle(page) {
  const active = page.locator('.codex-session-row.is-active').first();
  return ((await active.locator('.codex-session-title').first().textContent()) || '').trim();
}

async function headerTitle(page) {
  return ((await page.locator(HEADER).first().textContent()) || '').trim();
}

/** Open the rename dialog from the sidebar card menu. */
async function openFromCard(page, name) {
  const row = page.locator('.codex-session-row-wrap').filter({ hasText: name }).first();
  await row.hover();
  await row.locator('.codex-session-row-menu-toggle').first().click();
  await page.locator('.codex-session-row-menu').first().waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('.codex-session-row-menu button[role="menuitem"]').filter({ hasText: /Rename|重命名/ }).first().click();
  await dialogOpen(page).waitFor({ state: 'visible', timeout: 3000 });
}

/** Open the same dialog from the pane header. */
async function openFromHeader(page) {
  await page.locator('.codex-session-rename').first().click();
  await dialogOpen(page).waitFor({ state: 'visible', timeout: 3000 });
}

async function saveTitle(page, value) {
  const input = dialogOpen(page).locator('input[name="session-title"]');
  await input.fill(value);
  await dialogOpen(page).locator('.codex-navigation-dialog-actions button.is-primary').click();
}

const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const errors = [];
try {
  if (SHOT_DIR) await mkdir(SHOT_DIR, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await page.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 8000 });
  await page.locator(`${HEADER}`).first().waitFor({ state: 'visible', timeout: 8000 });
  await waitForTitle(page, firstTitle);

  // Rename from the card menu updates the card and the pane header at once.
  await openFromCard(page, firstTitle);
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/rename-dialog-desktop-light.png` });
  await saveTitle(page, '  发布前   检查 Sprint  ');
  await dialogOpen(page).waitFor({ state: 'detached', timeout: 4000 });
  await waitForTitle(page, '发布前 检查 Sprint');

  // A list poll must not revert the stored title.
  await page.waitForTimeout(2600);
  assert.equal(await cardTitle(page), '发布前 检查 Sprint');
  assert.equal(await headerTitle(page), '发布前 检查 Sprint');

  // The rename survives a reload because the bridge stores it.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`${HEADER}`).first().waitFor({ state: 'visible', timeout: 8000 });
  await waitForTitle(page, '发布前 检查 Sprint');

  // The pane header opens the same dialog, prefilled, and syncs the card back.
  await openFromHeader(page);
  assert.equal(await dialogOpen(page).locator('input[name="session-title"]').inputValue(), '发布前 检查 Sprint');
  await saveTitle(page, '窗格标题重命名');
  await dialogOpen(page).waitFor({ state: 'detached', timeout: 4000 });
  await waitForTitle(page, '窗格标题重命名');

  // A refused rename explains itself and leaves both titles untouched.
  await page.route('**/codex/sessions/*/title*', route => route.fulfill({
    status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Session not found' }),
  }));
  await openFromHeader(page);
  await saveTitle(page, '不应该保存');
  const alert = dialogOpen(page).locator('.codex-navigation-dialog-error');
  await alert.waitFor({ state: 'visible', timeout: 4000 });
  assert.match((await alert.textContent()) || '', /no longer exists/i);
  await dialogOpen(page).locator('.codex-navigation-dialog-actions button').first().click();
  await dialogOpen(page).waitFor({ state: 'detached', timeout: 4000 });
  await waitForTitle(page, '窗格标题重命名');
  await page.unroute('**/codex/sessions/*/title*');

  // Clearing the title falls back to the first-message default everywhere.
  await openFromCard(page, '窗格标题重命名');
  await saveTitle(page, '   ');
  await dialogOpen(page).waitFor({ state: 'detached', timeout: 4000 });
  const derived = 'Please verify that the local preview opens correctly.';
  await waitForTitle(page, derived);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`${HEADER}`).first().waitFor({ state: 'visible', timeout: 8000 });
  await waitForTitle(page, derived);
  await page.close();

  // Phone width: the dialog must fit and the page must not scroll sideways.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', error => errors.push(error.stack || error.message));
  await phone.goto(host.origin + '/chat?session=codex-regression&profile=default', { waitUntil: 'domcontentloaded' });
  await phone.locator(`${HEADER}`).first().waitFor({ state: 'visible', timeout: 8000 });
  await openFromHeader(phone);
  const box = await dialogOpen(phone).locator('.codex-navigation-dialog').boundingBox();
  assert.ok(box, 'dialog has a layout box');
  assert.ok(box.x >= 0 && box.x + box.width <= 390.5, `dialog fits the phone width: ${JSON.stringify(box)}`);
  assert.ok(box.y >= 0 && box.y + box.height <= 844.5, `dialog fits the phone height: ${JSON.stringify(box)}`);
  const overflow = await phone.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  }));
  assert.ok(overflow.scrollWidth <= overflow.innerWidth + 1, `no horizontal overflow: ${JSON.stringify(overflow)}`);
  const dialogSurface = () => dialogOpen(phone).locator('.codex-navigation-dialog').evaluate(node => getComputedStyle(node).backgroundColor);
  const lightSurface = await dialogSurface();
  await phone.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await phone.waitForTimeout(200);
  const darkSurface = await dialogSurface();
  assert.notEqual(darkSurface, lightSurface, 'the dialog follows the dark theme');
  const darkBox = await dialogOpen(phone).locator('.codex-navigation-dialog').boundingBox();
  assert.ok(darkBox && darkBox.x >= 0 && darkBox.x + darkBox.width <= 390.5, `dark dialog fits the phone width: ${JSON.stringify(darkBox)}`);
  if (SHOT_DIR) {
    await phone.screenshot({ path: `${SHOT_DIR}/rename-dialog-mobile-dark.png` });
    await phone.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await phone.waitForTimeout(200);
    await phone.screenshot({ path: `${SHOT_DIR}/rename-dialog-mobile-light.png` });
  }
  await phone.close();

  assert.deepEqual(errors, [], `Browser errors:\n${errors.join('\n')}`);
  console.log('Session rename browser checks passed');
} finally {
  await browser.close();
  await host.close();
}
