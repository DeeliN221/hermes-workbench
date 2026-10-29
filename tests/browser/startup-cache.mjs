/**
 * Verify a repeat Workbench open reuses the immutable runtime and paints the
 * last Codex messages even while the session API is deliberately delayed.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await context.newPage();
  await first.goto(host.origin + '/chat?session=codex-preview&profile=default&loader=1', { waitUntil: 'domcontentloaded' });
  await first.locator('.codex-message.is-user').first().waitFor({ state: 'visible', timeout: 10000 });
  await first.waitForFunction(() => Object.keys(localStorage).some(key => key.includes('codex-snapshot')));
  // Let Chromium finish writing the immutable response to its disk cache.
  await first.waitForTimeout(700);
  await first.close();

  const cached = await context.newPage();
  await cached.goto(host.origin + '/chat?session=codex-preview&profile=default&loader=1', { waitUntil: 'domcontentloaded' });
  await cached.locator('.codex-message.is-user').first().waitFor({ state: 'visible', timeout: 5000 });
  const runtime = await cached.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => entry.name.includes('/workbench-sidecar/') && entry.name.endsWith('workbench.js'))
    .map(entry => ({ transferSize: entry.transferSize, duration: entry.duration })));
  await cached.close();

  assert.equal(runtime.length, 1);
  assert.equal(runtime[0].transferSize, 0, 'The runtime must come from the browser cache');

  const replay = await context.newPage();
  let delayedSessionRequests = 0;
  await replay.route('**/api/plugins/workbench/codex/session**', async route => {
    delayedSessionRequests += 1;
    await new Promise(resolve => setTimeout(resolve, 2500));
    await route.continue().catch(() => {});
  });
  const started = Date.now();
  await replay.goto(host.origin + '/chat?session=codex-preview&profile=default&loader=1', { waitUntil: 'domcontentloaded' });
  await replay.locator('.codex-message.is-user').first().waitFor({ state: 'visible', timeout: 1500 });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1500, `Cached transcript must paint within 1.5s; took ${elapsed}ms`);
  assert.ok(delayedSessionRequests > 0, 'The session API delay must exercise the cached first paint');
  assert.equal(await replay.locator('.codex-message.is-user').first().innerText(), 'Please verify that the local preview opens correctly.');

  const preview = await context.newPage();
  await preview.route('**/workbench-sidecar/**/workbench.js', async route => {
    await new Promise(resolve => setTimeout(resolve, 2500));
    await route.continue().catch(() => {});
  });
  const previewStarted = Date.now();
  await preview.goto(host.origin + '/chat?session=codex-preview&profile=default&loader=1', { waitUntil: 'domcontentloaded' });
  await preview.locator('.workbench-sidecar-preview-message.is-user').first().waitFor({ state: 'visible', timeout: 1500 });
  const previewElapsed = Date.now() - previewStarted;
  assert.ok(previewElapsed < 1500, `Loader preview must paint within 1.5s; took ${previewElapsed}ms`);
  assert.match(
    await preview.locator('.workbench-sidecar-preview-message.is-user').first().innerText(),
    /Please verify that the local preview opens correctly\./,
  );
  await context.close();
} finally {
  await browser.close();
  await host.close();
}

console.log('Workbench startup cache passed: cached runtime and last Codex message painted before session APIs.');
