/** Browser plugin not available; localhost resize and Phase 1 regression. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const shotDir = process.env.SHOT_DIR || '/tmp/kanban-floating-evidence';
if (shotDir) await mkdir(shotDir, { recursive: true });

const now = Date.now();
const iso = minutes => new Date(now - minutes * 60_000).toISOString();
const tasks = [
  {
    id: 'triage-export', title: 'Outline the export experience', status: 'triage', revision: 1,
    created_at: iso(240), status_changed_at: iso(120), repo: 'sample/workbench', machine: 'dev-box',
    risk: 'R1', priority: 'P2', acceptance: [], spec_json: {}, attempts: [], decision: null,
  },
  {
    id: 'running-search', title: 'Improve workspace search', status: 'running', revision: 2,
    created_at: iso(180), status_changed_at: iso(18), repo: 'sample/workbench', machine: 'nas',
    risk: 'R1', priority: 'P1', assignee: 'W-nas', model_used: 'gpt-5.2', reasoning_effort: 'high',
    acceptance: [{ label: 'Search tests pass', checked: true }], spec_json: {}, decision: null,
    attempts: [{ id: 'attempt-search', status: 'running', worker_id: 'W-nas', started_at: iso(18) }],
  },
  {
    id: 'review-download', title: 'Verify the download experience', status: 'review', revision: 3,
    created_at: iso(150), status_changed_at: iso(12), repo: 'sample/workbench', machine: 'nas',
    risk: 'R2', priority: 'P1', verify_mode: 'human', needs_human: true, assignee: 'W-nas',
    model_used: 'gpt-5.2', reasoning_effort: 'high', acceptance: [{ label: 'Checks pass', checked: true }],
    spec_json: { summary: 'Confirm the downloadable acceptance report.' }, decision: null,
    attempts: [{ id: 'attempt-review', status: 'ok', worker_id: 'W-nas', started_at: iso(40), ended_at: iso(12) }],
  },
  {
    id: 'done-navigation', title: 'Polish keyboard navigation', status: 'done', revision: 2,
    created_at: iso(300), status_changed_at: iso(60), completed_at: iso(60), repo: 'sample/workbench',
    machine: 'dev-box', risk: 'R0', priority: 'P2', acceptance: [{ label: 'Focus order verified', checked: true }],
    spec_json: {}, decision: null, attempts: [{ id: 'attempt-nav', status: 'ok', started_at: iso(100), ended_at: iso(60) }],
  },
];

function installFleetFixture(page) {
  return page.route('**/api/plugins/workbench/fleetd/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/config')) {
      return route.fulfill({ json: { mode: 'live', extended_workflow: false } });
    }
    if (url.pathname.endsWith('/tasks/sync')) {
      return route.fulfill({ json: { tasks, removed: [], cursors: {}, full: true } });
    }
    const task = tasks.find(task => url.pathname.endsWith('/tasks/' + task.id));
    if (task) return route.fulfill({ json: { task, artifacts: [], links: [], events: [], attempts: task.attempts } });
    return route.fulfill({ status: 404, json: { detail: 'Not part of this fixture' } });
  });
}

