import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';

const managedRoot = '/opt/data';
const configuredRoot = '/srv/hermes-workbench';
const host = await createMockHost({ host: 'localhost', filesRootError: true, managedRoot, managedRoots: [configuredRoot] });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shots = process.env.SHOT_DIR || 'node_modules/.cache/files-root-recovery';
await mkdir(shots, { recursive: true });
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    // The regression deliberately requests forbidden paths; the browser logs
    // those probe responses as resource errors. Any other console error fails.
    page.on('console', message => {
      if (message.type() === 'error' && !/Failed to load resource.*403 \(Forbidden\)/.test(message.text())) errors.push(message.text());
    });
    await page.goto(host.origin + '/files?profile=default', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-workbench-shell', 'true');
    await page.evaluate(theme => {
      document.documentElement.dataset.workbenchTheme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, theme);

    const recovered = await page.evaluate(async () => {
      const response = await fetch('/api/files?path=%2Fopt%2Fdata');
      return { status: response.status, body: await response.json() };
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.path, managedRoot);
    assert.equal(recovered.body.root, managedRoot);
    assert.deepEqual(recovered.body.entries.map(entry => entry.name), ['workspace', 'notes.txt']);
    assert.equal(recovered.body.entries.some(entry => entry.name === 'external-link'), false);

    const configured = await page.evaluate(async root => {
      const response = await fetch(`/api/files?path=${encodeURIComponent(root)}`);
      return { status: response.status, body: await response.json() };
    }, configuredRoot);
    assert.equal(configured.status, 200);
    assert.equal(configured.body.root, configuredRoot);

    for (const path of ['/etc', '../outside']) {
      const denied = await page.evaluate(async requested => {
        const response = await fetch(`/api/files?path=${encodeURIComponent(requested)}`);
        return { status: response.status, body: await response.json() };
      }, path);
      assert.equal(denied.status, 403, `${path} must stay forbidden`);
      assert.equal(denied.body.detail, 'Path outside managed files root');
    }

    await page.evaluate(body => {
      document.body.innerHTML = `<main style="max-width:760px;margin:48px auto;padding:24px;border:1px solid #8884;font:14px/1.5 system-ui">
        <h1 style="margin:0 0 16px">Files</h1>
        <p style="margin:0 0 16px;font-family:monospace">${body.path}</p>
        <div role="alert" style="margin-bottom:16px;padding:10px 12px;border:1px solid #c33;color:#c33">
          <div class="text-destructive">Path outside managed files root</div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button aria-label="Upload files" style="flex:1;padding:12px;border:1px dashed #888;background:transparent"><span title="Upload">Upload</span></button>
          <button aria-label="Create folder" style="padding:12px 16px;border:1px solid #888;background:transparent">Create</button>
        </div>
        <div style="margin-top:16px;border:1px solid #8884">
          ${body.entries.map(entry => `<div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #8882"><span>${entry.name}</span><span>${entry.is_directory ? 'Folder' : 'File'}</span></div>`).join('')}
        </div></main>`;
    }, recovered.body);

    const cleaned = await page.evaluate(async () => {
      await fetch('/api/files?path=%2Fopt%2Fdata');
      const upload = document.querySelector('button[aria-label="Upload files"]');
      const create = document.querySelector('button[aria-label="Create folder"]');
      return {
        banner: Boolean(document.querySelector('[role="alert"], .text-destructive')),
        uploadLabel: upload?.textContent?.trim(),
        uploadDisabled: Boolean(upload?.disabled),
        createDisabled: Boolean(create?.disabled),
      };
    });
    assert.equal(cleaned.banner, false);
    assert.equal(cleaned.uploadLabel, 'Upload');
    assert.equal(cleaned.uploadDisabled, false);
    assert.equal(cleaned.createDisabled, false);
    await page.screenshot({ path: `${shots}/${mobile ? 'mobile-390' : 'desktop'}-${theme}-files-root-recovered.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS files root recovery: /opt/data and configured root recovered, child/out-of-root 403, banner cleared, desktop/mobile light/dark');
} finally {
  await browser.close();
  await host.close();
}
