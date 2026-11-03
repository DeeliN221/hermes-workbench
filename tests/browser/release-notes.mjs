import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shots = process.env.SHOT_DIR || 'node_modules/.cache/release-notes';
await mkdir(shots, { recursive: true });
const longURL = 'https://github.com/example/workbench/commit/' + 'a'.repeat(100);
const notes = "## What's Changed\n\n* **Render release notes** with `Markdown` by @contributor in https://github.com/example/workbench/pull/123\n* [Review commit](https://github.com/example/workbench/commit/abc123)\n* Long URL: " + longURL + '\n* ' + 'LongEnglishWord'.repeat(8) + '\n\nBuilt from main commit abc123.';
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/api/plugins/workbench/versions', route => route.fulfill({ json: {
      active: '20261103-1', update_mode: 'release', versions: [
        { version: '20261103-1', ready: true, source: 'github', notes },
        { version: '20261102-1', ready: true, source: 'github', notes: 'Built from main commit def456.' },
      ],
    } }));
    await page.goto(host.origin + '/config?workbench=versions');
    await expect(page.locator('html')).toHaveAttribute('data-workbench-shell', 'true');
    for (const refreshed of [false, true]) {
      if (refreshed) await page.reload();
      await page.addStyleTag({ content: '#preview-banner { display: none }' });
      await page.evaluate(theme => {
        document.documentElement.dataset.workbenchTheme = theme;
        document.documentElement.classList.toggle('dark', theme === 'dark');
      }, theme);
      const details = page.locator('.workbench-version-notes');
      await expect(details).toHaveCount(2);
      for (const item of await details.all()) await item.locator('summary').click();
      const current = details.first();
      await expect(current.locator('h2')).toHaveText("What's Changed");
      await expect(current.locator('ul > li')).toHaveCount(4);
      await expect(current.locator('strong')).toHaveText('Render release notes');
      await expect(current.locator('code')).toHaveText('Markdown');
      await expect(details.last().locator('p')).toHaveText('Built from main commit def456.');
      for (const link of await current.locator('a').all()) {
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page must fit viewport');
      assert.ok(await current.evaluate(el => el.scrollWidth <= el.clientWidth), 'Notes must fit card');
      const pr = current.locator('a').first();
      await page.context().route('https://github.com/**', route => route.fulfill({ body: 'Local navigation fixture' }));
      const popupPromise = page.waitForEvent('popup');
      await pr.click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(popup.url(), 'https://github.com/example/workbench/pull/123');
      assert.equal(await popup.evaluate(() => window.opener), null);
      await popup.close();
      if (!refreshed) {
        if (mobile) await current.locator('h2').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}.png`, fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS release notes: desktop/mobile × light/dark, refresh, Markdown, plain text, external popup, no overflow, no console/page errors');
} finally {
  await browser.close();
  await host.close();
}