async function preparePage(browser, origin, { profile, theme, viewport = { width: 1440, height: 900 } }) {
  const page = await browser.newPage({ viewport, colorScheme: theme });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installFleetFixture(page);
  await page.goto(origin + `/chat?session=codex-preview&profile=${profile}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.codex-pane-slot').first().waitFor();
  await page.evaluate(value => { document.documentElement.dataset.workbenchTheme = value; }, theme);
  await page.addStyleTag({ content: '#preview-banner { display: none !important; }' });
  return { page, errors };
}

async function boxOf(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, 'Expected a visible bounding box');
  return box;
}

const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  console.log('Localhost:', host.origin);
  for (const theme of ['light', 'dark']) {
    const { page, errors } = await preparePage(browser, host.origin, { profile: `resize-${theme}`, theme });
    assert.match(await page.title(), /./);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `desktop-${theme}-before.png`) });
    const opener = page.locator('.dashboard-nav-collapse');
    await page.clock.install();
    let syncs = 0;
    page.on('request', request => { if (request.url().includes('/tasks/sync')) syncs++; });
    await opener.focus();
    await page.keyboard.press('b');
    const panel = page.locator('.hti-kanban-float-panel');
    await panel.locator('.tower-card').first().waitFor().catch(async error => { console.log('DEBUG', await page.locator('body').innerText(), errors); await page.screenshot({path:'/tmp/phase1-debug.png'}); throw error; });
    const beforeSync = syncs;
    await page.clock.runFor(8000);
    await page.waitForFunction(() => !document.querySelector('.task-tower[aria-busy="true"]'));
    assert.ok(syncs > beforeSync, 'Existing refresh continues inside the window');
    const initial = await boxOf(panel);
    for (const [actual, expected] of [[initial.width, 1152], [initial.height, 720], [initial.x, 144], [initial.y, 90]]) assert.ok(Math.abs(actual - expected) <= 2);

    for (const edge of ['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se']) {
      const before = await boxOf(panel);
      const handle = await boxOf(panel.locator(`[data-edge="${edge}"]`));
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      const saved = page.waitForResponse(response => response.url().includes('/kanban-geometry') && response.request().method() === 'PUT');
      await page.mouse.move(handle.x + handle.width / 2 + (edge.includes('w') ? 18 : -18), handle.y + handle.height / 2 + (edge.includes('n') ? 18 : -18), { steps: 4 });
      await page.mouse.up(); await saved;
      const after = await boxOf(panel);
      assert.ok(Math.abs(after.width - before.width) > 5 || Math.abs(after.height - before.height) > 5, edge);
    }
    const handle = await boxOf(panel.locator('[data-edge="se"]'));
    await page.mouse.move(handle.x + 8, handle.y + 8); await page.mouse.down();
    const saved = page.waitForResponse(r => r.url().includes('/kanban-geometry') && r.request().method() === 'PUT');
    await page.mouse.move(0, 0, { steps: 5 }); await page.mouse.up(); await saved;
    const minimum = await boxOf(panel);
    assert.ok(Math.abs(minimum.width - 560) < 2 && Math.abs(minimum.height - 320) < 2);
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
    await page.keyboard.press('b'); await panel.waitFor();
    assert.deepEqual(await boxOf(panel), minimum);
    await page.reload(); await page.locator('.dashboard-nav-collapse').focus(); await page.keyboard.press('b'); await panel.waitFor();
    assert.deepEqual(await boxOf(panel), minimum, 'reload restores server geometry');
    // Enlarge again for the drawer and screenshot checks below.
    const corner = await boxOf(panel.locator('[data-edge="se"]'));
    await page.mouse.move(corner.x + 8, corner.y + 8); await page.mouse.down();
    const enlarged = page.waitForResponse(r => r.url().includes('/kanban-geometry') && r.request().method() === 'PUT');
    await page.mouse.move(1300, 810, { steps: 5 }); await page.mouse.up(); await enlarged;
    await page.evaluate(value => { document.documentElement.dataset.workbenchTheme = value; }, theme);
    assert.equal(await panel.getByRole('button', { name: /close|maximize/i }).count(), 0);
    assert.ok(await panel.evaluate(el => el.contains(document.activeElement)));
    await panel.locator('.tower-card').first().click();
    await panel.locator('.tower-drawer').waitFor();
    await page.keyboard.press('Escape');
    await panel.locator('.tower-drawer').waitFor({ state: 'hidden' });
    assert.ok(await panel.isVisible());
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `desktop-${theme}.png`) });
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.ok(await opener.evaluate(el => el === document.activeElement));
    // Real composer plus custom editable/dropdown roles and modifier/IME guards.
    await page.locator('textarea').first().focus();
    await page.keyboard.press('b');
    assert.equal(await panel.count(), 0);
    for (const markup of ['<input>', '<textarea></textarea>', '<select><option>b</option></select>', '<div contenteditable="true"><span>edit</span></div>', '<div role="combobox" tabindex="0"></div>', '<div class="cm-editor" tabindex="0"></div>']) {
      await page.evaluate(html => { const wrapper = document.createElement('div'); wrapper.id = 'shortcut-test'; wrapper.innerHTML = html; document.body.append(wrapper); wrapper.firstElementChild.focus(); }, markup);
      await page.keyboard.press('b');
      assert.equal(await panel.count(), 0, markup);
      await page.locator('#shortcut-test').evaluate(el => el.remove());
    }
    await opener.focus();
    for (const role of ['menu', 'listbox']) {
      await page.evaluate(role => { const el = document.createElement('div'); el.id = 'shortcut-test'; el.setAttribute('role', role); el.textContent = 'Open dropdown'; document.body.append(el); }, role);
      await page.keyboard.press('b');
      assert.equal(await panel.count(), 0);
      await page.locator('#shortcut-test').evaluate(el => el.remove());
    }
    for (const key of ['Control+b', 'Alt+b', 'Meta+b', 'Shift+b']) { await page.keyboard.press(key); assert.equal(await panel.count(), 0); }
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', isComposing: true })));
    assert.equal(await panel.count(), 0);
    await page.keyboard.press('b');
    await panel.waitFor();
    await page.mouse.click(20, 20);
    await panel.waitFor({ state: 'hidden' });
    assert.ok(await opener.evaluate(el => el === document.activeElement));
    // A different profile starts at 80%; damaged server state falls back there too.
    await page.goto(host.origin + '/chat?session=codex-preview&profile=isolated-' + theme);
    await page.locator('.dashboard-nav-collapse').focus(); await page.keyboard.press('b'); await panel.waitFor();
    const isolated = await boxOf(panel);
    assert.ok(Math.abs(isolated.width - 1152) <= 2 && Math.abs(isolated.x - 144) <= 2);
    await page.request.put(host.origin + '/api/plugins/workbench/kanban-geometry?profile=isolated-' + theme, { data: { x: 9, y: 0, width: .8, height: .8 } });
    await page.reload(); await page.locator('.dashboard-nav-collapse').focus(); await page.keyboard.press('b'); await panel.waitFor();
    assert.deepEqual(await boxOf(panel), isolated, 'corrupt geometry falls back to centered 80%');
    assert.deepEqual(errors, []);
    await page.close();
  }
  // Global shortcut also works on the full-page board; only the foreground search responds.
  {
    const { page, errors } = await preparePage(browser, host.origin, { profile: 'default', theme: 'light' });
    await page.goto(host.origin + '/kanban');
    await page.locator('.tower-card').first().waitFor();
    await page.locator('.dashboard-nav-collapse').focus();
    await page.keyboard.press('b');
    const panel = page.locator('.hti-kanban-float-panel');
    await panel.locator('.tower-card').first().waitFor();
    await page.keyboard.press('f');
    await panel.locator('.tower-searchbar input').waitFor();
    assert.ok(await panel.locator('.tower-searchbar input').evaluate(el => el === document.activeElement));
    assert.equal(await page.locator('.task-tower .tower-searchbar input').count(), 1);
    await page.keyboard.press('Escape');
    assert.ok(await panel.isVisible());
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const theme of ['light', 'dark']) {
    const { page, errors } = await preparePage(browser, host.origin, { profile: 'default', theme, viewport: { width: 390, height: 844 } });
    await page.goto(host.origin + '/kanban');
    await page.locator('.tower-list .tower-card').first().waitFor();
    await page.evaluate(value => { document.documentElement.dataset.workbenchTheme = value; document.activeElement?.blur(); }, theme);
    await page.addStyleTag({ content: '#preview-banner { display:none }' });
    await page.keyboard.press('b');
    assert.equal(await page.locator('.hti-kanban-float-panel').count(), 0);
    assert.ok(await page.locator('.tower-list').isVisible());
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `mobile-${theme}.png`) });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: geometry, focus, input/editor/modifier/IME guards, drawer interaction, Escape, outside click, mobile, themes, console');
} finally { await browser.close(); await host.close(); }
