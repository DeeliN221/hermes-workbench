import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const label = `${viewport.width < 800 ? 'mobile' : 'desktop'}-${theme}`;
    test.describe(label, () => {
      test.use({ viewport });
      test('manage arbitrary subscriptions through the real persistent API', async ({ page, request }, info) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        const headers = { 'remote-user': `browser-${label}` };
        await page.route('**/api/plugins/workbench/quotas**', async route => {
          const incoming = route.request();
          expect(incoming.postData() || '').not.toMatch(/token|password|secret|apiKey/);
          const url = new URL(incoming.url());
          const response = await request.fetch(`http://127.0.0.1:4180${url.pathname}${url.search}`, {
            method: incoming.method(), headers: { ...headers, 'content-type': 'application/json' },
            ...(incoming.postData() ? { data: incoming.postData()! } : {}),
          });
          await route.fulfill({ response });
        });
        await page.goto('/config?workbench=allowances&profile=default');
        await expect(page).toHaveTitle('default');
        await expect(page).toHaveURL(/workbench=allowances/);
        const panel = page.locator('.quota-settings');
        await expect(panel.locator('.quota-card')).toHaveCount(3);
        await expect(panel.getByText('75% remaining')).toBeVisible();
        const add = async (name: string) => {
          await panel.getByRole('button', { name: 'Add subscription', exact: true }).click();
          await panel.getByLabel('Display name', { exact: true }).fill(name);
          await panel.getByLabel('Provider / service', { exact: true }).fill('Example Cloud');
          await panel.getByLabel('Plan / account label', { exact: true }).fill('Team account');
          await panel.getByLabel('Allowance window', { exact: true }).selectOption('43200');
          await panel.getByLabel('Reset time (local time)', { exact: true }).fill('2030-01-01T00:00');
          await panel.getByLabel('Manual value', { exact: true }).fill('42');
          await panel.getByLabel('Total allowance (optional)', { exact: true }).fill('100');
          await panel.getByRole('button', { name: 'Save subscription', exact: true }).click();
          await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
        };
        await add('Example personal');
        await add('Example second account');
        await expect(panel.locator('.quota-card')).toHaveCount(5);
        await page.reload();
        await expect(panel.locator('.quota-card')).toHaveCount(5);
        const card = panel.locator('.quota-card').filter({ has: page.getByRole('heading', { name: 'Example second account', exact: true }) });
        await card.getByRole('button', { name: 'Edit', exact: true }).click();
        await panel.getByLabel('Display name', { exact: true }).fill('Example work');
        await panel.getByLabel('Value represents', { exact: true }).selectOption('used');
        await panel.getByLabel('Manual value', { exact: true }).fill('18');
        await panel.getByRole('button', { name: 'Save subscription', exact: true }).click();
        const work = panel.locator('.quota-card').filter({ has: page.getByRole('heading', { name: 'Example work', exact: true }) });
        await expect(work.getByText('18 credits used')).toBeVisible();
        await work.getByRole('button', { name: 'Move up', exact: true }).click();
        await expect(panel.locator('.quota-card').nth(3).getByRole('heading', { name: 'Example work', exact: true })).toBeVisible();
        await work.getByRole('button', { name: 'Disable', exact: true }).click();
        await expect(work.getByText('Disabled', { exact: true })).toBeVisible();
        await expect(work.getByText('18 credits used')).toHaveCount(0);
        await page.reload();
        await expect(work.getByText('Disabled', { exact: true })).toBeVisible();
        await work.getByRole('button', { name: 'Enable', exact: true }).click();
        await expect(work.getByText('18 credits used')).toBeVisible();
        await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(panel.getByRole('status')).toContainText('3 of 5 providers available');
        await page.evaluate(theme => document.documentElement.setAttribute('data-workbench-theme', theme), theme);
        await panel.scrollIntoViewIfNeeded();
        expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${label}-overview.png`) });
        await work.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`${label}-subscriptions.png`) });
        await panel.getByRole('button', { name: 'Add subscription', exact: true }).click();
        await panel.getByLabel('Display name', { exact: true }).fill('Another subscription');
        await panel.locator('form').scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`${label}-editor.png`) });
        await panel.locator('form').getByRole('button', { name: 'Cancel', exact: true }).click();
        await work.getByRole('button', { name: 'Delete', exact: true }).click();
        await work.getByRole('button', { name: 'Confirm delete', exact: true }).click();
        await expect(panel.locator('.quota-card')).toHaveCount(4);
        await page.reload();
        await expect(panel.locator('.quota-card')).toHaveCount(4);
        await expect(panel.getByRole('heading', { name: 'Example work', exact: true })).toHaveCount(0);
        await expect(panel.getByText('42 credits remaining')).toBeVisible();
        await panel.getByRole('button', { name: 'Add subscription', exact: true }).click();
        await panel.getByLabel('Entry source', { exact: true }).selectOption('opencode');
        await panel.getByLabel('Display name', { exact: true }).fill('Restored preset');
        await expect(panel.getByLabel('Manual value', { exact: true })).toHaveCount(0);
        await panel.getByRole('button', { name: 'Save subscription', exact: true }).click();
        await expect(panel.getByRole('heading', { name: 'Restored preset', exact: true })).toBeVisible();
        await expect(page.locator('#preview-errors')).toBeEmpty();
        await expect(page.locator('vite-error-overlay')).toHaveCount(0);
        expect(errors).toEqual([]);
      });
    });
  }
}
