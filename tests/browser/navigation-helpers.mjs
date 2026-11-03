/** Project/session controls now live in the compact mobile navigation, outside the W menu. */
export async function openSessionNavigation(page) {
  const viewport = page.viewportSize();
  if (viewport.width > 800) await page.setViewportSize({ width: 800, height: viewport.height });
  const menu = page.locator('.workbench-actions-dialog[open]');
  if (await menu.count()) await page.keyboard.press('Escape');
  const toggle = page.locator('.dashboard-mobile-toggle').first();
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.locator('.dashboard-global-nav.is-open').waitFor({ state: 'visible' });
  return async () => {
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    if (viewport.width > 800) await page.setViewportSize(viewport);
  };
}
export async function openSecondSession(page) {
  const restore = await openSessionNavigation(page);
  await page.locator('.project-temporary .codex-session-row').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.codex-pane-slot').length === 2);
  await restore();
}
