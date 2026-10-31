import { test, expect } from '@playwright/test';
const data = () => ({ providers: ['opencode', 'gemini', 'openai'].map(id => ({
  id, status: id === 'openai' ? 'available' : 'unavailable',
  reason: id === 'openai' ? 'Codex allowance only; not a ChatGPT-wide balance.' : 'No verified quota connection. Check the provider console.',
  windows: id === 'openai' ? [{ minutes: 300, remainingPercent: 75, resetsAt: '2030-01-01T00:00:00Z' },
    { minutes: 10080, remainingPercent: 40, resetsAt: '2030-01-07T00:00:00Z' }] : [],
  updatedAt: id === 'openai' ? '2030-01-01T00:00:00Z' : null, checkedAt: '2030-01-01T00:00:00Z',
})) });

test('desktop: open, partial availability, coalesced refresh, failure, retry, Escape', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let count = 0;
  let fail = false;
  await page.route('**/api/plugins/workbench/quotas?**', async route => {
    count++;
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : data() });
  });
  await page.goto('/sessions?profile=default');
  await expect(page.getByRole('button', { name: 'Allowances', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('desktop-entry.png'), fullPage: true });
  await page.getByRole('button', { name: 'Allowances', exact: true }).click();
  await expect(page.locator('.quota-dialog').getByRole('status')).toHaveText('Refresh complete · 1 of 3 providers available');
  await expect(page.locator('.quota-card')).toHaveCount(3);
  await expect(page.getByText('75% remaining')).toBeVisible();
  await expect(page.getByText('40% remaining')).toBeVisible();
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true });
  const refresh = page.locator('.quota-dialog').getByRole('button', { name: 'Refresh', exact: true });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(page.locator('.quota-dialog').getByRole('status')).toHaveText('Refresh complete · 1 of 3 providers available');
  expect(count).toBe(2);
  fail = true;
  await refresh.click();
  await expect(page.locator('.quota-dialog').getByRole('status')).toHaveText('Refresh failed · Retry available');
  await expect(page.getByText('75% remaining')).toHaveCount(0);
  fail = false;
  await refresh.click();
  await expect(page.getByText('75% remaining')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Allowances', exact: true })).toBeFocused();
});

test('mobile: unavailable and timeout show reasons without overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const payload = data();
  payload.providers[2] = { ...payload.providers[2], status: 'timeout', windows: [], updatedAt: null,
    reason: 'Quota refresh timed out. Retry later.' };
  await page.route('**/api/plugins/workbench/quotas?**', route => route.fulfill({ json: payload }));
  await page.goto('/sessions?profile=default');
  await page.getByRole('button', { name: 'Allowances', exact: true }).click();
  await expect(page.locator('.quota-dialog').getByRole('status')).toHaveText('Refresh complete · 0 of 3 providers available');
  await expect(page.getByText('Timed out', { exact: true })).toBeAttached();
  expect(await page.locator('.quota-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
  await page.getByText('Timed out', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('mobile-timeout.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('browser aborts a hanging dashboard request and enables retry', async ({ page }) => {
  await page.route('**/api/plugins/workbench/quotas?**', () => new Promise(() => {}));
  await page.goto('/sessions?profile=default');
  await page.getByRole('button', { name: 'Allowances', exact: true }).click();
  await expect(page.locator('.quota-dialog').getByRole('status')).toHaveText('Refresh failed · Retry available', { timeout: 15000 });
  await expect(page.locator('.quota-dialog').getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
});
