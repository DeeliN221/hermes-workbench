/** First-click regression with the host router mounted before Workbench. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';

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
const output = process.env.SHOT_DIR || 'node_modules/.cache/home-first-click';
await mkdir(output, { recursive: true });
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    for (const profile of ['default', 'writer']) for (const source of ['codex', 'hermes']) {
      // A fresh context ensures no second click, stored panes or warm session cache can mask failure.
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      const page = await context.newPage();
      const events = [];
      page.on('pageerror', error => events.push({ type: 'pageerror', text: String(error) }));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) events.push({ type: message.type(), text: message.text() }); });
      page.on('response', response => { if (response.url().includes('/api/')) events.push({ type: 'response', status: response.status(), url: response.url() }); });
      page.on('requestfailed', request => events.push({ type: 'failed', url: request.url(), error: request.failure() }));
      await page.addInitScript(theme => {
        localStorage.setItem('hermes-dashboard-theme', theme);
        window.__routeLog = [];
        for (const method of ['pushState', 'replaceState']) {
          const original = history[method];
          history[method] = function (...args) {
            window.__routeLog.push({ method, url: args[2] == null ? null : String(args[2]) });
            return original.apply(this, args);
          };
        }
      }, theme);
      await page.route('**/react.development.js', route => route.fulfill({ body: hostScript, contentType: 'text/javascript' }));
      await page.route('**/react-dom.development.js', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
      await page.goto(host.origin + '/');
      const link = page.locator(`[data-profile="${profile}"] .profile-session[href*="${source === 'codex' ? 'session=codex-preview' : 'hermesSession=hermes-preview'}"]`);
      await expect(link).toBeVisible();
      await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); window.__routeLog = []; }, theme);
      const name = `${mobile ? 'mobile' : 'desktop'}-${theme}-${profile}-${source}`;
      if (profile === 'writer' && source === 'codex') await page.screenshot({ path: `${output}/${name}-home.png` });
      await link.click();
      if (!mobile) {
        assert.equal(new URL(page.url()).pathname, '/');
        await expect(link).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: /Open selected|打开选中/ }).click();
      }
      // Observe past the first chat paint: the regression redirects after that paint.
      await page.waitForTimeout(800);
      const routes = await page.evaluate(() => window.__routeLog);
      await writeFile(`${output}/${name}.json`, JSON.stringify({ url: page.url(), routes, events }, null, 2));
      if (profile === 'writer' && source === 'codex') await page.screenshot({ path: `${output}/${name}-chat.png` });
      assert.equal(new URL(page.url()).pathname, '/chat', `${name}: first click must stay on chat`);
      assert.equal(new URL(page.url()).searchParams.get('profile'), profile);
      assert.equal(new URL(page.url()).searchParams.get(source === 'codex' ? 'session' : 'hermesSession'), `${source}-preview`);
      assert.ok(routes.every(route => route.url === null || new URL(route.url, host.origin).pathname === '/chat'), `${name}: no intermediate home route or bounce`);
      await expect(source === 'codex' ? page.locator('.codex-message.is-user').first() : page.getByText('Please verify the Hermes session in the local preview.')).toBeVisible();
      await expect(page.locator('.profile-overview')).toBeHidden();
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      assert.ok(await page.title());
      assert.equal(new URL(page.url()).hostname, 'localhost');
      assert.deepEqual(events.filter(event => event.type !== 'response' || event.status >= 400), []);
      await context.close();
    }
  }
  console.log('PASS first click: cold home -> selected Codex/Hermes session; same/cross profile; desktop/mobile; light/dark; no bounce or API/console errors');
} finally { await browser.close(); await host.close(); }
