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

  const quotaPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const quotaErrors = [];
  quotaPage.on('pageerror', error => quotaErrors.push(error.stack || error.message));
  await quotaPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  const quota = quotaPage.locator('.codex-weekly-quota').first();
  await quota.waitFor({ state: 'attached', timeout: 5000 });
  const quotaText = (await quota.textContent() || '').trim();
  assert.equal(quotaText, '0%');
  assert.deepEqual(quotaErrors, [], `Browser errors in the response allowance:\n${quotaErrors.join('\n')}`);
  await quotaPage.close();

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

  // Verify Mermaid lightbox
  const mermaidZoom = diagramPage.locator('.hti-rich-mermaid:not(.hti-rich-plantuml) .hti-rich-diagram-zoom').first();
  await mermaidZoom.waitFor({ state: 'visible', timeout: 5000 });
  await mermaidZoom.click();
  const lightbox = diagramPage.locator('#hti-diagram-lightbox');
  await lightbox.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await lightbox.locator('.hti-diagram-lightbox-title').textContent(), 'Mermaid');
  assert.equal(await lightbox.locator('.hti-diagram-lightbox-scale').textContent(), '100%');
  await lightbox.locator('button[data-action="zoom-in"]').click();
  assert.equal(await lightbox.locator('.hti-diagram-lightbox-scale').textContent(), '125%');
  await diagramPage.keyboard.press('Escape');
  await lightbox.waitFor({ state: 'detached', timeout: 5000 });

  // Verify PlantUML lightbox
  const plantumlSection = diagramPage.locator('.hti-rich-plantuml').first();
  await plantumlSection.waitFor({ state: 'visible', timeout: 15000 });
  const plantumlImg = plantumlSection.locator('.hti-rich-mermaid-svg img').first();
  await plantumlImg.waitFor({ state: 'visible', timeout: 15000 });
  const plantumlZoom = plantumlSection.locator('.hti-rich-diagram-zoom').first();
  await plantumlZoom.waitFor({ state: 'visible', timeout: 5000 });
  await plantumlZoom.click();
  await lightbox.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await lightbox.locator('.hti-diagram-lightbox-title').textContent(), 'PlantUML');
  await lightbox.locator('button[data-action="close"]').click();
  await lightbox.waitFor({ state: 'detached', timeout: 5000 });
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
  assert.equal(await panePage.locator('.codex-session-color-bar').count(), 0,
    'A single pane must not show session accent bars');
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
  assert.ok(headerLayout.height <= 52, `The one-line chat header must stay compact; got ${headerLayout.height}px`);
  await panePage.locator('.codex-pane-color-trigger').click();
  const colorMenu = panePage.locator('.codex-pane-color-menu');
  await colorMenu.waitFor({ state: 'visible', timeout: 5000 });
  const colorGrid = colorMenu.locator('.codex-session-color-grid');
  assert.equal(await colorGrid.locator('.codex-session-color-swatch').count(), 8, 'The color picker must keep eight cells');
  assert.equal(await colorGrid.locator('button.codex-session-color-swatch').count(), 7, 'Seven cells are rainbow presets');
  assert.equal(await colorGrid.locator('input[type="color"]').count(), 1, 'The last cell must open a custom color input');
  assert.equal(await colorMenu.getByText('Restore default').count(), 0, 'The reset action must be removed');
  const colorColumns = await colorGrid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  assert.equal(colorColumns, 4, 'The color picker must keep two rows of four cells');
  await colorGrid.locator('input[type="color"]').fill('#123456');
  await panePage.waitForFunction(() => document.querySelector('.codex-pane-color-dot')?.getAttribute('style')?.includes('18, 52, 86'));
  if (await colorMenu.isVisible()) await panePage.locator('.codex-pane-color-trigger').click();
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
  const splitBars = await panePage.locator('.codex-session-color-bar').evaluateAll(bars => bars.map(bar =>
    bar.closest('.project-session-drag')?.getAttribute('data-session-id') || ''));
  assert.deepEqual([...splitBars].sort(), ['codex-preview', 'codex-regression'],
    'Split view must mark exactly the open session cards');
  const paneProfiles = await panePage.locator('.codex-pane-slot [data-profile]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-profile')));
  assert.deepEqual(paneProfiles, ['default', 'default'], 'Panes must stay within one profile');
  await panePage.locator('.codex-pane-slot').nth(1).locator('.codex-pane-close').click();
  await panePage.waitForFunction(() => document.querySelectorAll('.codex-pane-slot').length === 1
    && document.querySelectorAll('.codex-session-color-bar').length === 0);
  assert.equal(await panePage.locator('.codex-session-color-bar').count(), 0,
    'Closing the split pane must hide session accent bars');
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

  const settingsReturnPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const settingsReturnErrors = [];
  settingsReturnPage.on('pageerror', error => settingsReturnErrors.push(error.stack || error.message));
  await settingsReturnPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await settingsReturnPage.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 5000 });
  await settingsReturnPage.locator('.project-temporary .codex-session-row').nth(1).click();
  await settingsReturnPage.waitForFunction(() => document.querySelectorAll('.codex-pane-slot').length === 2);
  const splitChatUrl = settingsReturnPage.url();
  await settingsReturnPage.evaluate(() => document.querySelector('.dashboard-crafting-grid a[aria-label="Settings"]')?.click());
  await settingsReturnPage.waitForFunction(() => location.pathname === '/config' && new URLSearchParams(location.search).get('panel') === '1');
  await settingsReturnPage.locator('.dashboard-accessory-close').waitFor({ state: 'visible', timeout: 5000 });
  for (const [selector, tab] of [
    ['[data-workbench-chat-display-link]', 'display'],
    ['[data-workbench-model-link]', 'models'],
    ['[data-workbench-version-link]', 'versions'],
  ]) {
    await settingsReturnPage.locator(selector).click();
    await settingsReturnPage.waitForFunction(expected => new URLSearchParams(location.search).get('workbench') === expected, tab);
    assert.equal(new URL(settingsReturnPage.url()).searchParams.get('panel'), '1', `${tab} settings must keep the floating panel marker`);
    assert.equal(await settingsReturnPage.locator('.dashboard-accessory-close').isVisible(), true, `${tab} settings must keep the close control visible`);
  }
  await settingsReturnPage.locator('.dashboard-accessory-close').click();
  await settingsReturnPage.waitForFunction(() => location.pathname === '/chat');
  assert.equal(settingsReturnPage.url(), splitChatUrl, 'Closing settings must restore the original split chat route');
  assert.equal(await settingsReturnPage.locator('.codex-pane-slot').count(), 2, 'Closing settings must preserve both chat panes');
  assert.equal(await settingsReturnPage.evaluate(() => document.querySelector('.dashboard-persistent-workbench')?.getAttribute('data-chat-visible')), 'true');
  assert.deepEqual(settingsReturnErrors, [], `Browser errors returning from floating settings:\n${settingsReturnErrors.join('\n')}`);
  await settingsReturnPage.close();
  const messageNavigatorPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const messageNavigatorErrors = [];
  messageNavigatorPage.on('pageerror', error => messageNavigatorErrors.push(error.stack || error.message));
  await messageNavigatorPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await messageNavigatorPage.locator('.codex-message.is-user').first().waitFor({ state: 'attached', timeout: 5000 });
  await messageNavigatorPage.evaluate(() => {
    const list = document.querySelector('.codex-message-list');
    const template = list?.querySelector('.codex-message.is-user');
    if (!list || !template) throw new Error('Missing user message fixture');
    for (let index = 0; index < 6; index++) {
      const clone = template.cloneNode(true);
      clone.setAttribute('data-message-id', `preview-user-${index}`);
      const body = clone.querySelector('.codex-message-body');
      if (body) body.textContent = `Follow-up user message ${index + 1}: verify the navigator jump target.`;
      list.append(clone);
    }
    const spacer = document.createElement('div');
    spacer.style.height = '1200px';
    list.append(spacer);
  });
  await messageNavigatorPage.waitForFunction(() => document.querySelectorAll('.codex-message.is-user[data-message-id]').length === 7);
  const messageBall = messageNavigatorPage.locator('[data-workbench-user-message-ball]');
  await messageBall.waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await messageBall.getAttribute('aria-label'), /7/);
  await messageBall.click();
  const messagePanel = messageNavigatorPage.locator('[data-workbench-user-message-panel]');
  await messagePanel.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await messagePanel.locator('[data-user-message-item]').count(), 7, 'The navigator must list every user message');
  const beforeJump = await messageNavigatorPage.locator('.codex-message-list').evaluate(node => node.scrollTop);
  await messagePanel.locator('[data-user-message-item]').nth(4).click();
  const jumped = await messageNavigatorPage.evaluate(() => ({
    target: document.querySelector('[data-message-id="preview-user-3"]')?.classList.contains('is-user-message-jump-target'),
    panelVisible: !document.querySelector('[data-workbench-user-message-panel]')?.hasAttribute('hidden'),
  }));
  assert.equal(jumped.target, true, 'Choosing a user message must mark its jump target');
  assert.equal(jumped.panelVisible, false, 'Choosing a user message must close the navigator panel');
  await messageNavigatorPage.waitForFunction(() => document.querySelector('.codex-message-list')?.scrollTop > 0);
  const afterJump = await messageNavigatorPage.locator('.codex-message-list').evaluate(node => node.scrollTop);
  assert.ok(afterJump > beforeJump, 'Choosing a user message must scroll the conversation');

  await messageNavigatorPage.goto(host.origin + '/config?workbench=display&profile=default', { waitUntil: 'domcontentloaded' });
  await messageNavigatorPage.locator('[data-testid="chat-display-settings"]').waitFor({ state: 'visible', timeout: 5000 });
  const navigatorToggle = messageNavigatorPage.locator('[data-testid="user-message-ball-toggle"]');
  assert.equal(await navigatorToggle.getAttribute('aria-checked'), 'true');
  await navigatorToggle.click();
  assert.equal(await navigatorToggle.getAttribute('aria-checked'), 'false');
  assert.equal(await messageNavigatorPage.evaluate(() => localStorage.getItem('workbench.user-message-ball.v1')), 'false');
  await messageNavigatorPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await messageNavigatorPage.locator('.codex-message.is-user').first().waitFor({ state: 'attached', timeout: 5000 });
  assert.equal(await messageNavigatorPage.locator('[data-workbench-user-message-ball]').isVisible(), false, 'The setting must hide the navigator');
  await messageNavigatorPage.goto(host.origin + '/config?workbench=display&profile=default', { waitUntil: 'domcontentloaded' });
  await messageNavigatorPage.locator('[data-testid="chat-display-settings"]').waitFor({ state: 'visible', timeout: 5000 });
  await messageNavigatorPage.locator('[data-testid="user-message-ball-toggle"]').click();
  await messageNavigatorPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await messageNavigatorPage.locator('.codex-message.is-user').first().waitFor({ state: 'attached', timeout: 5000 });
  await messageNavigatorPage.locator('[data-workbench-user-message-ball]').waitFor({ state: 'visible', timeout: 5000 });

  await messageNavigatorPage.setViewportSize({ width: 390, height: 844 });
  await messageNavigatorPage.reload({ waitUntil: 'domcontentloaded' });
  await messageNavigatorPage.locator('.codex-message.is-user').first().waitFor({ state: 'attached', timeout: 5000 });
  const mobileHeaderHeight = await messageNavigatorPage.locator('.codex-center-header').evaluate(node => node.getBoundingClientRect().height);
  assert.ok(mobileHeaderHeight <= 56, `The mobile chat header must stay compact; got ${mobileHeaderHeight}px`);
  await messageNavigatorPage.locator('[data-workbench-user-message-ball]').waitFor({ state: 'visible', timeout: 5000 });
  assert.deepEqual(messageNavigatorErrors, [], `Browser errors in the user message navigator:\n${messageNavigatorErrors.join('\n')}`);
  await messageNavigatorPage.close();
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
  // Switching between custom settings tabs must keep the host ConfigPage hidden and preserve floating panel state.
  await detailPage.locator('[data-workbench-model-link]').click();
  await detailPage.locator('[data-testid="model-visibility-settings"] .workbench-model-group').first().waitFor({ state: 'visible', timeout: 5000 });
  const desktopLayerCheck = await detailPage.evaluate(() => {
    const hostForm = document.querySelector('[data-testid="host-config-form"]');
    const hostBanner = document.querySelector('.host-banner');
    const modelPanel = document.querySelector('[data-testid="model-visibility-settings"]');
    const rect = modelPanel?.getBoundingClientRect();
    const topHit = rect ? document.elementFromPoint(rect.left + 80, rect.top + 60) : null;
    return {
      pageMode: document.documentElement.dataset.workbenchPage,
      hostInert: Boolean(document.querySelector('#app-sidebar + div')?.inert),
      hostBannerVisible: hostBanner ? getComputedStyle(hostBanner).visibility !== 'hidden' : false,
      hostFormVisible: hostForm ? getComputedStyle(hostForm).visibility !== 'hidden' : false,
      activeLink: document.querySelector('[data-workbench-model-link]')?.getAttribute('aria-current'),
      hitInsideModelPanel: Boolean(topHit && modelPanel?.contains(topHit)),
    };
  });
  assert.equal(desktopLayerCheck.pageMode, 'custom', 'Model visibility must mount as a custom Workbench settings page');
  assert.equal(desktopLayerCheck.hostInert, true, 'Underlying host configuration must stay inert');
  assert.equal(desktopLayerCheck.hostBannerVisible, false, 'Host configuration header must not leak above Model visibility');
  assert.equal(desktopLayerCheck.hostFormVisible, false, 'Host configuration form must not bleed through Model visibility');
  assert.equal(desktopLayerCheck.activeLink, 'page', 'Model visibility nav item must mark aria-current=page');
  assert.equal(desktopLayerCheck.hitInsideModelPanel, true, 'Pointer hit testing must reach Model visibility rather than host ConfigPage');

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

  const aliasPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const aliasErrors = [];
  aliasPage.on('pageerror', error => aliasErrors.push(error.stack || error.message));
  await aliasPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await aliasPage.locator('.codex-option-toggle').waitFor({ state: 'visible', timeout: 5000 });
  await aliasPage.evaluate(() => document.getElementById('preview-banner')?.remove());
  // Navigate inside the SPA so the already-mounted chat stays alive while the alias is edited.
  await aliasPage.evaluate(() => {
    const next = new URL('/config?workbench=models&profile=default', location.origin);
    history.pushState(null, '', next);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  const deepseekAlias = aliasPage.locator('[data-model-alias="deepseek/deepseek-flash"]');
  await deepseekAlias.waitFor({ state: 'visible', timeout: 5000 });
  await deepseekAlias.fill(' ds-flash ');
  await deepseekAlias.press('Enter');
  await aliasPage.waitForFunction(() => localStorage.getItem('workbench.model-aliases.v2')?.includes('ds-flash'));
  assert.equal(await deepseekAlias.inputValue(), 'ds-flash', 'Alias input must trim before saving');

  await aliasPage.evaluate(() => history.back());
  await aliasPage.waitForFunction(() => location.pathname === '/chat' && Boolean(document.querySelector('.codex-option-toggle')));
  await aliasPage.locator('.codex-option-toggle').waitFor({ state: 'visible', timeout: 5000 });
  await aliasPage.locator('.codex-option-toggle').click();
  await aliasPage.locator('.codex-setting-row').first().click();
  const aliasChoice = aliasPage.locator('.codex-setting-choice', { hasText: 'ds-flash' });
  await aliasChoice.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await aliasChoice.locator('span').first().getAttribute('title'), 'deepseek/deepseek-flash', 'The selector must keep the original model id available on hover');
  await aliasChoice.click();
  await aliasPage.waitForFunction(() => document.querySelector('.codex-model-summary')?.textContent?.includes('ds-flash'));
  assert.match(await aliasPage.locator('.codex-model-summary').innerText(), /ds-flash/);

  // The same alias must show up in another profile's chat without re-entering it.
  await aliasPage.goto(host.origin + '/chat?session=codex-preview&profile=writer', { waitUntil: 'domcontentloaded' });
  await aliasPage.locator('.codex-option-toggle').waitFor({ state: 'visible', timeout: 5000 });
  await aliasPage.evaluate(() => document.getElementById('preview-banner')?.remove());
  await aliasPage.locator('.codex-option-toggle').click();
  await aliasPage.locator('.codex-setting-row').first().click();
  const writerAliasChoice = aliasPage.locator('.codex-setting-choice', { hasText: 'ds-flash' });
  await writerAliasChoice.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await writerAliasChoice.locator('span').first().getAttribute('title'), 'deepseek/deepseek-flash',
    'A chat display name must apply to every profile');
  await writerAliasChoice.click();

  await aliasPage.goto(host.origin + '/config?workbench=models&profile=default', { waitUntil: 'domcontentloaded' });
  const restoredAlias = aliasPage.locator('[data-model-alias="deepseek/deepseek-flash"]');
  await restoredAlias.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await restoredAlias.inputValue(), 'ds-flash', 'The alias must survive navigation and settings re-renders');
  // Regrouped settings navigation: four groups, with rarely used pages folded into "More".
  const settingsNav = await aliasPage.evaluate(() => {
    const nav = document.querySelector('.dashboard-settings-nav');
    const groups = [...(nav?.querySelectorAll('.workbench-settings-group') || [])];
    const more = nav?.querySelector('[data-settings-group="more"]');
    return {
      groups: groups.map(group => group.getAttribute('data-settings-group')),
      headings: groups.map(group => group.querySelector('h2')?.textContent?.trim() || null),
      topLevelLinks: [...(nav?.querySelectorAll(':scope > a') || [])].length,
      moreExpanded: more?.querySelector('.workbench-settings-more-toggle')?.getAttribute('aria-expanded'),
      moreLinksHidden: Boolean(more?.querySelector('.workbench-settings-more-links')?.hasAttribute('hidden')),
      moreLinkCount: more?.querySelectorAll('.workbench-settings-more-links a').length,
    };
  });
  assert.deepEqual(settingsNav.groups, ['preferences', 'agent', 'maintenance', 'more'], 'Settings must group into four sections');
  assert.deepEqual(settingsNav.headings, ['Preferences', 'Agent', 'Maintenance', null], 'Groups must be labelled by intent');
  assert.equal(settingsNav.topLevelLinks, 0, 'Long lists must live inside grouped sections, not as a flat link list');
  assert.equal(settingsNav.moreExpanded, 'false', 'The More section must start collapsed');
  assert.equal(settingsNav.moreLinksHidden, true, 'Collapsed More links must not be reachable visually');
  assert.equal(settingsNav.moreLinkCount, 7, 'The More section must keep all rarely used settings reachable');
  await aliasPage.evaluate(() => document.getElementById('preview-banner')?.remove());
  await aliasPage.locator('[data-settings-group="more"] .workbench-settings-more-toggle').click();
  assert.equal(await aliasPage.locator('[data-settings-group="more"] .workbench-settings-more-toggle').getAttribute('aria-expanded'), 'true');
  await aliasPage.locator('[data-settings-group="more"] a', { hasText: 'Plugins' }).waitFor({ state: 'visible', timeout: 3000 });
  await aliasPage.reload({ waitUntil: 'domcontentloaded' });
  await aliasPage.locator('.dashboard-settings-nav').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await aliasPage.locator('[data-settings-group="more"] .workbench-settings-more-toggle').getAttribute('aria-expanded'), 'true',
    'The expanded More section must survive a reload');
  assert.deepEqual(aliasErrors, [], 'Browser errors in the alias flow:\n' + aliasErrors.join('\n'));
  await aliasPage.close();

  // The floating settings panel keeps the grouped navigation usable in its narrow column.
  const floatingSettings = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const floatingErrors = [];
  floatingSettings.on('pageerror', error => floatingErrors.push(error.stack || error.message));
  await floatingSettings.goto(host.origin + '/config?workbench=models&profile=default&panel=1', { waitUntil: 'domcontentloaded' });
  await floatingSettings.locator('.dashboard-settings-nav').waitFor({ state: 'visible', timeout: 5000 });
  const floatingNav = await floatingSettings.evaluate(() => {
    const nav = document.querySelector('.dashboard-settings-nav');
    const toggle = nav?.querySelector('.workbench-settings-more-toggle');
    const navRect = nav?.getBoundingClientRect();
    const toggleRect = toggle?.getBoundingClientRect();
    return {
      groups: [...(nav?.querySelectorAll('.workbench-settings-group') || [])].map(group => group.getAttribute('data-settings-group')),
      toggleInside: Boolean(navRect && toggleRect && toggleRect.left >= navRect.left - 1 && toggleRect.right <= navRect.right + 1),
      toggleWidth: toggleRect?.width || 0,
      navWidth: navRect?.width || 0,
    };
  });
  assert.deepEqual(floatingNav.groups, ['preferences', 'agent', 'maintenance', 'more'], 'Floating panel must keep the grouped settings navigation');
  assert.equal(floatingNav.toggleInside, true, 'The More toggle must stay inside the floating settings column');
  assert.ok(floatingNav.toggleWidth > 0 && floatingNav.toggleWidth <= floatingNav.navWidth, 'The More toggle must fit the narrow floating column');
  assert.deepEqual(floatingErrors, [], 'Browser errors in the floating settings panel:\n' + floatingErrors.join('\n'));
  await floatingSettings.close();

  const mobileSettingsPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const mobileSettingsErrors = [];
  mobileSettingsPage.on('pageerror', error => mobileSettingsErrors.push(error.stack || error.message));
  await mobileSettingsPage.goto(host.origin + '/config?workbench=display&profile=writer', { waitUntil: 'domcontentloaded' });
  await mobileSettingsPage.locator('[data-testid="chat-display-settings"]').waitFor({ state: 'visible', timeout: 5000 });
  await mobileSettingsPage.locator('.workbench-mobile-settings-back').click();
  // The mobile settings list must expose the grouped navigation and expand More on tap.
  await mobileSettingsPage.locator('[data-settings-group="more"] .workbench-settings-more-toggle').waitFor({ state: 'visible', timeout: 5000 });
  await mobileSettingsPage.locator('[data-settings-group="more"] .workbench-settings-more-toggle').click();
  await mobileSettingsPage.locator('[data-settings-group="more"] a', { hasText: 'Plugins' }).waitFor({ state: 'visible', timeout: 3000 });
  await mobileSettingsPage.locator('[data-settings-group="more"] .workbench-settings-more-toggle').click();
  await mobileSettingsPage.locator('[data-settings-group="more"] a', { hasText: 'Plugins' }).waitFor({ state: 'hidden', timeout: 3000 });
  await mobileSettingsPage.locator('[data-workbench-model-link]').click();
  await mobileSettingsPage.locator('[data-testid="model-visibility-settings"] .workbench-model-group').first().waitFor({ state: 'visible', timeout: 5000 });
  const mobileSettingsCheck = await mobileSettingsPage.evaluate(() => {
    const panel = document.querySelector('[data-testid="model-visibility-settings"]');
    const rect = panel?.getBoundingClientRect();
    const hit = rect ? document.elementFromPoint(rect.left + 80, rect.top + 80) : null;
    const hostForm = document.querySelector('[data-testid="host-config-form"]');
    return {
      profile: document.querySelector('[data-model-profile]')?.textContent,
      hitInsidePanel: Boolean(hit && panel?.contains(hit)),
      hostFormVisible: hostForm ? getComputedStyle(hostForm).visibility !== 'hidden' : false,
    };
  });
  assert.equal(mobileSettingsCheck.profile, 'writer', 'Switching settings tabs must preserve the active profile');
  assert.equal(mobileSettingsCheck.hitInsidePanel, true, 'Mobile Model visibility must own pointer hit-testing without host overlap');
  assert.equal(mobileSettingsCheck.hostFormVisible, false, 'Mobile host configuration form must remain hidden behind Model visibility');
  // Returning from /profiles to the mobile settings list must keep the Settings heading visible.
  await mobileSettingsPage.locator('.workbench-mobile-settings-back').click();
  await mobileSettingsPage.locator('.dashboard-settings-nav a[href^="/profiles"]').click();
  await mobileSettingsPage.locator('.workbench-profiles').waitFor({ state: 'visible', timeout: 5000 });
  await mobileSettingsPage.locator('.workbench-mobile-settings-back').click();
  assert.equal(await mobileSettingsPage.locator('.dashboard-settings-nav h1').isVisible(), false, 'The duplicate settings heading must stay hidden in mobile list mode');
  assert.equal(await mobileSettingsPage.locator('#workbench-mobile-settings-title').innerText(), 'Settings', 'The mobile header must keep the Settings title visible');
  const mobileHeaderBox = await mobileSettingsPage.locator('#workbench-mobile-settings-header').boundingBox();
  assert.ok(mobileHeaderBox && mobileHeaderBox.x >= 48, 'The mobile settings list header must clear the action rail');
  // Portaled z-[100] host dialogs (such as /models ModelPickerDialog) must appear above mobile settings detail view.
  await mobileSettingsPage.goto(host.origin + '/models?profile=writer', { waitUntil: 'domcontentloaded' });
  await mobileSettingsPage.locator('.workbench-mobile-settings-header').waitFor({ state: 'visible', timeout: 5000 });
  const modalHit = await mobileSettingsPage.evaluate(() => {
    const portal = document.createElement('div');
    portal.className = 'fixed inset-0 z-[100]';
    portal.id = 'smoke-model-picker-portal';
    portal.style.background = 'rgba(0, 0, 0, 0.5)';
    document.body.append(portal);
    const hitCenter = document.elementFromPoint(195, 420)?.id;
    const hitHeaderArea = document.elementFromPoint(195, 24)?.id;
    portal.remove();
    return { hitCenter, hitHeaderArea };
  });
  assert.equal(modalHit.hitCenter, 'smoke-model-picker-portal', 'Portaled z-[100] model picker must sit above mobile settings detail panel');
  assert.equal(modalHit.hitHeaderArea, 'smoke-model-picker-portal', 'Portaled z-[100] model picker must sit above mobile settings header');
  assert.deepEqual(mobileSettingsErrors, [], `Browser errors in mobile settings layering check:\n${mobileSettingsErrors.join('\n')}`);
  await mobileSettingsPage.close();

  const mobileReturnPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const mobileReturnErrors = [];
  mobileReturnPage.on('pageerror', error => mobileReturnErrors.push(error.stack || error.message));
  await mobileReturnPage.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await mobileReturnPage.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 5000 });
  await mobileReturnPage.locator('.project-temporary .codex-session-row').nth(1).click();
  await mobileReturnPage.waitForFunction(() => document.querySelectorAll('.codex-pane-slot').length === 2);
  const mobileSplitChatUrl = mobileReturnPage.url();
  await mobileReturnPage.setViewportSize({ width: 390, height: 844 });
  await mobileReturnPage.waitForTimeout(300);
  await mobileReturnPage.evaluate(() => document.querySelector('.dashboard-rail-actions a[aria-label="Settings"], .dashboard-crafting-grid a[aria-label="Settings"]')?.click());
  await mobileReturnPage.waitForFunction(() => location.pathname === '/config');
  await mobileReturnPage.locator('#workbench-mobile-settings-header').waitFor({ state: 'visible', timeout: 5000 });
  const returnButton = mobileReturnPage.locator('.workbench-mobile-settings-chat');
  assert.equal(await returnButton.isVisible(), true, 'Mobile settings must expose a visible Back to chat button');
  await returnButton.click();
  await mobileReturnPage.waitForFunction(() => location.pathname === '/chat');
  assert.equal(mobileReturnPage.url(), mobileSplitChatUrl, 'Back to chat must restore the original split chat route');
  assert.equal(await mobileReturnPage.locator('.codex-pane-slot').count(), 2, 'Back to chat must preserve both panes');
  await mobileReturnPage.evaluate(() => document.querySelector('.dashboard-rail-actions a[aria-label="Settings"], .dashboard-crafting-grid a[aria-label="Settings"]')?.click());
  await mobileReturnPage.waitForFunction(() => location.pathname === '/config');
  await mobileReturnPage.locator('[data-workbench-chat-display-link]').click();
  await mobileReturnPage.waitForFunction(() => new URLSearchParams(location.search).get('workbench') === 'display');
  await mobileReturnPage.locator('.workbench-mobile-settings-chat').click();
  await mobileReturnPage.waitForFunction(() => location.pathname === '/chat');
  assert.equal(mobileReturnPage.url(), mobileSplitChatUrl, 'Back to chat from a settings subpage must restore the split chat route');
  assert.equal(await mobileReturnPage.locator('.codex-pane-slot').count(), 2, 'Back to chat from a settings subpage must preserve both panes');
  assert.deepEqual(mobileReturnErrors, [], `Browser errors returning from mobile settings:\n${mobileReturnErrors.join('\n')}`);
  await mobileReturnPage.close();

  console.log('Workbench browser smoke passed: home, same-profile chat panes, profile switching, icon-only file actions, mobile drawer, board-dialog and organizer rail offsets, the centered floating panel, grouped settings navigation with a collapsible More section, cross-profile chat display names, settings subpage layering, and the three chat detail levels rendered without page errors.');
} finally {
  await browser.close();
  await host.close();
}
