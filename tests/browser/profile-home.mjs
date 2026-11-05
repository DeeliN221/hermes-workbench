/** Localhost acceptance of the actual bundle; deterministic, public-safe fixture data. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shotDir = process.env.SHOT_DIR || 'node_modules/.cache/profile-overview-screenshots';
await mkdir(shotDir, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], writes = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    // Failure fixtures intentionally return HTTP 503; healthy routes must stay clean.
    if (message.type() === 'error' && !(injectedFailure && message.text().includes('503'))) errors.push(message.text());
  });
  page.on('request', request => { requests.push(request.url()); if (request.method() !== 'GET') writes.push(request.url()); });
  let mode = 'ready', savedOrder = [], injectedFailure = false;
  await page.route('**/api/plugins/workbench/profile-order', async route => {
    if (route.request().method() === 'PUT') savedOrder = route.request().postDataJSON().order;
    await route.fulfill({ json: { order: savedOrder } });
  });
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
    { name: 'research', projects: [{ id: 'research', name: 'Research notebook' }], failed: [], sessions: [session('research-one', 'Compare findings across projects', 9 * day, { groupId: 'research' })] },
    { name: 'empty', projects: [], failed: [], sessions: [] },
    { name: 'archive', projects: [], failed: [], sessions: [] },
  ];
  let failStyle = false;
  await page.route('**/api/plugins/workbench/codex/groups**', async route => {
    const url = new URL(route.request().url());
    const profile = profiles.find(p => p.name === (url.searchParams.get('profile') || route.request().postDataJSON()?.profile));
    if (url.pathname.endsWith('/appearance')) {
      if (failStyle) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
      const group = profile.projects.find(p => p.id === url.pathname.split('/').at(-2));
      Object.assign(group, route.request().postDataJSON());
      return route.fulfill({ json: { group } });
    }
    if (route.request().method() === 'POST') {
      const group = { id: 'new-project', name: route.request().postDataJSON().name };
      profile.projects.push(group);
      return route.fulfill({ json: { group } });
    }
    return route.fulfill({ json: { items: profile?.projects || [] } });
  });
  // Deliberately unordered input proves selection happens after freshness sorting.
  profiles[0].sessions.reverse();
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
  assert.deepEqual(await columns.evaluateAll(nodes => nodes.map(n => n.dataset.profile)), ['default', 'writer', 'research', 'empty', 'archive']);
  assert.equal(await page.locator('.task-tower').count(), 0);
  assert.equal(await page.locator('[data-profile="default"] .profile-session').count(), 3);
  assert.deepEqual(await page.locator('[data-profile="default"] .profile-session').evaluateAll(nodes => nodes.map(n => n.dataset.freshness)), ['1', '2', '3']);
  const assertLimited = async () => {
    assert.deepEqual(await columns.evaluateAll(nodes => nodes.map(n => n.querySelectorAll('.profile-session').length)), [3, 3, 1, 0, 0]);
    assert.deepEqual(await columns.first().locator('.profile-session').evaluateAll(nodes => nodes.map(n => new URL(n.href).searchParams.get('session'))), ['codex-preview', 'codex-regression', 'third']);
    assert.equal(await page.locator('.profile-session[href*="older-"]').count(), 0, 'Older sessions are absent from DOM');
    assert.equal(await page.getByText(/Show all|Expand all/i).count(), 0);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.ok(await page.title());
    assert.equal(new URL(page.url()).hostname, 'localhost');
  };
  await assertLimited();
  assert.match(await columns.nth(3).textContent(), /No sessions yet/);
  assert.equal(await page.locator('.profile-empty-project').count(), 0);
  assert.equal(await page.locator('.profile-session time, .profile-session-meta').count(), 0);
  assert.equal(await page.locator('.profile-new-session').count(), 5);
  assert.deepEqual(writes.filter(url => /session|read-state/.test(url)), [], 'Overview does not mutate sessions or read cursors');
  assert.equal(requests.filter(url => url.includes('/profile-overview')).length, 1);
  assert.equal(requests.filter(url => url.includes('/api/profiles/sessions?profile=all')).length, 1);
  for (const name of ['empty', 'archive']) {
    assert.equal(await page.locator(`[data-profile="${name}"] .profile-project-actions`).count(), 0);
    assert.equal(await page.locator(`[data-profile="${name}"] .profile-session-project`).count(), 0);
  }
  assert.equal(await page.locator('.profile-project-actions, .profile-order-toolbar, .profile-order-controls').count(), 0);
  const geometry = await page.locator('.profile-overview-columns').evaluate(node => ({ scroll: node.scrollWidth, width: node.clientWidth }));
  assert.ok(geometry.scroll <= geometry.width, 'Profile groups never overflow horizontally');
  assert.ok(await columns.first().locator('.profile-column-scroll').evaluate(node => node.scrollHeight <= node.clientHeight), 'Groups use the page scroll, not nested scrolling');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; localStorage.setItem('hermes-dashboard-theme', theme); }, theme);
    await page.screenshot({ path: `${shotDir}/after-desktop-${theme}.png` });
    const gradient = await page.locator('.profile-session').first().evaluate(node => getComputedStyle(node).backgroundImage);
    assert.match(gradient, /linear-gradient/);
    assert.equal(await page.locator('.profile-session[data-freshness="0"]').first().evaluate(node => getComputedStyle(node).backgroundImage), 'none');
  }
  for (const [width, expected] of [[1440, 3], [1024, 2], [800, 1], [390, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('.profile-overview-columns').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), expected);
    assert.ok(await page.locator('.profile-overview-columns').evaluate(node => node.scrollWidth <= node.clientWidth));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.getByRole('combobox').count(), 0);
  await assertLimited();
  const visibleCount = await page.locator('.profile-session').evaluateAll(nodes => nodes.filter(node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length);
  assert.ok(visibleCount === 7, `Compact desktop shows all seven retained sessions: ${visibleCount}`);
  console.log(`Desktop fully visible sessions: ${visibleCount}`);
  assert.equal(await page.locator('.dashboard-global-nav').isVisible(), false);
  assert.equal(await page.locator('.dashboard-action-rail').isVisible(), false);
  assert.equal((await page.locator('.dashboard-owned-page').boundingBox()).x, 0);
  assert.equal(await page.locator('.overview-tabs').count(), 0);
  await columns.first().locator('h2').click();
  await page.bringToFront();
  await page.keyboard.press('w');
  const homeUrl = page.url();
  await page.locator('.workbench-actions-dialog[open]').getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.locator('.hti-kanban-float-panel .task-tower').waitFor();
  assert.equal(page.url(), homeUrl);
  assert.equal(await page.locator('.profile-overview').count(), 1);
  await page.keyboard.press('Escape');
  await page.locator('.hti-kanban-float-panel').waitFor({ state: 'hidden' });
  await page.goto(host.origin + '/kanban');
  await page.waitForURL(url => url.pathname === '/kanban');
  await page.locator('.task-tower').waitFor();
  assert.equal(await page.locator('.profile-overview').count(), 0);
  assert.equal(await page.locator('.tower-session').count(), 0);
  assert.equal(await page.locator('#dashboard-workbench-sessions').isVisible(), false);
  assert.equal(await page.locator('.overview-tabs').count(), 0);
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
  if (page.viewportSize().width > 800) await page.getByRole('button', { name: /Open selected/ }).click();
  await page.waitForURL(url => url.pathname === '/chat' && url.searchParams.get('profile') === 'writer');
  await page.locator('.codex-pane-slot').first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(host.origin + '/'); await columns.nth(3).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; localStorage.setItem('hermes-dashboard-theme', theme); }, theme);
    await assertLimited();
    assert.ok(await page.locator('.dashboard-action-rail').isVisible());
    assert.equal(await page.locator('.overview-tabs').count(), 0);
    assert.ok(await columns.first().locator('h2').isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await page.locator('.profile-overview-columns').evaluate(node => getComputedStyle(node).scrollSnapType), 'none');
    assert.ok(await columns.evaluateAll(nodes => nodes.every((node, i) => !i || node.getBoundingClientRect().top >= nodes[i - 1].getBoundingClientRect().bottom)), 'Mobile groups stack vertically');
    assert.ok(await page.locator('.profile-overview-columns').evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.screenshot({ path: `${shotDir}/after-mobile-${theme}.png` });
    await columns.nth(1).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shotDir}/after-mobile-groups-${theme}.png` });
    await page.locator('.profile-overview').evaluate(node => { node.scrollTop = 0; });
  }
  await columns.nth(1).scrollIntoViewIfNeeded();
  assert.ok(await columns.nth(1).locator('h2').isVisible());
  assert.equal(await page.locator('.overview-tabs').count(), 0);
  const visibleSession = profiles[0].sessions.find(row => row.id === 'codex-preview');
  const originalTitle = visibleSession.title;
  visibleSession.title = 'LongUnbrokenSessionTitle'.repeat(15);
  await page.reload(); await columns.nth(3).waitFor();
  for (const width of [390, 800, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.locator('.profile-overview-columns').evaluate(node => node.scrollWidth <= node.clientWidth), `Long titles fit at ${width}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  visibleSession.title = originalTitle;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-profile="writer"] .profile-session').first().click();
  if (page.viewportSize().width > 800) await page.getByRole('button', { name: /Open selected/ }).click();
  await page.waitForURL(url => url.pathname === '/chat' && url.searchParams.get('profile') === 'writer');
  await page.locator('.codex-pane-slot').first().waitFor();
  await page.goto(host.origin + '/'); await columns.nth(3).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const profile of ['default', 'writer']) {
      await page.goto(host.origin + '/'); await columns.nth(3).waitFor();
      const add = page.locator(`[data-profile="${profile}"] .profile-new-session`);
      await add.focus();
      assert.notEqual(await add.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
      await page.keyboard.press('Enter');
      await page.waitForURL(url => url.pathname === '/chat' && url.searchParams.get('profile') === profile && url.searchParams.get('new') === '1');
      await page.locator('.codex-pane-slot').first().waitFor();
      assert.equal(new URL(page.url()).searchParams.has('session'), false);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(host.origin + '/'); await columns.nth(3).waitFor();
  mode = 'partial'; await page.reload();
  await columns.nth(1).getByRole('alert').waitFor();
  assert.equal(await columns.first().getByRole('alert').count(), 0);
  assert.equal(await columns.first().locator('.profile-session').count(), 3);
  await columns.nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotDir}/partial-mobile.png` });
  injectedFailure = true; mode = 'failed'; await page.reload(); await page.getByRole('alert').filter({ hasText: 'Session overview unavailable' }).waitFor();
  mode = 'ready'; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await columns.nth(3).waitFor();
  mode = 'all-failed'; await page.reload(); await page.getByRole('alert').filter({ hasText: 'Session overview unavailable' }).waitFor();
  assert.equal(await columns.count(), 5);
  mode = 'empty'; await page.reload(); await page.getByText('No profiles available.').waitFor();
  mode = 'loading'; await page.reload(); await page.getByText('Loading profiles and project sessions…').waitFor(); await columns.nth(3).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(host.origin + '/config?workbench=allowances');
  await page.locator('.dashboard-settings-nav a[href*="allowances"]').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: profile grouping, empty profiles/projects, freshness, partial/all failures, retry/loading, W menu/reload/history/legacy routes, 3/2/1 columns, removed home controls, keyboard new sessions, scoped session open, desktop/mobile light/dark, allowances');
} finally { await browser.close(); await host.close(); }
