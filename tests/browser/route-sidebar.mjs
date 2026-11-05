import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shots = process.env.SHOT_DIR || 'node_modules/.cache/route-sidebar';
await mkdir(shots, { recursive: true });
try {
 for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  for (const route of ['/', '/kanban', '/chat?session=codex-preview&profile=default', '/config?workbench=display', '/cron', '/files']) {
   await page.goto(host.origin + route);
   await expect(page.locator('html')).toHaveAttribute('data-workbench-shell', 'true');
   await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
   const nav = page.locator('.dashboard-global-nav');
   if (!mobile) {
    if (route === '/' || route === '/kanban') {
     await expect(nav).toBeHidden();
     assert.equal(await page.locator('html').evaluate(n => getComputedStyle(n).getPropertyValue('--dashboard-nav-width').trim()), '0px');
    } else {
     await expect(nav).toBeVisible();
     await expect(nav.locator('.dashboard-nav-collapse')).toBeVisible();
    }
   }
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route + ' overflow');
   if (route.startsWith('/chat')) {
    await expect(page.locator('.codex-composer').first()).toBeVisible();
    if (!mobile) {
     await expect(nav.locator('.project-folder').first()).toBeVisible();
     await expect(nav.locator('.project-temporary')).toBeVisible();
     const center = await page.locator('.codex-multi-pane').boundingBox();
     const bounds = await nav.boundingBox();
     assert.ok(Math.abs(center.x - bounds.width) < 2);
     await page.locator('.dashboard-nav-collapse').first().focus();
     await page.keyboard.press('w');
     await expect(page.locator('.workbench-actions-dialog')).toBeVisible();
     await page.keyboard.press('Escape');
     await expect(page.locator('.dashboard-nav-collapse').first()).toBeFocused();
     await nav.locator('.dashboard-nav-collapse').click();
     await expect(nav).toHaveClass(/is-collapsed/);
     await page.evaluate(() => { history.pushState({}, '', '/chat?session=codex-regression&profile=default'); dispatchEvent(new PopStateEvent('popstate')); });
     await expect(nav).toHaveClass(/is-collapsed/);
     await nav.locator('.dashboard-nav-collapse').click();
     await page.evaluate(() => { history.pushState({}, '', '/chat?session=codex-preview&profile=default'); dispatchEvent(new PopStateEvent('popstate')); });
     const folder = nav.locator('.project-folder').first();
     await folder.locator('summary').click();
     await expect(folder).toHaveAttribute('open', '');
     await nav.evaluate(n => { window.__nav = n; const s = n.querySelector('.project-navigation-split > .project-navigation'); window.__scroll = s; s.style.maxHeight = '200px'; s.style.overflow = 'auto'; s.scrollTop = 50; window.__scrollTop = s.scrollTop; });
     assert.ok(await page.evaluate(() => window.__scrollTop > 0), 'Nonzero sidebar scroll position');
     const rows = nav.locator('.codex-session-row');
     await rows.filter({ hasText: 'Home rendering regression' }).first().click();
     await expect(nav.locator('.codex-session-row.is-active')).toContainText('Home rendering regression');
     assert.equal(await nav.evaluate(n => n === window.__nav), true);
     await expect(folder).toHaveAttribute('open', '');
     assert.equal(await page.evaluate(() => window.__scroll.scrollTop === window.__scrollTop), true);
     await nav.evaluate(() => { window.__scroll.style.maxHeight = ''; window.__scroll.style.overflow = ''; });
     await page.mouse.move(1000, 800);
    }
   }
   if (['/', '/kanban'].includes(route) || route.startsWith('/chat') || route.startsWith('/config')) {
    await page.addStyleTag({ content: '#preview-banner { display:none }' });
    await page.screenshot({ path: `${shots}/${mobile ? 'mobile' : 'desktop'}-${theme}-${route === '/' ? 'home' : route.split('?')[0].slice(1)}.png` });
   }
  }
  assert.deepEqual(errors, []); await page.close();
 }
 console.log('PASS route sidebar: desktop/mobile, light/dark, home/kanban/chat/settings/cron/files, state, focus, geometry');
} finally { await browser.close(); await host.close(); }
