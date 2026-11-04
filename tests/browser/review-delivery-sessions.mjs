/** Localhost-only validation for review material and execution-session entry points. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const shotDir = process.env.WORKBENCH_SCREENSHOT_DIR || process.env.SHOT_DIR || '/tmp/review-delivery-screenshots';
await mkdir(shotDir, { recursive: true });
const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: host.origin });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

const now = new Date().toISOString();
const tasks = [
  {
    id: 'review-local', title: 'Review the merged export flow', status: 'review', revision: 1,
    risk: 'R2', priority: 'P1', verify_mode: 'human', created_at: now, review_actions: true,
    machine: 'studio', conversation_id: 'codex-preview', conversation_profile: 'default',
    conversation_kind: 'codex', conversation_local: true,
    acceptance: [{ label: 'Keyboard and contrast checks pass', checked: true }],
    spec_json: { summary: 'A final pull request and commit are ready for human review.' }, attempts: [],
  },
  {
    id: 'review-remote', title: 'Review the NAS deployment', status: 'review', revision: 1,
    risk: 'R2', priority: 'P1', verify_mode: 'human', created_at: now, review_actions: true,
    machine: 'nas', conversation_id: 'codex-preview', conversation_profile: 'writer',
    conversation_kind: 'codex', conversation_local: false, conversation_machine: 'nas',
    conversation_workbench_url: host.origin + '/',
    deliverables: [{ kind: 'demo', label: 'Merged deployment demo', url: host.origin + '/demo/result' }],
    acceptance: [{ label: 'Remote smoke test passes', checked: true }],
    spec_json: { summary: 'The worker ran on another device; open its Workbench session to continue.' }, attempts: [],
  },
  {
    id: 'review-stage', title: 'Review progress on the mobile drawer', status: 'review', revision: 1,
    risk: 'R2', priority: 'P2', verify_mode: 'human', created_at: now, review_actions: true,
    machine: 'studio', conversation_id: 'codex-preview', conversation_profile: 'default',
    conversation_kind: 'codex', conversation_local: true,
    stage_report: {
      status: 'UI implementation complete',
      blocker: 'Review token still missing',
      next: 'Verify light and dark screenshots',
      conclusions: [
        'The drawer prioritizes review material.',
        'Mermaid progress is rendered locally.',
        'Remote session links stay on the Workbench origin.',
        'Release waits for the final review.',
      ],
      diagram: 'flowchart TB\n  P["Progress · UI complete"] --> B["Blocker · Review token"]\n  B --> N["Next · Verify screenshots"]',
    },
    acceptance: [{ label: 'Progress and blocker are visible', checked: true }],
    spec_json: { summary: 'No final artifact yet; the stage report explains progress.' }, attempts: [],
  },
  {
    id: 'review-empty', title: 'Review a task without delivery details', status: 'review', revision: 1,
    risk: 'R2', priority: 'P2', verify_mode: 'human', created_at: now, review_actions: true,
    machine: 'studio', conversation_id: 'codex-preview', conversation_profile: 'default',
    conversation_kind: 'codex', conversation_local: true,
    acceptance: [{ label: 'Delivery details requested from the worker', checked: false }],
    spec_json: { summary: 'This task intentionally has no delivery or stage-report data.' }, attempts: [],
  },
];
const byId = new Map(tasks.map(task => [task.id, task]));
const details = {
  'review-local': {
    links: [
      { label: 'Pull request #128', url: 'https://github.com/example/workbench/pull/128' },
      { label: 'Commit 4f2c1a9', url: 'https://github.com/example/workbench/commit/4f2c1a9' },
    ],
    artifacts: [],
  },
  'review-remote': { links: [], artifacts: [] },
  'review-stage': { links: [], artifacts: [] },
  'review-empty': { links: [], artifacts: [] },
};

await page.route('**/api/plugins/workbench/fleetd/**', async route => {
  const url = new URL(route.request().url());
  const suffix = url.pathname.split('/fleetd')[1] || '/';
  const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (suffix === '/config') return json({ mode: 'live', extended_workflow: false });
  if (suffix === '/tasks/sync') return json({ tasks, removed: [], cursors: {}, full: true });
  if (suffix === '/tasks') return json({ tasks, possibly_truncated: false });
  if (suffix === '/decisions') return json({ decisions: [] });
  if (suffix === '/workers') return json({ workers: [] });
  const match = /^\/tasks\/([^/]+)$/.exec(suffix);
  if (match && byId.has(match[1])) {
    const task = byId.get(match[1]);
    return json({ task, artifacts: details[task.id].artifacts, links: details[task.id].links, review_notes: [], attempts: [] });
  }
  return route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not found"}' });
});

const openTask = async id => {
  await page.locator(`[data-task-id="${id}"] .tower-card-title:visible`).first().click();
  await page.locator('.tower-drawer').waitFor();
  await page.locator('.tower-delivery').waitFor();
};
const closeTask = async () => { await page.keyboard.press('Escape'); await page.locator('.tower-drawer').waitFor({ state: 'detached' }); };
const gotoBoard = async () => { await page.goto(host.origin + '/kanban'); await page.locator('.tower-card:visible').first().waitFor(); };

try {
  await gotoBoard();

  // 1. Final deliverables win the top slot; review actions remain available.
  await openTask('review-local');
  const delivery = page.locator('.tower-delivery');
  assert.equal((await delivery.locator('h3').textContent()).trim(), 'Final deliverable');
  assert.equal(await delivery.locator('.tower-delivery-row').count(), 2);
  assert.equal(await delivery.locator('a.tower-delivery-row').first().getAttribute('href'), 'https://github.com/example/workbench/pull/128');
  assert.ok((await delivery.boundingBox()).y < (await page.locator('.tower-next').boundingBox()).y, 'Deliverable is above the summary');
  assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Request changes', exact: true }).count(), 1);
  const localSession = page.locator('.tower-session-entry[data-session="conversation"]');
  assert.match(await localSession.textContent(), /Device · studio/);
  await Promise.all([
    page.waitForURL(url => url.pathname === '/chat' && url.searchParams.get('session') === 'codex-preview' && url.searchParams.get('profile') === 'default'),
    localSession.getByRole('button', { name: 'Continue execution session →', exact: true }).click(),
  ]);
  await page.locator('.codex-pane-slot').waitFor();
  await page.locator('textarea:visible').first().waitFor();

  // 2. A remote session exposes an absolute Workbench link that opens and continues.
  await gotoBoard();
  await openTask('review-remote');
  assert.equal((await page.locator('.tower-delivery h3').textContent()).trim(), 'Final deliverable');
  assert.equal((await page.locator('.tower-delivery-kind').textContent()).trim(), 'DEMO');
  const remote = page.locator('.tower-session-entry[data-session="conversation"]');
  assert.match(await remote.textContent(), /Device · nas/);
  const remoteLink = remote.getByRole('link', { name: 'Open remote Workbench →', exact: true });
  const remoteUrl = await remoteLink.getAttribute('href');
  assert.equal(remoteUrl, host.origin + '/chat?session=codex-preview&profile=writer');
  await remote.getByRole('button', { name: 'Copy remote session link', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), remoteUrl);
  const [remotePage] = await Promise.all([context.waitForEvent('page'), remoteLink.click()]);
  await remotePage.locator('.codex-pane-slot').waitFor();
  await remotePage.locator('textarea:visible').first().waitFor();
  assert.equal(new URL(remotePage.url()).searchParams.get('profile'), 'writer');
  await remotePage.close();

  // 3. No final deliverable falls back to a rendered Mermaid stage report (max five points).
  await gotoBoard();
  await openTask('review-stage');
  const report = page.locator('.tower-stage-report');
  assert.equal((await report.locator('h3').textContent()).trim(), 'Stage report');
  await report.locator('.hti-mermaid svg').waitFor();
  assert.ok(await report.locator('.hti-mermaid svg').first().isVisible());
  assert.ok(await report.locator('.tower-stage-points li').count() <= 5);
  assert.ok(await report.locator('.tower-stage-points li').count() >= 3);

  // 4. No material is explicit, never looks confirmable, and keeps review actions.
  await gotoBoard();
  await openTask('review-empty');
  const empty = page.locator('.tower-review-empty');
  assert.equal((await empty.textContent()).includes('No final deliverable or stage report'), true);
  assert.equal(await empty.getAttribute('data-review-material'), 'empty');
  assert.equal((await page.locator('.tower-next').textContent()).includes('No final deliverable or stage report. Check the execution session'), true);
  assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Request changes', exact: true }).count(), 1);
  assert.equal(await page.getByText('Available after the run finishes', { exact: true }).count(), 0);

  // Evidence: four states at desktop/mobile and light/dark.
  const states = [
    ['final-local', 'review-local'],
    ['final-remote', 'review-remote'],
    ['stage-report', 'review-stage'],
    ['no-material', 'review-empty'],
  ];
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      for (const [state, id] of states) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
        await gotoBoard();
        await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; }, theme);
        await openTask(id);
        if (state === 'stage-report') await page.locator('.tower-stage-report .hti-mermaid svg').waitFor();
        await page.addStyleTag({ content: '#preview-banner { display: none !important; }' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal overflow');
        await page.screenshot({ path: path.join(shotDir, `${state}-${width === 390 ? 'mobile' : 'desktop'}-${theme}.png`) });
        await closeTask();
      }
    }
  }

  assert.deepEqual(errors, []);
  console.log(`PASS: local/remote sessions and deliverable/stage-report/empty states; evidence ${shotDir}`);
} finally {
  await browser.close();
  await host.close();
}
