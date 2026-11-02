/** Localhost acceptance of the actual bundle; deterministic, public-safe fixture data. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shotDir = process.env.SHOT_DIR || 'node_modules/.cache/profile-overview-screenshots';
await mkdir(shotDir, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], writes = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { requests.push(request.url()); if (request.method() !== 'GET') writes.push(request.url()); });
  let mode = 'ready';
  const now = Date.now(), day = 86400000;
  const projects = [{ id: 'workbench', name: 'Workbench' }, { id: 'planning', name: 'Planning' }, { id: 'empty-project', name: 'Upcoming project' }];
  const session = (id, title, age, extra = {}) => ({ id, title, updatedAt: now - age, groupId: 'workbench', status: 'idle', ...extra });
  const profiles = [
    { name: 'default', projects, failed: [], sessions: [
      session('codex-preview', 'Review project navigation and session overview', 30_000, { last_opened_at: now - 20_000, unread: true }),
      session('codex-regression', 'Investigate the loading state', 4 * 3600000, { status: 'running' }),
      session('third', 'Plan the next iteration', 2 * day, { groupId: 'planning' }),
      ...Array.from({ length: 10 }, (_, i) => session('older-' + i, `Project notes from iteration ${i + 1}`, (8 + i) * day)),
    ] },
    { name: 'writer', projects: [{ id: 'writing', name: 'Writing studio' }], failed: [], sessions: [
      session('codex-preview', 'Outline the product announcement', 45_000, { groupId: 'writing' }),
      session('writer-two', 'Refine the release notes', day, { groupId: 'writing' }),
      session('writer-three', 'Draft the onboarding guide', 3 * day, { groupId: 'writing' }),
    ] },
    { name: 'research', projects: [{ id: 'research', name: 'Research notebook' }], failed: [], sessions: [session('research-one', 'Compare findings across projects', 3 * day, { groupId: 'research' })] },
    { name: 'empty', projects: [], failed: [], sessions: [] },
  ];
  await page.route('**/api/plugins/workbench/profile-overview', async route => {
    if (mode === 'loading') await new Promise(resolve => setTimeout(resolve, 500));
    if (mode === 'failed') return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    await route.fulfill({ json: { profiles: mode === 'empty' ? [] : profiles.map(p => mode === 'all-failed' ? { ...p, sessions: [], projects: [], failed: ['sessions', 'projects'] } : p) } });
  });
  await page.route('**/api/profiles/sessions?*', async route => {
    if (mode === 'partial') return route.fulfill({ json: { sessions: [], total: 0, errors: [{ profile: 'writer', error: 'Unavailable' }] } });
    if (mode === 'all-failed') return route.fulfill({ status: 503, json: {} });
    await route.fulfill({ json: { sessions: [], total: 0 } });
  });
  await page.goto(host.origin + '/');
  await page.locator('.profile-overview-column').nth(3).waitFor();
  await page.waitForFunction(() => document.querySelector('.profile-overview')?.getAttribute('aria-busy') === 'false');
  const columns = page.locator('.profile-overview-column');
  assert.deepEqual(await columns.evaluateAll(nodes => nodes.map(n => n.dataset.profile)), ['default', 'writer', 'research', 'empty']);
  assert.equal(await page.locator('.task-tower').count(), 0);
  assert.equal(await page.locator('[data-profile="default"] .profile-session').count(), 13);
  assert.deepEqual(await page.locator('[data-profile="default"] .profile-session').evaluateAll(nodes => nodes.slice(0, 4).map(n => n.dataset.freshness)), ['1', '2', '3', '0']);
  assert.match(await columns.nth(3).textContent(), /No projects or sessions yet/);
  assert.match(await columns.first().textContent(), /Upcoming project.*No sessions yet/s);
  assert.deepEqual(writes.filter(url => /session|read-state/.test(url)), [], 'Overview does not mutate sessions or read cursors');
  assert.equal(requests.filter(url => url.includes('/profile-overview')).length, 1);
  assert.equal(requests.filter(url => url.includes('/api/profiles/sessions?profile=all')).length, 1);
  const geometry = await page.locator('.profile-overview-columns').evaluate(node => ({ scroll: node.scrollWidth, width: node.clientWidth }));
  assert.ok(geometry.scroll > geometry.width, 'Columns scroll horizontally instead of squeezing titles');
  assert.ok(await columns.first().locator('.profile-column-scroll').evaluate(node => node.scrollHeight > node.clientHeight), 'Each column scrolls vertically');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; localStorage.setItem('hermes-dashboard-theme', theme); }, theme);
    await page.screenshot({ path: `${shotDir}/after-desktop-${theme}.png` });
    const gradient = await page.locator('.profile-session').first().evaluate(node => getComputedStyle(node).backgroundImage);
    assert.match(gradient, /linear-gradient/);
    assert.equal(await page.locator('.profile-session[data-freshness="0"]').first().evaluate(node => getComputedStyle(node).backgroundImage), 'none');
  }
  const tabs = page.locator('.overview-tabs');
  await tabs.getByRole('link', { name: 'Kanban', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/kanban');
  await page.locator('.task-tower').waitFor();
  assert.equal(await page.locator('.profile-overview').count(), 0);
  assert.equal(await page.locator('.tower-session').count(), 0);
  assert.equal(await page.locator('#dashboard-workbench-sessions').isVisible(), false);
  assert.equal(await tabs.locator('[aria-current="page"]').textContent(), 'Kanban');
  await page.screenshot({ path: `${shotDir}/after-kanban-desktop-dark.png` });
  await page.reload(); await page.locator('.task-tower').waitFor();
  await page.goBack(); await page.locator('.profile-overview').waitFor();
  await page.goForward(); await page.locator('.task-tower').waitFor();
  for (const route of ['/?view=kanban', '/sessions?board=one', '/kanban?view=legacy']) {
    await page.goto(host.origin + route); await page.waitForURL(url => url.pathname === '/kanban' && !url.searchParams.has('view'));
    await page.locator('.task-tower').waitFor();
  }
  await page.goto(host.origin + '/sessions?view=recent&profile=writer');
  await page.waitForURL(url => url.pathname === '/' && !url.searchParams.has('view'));
  await page.locator('[data-profile="writer"] .profile-session').first().click();
  await page.waitForURL(url => url.pathname === '/chat' && url.searchParams.get('profile') === 'writer');
  await page.locator('.codex-pane-slot').first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(host.origin + '/'); await columns.nth(3).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; localStorage.setItem('hermes-dashboard-theme', theme); }, theme);
    assert.ok(await tabs.isVisible());
    assert.ok(await columns.first().locator('h2').isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await page.locator('.profile-overview-columns').evaluate(node => getComputedStyle(node).scrollSnapType), 'x mandatory');
    await page.screenshot({ path: `${shotDir}/after-mobile-${theme}.png` });
  }
  await columns.nth(1).scrollIntoViewIfNeeded();
  assert.ok(await columns.nth(1).locator('h2').isVisible());
  assert.ok(await tabs.isVisible());
  mode = 'partial'; await page.reload();
  await columns.nth(1).getByRole('alert').waitFor();
  assert.equal(await columns.first().getByRole('alert').count(), 0);
  assert.equal(await columns.first().locator('.profile-session').count(), 13);
  await columns.nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotDir}/partial-mobile.png` });
  mode = 'failed'; await page.reload(); await page.getByRole('alert').filter({ hasText: 'Session overview unavailable' }).waitFor();
  mode = 'ready'; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await columns.nth(3).waitFor();
  mode = 'all-failed'; await page.reload(); await page.getByRole('alert').filter({ hasText: 'Session overview unavailable' }).waitFor();
  assert.equal(await columns.count(), 4);
  mode = 'empty'; await page.reload(); await page.getByText('No profiles available.').waitFor();
  mode = 'loading'; await page.reload(); await page.getByText('Loading profiles and project sessions…').waitFor(); await columns.nth(3).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(host.origin + '/config?workbench=allowances');
  await page.locator('.dashboard-settings-nav a[href*="allowances"]').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: profile grouping, empty profiles/projects, freshness, partial/all failures, retry/loading, tabs/reload/history/legacy routes, scoped session open, desktop/mobile light/dark, allowances');
} finally { await browser.close(); await host.close(); }
