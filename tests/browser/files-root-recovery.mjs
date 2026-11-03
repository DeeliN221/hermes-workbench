import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost({ host: 'localhost', filesRootError: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shots = process.env.SHOT_DIR || 'node_modules/.cache/files-root-recovery';
await mkdir(shots, { recursive: true });
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(host.origin + '/files?profile=default', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-workbench-shell', 'true');
    await page.evaluate(theme => {
      document.documentElement.dataset.workbenchTheme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, theme);

    const recovered = await page.evaluate(async () => {
      const response = await fetch('/api/files');
      return { status: response.status, body: await response.json() };
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.path, '/home/preview');
    assert.equal(recovered.body.entries[0].path, '/home/preview/hermes-workbench');
    const denied = await page.evaluate(async () => {
      const response = await fetch('/api/files?path=%2Fopt%2Fshared-auth');
      return { status: response.status, body: await response.json() };
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.detail, 'Path outside managed files root');

    await page.evaluate(body => {
      document.body.innerHTML = `<main style="max-width:760px;margin:48px auto;padding:24px;border:1px solid #8884;font:14px/1.5 system-ui">
        <h1 style="margin:0 0 16px">Files</h1>
        <button aria-label="Upload files" style="display:block;width:100%;padding:16px;text-align:left;border:1px dashed #888">
          <strong>Drop files here</strong><span title="${body.path}" style="display:block;font-family:monospace">${body.path}</span>
        </button>
        <div style="margin-top:16px;border:1px solid #8884">
          ${body.entries.map(entry => `<div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #8882"><span>${entry.name}</span><span>${entry.is_directory ? 'Folder' : 'File'}</span></div>`).join('')}
        </div></main>`;
    }, recovered.body);
    await page.screenshot({ path: `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}-files-root-recovered.png`, fullPage: true });

    await page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<div class="text-destructive">Path outside managed files root</div>');
      document.querySelector('button[aria-label="Upload files"] span').textContent = 'Loading';
    });
    await page.waitForFunction(() =>
      document.querySelector('button[aria-label="Upload files"] span')?.textContent === 'Unavailable');
    await page.screenshot({ path: `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}-files-root-error.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS files root recovery: desktop/mobile light/dark, safe root fallback, out-of-root loading state ends');
} finally {
  await browser.close();
  await host.close();
}
