/** Localhost acceptance for profile-scoped home density in the real bundle. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shotDir = process.env.SHOT_DIR || '/tmp/home-layout-evidence';
await mkdir(shotDir, { recursive: true });

const now = Math.floor(Date.now() / 1000);
const profiles = ['default', 'writer', 'research', 'support', 'planning'].map((name, profileIndex) => ({
  name,
  failed: [],
  projects: [{ id: `project-${profileIndex}`, name: `${name[0].toUpperCase()}${name.slice(1)} project` }],
  sessions: Array.from({ length: 8 }, (_, index) => ({
    id: `${name}-session-${index}`,
    title: `Review ${name} release checklist ${index + 1}`,
    updated_at: now - (index * 90 + profileIndex * 5),
    last_opened_at: now - (index * 90 + profileIndex * 5),
    group_id: `project-${profileIndex}`,
    status: index === 1 ? 'running' : 'idle',
    unread: index === 0,
  })),
}));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/plugins/workbench/profile-overview', route => route.fulfill({ json: { profiles } }));
  await page.route('**/api/profiles/sessions?*', route => route.fulfill({ json: { sessions: [], total: 0 } }));

  const columnCount = () => page.locator('.profile-overview-columns').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  const waitForHome = async () => {
    await page.locator('.profile-overview').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.profile-overview')?.getAttribute('aria-busy') === 'false');
  };
  const screenshot = async path => {
    await page.evaluate(() => document.getElementById('preview-banner')?.remove());
    await page.screenshot({ path });
  };
  const assertLayout = async (profile, columns, sessions) => {
    assert.equal(await columnCount(), columns);
    assert.equal(await page.locator(`[data-profile="${profile}"] .profile-session`).count(), sessions);
    assert.equal(await page.locator(`[data-profile="${profile}"] .profile-session-indicator[aria-label="Unread"]`).count(), 1);
    assert.equal(await page.locator(`[data-profile="${profile}"] .profile-session-indicator[aria-label="Running"]`).count(), 1);
    assert.match(await page.locator(`[data-profile="${profile}"] .profile-column-count`).innerText(), /^8 sessions$/);
  };

  await page.goto(host.origin + '/?profile=default', { waitUntil: 'domcontentloaded' });
  await waitForHome();
  await page.waitForFunction(() => document.querySelector('.profile-overview-columns')?.dataset.columns === '3');
  await assertLayout('default', 3, 3);
  assert.equal(await page.locator('.profile-overview input, .profile-overview select, .profile-overview [data-testid="home-layout-settings"]').count(), 0,
    'The home page must not expose layout settings controls');
  assert.equal(await page.getByRole('button', { name: /layout|home layout/i }).count(), 0);
  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'light'; localStorage.setItem('hermes-dashboard-theme', 'light'); });
  await screenshot(`${shotDir}/home-default-3x3-light.png`);
  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'dark'; });
  await screenshot(`${shotDir}/home-default-3x3-dark.png`);
  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'light'; });

  await page.goto(host.origin + '/config?workbench=display&profile=default', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="home-layout-settings"]').waitFor({ state: 'visible' });
  const columnsInput = page.locator('[data-testid="home-layout-columns"]');
  const sessionsInput = page.locator('[data-testid="home-layout-sessions"]');
  assert.equal(await columnsInput.inputValue(), '3');
  assert.equal(await sessionsInput.inputValue(), '3');
  assert.match(await page.locator('[data-testid="home-layout-settings"]').innerText(), /Profiles per row \(1–6\)/);
  assert.match(await page.locator('[data-testid="home-layout-settings"]').innerText(), /Sessions per profile \(1–20\)/);
  await page.locator('[data-testid="home-layout-settings"]').scrollIntoViewIfNeeded();
  await screenshot(`${shotDir}/settings-home-layout-light.png`);

  await columnsInput.fill('7');
  await columnsInput.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-testid="home-layout-columns"]')?.value === '3');
  assert.match(await page.locator('.home-layout-status').innerText(), /Default 3 restored and saved/);

  await columnsInput.fill('4');
  await columnsInput.press('Tab');
  await sessionsInput.fill('5');
  await sessionsInput.press('Tab');
  await page.waitForFunction(() => document.querySelector('.home-layout-status')?.textContent?.includes('Saved'));
  assert.equal(await page.evaluate(() => localStorage.getItem('hermes.workbench.home-layout')), null,
    'Layout settings must not be stored in localStorage');
  const stored = await page.evaluate(async () => (await fetch('/api/plugins/workbench/home-layout?profile=default')).json());
  assert.deepEqual(stored, { columns: 4, sessions_per_profile: 5 });

  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'dark'; localStorage.setItem('hermes-dashboard-theme', 'dark'); });
  await page.locator('[data-testid="home-layout-settings"]').scrollIntoViewIfNeeded();
  await screenshot(`${shotDir}/settings-home-layout-dark.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-testid="home-layout-settings"]').scrollIntoViewIfNeeded();
  await screenshot(`${shotDir}/settings-home-layout-mobile-390-dark.png`);
  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'light'; });
  await screenshot(`${shotDir}/settings-home-layout-mobile-390-light.png`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'dark'; });

  await page.evaluate(() => {
    window.__homeLayoutNoReload = 'kept';
    history.pushState(null, '', '/?profile=default');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await waitForHome();
  await page.waitForFunction(() => document.querySelector('.profile-overview-columns')?.dataset.columns === '4');
  assert.equal(await page.evaluate(() => window.__homeLayoutNoReload), 'kept', 'Returning home must not reload the page');
  await assertLayout('default', 4, 5);
  await screenshot(`${shotDir}/home-custom-4x5-dark.png`);
  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'light'; localStorage.setItem('hermes-dashboard-theme', 'light'); });
  await screenshot(`${shotDir}/home-custom-4x5-light.png`);

  const firstSession = page.locator('[data-profile="default"] .profile-session').first();
  const firstSessionHref = await firstSession.getAttribute('href');
  await firstSession.click();
  await page.waitForURL(url => url.pathname === '/chat');
  assert.equal(new URL(page.url()).searchParams.get('session'), new URL(firstSessionHref, host.origin).searchParams.get('session'));
  assert.equal(new URL(page.url()).searchParams.get('profile'), 'default');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(host.origin + '/?profile=default', { waitUntil: 'domcontentloaded' });
  await waitForHome();
  await page.waitForFunction(() => document.querySelector('.profile-overview-columns')?.dataset.columns === '4');
  assert.equal(await columnCount(), 1, 'Phones stay single-column regardless of the saved desktop density');
  assert.ok(await page.locator('.profile-overview-columns').evaluate(node => node.scrollWidth <= node.clientWidth));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'light'; localStorage.setItem('hermes-dashboard-theme', 'light'); });
  await screenshot(`${shotDir}/home-custom-4x5-mobile-390-light.png`);
  await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'dark'; localStorage.setItem('hermes-dashboard-theme', 'dark'); });
  await screenshot(`${shotDir}/home-custom-4x5-mobile-390-dark.png`);

  const writerSaved = await page.evaluate(async () => {
    const response = await fetch('/api/plugins/workbench/home-layout?profile=writer', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: 2, sessions_per_profile: 2 }),
    });
    return response.json();
  });
  assert.deepEqual(writerSaved, { columns: 2, sessions_per_profile: 2 });
  const isolated = await page.evaluate(async () => Promise.all(['default', 'writer'].map(async profile => (
    await (await fetch(`/api/plugins/workbench/home-layout?profile=${profile}`)).json()
  ))));
  assert.deepEqual(isolated, [
    { columns: 4, sessions_per_profile: 5 },
    { columns: 2, sessions_per_profile: 2 },
  ]);
  await page.goto(host.origin + '/?profile=writer', { waitUntil: 'domcontentloaded' });
  await waitForHome();
  await page.waitForFunction(() => document.querySelector('.profile-overview-columns')?.dataset.columns === '2');
  await assertLayout('writer', 1, 2);

  assert.deepEqual(errors, []);
  console.log('PASS: home layout default/custom/bounds/persistence/isolation, no home controls, no-reload return, desktop and 390px mobile, session navigation');
} finally {
  await browser.close();
  await host.close();
}
