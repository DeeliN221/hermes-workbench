/** Unified search acceptance: real built UI on localhost, synthetic read-only APIs. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
import { fixtureTask } from '../fixtures/mock-fleet.mjs';
const shots = process.env.SHOT_DIR || 'node_modules/.cache/workbench-search';
await mkdir(shots, { recursive: true });
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const evidence = [];
const longTitle = 'Release review: verify the search experience with a deliberately long title and long-project-identifier-without-any-breaks-'.repeat(2);
const task = fixtureTask('search-task', 'review', { title: longTitle, attempts: [], spec_json: { summary: 'Review the release checklist.\n\nVerify keyboard navigation, responsive layout, and readable search summaries.\n\nRun the regression suite and inspect the screenshots before delivery.' } });
try {
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 960 } });
    page.setDefaultTimeout(15000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('503')) errors.push(message.text()); });
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    await page.addInitScript(theme => { localStorage.setItem('hermes-locale', 'en'); localStorage.setItem('hermes-dashboard-theme', theme); }, theme);
    let fail = false;
    await page.route('**/api/plugins/workbench/fleetd/**', async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.split('/fleetd')[1];
      if (path === '/tasks/search') {
        if (fail) return route.fulfill({ status: 503, json: { detail: 'Synthetic task search outage' } });
        return route.fulfill({ json: { tasks: url.searchParams.get('q') === 'empty-unique-query' ? [] : [task], next_cursor: '', has_more: false } });
      }
      const data = path === '/config' ? { mode: 'live', extended_workflow: false }
        : path === '/tasks/sync' ? {tasks: [], removed: [], cursors: {}, full: true}
        : path === '/tasks' ? { tasks: [] } // Deep link must work outside the recent board snapshot.
        : path === '/workers' ? { workers: [] } : path === '/decisions' ? { decisions: [] }
        : { task, artifacts: [], attempts: [] };
      return route.fulfill({ json: data });
    });
    await page.route('**/api/plugins/workbench/codex/search?*', route => {
      const q = new URL(route.request().url()).searchParams.get('q');
      return route.fulfill({ json: { results: q === 'empty-unique-query' ? [] : [{ session_id: 'codex-preview', title: longTitle, snippet: 'A useful conversation excerpt with enough detail to assess the result before opening it. '.repeat(3), group_name: 'Release verification project with a long name' }] } });
    });
    await page.route('**/api/sessions/search?*', route => route.fulfill({ json: { results: [] } }));
    await page.route(/\/api\/plugins\/workbench\/codex\/session(?:\/preview)?\?/, route => route.fulfill({ json: { turns: [{
      id: 'search-preview-turn', status: 'completed', items: [
        { id: 'question', type: 'userMessage', content: [{ type: 'text', text: 'What should we check before shipping the search update?' }] },
        { id: 'answer', type: 'agentMessage', text: '## Search acceptance\n\nSearch should find conversations across profiles and tasks on the Fleet board.\n\n- Confirm that each result clearly identifies its source.\n- Keep the open action beside the title.\n- Check long titles, summaries, and metadata at phone width.\n\n## Verification\n\nUse light and dark themes, inspect empty results, and retry a failed source without losing successful results.', phase: 'final' },
      ],
    }] } }));
    const homeSearch = async () => {
      await page.goto(host.origin + '/');
      await page.locator('.profile-new-session').first().focus();
      await page.keyboard.press('w');
      const trigger = page.locator('.workbench-actions-dialog .codex-session-search-trigger');
      assert.equal((await trigger.textContent()).trim(), 'Search');
      await trigger.click();
      await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
      await page.locator('dialog.codex-session-search-dialog-backdrop input').fill('release needle');
      await page.locator('[data-result-kind="task"]').waitFor();
    };
    await homeSearch();
    const dialog = page.locator('dialog.codex-session-search-dialog-backdrop');
    await dialog.locator('input').fill('release needle');
    await dialog.locator('[data-result-kind="task"]').waitFor();
    await dialog.locator('[data-result-kind="session"][data-profile="writer"]').waitFor();
    const prefix = `${shots}/${width === 390 ? 'mobile' : 'desktop'}-${theme}`;
    const checkRows = async () => {
      const geometry = await dialog.locator('.codex-session-search-result:visible').evaluateAll(nodes => nodes.map(node => {
        const title = node.querySelector('.session-search-result-heading').getBoundingClientRect();
        const meta = node.querySelector('.codex-session-search-result-meta').getBoundingClientRect();
        const snippet = node.querySelector('.codex-session-search-result-snippet')?.getBoundingClientRect();
        return { titleBottom: title.bottom, metaTop: meta.top, metaBottom: meta.bottom, snippetTop: snippet?.top, overflow: node.scrollWidth - node.clientWidth };
      }));
      for (const row of geometry) {
        assert.ok(row.titleBottom <= row.metaTop + 1, 'title and metadata do not overlap');
        assert.ok(row.snippetTop == null || row.metaBottom <= row.snippetTop + 1, 'metadata and snippet do not overlap');
        assert.ok(row.overflow <= 1, 'result fits horizontally');
      }
      return geometry;
    };
    const rows = await checkRows();
    await page.screenshot({ path: `${prefix}-results.png` });
    await dialog.locator('[data-result-kind="session"][data-profile="writer"]').click();
    const preview = dialog.locator('.session-search-preview');
    await preview.locator('.codex-message.is-assistant').first().waitFor();
    const measure = await preview.evaluate(node => {
      const title = node.querySelector('.session-search-preview-heading > strong').getBoundingClientRect();
      const action = node.querySelector('.session-search-open').getBoundingClientRect();
      const header = node.querySelector('header').getBoundingClientRect();
      const body = node.querySelector('.session-search-transcript').getBoundingClientRect();
      return { title: { top: title.top, bottom: title.bottom, right: title.right }, action: { top: action.top, bottom: action.bottom, left: action.left }, headerHeight: header.height, bodyHeight: body.height, overflow: node.scrollWidth - node.clientWidth };
    });
    assert.ok(measure.title.right <= measure.action.left, 'action does not overlap the title');
    assert.ok(measure.action.top < measure.title.bottom && measure.action.bottom > measure.title.top, 'open action stays in the title row');
    assert.ok(measure.headerHeight < 110, 'compact header leaves room for content');
    assert.ok(measure.bodyHeight > 350, 'substantive preview retains usable height');
    assert.ok(measure.overflow <= 1);
    await page.screenshot({ path: `${prefix}-session.png` });
    await preview.locator('.session-search-open').click();
    await page.waitForURL(/\/chat\?.*profile=writer/);
    assert.equal(new URL(page.url()).searchParams.get('session'), 'codex-preview');
    await homeSearch();
    if (width === 390 && await preview.isVisible()) await preview.locator('.session-search-back').click();
    await dialog.locator('[data-result-kind="task"]').click();
    await preview.getByText('Review the release checklist.', { exact: false }).waitFor();
    await page.screenshot({ path: `${prefix}-task.png` });
    await preview.getByRole('button', { name: 'Open task', exact: true }).click();
    await page.waitForURL(/\/kanban\?task=search-task/);
    await page.locator('#tower-detail-title').filter({ hasText: longTitle }).waitFor();
    assert.equal(await page.locator('#tower-detail-title').textContent(), longTitle);
    await page.reload();
    await page.locator('#tower-detail-title').filter({ hasText: longTitle }).waitFor();
    await page.screenshot({ path: `${prefix}-opened-task.png` });
    await homeSearch();
    await dialog.locator('input').fill('empty-unique-query');
    await dialog.getByText('No matching sessions or tasks', { exact: true }).waitFor();
    await page.screenshot({ path: `${prefix}-empty.png` });
    fail = true;
    await dialog.locator('input').fill('failure needle');
    await dialog.locator('[role="alert"]').waitFor();
    const retryBounds = await dialog.locator('[role="alert"] button').boundingBox();
    const alertBounds = await dialog.locator('[role="alert"]').boundingBox();
    assert.ok(retryBounds.y >= alertBounds.y && retryBounds.y + retryBounds.height <= alertBounds.y + alertBounds.height, 'retry button stays fully visible');
    assert.ok(await dialog.locator('[data-result-kind="session"]').count(), 'task outage preserves sessions');
    await page.screenshot({ path: `${prefix}-error.png` });
    fail = false;
    await dialog.locator('[role="alert"]').getByRole('button', { name: 'Retry', exact: true }).click();
    await dialog.locator('[data-result-kind="task"]').waitFor();
    assert.equal(await dialog.locator('[role="alert"]').count(), 0);
    assert.ok(!requests.some(request => request.url.includes('/fleetd/') && request.method !== 'GET'), 'search and open never mutate tasks');
    assert.deepEqual(errors, []);
    evidence.push({ width, theme, origin: host.origin, rows, ...measure, errors });
    // Also exercise narrow Chinese labels without publishing localized/private screenshots.
    if (width === 390 && theme === 'light') {
      await page.goto(host.origin + '/');
      await page.evaluate(() => { document.documentElement.lang = 'zh-CN'; });
      await page.setViewportSize({ width: 320, height: 740 });
      await page.locator('.profile-new-session').first().focus();
      await page.keyboard.press('w');
      assert.equal((await page.locator('.workbench-actions-dialog .codex-session-search-trigger').textContent()).trim(), '搜索');
      await page.locator('.workbench-actions-dialog .codex-session-search-trigger').click();
      await dialog.locator('input').fill('release needle');
      await dialog.locator('[data-result-kind="task"]').click();
      await preview.getByRole('button', { name: '打开任务', exact: true }).waitFor();
      assert.ok(await preview.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Chinese preview fits 320px');
    }
    await page.close();
  }
  await writeFile(`${shots}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log('PASS unified search: home label, sessions + Fleet, inline action, no overlap, deep link/reload, empty/error/retry; desktop/mobile light/dark');
} finally { await browser.close(); await host.close(); }
