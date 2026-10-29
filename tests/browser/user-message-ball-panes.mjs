/**
 * Per-pane user message navigators: every chat pane must own one ball, one
 * panel, and one scroll target, and none of them may drift with the layout.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const BALL = '[data-workbench-user-message-ball]';
const PANEL = '[data-workbench-user-message-panel]';

const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await page.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 5000 });
  await page.locator('.project-temporary .codex-session-row').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.codex-pane-slot').length === 2, null, { timeout: 5000 });
  await injectMessages(page, 0, ['pane-a-user-1', 'pane-a-user-2', 'pane-a-user-3', 'pane-a-user-4', 'pane-a-user-5', 'pane-a-user-6']);
  await injectMessages(page, 1, ['pane-b-user-1', 'pane-b-user-2']);
  await page.waitForFunction((ball) => document.querySelectorAll(ball).length === 2
    && document.querySelectorAll(ball)[1]?.dataset.count === '3', BALL, { timeout: 5000 });

  const desktop = await paneGeometry(page);
  assert.deepEqual(desktop.map(pane => pane.count), ['7', '3'], 'each pane must show its own user message count');
  assert.deepEqual(desktop.map(pane => pane.hidden), [false, false]);
  assert.deepEqual(desktop.map(pane => pane.insidePane), [true, true], 'each ball must stay inside its own pane');
  assert.ok(desktop.every(pane => pane.composerClearance >= 8), 'the ball must clear the composer controls');

  // The panel belongs to one pane only.
  await page.locator('.codex-pane-slot').nth(1).locator(BALL).click();
  const secondPanel = page.locator('.codex-pane-slot').nth(1).locator(PANEL);
  await secondPanel.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await page.locator('.codex-pane-slot').nth(0).locator(PANEL).isHidden(), true, 'the other pane must keep its panel closed');
  assert.equal(await secondPanel.locator('[data-user-message-item]').count(), 3, 'the panel must list only its own pane');
  const panelText = await secondPanel.textContent();
  assert.ok(panelText.includes('pane-b-user-1') && !panelText.includes('pane-a-user-'), 'panel text must stay inside its pane');
  const panelBox = await secondPanel.boundingBox();
  const paneBox = await page.locator('.codex-pane-slot').nth(1).boundingBox();
  assert.ok(panelBox.x >= paneBox.x - 1 && panelBox.x + panelBox.width <= paneBox.x + paneBox.width + 1, 'the panel must stay inside its pane');

  // Choosing a message scrolls and highlights only the owning pane.
  const scrollBefore = await page.evaluate(() => [...document.querySelectorAll('.codex-message-list')].map(list => list.scrollTop));
  await secondPanel.locator('[data-user-message-item]').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.codex-message-list')[1].scrollTop > 0, null, { timeout: 5000 });
  const jump = await page.evaluate(() => ({
    target: document.querySelector('[data-message-id="pane-b-user-1"]')?.classList.contains('is-user-message-jump-target'),
    other: document.querySelector('[data-message-id="pane-a-user-1"]')?.classList.contains('is-user-message-jump-target'),
    scrolls: [...document.querySelectorAll('.codex-message-list')].map(list => list.scrollTop),
    panelHidden: document.querySelectorAll('[data-workbench-user-message-panel]')[1].hasAttribute('hidden'),
  }));
  assert.equal(jump.target, true, 'the chosen message must be highlighted');
  assert.equal(jump.other, false, 'the other pane must not be highlighted');
  assert.equal(jump.scrolls[0], scrollBefore[0], 'the other pane must keep its scroll position');
  assert.ok(jump.scrolls[1] > scrollBefore[1], 'only the owning pane scrolls');
  assert.equal(jump.panelHidden, true, 'choosing a message closes the panel');

  // Geometry must survive transcript scrolling and window resizes.
  const afterScroll = await paneGeometry(page);
  assert.deepEqual(offsets(afterScroll), offsets(desktop), 'scrolling must not move the balls');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(250);
  const resized = await paneGeometry(page);
  assert.deepEqual(offsets(resized), offsets(desktop), 'resizing must not move the balls');
  assert.deepEqual(resized.map(pane => pane.insidePane), [true, true]);
  assert.ok(resized.every(pane => pane.composerClearance >= 8));

  // Escape and outside clicks close the panel.
  await page.locator('.codex-pane-slot').nth(0).locator(BALL).click();
  await page.locator('.codex-pane-slot').nth(0).locator(PANEL).waitFor({ state: 'visible', timeout: 5000 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.codex-pane-slot').nth(0).locator(PANEL).isHidden(), true, 'Escape must close the panel');
  await page.locator('.codex-pane-slot').nth(0).locator(BALL).click();
  await page.locator('.codex-pane-slot').nth(0).locator(PANEL).waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.codex-center-header').nth(0).click();
  assert.equal(await page.locator('.codex-pane-slot').nth(0).locator(PANEL).isHidden(), true, 'an outside click must close the panel');

  // The global setting hides and restores every pane ball.
  await page.evaluate(() => localStorage.setItem('workbench.user-message-ball.v1', 'false'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.codex-message.is-user').first().waitFor({ state: 'attached', timeout: 5000 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator(BALL).first().isVisible(), false, 'the disabled setting must hide the navigator');
  await page.evaluate(() => localStorage.setItem('workbench.user-message-ball.v1', 'true'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.codex-message.is-user').first().waitFor({ state: 'attached', timeout: 5000 });
  await page.locator(BALL).first().waitFor({ state: 'visible', timeout: 5000 });
  await page.close();

  // Mobile 390x844: two panes, horizontal strip scrolling and the navigation drawer.
  const mobile = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const mobileErrors = [];
  mobile.on('pageerror', error => mobileErrors.push(error.stack || error.message));
  await mobile.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await mobile.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 5000 });
  await mobile.locator('.project-temporary .codex-session-row').nth(1).click();
  await mobile.waitForFunction(() => document.querySelectorAll('.codex-pane-slot').length === 2, null, { timeout: 5000 });
  await injectMessages(mobile, 0, ['mobile-a-1', 'mobile-a-2', 'mobile-a-3', 'mobile-a-4', 'mobile-a-5', 'mobile-a-6']);
  await injectMessages(mobile, 1, ['mobile-b-1', 'mobile-b-2']);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.waitForTimeout(400);
  await mobile.waitForFunction((ball) => document.querySelectorAll(ball).length === 2
    && document.querySelectorAll(ball)[1]?.dataset.count === '3', BALL, { timeout: 5000 });

  const mobileStart = await paneGeometry(mobile);
  assert.deepEqual(mobileStart.map(pane => pane.count), ['7', '3'], 'mobile panes must keep separate counts');
  assert.deepEqual(mobileStart.map(pane => pane.insidePane), [true, true], 'mobile balls must stay inside their panes');
  assert.ok(mobileStart.every(pane => pane.composerClearance >= 8), 'mobile balls must clear the composer');

  await mobile.evaluate(() => {
    const strip = document.querySelector('.codex-multi-pane');
    strip.scrollLeft = strip.scrollWidth;
  });
  await mobile.waitForTimeout(250);
  const mobileScrolled = await paneGeometry(mobile);
  assert.deepEqual(offsets(mobileScrolled), offsets(mobileStart), 'horizontal pane scrolling must not move the balls');

  await mobile.locator('.dashboard-mobile-toggle').click();
  await mobile.locator('.dashboard-global-nav.is-open').waitFor({ state: 'visible', timeout: 5000 });
  const mobileDrawer = await paneGeometry(mobile);
  assert.deepEqual(offsets(mobileDrawer), offsets(mobileStart), 'the navigation drawer must not move the balls');
  await mobile.locator('.dashboard-mobile-toggle').click();
  await mobile.waitForFunction(() => !document.querySelector('.dashboard-global-nav.is-open'), null, { timeout: 5000 });

  await mobile.locator('.codex-pane-slot').nth(1).locator(BALL).click();
  const mobilePanel = mobile.locator('.codex-pane-slot').nth(1).locator(PANEL);
  await mobilePanel.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await mobilePanel.locator('[data-user-message-item]').count(), 3, 'the mobile panel must list only its own pane');
  const mobilePanelBox = await mobilePanel.boundingBox();
  const mobilePaneBox = await mobile.locator('.codex-pane-slot').nth(1).boundingBox();
  assert.ok(mobilePanelBox.x >= mobilePaneBox.x - 1 && mobilePanelBox.x + mobilePanelBox.width <= mobilePaneBox.x + mobilePaneBox.width + 1, 'the mobile panel must stay inside its pane');
  await mobilePanel.locator('.workbench-user-message-panel-close').click();
  assert.equal(await mobilePanel.isHidden(), true, 'the close control must close the panel');
  assert.deepEqual(mobileErrors, [], `Browser errors on mobile:\n${mobileErrors.join('\n')}`);
  await mobile.close();

  assert.deepEqual(errors, [], `Browser errors on desktop:\n${errors.join('\n')}`);
  console.log('Per-pane user message navigator check passed: separate balls, panels, jumps, stable geometry on desktop and mobile.');
} finally {
  await browser.close();
  await host.close();
}

/** Clone extra user messages into one pane so the transcript can scroll. */
async function injectMessages(page, paneIndex, ids) {
  await page.evaluate(({ paneIndex: index, ids: messages }) => {
    const list = document.querySelectorAll('.codex-pane-slot')[index].querySelector('.codex-message-list');
    const template = list.querySelector('.codex-message.is-user');
    if (!template) throw new Error('Missing user message fixture');
    for (const id of messages) {
      const clone = template.cloneNode(true);
      clone.setAttribute('data-message-id', id);
      const body = clone.querySelector('.codex-message-body');
      if (body) body.textContent = `${id}: verify the per-pane navigator jump target.`;
      list.append(clone);
    }
    const spacer = document.createElement('div');
    spacer.style.height = '1200px';
    list.append(spacer);
  }, { paneIndex, ids });
}

/** Read each pane ball's count and offsets relative to its own pane. */
function paneGeometry(page) {
  return page.evaluate((ballSelector) => {
    const panes = [...document.querySelectorAll('.codex-pane-slot')];
    return panes.map(pane => {
      const ball = pane.querySelector(ballSelector);
      const composer = pane.querySelector('.codex-composer-wrap');
      const paneRect = pane.getBoundingClientRect();
      const ballRect = ball?.getBoundingClientRect();
      return {
        count: ball?.dataset.count ?? null,
        hidden: ball ? ball.hasAttribute('hidden') : null,
        rightGap: ballRect ? Math.round(paneRect.right - ballRect.right) : null,
        bottomGap: ballRect ? Math.round(paneRect.bottom - ballRect.bottom) : null,
        composerClearance: ballRect && composer ? Math.round(composer.getBoundingClientRect().top - ballRect.bottom) : null,
        insidePane: ballRect ? ballRect.left >= paneRect.left - 1 && ballRect.right <= paneRect.right + 1 : null,
      };
    });
  }, BALL);
}

function offsets(geometry) {
  return geometry.map(pane => [pane.rightGap, pane.bottomGap]);
}
