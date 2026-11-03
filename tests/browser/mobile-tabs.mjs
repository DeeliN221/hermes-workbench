/** Browser plugin not available; exercise the built overlay in the local mock host. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

async function assertContentGutter(page, target, label) {
  const rail = await page.locator('.dashboard-action-rail').boundingBox();
  const minimum = rail.x + rail.width + 8;
  const bounds = await page.locator(target).evaluate(el => [el, ...el.querySelectorAll('h1, h2, h3, form, input, select, textarea, ul, ol, label, [role="list"], .dashboard-cron-job-row')]
    .filter(node => node.getClientRects().length && !node.closest('dialog'))
    .map(node => ({ tag: node.tagName, left: node.getBoundingClientRect().left })));
  assert.ok(bounds.length);
  for (const bound of bounds) assert.ok(bound.left >= minimum, `${label} ${bound.tag} left ${bound.left} < ${minimum}`);
}

const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
const evidence = process.env.WORKBENCH_SCREENSHOT_DIR;
if (evidence) await fs.mkdir(evidence, { recursive: true });
const conversation = '/chat?session=codex-preview&profile=writer';
const routes = ['/achievements', '/cron', '/skills', '/files', '/config', '/kanban', '/sample-plugin'];
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/api/cron/jobs?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'sample-job', name: 'Daily check', prompt: 'Check the sample workspace', profile: 'writer', enabled: true, state: 'scheduled', schedule: { expr: '0 9 * * *' } }]) }));
    await page.goto(host.origin + conversation);
    await page.locator('.dashboard-action-rail').waitFor();
    assert.equal(await page.locator('.workbench-mobile-tab-chat').count(), 0);
    for (const route of routes) {
      console.log(theme, route);
      await page.goto(host.origin + route);
      assert.ok((await page.title()).length > 0);
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      const back = page.getByRole('link', { name: 'Back to chat', exact: true });
      await back.waitFor();
      assert.equal(await back.count(), 1);
      assert.equal(await back.getAttribute('href'), conversation);
      await page.evaluate(theme => document.documentElement.dataset.workbenchTheme = theme, theme);
      await page.addStyleTag({ content: '#preview-banner { display: none; }' });
      const rail = page.locator('.dashboard-action-rail');
      const railBox = await rail.boundingBox();
      assert.equal(railBox.x, 0);
      assert.equal(railBox.width, 48);
      const target = route === '/config' ? '.dashboard-settings-nav' : '.workbench-mobile-tab-content';
      await page.locator(target).waitFor();
      const box = await page.locator(target).boundingBox();
      assert.ok(box, `${route} content visible`);
      assert.ok((await page.locator(target).innerText()).trim().length > 0);
      assert.ok(box.x >= railBox.x + railBox.width + 8, `${route} content clears rail by 8px: ${box.x}`);
      await assertContentGutter(page, target, route);
      assert.equal(Math.round(box.width), 334, `${route} fills remaining width`);
      assert.ok(box.y >= 48, `${route} below shared header`);
      assert.ok(Math.abs(box.y + box.height - 844) <= 1, `${route} fills available height`);
      assert.ok((await back.boundingBox()).height >= 44);
      assert.equal(await page.locator('.dashboard-accessory-close:visible, .dashboard-accessory-backdrop:visible').count(), 0);
      assert.equal(await rail.evaluate(el => el.inert || el.getAttribute('aria-hidden') === 'true'), false);
      assert.equal(await rail.locator('a[href^="/skills"], a[href^="/sample-plugin"]').count(), 0);
      assert.deepEqual(await rail.locator('.dashboard-rail-actions a').evaluateAll(links => links.map(a => { const url = new URL(a.href); url.searchParams.delete('profile'); return url.pathname + url.search; }).sort()),
        ['/config?workbench=versions', '/kanban', '/cron', '/chat?workbench=terminal', '/achievements'].sort(), 'Rail links match main');
      if (!['/skills', '/sample-plugin'].includes(route)) assert.ok(await rail.locator('[aria-current="page"]').count());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (evidence) await page.screenshot({ path: path.join(evidence, `${route.slice(1)}-${theme}.png`) });
      if (route === '/cron') {
        const createBox = await page.locator('.dashboard-cron-page-header button').boundingBox();
        assert.ok(createBox.x >= 48 && createBox.x + createBox.width <= 390, 'New job remains inside content');
        await page.locator('.dashboard-cron-job-row').first().click();
        await page.locator('.dashboard-cron-page[data-mobile-view="detail"]').waitFor();
        await page.locator('.dashboard-cron-back').click();
        await page.locator('.dashboard-cron-page[data-mobile-view="list"]').waitFor();
        await page.locator('.dashboard-cron-page-header button').click();
        await page.getByRole('dialog', { name: 'New scheduled job' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Close editor' }).isVisible(), true);
        await page.keyboard.press('Escape');
        await page.locator('.dashboard-cron-modal').waitFor({ state: 'detached' });
      }
      if (route === '/files') {
        assert.ok(await page.locator('.host-main').evaluate(el => { el.scrollTop = 80; return el.scrollTop > 0; }), 'Native content scrolls inside the shell');
        await page.getByRole('textbox', { name: 'Filter', exact: true }).fill('example');
        await page.getByRole('button', { name: 'Preview', exact: true }).click();
        await page.getByRole('dialog').waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#preview-dialog').count(), 1);
        assert.equal(await page.locator('#preview-dialog').isVisible(), false);
        assert.equal(await page.getByRole('textbox', { name: 'Filter', exact: true }).inputValue(), 'example');
      }
      if (route === '/config') {
        await page.locator('.dashboard-settings-nav a[href^="/config"]').first().click();
        await page.locator('.workbench-mobile-settings-panel').waitFor();
        assert.equal(await page.locator('.workbench-mobile-settings-panel').getAttribute('aria-modal'), null);
        assert.equal((await rail.boundingBox()).x, 0);
        await page.locator('.workbench-mobile-settings-back').waitFor();
        const detailBox = await page.locator('.workbench-mobile-settings-panel').boundingBox();
        assert.ok(detailBox.x >= railBox.x + railBox.width + 8);
        await assertContentGutter(page, '.workbench-mobile-settings-panel', 'settings detail');
        assert.equal(detailBox.width, 334);
        assert.equal(detailBox.y, 96);
        assert.equal(await back.isVisible(), true);
        assert.equal(await back.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'Chat link is not covered by settings');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (evidence) await page.screenshot({ path: path.join(evidence, 'config-detail-' + theme + '.png') });
        await page.keyboard.press('Escape');
        await page.locator('.dashboard-settings-nav').waitFor();
      }
      await page.setViewportSize({ width: 800, height: 844 });
      await assertContentGutter(page, target, `${route} at 800px`);
      await page.setViewportSize({ width: 801, height: 844 });
      await back.waitFor({ state: 'detached' });
      // Media-query listeners reconcile the canvas on the next animation frame.
      await page.locator('.workbench-mobile-tab-content').waitFor({ state: 'detached' });
      assert.equal(await page.locator('html').getAttribute('data-mobile-tab'), 'false', `${route} desktop canvas restored`);
      await page.setViewportSize({ width: 1440, height: 900 });
      assert.equal(await page.locator('.workbench-mobile-tab-chat').count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await back.waitFor();
      await back.click();
      await page.waitForURL(host.origin + conversation);
      await page.goBack();
      await page.waitForURL(url => url.pathname === route);
      await page.getByRole('link', { name: 'Back to chat', exact: true }).waitFor();
    }
    for (const tab of ['display', 'models', 'shortcuts', 'versions']) {
      await page.goto(host.origin + '/config?workbench=' + tab);
      const detail = page.locator('.workbench-mobile-settings-panel');
      await detail.waitFor();
      await page.evaluate(theme => document.documentElement.dataset.workbenchTheme = theme, theme);
      await page.addStyleTag({ content: '#preview-banner { display: none; }' });
      await assertContentGutter(page, '.workbench-mobile-settings-panel', `settings ${tab}`);
      assert.equal((await detail.boundingBox()).y, 96, `${tab} clears both headers`);
      if (evidence) await page.screenshot({ path: path.join(evidence, `config-${tab}-${theme}.png`) });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(host.origin + '/achievements');
  const back = page.getByRole('link', { name: 'Back to chat', exact: true });
  await back.waitFor();
  assert.equal(await back.getAttribute('href'), '/chat');
  await back.click();
  await page.waitForURL(url => url.pathname === '/chat');
  // Rail clicks use ordinary tab routes; tools on /chat retain their existing surface.
  await page.locator('.dashboard-action-rail a[href^="/achievements"]').click();
  await page.waitForURL(/\/achievements/);
  await back.waitFor();
  await page.setViewportSize({ width: 390, height: 320 });
  assert.ok(await page.locator('.dashboard-action-rail').evaluate(el => { el.scrollTop = 200; return el.scrollTop > 0; }), 'Rail remains scrollable');
  await page.setViewportSize({ width: 800, height: 844 });
  await back.waitFor();
  await assertContentGutter(page, '.workbench-mobile-tab-content', '800px');
  await page.setViewportSize({ width: 801, height: 844 });
  await back.waitFor({ state: 'detached' });
  await page.locator('.workbench-mobile-tab-content').waitFor({ state: 'detached' });
  assert.equal(await page.locator('html').getAttribute('data-mobile-tab'), 'false');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(host.origin + '/cron?panel=1');
  await page.locator('.dashboard-accessory-close').waitFor();
  assert.equal(await page.locator('.workbench-mobile-tab-chat').count(), 0);
  await page.close();
  console.log('PASS mobile tabs: light/dark 390x844, seven routes, storage/fallback, settings, preview Escape, browser back, 800/801 and desktop overlay');
} finally { await browser.close(); await host.close(); }
