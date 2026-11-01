/** Browser plugin not available: built overlay + authenticated Python proxy, localhost only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
import { createMockFleet } from '../fixtures/mock-fleet.mjs';

const evidence = process.env.WORKBENCH_SCREENSHOT_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const fleet = await createMockFleet();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  for (const mode of ['demo', 'live']) {
    const reserve = createServer();
    await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const env = { ...process.env, HERMES_DASHBOARD_TRUSTED_PROXY_SECRET: 'local-proxy-secret', HERMES_WORKBENCH_ALLOWED_USERS: 'preview' };
    for (const key of ['CODEX_HOME', 'CODEX_APP_SERVER_ENDPOINT', 'FLEET_URL', 'FLEET_TOKEN', 'HERMES_WORKBENCH_FLEET_DEMO_URL', 'HERMES_WORKBENCH_FLEET_TOKEN', 'HERMES_WORKBENCH_FLEET_MODE']) delete env[key];
    if (mode === 'live') Object.assign(env, { FLEET_URL: fleet.origin, FLEET_TOKEN: 'mock-fleet-token', HERMES_WORKBENCH_FLEET_MODE: 'live' });
    const proxy = spawn('uv', ['run', '--no-project', '--with-requirements', 'requirements-dev.txt', 'python', '-m', 'uvicorn', 'fleet-proxy-app:app', '--app-dir', 'tests/fixtures', '--host', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '', host;
    proxy.stdout.on('data', data => logs += data);
    proxy.stderr.on('data', data => logs += data);
    try {
      let ready = false;
      for (let attempt = 0; attempt < 300; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/plugins/workbench/fleet/config`, { headers: { 'x-hermes-proxy-secret': 'local-proxy-secret', 'remote-user': 'preview' } });
          if (response.ok) { assert.equal((await response.json()).mode, mode === 'demo' ? 'mock' : 'live'); ready = true; break; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(ready, logs);
      host = await createMockHost({ fleetProxyOrigin: `http://127.0.0.1:${port}` });
      for (const mobile of [false, true]) {
        const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1536, height: 960 } });
        page.setDefaultTimeout(10000);
        const errors = [], requests = [], bodies = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('request', request => requests.push(request.url()));
        page.on('response', async response => { if (response.url().includes('/fleet/')) bodies.push(await response.text().catch(() => '')); });
        // Even profiles with no native board must enter the tower without fetching boards.
        await page.route('**/api/plugins/kanban/boards**', route => route.fulfill({ status: 500, json: { error: 'No native board' } }));
        const chat = '/chat?session=codex-preview&profile=writer';
        await page.goto(host.origin + chat);
        await page.locator('.codex-pane-slot').waitFor();
        const nav = mobile ? page.locator('.dashboard-action-rail') : page.locator('.workbench-actions-dialog');
        const openNav = async () => { if (!mobile) { await page.locator('.dashboard-nav-collapse').focus(); await page.keyboard.press('w'); await page.locator('.workbench-actions-dialog[open]').waitFor(); } };
        await openNav();
        const link = nav.getByRole('link', { name: 'Kanban', exact: true });
        assert.equal(await link.getAttribute('href'), '/kanban?profile=writer');
        await link.click();
        const check = async () => {
          await page.locator('.task-tower').waitFor();
          await page.locator('.tower-card:visible').first().waitFor();
          assert.equal(new URL(page.url()).pathname, '/kanban');
          assert.equal(new URL(page.url()).searchParams.get('profile'), 'writer');
          assert.ok((await page.title()).length);
          assert.equal(await page.locator('[data-column]').count(), 4);
          assert.equal(await page.getByText('Demo mode', { exact: true }).count(), mode === 'demo' ? 1 : 0);
          assert.equal(await page.locator('vite-error-overlay, .hermes-kanban-columns:visible, .dashboard-accessory-backdrop:visible').count(), 0);
          await openNav();
          assert.equal(await nav.getByRole('link', { name: 'Kanban', exact: true }).getAttribute('aria-current'), 'page');
          assert.equal(await nav.getByRole('link', { name: 'Home', exact: true }).getAttribute('aria-current'), null);
          if (!mobile) await page.keyboard.press('Escape');
        };
        await check();
        await page.reload();
        await check();
        await page.goBack();
        await page.locator('.codex-pane-slot').waitFor();
        assert.equal(new URL(page.url()).pathname, '/chat');
        await page.goForward();
        await check();
        // Old board/panel bookmarks resolve to the tower, including an irrelevant recent-view marker.
        await page.goto(host.origin + '/kanban?profile=writer&board=writing&panel=1&view=recent#saved');
        await check();
        assert.equal(new URL(page.url()).hash, '#saved');
        if (mobile) {
          await page.getByRole('link', { name: 'Back to chat', exact: true }).click();
          assert.equal(new URL(page.url()).pathname, '/chat');
          await page.goBack();
          await check();
        }
        if (mode === 'demo' && evidence) {
          for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => document.documentElement.dataset.workbenchTheme = theme, theme);
            await page.addStyleTag({ content: '#preview-banner { display: none }' });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.screenshot({ path: path.join(evidence, `kanban-${mobile ? 'mobile' : 'desktop'}-${theme}.png`) });
          }
        }
        assert.ok(!requests.some(url => url.includes('/api/plugins/kanban/boards')));
        assert.ok(requests.every(url => new URL(url).origin === host.origin), 'Browser only contacts same-origin host');
        const exposed = bodies.join('') + await page.locator('body').innerText() + await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
        assert.ok(!exposed.includes(fleet.origin) && !exposed.includes('mock-fleet-token'), 'Fleet URL/token remain server-side');
        assert.deepEqual(errors, []);
        await page.close();
      }
      console.log(`PASS: Kanban ${mode}, desktop/mobile navigation, profile, active state, deep link, refresh, history, same-origin requests and credentials`);
    } finally {
      if (host) await host.close();
      proxy.kill('SIGTERM');
      await new Promise(resolve => { if (proxy.exitCode !== null) return resolve(); proxy.once('exit', resolve); setTimeout(() => { proxy.kill('SIGKILL'); resolve(); }, 3000).unref(); });
    }
  }
} finally {
  await browser.close();
  await fleet.close();
}
