/** Sidebar acceptance against a localhost mock host; no installed service is contacted. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';
const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const shots = process.env.SHOT_DIR;
if (shots) await mkdir(shots, { recursive: true });
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: mobile, isMobile: mobile, colorScheme: theme });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const groups = [{ id: 'research', name: 'Research notes' }, { id: 'tools', name: 'Developer tools' }, { id: 'archive', name: 'Reading list' }];
    const writes = [];
    await page.route('**/api/plugins/workbench/codex/groups**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'GET') return route.fulfill({ json: { items: groups } });
      const body = request.postDataJSON();
      writes.push({ method: request.method(), path: url.pathname, body });
      const id = url.pathname.split('/')[6];
      if (url.pathname.endsWith('/appearance')) {
        const group = groups.find(group => group.id === id);
        Object.assign(group, body);
        return route.fulfill({ json: { group } });
      }
      if (request.method() === 'DELETE') {
        groups.splice(groups.findIndex(group => group.id === id), 1);
        return route.fulfill({ json: { ok: true } });
      }
      if (request.method() === 'PATCH') {
        const group = groups.find(group => group.id === id);
        Object.assign(group, body);
        return route.fulfill({ json: { group } });
      }
      const group = { id: 'created', name: body.name };
      groups.push(group);
      return route.fulfill({ json: { group } });
    });
    await page.goto(host.origin + '/chat?session=codex-preview&profile=default');
    await page.locator('.codex-pane-slot').first().waitFor();
    if (mobile) await page.locator('.dashboard-mobile-toggle').first().click();
    await page.locator('.project-folder-row').first().waitFor();
    await page.evaluate(theme => { document.documentElement.dataset.workbenchTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    const prefix = `${mobile ? 'mobile' : 'desktop'}-${theme}`;
    const shot = async suffix => { if (shots) await page.screenshot({ path: `${shots}/${prefix}-${suffix}.png` }); };
    await shot('sidebar');
    assert.equal(await page.locator('.project-temporary .project-section-heading button').count(), 1);
    assert.equal(await page.locator('.project-navigation .project-section-heading .project-create').count(), 0);
    assert.equal(await page.getByRole('menuitem').count(), 0); // Closed popovers are hidden from accessibility tree.
    assert.equal(await page.locator('.project-actions > button').count(), 3);
    assert.equal(await page.locator('.project-actions > button').first().textContent(), '');
    const heading = page.locator('.project-heading-label');
    const nameInput = page.locator('input[name="project-name"]');
    await heading.click();
    await page.waitForTimeout(650);
    assert.equal(await nameInput.count(), 0, 'A tap must not create a project');
    // Movement and cancellation both prevent creation, even after the hold threshold.
    for (const end of ['pointermove', 'pointercancel', 'pointerout']) {
      await heading.dispatchEvent('pointerdown', { button: 0, isPrimary: true, pointerId: 1, clientX: 40, clientY: 40 });
      await heading.dispatchEvent(end, { pointerId: 1, clientX: 60, clientY: 40 });
      await page.waitForTimeout(650);
      assert.equal(await nameInput.count(), 0, end);
    }
    // A real pointer hold opens once, and release doesn't submit or open another dialog.
    if (mobile) {
      const client = await page.context().newCDPSession(page);
      const box = await heading.boundingBox();
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 8, y: box.y + 8 }] });
      await page.waitForTimeout(300);
      await heading.evaluate(node => node.dispatchEvent(new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' })));
      assert.equal(await nameInput.count(), 0, 'Native touch contextmenu must not bypass the hold threshold');
      await page.waitForTimeout(400);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
    } else await heading.click({ delay: 700 });
    await nameInput.waitFor();
    await shot('create');
    await page.keyboard.press('Escape');
    await heading.click({ button: 'right' });
    await nameInput.waitFor();
    await page.keyboard.press('Escape');
    await heading.focus();
    await heading.press('Shift+F10');
    await nameInput.waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'History and archive', exact: true }).click();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await nameInput.fill('New research');
    await nameInput.press('Enter');
    await page.getByText('New research', { exact: true }).waitFor();
    const row = page.locator('.project-folder-row').filter({ hasText: 'Research notes' });
    const appearance = row.getByRole('button', { name: 'Edit project appearance: Research notes', exact: true });
    const disclosure = row.locator('details');
    const wasOpen = await disclosure.getAttribute('open');
    await appearance.focus();
    await appearance.press('Enter');
    const editor = page.getByRole('dialog', { name: 'Project appearance', exact: true });
    await editor.getByLabel('Color', { exact: true }).selectOption('green');
    await editor.getByLabel('Icon', { exact: true }).selectOption('star');
    await shot('appearance');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    assert.equal(await disclosure.getAttribute('open'), wasOpen, 'Appearance editing must not toggle a project');
    assert.equal(await appearance.textContent(), '☆');
    assert.equal(await appearance.locator('span').evaluate(node => getComputedStyle(node).color), 'rgb(51, 155, 114)');
    const more = row.getByRole('button', { name: 'More project actions: Research notes', exact: true });
    await row.hover();
    if (mobile) await more.tap(); else await more.click();
    await page.getByRole('menuitem', { name: 'Rename project', exact: true }).waitFor();
    await shot('menu');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('menuitem', { name: 'Delete project', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await more.evaluate(node => node === document.activeElement), true);
    await more.click();
    await page.getByRole('menuitem', { name: 'Rename project', exact: true }).click();
    await nameInput.fill('Research renamed');
    await nameInput.press('Enter');
    const renamed = page.locator('.project-folder-row').filter({ hasText: 'Research renamed' });
    await renamed.waitFor();
    const renamedMore = renamed.getByRole('button', { name: 'More project actions: Research renamed', exact: true });
    const beforeDelete = writes.length;
    page.once('dialog', dialog => { assert.match(dialog.message(), /sessions will remain as temporary sessions/); dialog.dismiss(); });
    await renamed.hover();
    await renamedMore.click();
    await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
    assert.equal(writes.length, beforeDelete, 'Cancelling confirmation must not delete');
    assert.equal(await renamed.count(), 1);
    page.once('dialog', dialog => dialog.accept());
    await renamedMore.click();
    await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
    await renamed.waitFor({ state: 'detached' });
    assert.equal(writes.at(-1).method, 'DELETE');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS: project navigation ${prefix}`);
  }
} finally { await browser.close(); await host.close(); }
