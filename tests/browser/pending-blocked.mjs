/** Browser plugin not available. Built bundle on localhost with fictional Fleet API fixtures. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
const evidence = process.env.WORKBENCH_SCREENSHOT_DIR || '/tmp/pending-blocked-evidence';
await mkdir(evidence, { recursive: true });
const tasks = [
  { id: 'blocked', status: 'blocked', title: 'Waiting for repository access' },
  { id: 'fleet-blocked', status: 'triage', fleet_status: 'blocked', title: 'Fleet dependency unavailable' },
  { id: 'triage', status: 'triage', title: 'Review the next task brief' },
  { id: 'ready', status: 'ready', title: 'Polish keyboard navigation' },
].map(t => ({ ...t, revision: 1, created_at: new Date().toISOString(), acceptance: [], read_only: true, machine: 'dev-box', model_used: 'sample-model' }));
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true });
const contrast = (a, b) => {
  const lum = c => {
    const rgb = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1536, height: mobile ? 844 : 960 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/api/plugins/workbench/fleet*/**', route => {
      const url = new URL(route.request().url());
      const task = tasks.find(t => url.pathname.endsWith(`/tasks/${t.id}`));
      const json = url.pathname.endsWith('/config') ? { mode: 'live', extended_workflow: false }
        : url.pathname.endsWith('/tasks/sync') ? { tasks, removed: [], cursors: {}, full: true }
        : task ? { task, artifacts: [], review_notes: [], attempts: [] }
        : { workers: [], decisions: [], tasks: [] };
      return route.fulfill({ json });
    });
    await page.goto(host.origin + '/kanban');
    const layout = mobile ? '.tower-list' : '.tower-board';
    const blocked = page.locator(`${layout} [data-task-id="blocked"]`);
    const ready = page.locator(`${layout} [data-task-id="ready"]`);
    await blocked.waitFor();
    assert.equal(new URL(page.url()).pathname, '/kanban');
    assert.ok(await page.title());
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.equal(await ready.evaluate(e => e.classList.contains('is-pending-blocked')), false);
    assert.equal(await page.locator(`${layout} .is-pending-blocked`).count(), 2);
    assert.match(await blocked.getAttribute('aria-label'), /Blocked/);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.workbenchTheme = theme, theme);
      const bg = await blocked.evaluate(e => getComputedStyle(e).backgroundColor);
      assert.notEqual(bg, await ready.evaluate(e => getComputedStyle(e).backgroundColor));
      for (const selector of ['.tower-card-title', '.tower-card-meta', '.tower-blocked-label']) {
        const fg = await blocked.locator(selector).evaluate(e => getComputedStyle(e).color);
        const ratio = contrast(fg, bg);
        assert.ok(ratio >= 4.5, `${theme} ${selector}: ${ratio}`);
        console.log(`${mobile ? 390 : 1536} ${theme} ${selector} contrast ${ratio.toFixed(2)}:1`);
      }
      await page.mouse.move(0, 0);
      await blocked.locator('.tower-card-title').evaluate(e => e.blur());
      const border = await blocked.evaluate(e => getComputedStyle(e).borderColor);
      await blocked.hover();
      assert.equal(await blocked.evaluate(e => getComputedStyle(e).backgroundColor), bg);
      assert.notEqual(await blocked.evaluate(e => getComputedStyle(e).borderColor), border);
      await blocked.locator('.tower-card-title').focus();
      assert.equal(await blocked.evaluate(e => getComputedStyle(e).backgroundColor), bg);
      assert.notEqual(await blocked.evaluate(e => getComputedStyle(e).boxShadow), 'none');
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${evidence}/${mobile ? 'mobile-390' : 'desktop'}-${theme}.png` });
      await blocked.locator('.tower-card-title').click();
      await page.locator('.tower-drawer').waitFor();
      assert.ok(await blocked.evaluate(e => e.classList.contains('is-selected')));
      assert.equal(await blocked.evaluate(e => getComputedStyle(e).backgroundColor), bg);
      await page.keyboard.press('Escape');
      await page.locator('.tower-drawer').waitFor({ state: 'hidden' });
      await blocked.locator('.tower-card-title').evaluate(e => e.blur());
      if (mobile) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`PASS: localhost desktop/mobile light/dark blockers, neutral controls, contrast, hover, focus, selected, drawer and layout. Evidence: ${evidence}`);
} finally { await browser.close(); await host.close(); }
