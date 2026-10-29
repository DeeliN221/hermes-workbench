/**
 * Load the built Workbench bundle in a real browser with the local fixture host.
 * This catches render-time failures that pure-function tests cannot observe.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  for (const [route, selector] of [
    ['/sessions?profile=default', '.workbench-recent-home'],
    ['/chat?session=codex-preview&profile=default', '.codex-pane-slot'],
    ['/chat?session=codex-preview&profile=writer', '.codex-pane-slot'],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.goto(host.origin + route, { waitUntil: 'domcontentloaded' });
    await page.locator(selector).first().waitFor({ state: 'attached', timeout: 5000 });
    await page.waitForTimeout(300);
    const fixtureErrors = await page.evaluate(() => window.__smokeErrors);
    assert.deepEqual(errors, [], `Browser errors on ${route}:\n${errors.join('\n')}`);
    assert.deepEqual(fixtureErrors, [], `Fixture errors on ${route}:\n${fixtureErrors.join('\n')}`);
    await page.close();
  }

  const diagramPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const diagramErrors = [];
  diagramPage.on('pageerror', error => diagramErrors.push(error.stack || error.message));
  await diagramPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  const diagram = diagramPage.locator('.hti-rich-mermaid-svg svg').first();
  await diagram.waitFor({ state: 'visible', timeout: 8000 });
  const diagramInfo = await diagram.evaluate(node => ({
    className: node.getAttribute('class') || '',
    text: node.textContent || '',
    width: node.getBoundingClientRect().width,
  }));
  assert.match(diagramInfo.className, /pele/);
  assert.match(diagramInfo.text, /Chat/);
  assert.match(diagramInfo.text, /Pele/);
  assert.ok(diagramInfo.width > 0, 'Pele must render a visible SVG');
  assert.equal(await diagramPage.locator('.hti-rich-mermaid-error').count(), 0, 'Pele must render without an error note');
  assert.deepEqual(diagramErrors, [], `Browser errors while rendering Mermaid with Pele:\n${diagramErrors.join('\n')}`);
  await diagramPage.close();

  const profilePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const profileErrors = [];
  profilePage.on('pageerror', error => profileErrors.push(error.stack || error.message));
  await profilePage.goto(host.origin + '/sessions?profile=default', { waitUntil: 'domcontentloaded' });
  await profilePage.locator('.workbench-recent-home').waitFor({ state: 'attached', timeout: 5000 });
  const profileTrigger = profilePage.locator('.dashboard-nav-profile > button');
  await profileTrigger.click();
  const profileMenu = profilePage.locator('#workbench-profile-menu');
  await profileMenu.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await profilePage.locator('dialog.workbench-profile-dialog').count(), 0, 'Profile choices must expand in place');
  const [triggerBox, menuBox] = await Promise.all([profileTrigger.boundingBox(), profileMenu.boundingBox()]);
  assert.ok(triggerBox && menuBox && menuBox.y >= triggerBox.y + triggerBox.height, 'Profile menu must sit below its trigger');
  await profileMenu.locator('[role="menuitemradio"]', { hasText: 'writer' }).click();
  await profilePage.waitForFunction(() => new URLSearchParams(location.search).get('profile') === 'writer', null, { timeout: 5000 });
  assert.equal(await profileMenu.count(), 0, 'Choosing a profile must close the expanded menu');
  assert.deepEqual(profileErrors, [], `Browser errors in the profile switcher:\n${profileErrors.join('\n')}`);
  await profilePage.close();

  const searchPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const searchErrors = [];
  searchPage.on('pageerror', error => searchErrors.push(error.stack || error.message));
  await searchPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await searchPage.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 5000 });
  await searchPage.waitForTimeout(300);
  // The sidebar may be collapsed in the chat pane; the trigger still owns the dialog.
  await searchPage.evaluate(() => document.querySelector('.codex-session-search-trigger')?.click());
  await searchPage.locator('.codex-session-search-input').fill('servercontent');
  await searchPage.waitForFunction(
    () => document.querySelectorAll('.codex-session-search-result-snippet').length >= 2,
    null,
    { timeout: 5000 },
  );
  const searchRows = await searchPage.evaluate(() => [...document.querySelectorAll('.codex-session-search-result')].map(row => ({
    id: row.getAttribute('data-result-id'),
    kind: row.getAttribute('data-result-kind'),
    text: row.textContent || '',
    snippet: row.querySelector('.codex-session-search-result-snippet')?.textContent || '',
  })));
  assert.ok(searchRows.some(row => row.id === 'codex-regression' && row.kind === 'session'), 'Codex content hits must appear');
  assert.ok(searchRows.some(row => row.id === 'hermes-preview' && row.kind === 'hermes'), 'Hermes content hits must appear');
  assert.ok(searchRows.every(row => row.snippet.includes('Server-side content needle')), 'Content hits must show their snippet');
  assert.deepEqual(searchErrors, [], `Browser errors in session search:\n${searchErrors.join('\n')}`);
  await searchPage.close();

  const filesPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const fileErrors = [];
  filesPage.on('pageerror', error => fileErrors.push(error.stack || error.message));
  await filesPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await filesPage.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 5000 });
  await filesPage.evaluate(() => document.querySelector('.dashboard-workspace-button')?.click());
  await filesPage.waitForFunction(() => document.querySelectorAll('.hti-tree-row').length > 0, null, { timeout: 5000 });
  await filesPage.evaluate(() => {
    [...document.querySelectorAll('.hti-tree-row')]
      .find(row => row.textContent?.includes('README.md'))?.click();
  });
  await filesPage.locator('.hti-codex-file-modal-actions').waitFor({ state: 'visible', timeout: 5000 });
  const fileActions = await filesPage.evaluate(() =>
    [...document.querySelectorAll('.hti-codex-file-modal-actions button, .hti-codex-file-modal-actions a')]
      .map(action => ({
        text: action.textContent?.trim() || '',
        label: action.getAttribute('aria-label') || '',
        title: action.getAttribute('title') || '',
        hasIcon: Boolean(action.querySelector('svg')),
      })));
  assert.equal(fileActions.length, 5, 'File renderer should expose five action controls');
  for (const action of fileActions) {
    assert.equal(action.text, '', 'File renderer actions must not show text labels');
    assert.ok(action.label, 'Every file action needs an accessible label');
    assert.ok(action.title, 'Every file action needs a tooltip');
    assert.equal(action.hasIcon, true, 'Every file action must render an icon');
  }
  assert.deepEqual(fileErrors, [], `Browser errors in the file renderer:\n${fileErrors.join('\n')}`);
  await filesPage.close();

  const panePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const paneErrors = [];
  panePage.on('pageerror', error => paneErrors.push(error.stack || error.message));
  await panePage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await panePage.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 5000 });
  await panePage.waitForFunction(() => document.querySelectorAll('.project-folder-row').length === 6);
  assert.equal(await panePage.locator('.codex-session-id').count(), 0, 'The session id must not occupy a second header line');
  assert.equal(await panePage.locator('.codex-pane-profile').count(), 0, 'Session id must not show a profile chip');
  const projectList = await panePage.locator('.project-list').evaluate(node => ({
    count: node.querySelectorAll('.project-folder-row').length,
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    overflowY: getComputedStyle(node).overflowY,
  }));
  assert.equal(projectList.count, 6, 'The preview must exercise more than five projects');
  assert.equal(projectList.overflowY, 'auto');
  assert.equal(projectList.clientHeight, 200, 'The project list must show five 40px project rows');
  assert.ok(projectList.scrollHeight > projectList.clientHeight, 'The project list must scroll when it exceeds five rows');
  assert.ok(projectList.scrollWidth <= projectList.clientWidth, 'The project list must not scroll horizontally');
  const headerLayout = await panePage.evaluate(() => {
    const picker = document.querySelector('.codex-pane-color-picker')?.getBoundingClientRect();
    const title = document.querySelector('.codex-center-title')?.getBoundingClientRect();
    const header = document.querySelector('.codex-center-header')?.getBoundingClientRect();
    if (!picker || !title || !header) throw new Error('Missing center header controls');
    return { pickerLeft: picker.left, titleLeft: title.left, pickerTop: picker.top, titleTop: title.top, height: header.height };
  });
  assert.ok(headerLayout.pickerLeft < headerLayout.titleLeft, 'The color picker must sit left of the title');
  assert.ok(Math.abs(headerLayout.pickerTop - headerLayout.titleTop) < 16, 'The title and color picker must share one row');
  await panePage.evaluate(() => {
    window.__copiedSessionId = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async value => { window.__copiedSessionId = value; } },
    });
  });
  const temporaryRow = panePage.locator('.project-temporary .codex-session-row-wrap').first();
  await temporaryRow.hover();
  await temporaryRow.locator('.codex-session-row-menu-toggle').click();
  const sessionMenu = panePage.locator('.codex-session-row-menu');
  await sessionMenu.waitFor({ state: 'visible', timeout: 5000 });
  await sessionMenu.getByRole('menuitem', { name: 'Copy session ID' }).click();
  assert.equal(await panePage.evaluate(() => window.__copiedSessionId), 'codex-preview');
  await panePage.locator('.project-temporary .codex-session-row').nth(1).click();
  await panePage.waitForFunction(() => document.querySelectorAll('.codex-pane-slot').length === 2);
  const paneProfiles = await panePage.locator('.codex-pane-slot [data-profile]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-profile')));
  assert.deepEqual(paneProfiles, ['default', 'default'], 'Panes must stay within one profile');
  await panePage.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('profile', 'writer');
    history.pushState(null, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await panePage.waitForFunction(() => document.querySelectorAll('.codex-pane-slot').length === 1
    && document.querySelector('.codex-pane-slot [data-profile]')?.getAttribute('data-profile') === 'writer');
  assert.equal(await panePage.locator('.codex-pane-profile').count(), 0, 'Session id must not show a profile chip after switching profiles');
  assert.deepEqual(paneErrors, [], `Browser errors in the pane check:\n${paneErrors.join('\n')}`);
  await panePage.close();

  const compactProjectsPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const compactProjectErrors = [];
  compactProjectsPage.on('pageerror', error => compactProjectErrors.push(error.stack || error.message));
  await compactProjectsPage.goto(host.origin + '/chat?session=codex-preview&profile=writer', { waitUntil: 'domcontentloaded' });
  await compactProjectsPage.locator('.project-list').waitFor({ state: 'attached', timeout: 5000 });
  await compactProjectsPage.waitForFunction(() => document.querySelectorAll('.project-folder-row').length === 2);
  const compactProjectList = await compactProjectsPage.locator('.project-list').evaluate(node => ({
    count: node.querySelectorAll('.project-folder-row').length,
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  assert.equal(compactProjectList.count, 2);
  assert.equal(compactProjectList.scrollHeight, compactProjectList.clientHeight, 'A short project list must not scroll');
  assert.deepEqual(compactProjectErrors, [], `Browser errors in the short project list:\n${compactProjectErrors.join('\n')}`);
  await compactProjectsPage.close();

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const mobileErrors = [];
  mobilePage.on('pageerror', error => mobileErrors.push(error.stack || error.message));
  await mobilePage.goto(host.origin + '/sessions?profile=default', { waitUntil: 'domcontentloaded' });
  await mobilePage.locator('.workbench-recent-home').waitFor({ state: 'attached', timeout: 5000 });
  // Mirror the native Kanban overlay's positioning while exercising the real
  // Workbench mobile width override and the real action rail.
  await mobilePage.addStyleTag({ content: `
    .hermes-kanban-drawer-shade { position: fixed; inset: 0; display: flex; justify-content: flex-end; }
    .hermes-kanban-drawer { height: 100dvh; }
    .hermes-kanban-dialog-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; }
    .hermes-kanban-dialog { width: 28rem; max-width: calc(100vw - 2rem); padding: 1.1rem 1.2rem; border: 1px solid; }
  ` });
  const mobileLayout = await mobilePage.evaluate(() => {
    const shade = document.createElement('div');
    shade.className = 'hermes-kanban-drawer-shade';
    shade.innerHTML = '<div class="hermes-kanban-drawer hti-kanban-v4" role="dialog">'
      + '<div class="hermes-kanban-drawer-head"><span>preview / t1</span></div>'
      + '<div class="hermes-kanban-drawer-body"><div class="hermes-kanban-drawer-title-text">Mobile drawer</div></div></div>';
    document.body.append(shade);
    const drawer = shade.querySelector('.hermes-kanban-drawer');
    const title = shade.querySelector('.hermes-kanban-drawer-title-text');
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'hermes-kanban-dialog-backdrop';
    dialogBackdrop.innerHTML = '<form class="hermes-kanban-dialog"><div class="hermes-kanban-dialog-title">New board</div></form>';
    document.body.append(dialogBackdrop);
    const dialog = dialogBackdrop.querySelector('.hermes-kanban-dialog');
    const rail = document.querySelector('.dashboard-action-rail');
    if (!drawer || !title || !dialog || !rail) throw new Error('Missing mobile overlay fixture');
    return {
      viewport: window.innerWidth,
      rail: rail.getBoundingClientRect().toJSON(),
      drawer: drawer.getBoundingClientRect().toJSON(),
      title: title.getBoundingClientRect().toJSON(),
      dialogBackdrop: dialogBackdrop.getBoundingClientRect().toJSON(),
      dialog: dialog.getBoundingClientRect().toJSON(),
    };
  });
  assert.equal(Math.round(mobileLayout.rail.width), 48, 'The mobile action rail must stay visible');
  assert.equal(Math.round(mobileLayout.drawer.left), 48, 'The task drawer must start after the action rail');
  assert.equal(Math.round(mobileLayout.drawer.width), mobileLayout.viewport - 48, 'The task drawer must use the remaining viewport width');
  assert.ok(mobileLayout.title.left >= 60, 'Task text must clear the rail and its 12px padding');
  assert.equal(Math.round(mobileLayout.dialogBackdrop.left), 48, 'The board dialog layer must start after the action rail');
  assert.ok(mobileLayout.dialog.left >= 48, 'The board dialog must clear the action rail');
  assert.ok(mobileLayout.dialog.right <= mobileLayout.viewport, 'The board dialog must stay inside the viewport');
  const mobileFixtureErrors = await mobilePage.evaluate(() => window.__smokeErrors);
  assert.deepEqual(mobileErrors, [], `Browser errors in the mobile drawer check:\n${mobileErrors.join('\n')}`);
  assert.deepEqual(mobileFixtureErrors, [], `Fixture errors in the mobile drawer check:\n${mobileFixtureErrors.join('\n')}`);
  await mobilePage.close();

  const organizerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const organizerErrors = [];
  organizerPage.on('pageerror', error => organizerErrors.push(error.stack || error.message));
  await organizerPage.route('**/capabilities', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      codexChat: false, codexUserInput: false, codexThreadReasoningConfig: false,
      newChatProviders: [], historyOnlyProviders: [], supportsExternalContinuation: false,
    }),
  }));
  await organizerPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await organizerPage.locator('.hti-root').waitFor({ state: 'attached', timeout: 5000 });
  await organizerPage.locator('.hti-session-organize').first().waitFor({ state: 'attached', timeout: 5000 });
  await organizerPage.evaluate(() => document.querySelector('.hti-session-organize')?.click());
  await organizerPage.locator('.hti-organizer-dialog').waitFor({ state: 'visible', timeout: 5000 });
  const organizerLayout = await organizerPage.evaluate(() => ({
    viewport: window.innerWidth,
    backdrop: document.querySelector('.hti-organizer-backdrop').getBoundingClientRect().toJSON(),
    dialog: document.querySelector('.hti-organizer-dialog').getBoundingClientRect().toJSON(),
  }));
  assert.equal(Math.round(organizerLayout.backdrop.left), 48, 'The organizer layer must start after the action rail');
  assert.ok(organizerLayout.dialog.left >= 48, 'The organizer dialog must clear the action rail');
  assert.ok(organizerLayout.dialog.right <= organizerLayout.viewport, 'The organizer dialog must stay inside the viewport');
  assert.deepEqual(organizerErrors, [], `Browser errors in the organizer check:\n${organizerErrors.join('\n')}`);
  await organizerPage.close();

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(host.origin + '/profiles?profile=default&panel=1', { waitUntil: 'domcontentloaded' });
  await page.locator('.dashboard-owned-page').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.dashboard-settings-nav').waitFor({ state: 'visible', timeout: 5000 });
  const layout = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      if (!rect) throw new Error(`Missing ${selector}`);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      backdrop: box('.dashboard-accessory-backdrop'),
      settings: box('.dashboard-settings-nav'),
      page: box('.dashboard-owned-page'),
      navInert: Boolean(document.querySelector('.dashboard-global-nav')?.inert),
    };
  });
  const viewport = page.viewportSize();
  assert.equal(Math.round(layout.backdrop.left), 0, 'Backdrop must cover the navigation');
  assert.equal(Math.round(layout.backdrop.right), viewport.width, 'Backdrop must cover the viewport');
  assert.equal(Math.round(layout.backdrop.top), 0, 'Backdrop must start at the viewport top');
  assert.equal(Math.round(layout.backdrop.bottom), viewport.height, 'Backdrop must cover the viewport bottom');
  assert.ok(Math.abs((layout.settings.left + layout.page.right) / 2 - viewport.width / 2) <= 1, 'Floating panel must be horizontally centered');
  assert.ok(Math.abs((layout.settings.top + layout.page.bottom) / 2 - viewport.height / 2) <= 1, 'Floating panel must be vertically centered');
  assert.equal(layout.page.left, layout.settings.right, 'Settings navigation must sit against the panel content');
  assert.equal(layout.navInert, true, 'Navigation must be inert behind the floating panel');
  assert.deepEqual(errors, [], `Browser errors on the floating panel:\n${errors.join('\n')}`);
  await page.close();

  const detailPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const detailErrors = [];
  detailPage.on('pageerror', error => detailErrors.push(error.stack || error.message));
  await detailPage.goto(host.origin + '/config?workbench=display&profile=default', { waitUntil: 'domcontentloaded' });
  await detailPage.locator('[data-testid="chat-display-settings"]').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await detailPage.locator('[data-workbench-chat-display-link]').innerText(), 'Chat display');
  const detailOptions = detailPage.locator('[data-testid="chat-display-options"] [data-detail-mode]');
  assert.deepEqual(await detailOptions.evaluateAll(nodes => nodes.map(node => ({
    mode: node.getAttribute('data-detail-mode'),
    title: node.querySelector('strong')?.textContent,
    description: node.querySelector('span')?.textContent,
  }))), [
    { mode: 'compact', title: 'Compact', description: 'Fold completed work and keep only the latest line for quick scanning.' },
    { mode: 'standard', title: 'Standard', description: 'Keep work folded after completion; expanded details show the latest ten lines.' },
    { mode: 'detailed', title: 'Detailed', description: 'Expand process details and tool output with the complete content.' },
  ]);
  assert.equal(await detailPage.locator('[data-detail-mode="standard"]').getAttribute('aria-checked'), 'true');
  await detailPage.locator('[data-detail-mode="compact"]').click();
  assert.match(await detailPage.locator('[role="status"]').innerText(), /Compact saved/);

  await detailPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  const detailGroup = detailPage.locator('.codex-tool-group').first();
  await detailGroup.waitFor({ state: 'attached', timeout: 5000 });
  await detailPage.waitForFunction(() => !document.querySelector('.codex-tool-group')?.hasAttribute('open'));
  await detailPage.locator('[data-testid="codex-tool-preview"]').waitFor({ state: 'visible', timeout: 3000 });
  assert.equal(await detailGroup.getAttribute('open'), null, 'Compact keeps work details folded');
  assert.match(await detailPage.locator('[data-testid="codex-tool-preview"]').innerText(), /preview output line 12/);

  await detailPage.goto(host.origin + '/config?workbench=display&profile=default', { waitUntil: 'domcontentloaded' });
  await detailPage.locator('[data-detail-mode="detailed"]').waitFor({ state: 'visible', timeout: 5000 });
  await detailPage.locator('[data-detail-mode="detailed"]').click();
  await detailPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await detailPage.locator('.codex-tool-group').first().waitFor({ state: 'attached', timeout: 5000 });
  await detailPage.waitForFunction(() => document.querySelector('.codex-tool-group')?.hasAttribute('open'));
  assert.match(await detailPage.locator('.codex-process-text').first().innerText(), /Reasoning check 1/);
  assert.equal(await detailPage.locator('.codex-detail-more').count(), 0, 'Detailed must not truncate process text');

  await detailPage.goto(host.origin + '/config?workbench=display&profile=default', { waitUntil: 'domcontentloaded' });
  await detailPage.locator('[data-detail-mode="standard"]').waitFor({ state: 'visible', timeout: 5000 });
  await detailPage.locator('[data-detail-mode="standard"]').click();
  await detailPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await detailPage.locator('.codex-tool-group').first().waitFor({ state: 'attached', timeout: 5000 });
  await detailPage.waitForFunction(() => !document.querySelector('.codex-tool-group')?.hasAttribute('open'));
  await detailPage.locator('.codex-tool-group').first().locator('summary').first().click();
  await detailPage.locator('.codex-detail-more').waitFor({ state: 'visible', timeout: 3000 });
  const standardText = await detailPage.locator('.codex-process-text').first().innerText();
  assert.match(standardText, /Reasoning check 6/);
  assert.doesNotMatch(standardText, /Reasoning check 5/);
  assert.match(await detailPage.locator('.codex-detail-more').innerText(), /Show 5 more lines/);
  assert.deepEqual(detailErrors, [], `Browser errors in the message detail picker:\n${detailErrors.join('\n')}`);
  await detailPage.close();

  console.log('Workbench browser smoke passed: home, same-profile chat panes, profile switching, icon-only file actions, mobile drawer, board-dialog and organizer rail offsets, the centered floating panel, and the three chat detail levels rendered without page errors.');
} finally {
  await browser.close();
  await host.close();
}
