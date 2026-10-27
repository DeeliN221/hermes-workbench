/** Verify cron sessions load by owning profile and missing runs stay non-fatal. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const RUN_ID = 'cron_job-legacy_20261026_180000';
const host = await createMockHost();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});

async function runScenario(sessionProfile) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('request', request => {
    if (request.url().includes(`/api/sessions/${RUN_ID}`)) requests.push(request.url());
  });

  await page.route('**/api/cron/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/cron/jobs') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'job-legacy', name: 'Legacy task', prompt: 'Run legacy check',
          profile: 'project-manager', enabled: true, state: 'scheduled',
          schedule: { expr: '0 18 * * *' }, last_run_at: '2026-10-26T18:00:00Z',
        }]),
      });
    }
    if (url.pathname.endsWith('/runs')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ runs: [{
          id: RUN_ID, title: 'Legacy run', started_at: 1793037600,
          ended_at: 1793037900, profile: 'project-manager',
        }] }),
      });
    }
    if (url.pathname === '/api/plugins/workbench-cron/executions') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ executions: [] }) });
    }
    return route.fallback();
  });

  await page.route('**/api/sessions/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes(RUN_ID)) return route.fallback();
    const profile = url.searchParams.get('profile');
    // The real latest-descendant endpoint currently ignores profile. Cron
    // sessions must therefore load directly instead of probing that endpoint.
    if (url.pathname.endsWith('/latest-descendant')) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Session not found' }),
      });
    }
    if (!sessionProfile || profile !== sessionProfile) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Session not found' }),
      });
    }
    const id = url.pathname.split('/')[3];
    const body = url.pathname.endsWith('/messages')
      ? { session_id: id, messages: [
          { role: 'user', content: 'legacy prompt' },
          { role: 'assistant', content: 'legacy answer' },
        ] }
      : { id, title: 'Legacy session', source: 'cron', lineage: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto(`${host.origin}/cron?profile=project-manager&panel=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="dashboard-cron-page"]').waitFor({ state: 'attached', timeout: 5000 });
  await page.locator('.dashboard-cron-detail-tabs button').nth(1).click();
  await page.locator('.dashboard-cron-run-row').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.dashboard-cron-run-row').first().click();
  if (sessionProfile) {
    await page.locator('[data-testid="hermes-history-transcript"]').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('.dashboard-cron-inline-error').count(), 0);
    if (sessionProfile === 'default') {
      assert.ok(requests.some(url => url.includes('profile=default')), 'Expected the legacy default-profile retry');
    } else {
      assert.ok(requests.some(url => url.includes('profile=project-manager')), 'Expected the owning-profile session');
    }
  } else {
    await page.getByText('No transcript is available for this run').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('.dashboard-cron-inline-error').count(), 0);
  }
  assert.equal(requests.some(url => url.includes('/latest-descendant')), false, 'Cron sessions must bypass latest-descendant');
  assert.deepEqual(errors, []);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="dashboard-cron-page"]').waitFor({ state: 'attached', timeout: 5000 });
  await page.close();
}

try {
  await runScenario('project-manager');
  await runScenario('default');
  await runScenario(null);
  console.log('Cron session browser check passed: owning profile, legacy retry, missing transcript state, and refresh stay usable.');
} finally {
  await browser.close();
  await host.close();
}
