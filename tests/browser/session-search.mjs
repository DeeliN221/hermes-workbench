/** Localhost acceptance with public synthetic content; no production data. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
const shots = process.env.SHOT_DIR;
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const errors = [];
try {
  if (shots) await mkdir(shots, { recursive: true });
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme: theme });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(theme => { localStorage.setItem('hermes-locale', 'en'); }, theme);
    await page.route('**/api/plugins/workbench/codex/sessions?*', async route => {
      const profile = new URL(route.request().url()).searchParams.get('profile');
      await route.fulfill({ json: { items: [
        { id: 'codex-preview', threadId: 'codex-preview', title: `Local preview validation · ${profile}`, status: 'idle', createdAt: 1793538000 },
        { id: 'codex-regression', threadId: 'codex-regression', title: 'Home rendering regression', groupId: 'preview-project-1', status: 'idle', createdAt: 1793537000 },
      ] } });
    });
    await page.route('**/api/plugins/workbench/codex/groups?*', async route => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.fulfill({ json: { items: [{ id: 'preview-project-1', name: 'Preview Project 1' }] } });
    });
    await page.route(/\/api\/plugins\/workbench\/codex\/session(?:\/preview)?\?/, async route => {
      const data = {};
      const profile = new URL(route.request().url()).searchParams.get('profile');
      data.turns = [{ id: 'turn-search', status: 'completed', durationMs: 4000, startedAt: 1793538000, items: [
        { id: 'question', type: 'userMessage', content: [{ type: 'text', text: 'How should we validate the release workflow?' }] },
        { id: 'thinking', type: 'reasoning', summary: [{ text: 'Check the existing tests before proposing a release.' }] },
        { id: 'tool', type: 'commandExecution', command: 'npm test', aggregatedOutput: 'All checks passed.', status: 'completed' },
        { id: 'answer', type: 'agentMessage', text: `## Release validation\n\n~~~js\nconst preview = true;\n~~~\n\nProfile: **${profile}**\n\n1. Run the regression suite.\n2. Preview the conversation before opening it.\n3. Confirm its project is expanded.`, phase: 'final' },
      ] }];
      await route.fulfill({ json: data });
    });
    await page.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
    await page.locator('.codex-pane-slot').first().waitFor();
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    if (!mobile) { await page.locator('.codex-center-title:visible').first().click(); await page.keyboard.press('w'); }
    // Compact rail still exposes search directly.
    await page.locator('.codex-session-search-trigger:visible').first().click();
    const dialog = page.locator('dialog.codex-session-search-dialog-backdrop');
    await dialog.locator('input').fill('needle');
    const result = dialog.locator('[data-result-id="codex-regression"][data-profile="writer"]');
    await result.waitFor();
    assert.equal(await dialog.locator('[data-result-id="codex-regression"]').count(), 2, 'same ID in two profiles remains distinct');
    const originalUrl = page.url();
    const previewRequests = [];
    const recordRequest = request => previewRequests.push({ url: request.url(), method: request.method() });
    page.on('request', recordRequest);
    if (shots) await page.screenshot({ path: `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}-results.png` });
    await result.click();
    const preview = dialog.locator('.session-search-preview');
    await preview.getByRole('heading', { name: 'Release validation' }).waitFor();
    assert.equal(page.url(), originalUrl, 'preview does not navigate');
    assert.match(await preview.textContent(), /Profile: writer/);
    assert.equal(await preview.locator('.codex-message.is-user').count(), 1);
    assert.equal(await preview.locator('.codex-message.is-assistant .hti-rich-markdown').count(), 1);
    assert.equal(await preview.locator('.codex-tool-group').count(), 1);
    assert.equal(await preview.locator('details[open]').count(), 0, 'process details start collapsed');
    await preview.locator('summary').first().click();
    assert.equal(await preview.locator('details[open]').count(), 1);
    await preview.locator('.codex-tool-list > summary').click();
    await preview.locator('.codex-command-output > summary').click();
    await preview.getByText('All checks passed.', { exact: true }).waitFor();
    await preview.locator('.codex-tool-list > summary').click();
    await preview.locator('summary').first().click();
    assert.ok(await preview.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'preview fits viewport');
    assert.ok(await preview.locator('.hti-rich-code').count(), 'shared code enhancement renders');
    if (shots) await page.screenshot({ path: `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}-preview.png` });
    if (mobile) {
      await preview.locator('.session-search-back').click();
      assert.equal(await dialog.locator('input').inputValue(), 'needle');
      await result.click();
      await preview.getByRole('heading', { name: 'Release validation' }).waitFor();
    }
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.ok(await page.title());
    page.off('request', recordRequest);
    assert.ok(!previewRequests.some(request => request.url.includes('profile=writer') && request.method !== 'GET'), 'preview never writes to selected profile');
    assert.ok(!previewRequests.some(request => /\/codex\/session\?/.test(request.url) && request.url.includes('profile=writer')), 'preview never reads upstream history');
    await preview.locator('.session-search-open').click();
    await page.waitForURL(/profile=writer/);
    await page.waitForFunction(() => new URL(location.href).searchParams.get('session') === 'codex-regression');
    // Mobile uses a compact folder rail; expanding navigation must reveal the active project.
    if (mobile) {
      const toggle = page.locator('.dashboard-mobile-toggle');
      if (await toggle.count()) await toggle.first().click();
    }
    await page.locator('.codex-session-row.is-active').filter({ hasText: 'Home rendering regression' }).first().waitFor({ state: 'attached' });
    const folder = page.locator('details.project-folder').filter({ hasText: 'Preview Project 1' });
    await folder.first().waitFor({ state: 'visible' });
    assert.equal(await folder.first().getAttribute('open'), '');
    if (shots) await page.screenshot({ path: `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}-opened.png` });
    if (!await page.locator('.codex-session-search-trigger:visible').count()) {
      if (mobile) await page.locator('.dashboard-mobile-toggle').first().click();
      else { await page.locator('.codex-center-title:visible').first().click(); await page.keyboard.press('w'); }
    }
    await page.locator('.codex-session-search-trigger:visible').first().click();
    assert.equal(await dialog.locator('input').inputValue(), 'needle', 'search survives cross-profile open');
    await preview.getByRole('heading', { name: 'Release validation' }).waitFor();
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('details.project-folder[open]').first().waitFor({ state: 'attached' });
    assert.equal(new URL(page.url()).searchParams.get('profile'), 'writer');
    assert.deepEqual(await page.evaluate(() => window.__smokeErrors), []);
    await page.unrouteAll({ behavior: 'wait' });
    await page.close();
  }
  // A slow earlier selection must not overwrite a later profile's preview.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(host.origin + '/chat?session=codex-preview&profile=default');
  await page.locator('.codex-center-title:visible').first().click();
  await page.keyboard.press('w');
  await page.locator('.codex-session-search-trigger:visible').click();
  const dialog = page.locator('dialog.codex-session-search-dialog-backdrop');
  await dialog.locator('input').fill('needle');
  await dialog.locator('[data-profile="writer"][data-result-id="codex-regression"]').waitFor();
  let releaseSlow;
  let slowStarted;
  const started = new Promise(resolve => { slowStarted = resolve; });
  let fail = false;
  let slowOnce = true;
  await page.route('**/api/plugins/workbench/codex/session/preview?*', async route => {
    const profile = new URL(route.request().url()).searchParams.get('profile');
    if (profile === 'default' && !fail && slowOnce) {
      slowOnce = false;
      await new Promise(resolve => { releaseSlow = resolve; slowStarted(); });
    }
    if (fail) await route.fulfill({ status: 503, json: { detail: 'Synthetic preview failure' } });
    else await route.fulfill({ json: { turns: [{ id: 'race', items: [{ id: 'body', type: 'agentMessage', text: `${profile} preview answer` }] }] } });
  });
  const originalUrl = page.url();
  await dialog.locator('input').press('Enter');
  await started;
  assert.equal(page.url(), originalUrl, 'Enter only previews');
  await dialog.locator('[data-profile="writer"][data-result-id="codex-regression"]').click();
  await dialog.locator('.session-search-preview').getByText('writer preview answer', { exact: true }).waitFor();
  releaseSlow();
  await page.waitForTimeout(150);
  assert.equal(await dialog.getByText('default preview answer', { exact: true }).count(), 0);
  fail = true;
  await dialog.locator('[data-profile="default"][data-result-id="codex-regression"]').click();
  await dialog.locator('[role="alert"]').waitFor();
  fail = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await dialog.getByText('default preview answer', { exact: true }).waitFor();
  await dialog.locator('[data-profile="writer"][data-result-kind="hermes"]').click();
  await dialog.getByText('Please verify the Hermes session in the local preview.', { exact: true }).waitFor();
  assert.equal(page.url(), originalUrl);
  assert.equal(await dialog.locator('.hti-user-bubble').count(), 1, 'Hermes uses its main timeline');
  if (shots) await page.screenshot({ path: `${shots}/desktop-hermes-preview.png` });
  // Cached archives and empty snapshots stay in the preview without restoring.
  await page.route('**/api/plugins/workbench/codex/search?*', route => route.fulfill({ json: { results: [
    { session_id: 'archive-preview', title: 'Archived local conversation', deleted: true },
  ] } }));
  await dialog.locator('input').fill('archive');
  await page.route('**/api/plugins/workbench/codex/session/preview?*', route => route.fulfill({ json: { cached: true, turns: [] } }));
  await dialog.locator('[data-result-kind="archived"][data-profile="writer"]').click();
  await dialog.getByText('No messages yet', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Restore and open session' }).waitFor();
  assert.equal(page.url(), originalUrl);
  await page.route('**/api/plugins/workbench/codex/session/preview?*', route => route.fulfill({ json: { cached: true, turns: [{
    id: 'cached-running', status: 'inProgress', startedAt: 1793538000, items: [
      { id: 'image-question', type: 'userMessage', content: 'Review this diagram', attachments: [{ id: 'image', name: 'diagram.svg', src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="40"%3E%3Crect width="80" height="40" fill="green"/%3E%3C/svg%3E' }] },
      { id: 'reasoning', type: 'reasoning', summary: [{ text: 'Cached running process' }] },
      { id: 'body', type: 'agentMessage', status: 'completed', text: '### Cached diagram\n\n~~~mermaid\ngraph LR\nA-->B\n~~~\n\n~~~text\n' + 'long-output-'.repeat(60) + '\n~~~', phase: 'final' },
    ],
  }] } }));
  await dialog.locator('[data-result-kind="archived"][data-profile="default"]').click();
  const archivePreview = dialog.locator('.session-search-preview');
  await archivePreview.locator('.codex-message-attachment').waitFor();
  await archivePreview.locator('.hti-rich-mermaid svg').first().waitFor();
  assert.equal(await archivePreview.locator('details[open]').count(), 0, 'even running processes start collapsed');
  for (const width of [760, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await archivePreview.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'resized preview stays bounded');
    assert.ok(await archivePreview.locator('.session-search-transcript').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'long code scrolls inside the message');
  }
  assert.equal(page.url(), originalUrl);

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.unrouteAll({ behavior: 'wait' });
  await page.close();
  assert.deepEqual(errors, []);
  console.log('PASS: cross-profile results → preview → collapsed details → explicit open → active project; desktop/mobile light/dark and reload');
} finally { await browser.close(); await host.close(); }
