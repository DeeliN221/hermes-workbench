import { test, expect } from '@playwright/test';
const data = () => ({ providers: ['opencode', 'gemini', 'openai'].map(id => ({
  id, description: 'Plan unverified', name: id, service: id, plan: 'Test plan', adapter: id === 'openai' ? 'codex' : 'unsupported', enabled: true, status: id === 'openai' ? 'available' : 'unavailable',
  reason: id === 'openai' ? 'Codex allowance only; not a ChatGPT-wide balance.' : 'No verified quota connection. Check the provider console.',
  windows: id === 'openai' ? [{ minutes: 300, remainingPercent: 75, resetsAt: '2030-01-01T00:00:00Z' },
    { minutes: 10080, remainingPercent: 40, resetsAt: '2030-01-07T00:00:00Z' }] : [],
  updatedAt: id === 'openai' ? '2030-01-01T00:00:00Z' : null, checkedAt: '2030-01-01T00:00:00Z',
})) });

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  const mobile = viewport.width < 800;
  const label = mobile ? 'mobile' : 'desktop';
  test.describe(label, () => {
    test.use({ viewport });
    test('settings navigation, models summary, home entry and allowance refresh', async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      let count = 0;
      await page.route('**/api/plugins/workbench/quotas?**', async route => {
        count++;
        if (count > 1) expect(new URL(route.request().url()).searchParams.get('refresh')).toBe('true');
        await new Promise(resolve => setTimeout(resolve, 150));
        await route.fulfill({ json: data() });
      });
      for (const url of ['/sessions?profile=default', '/sessions?profile=default&view=recent']) {
        await page.goto(url);
        await expect(page.locator('.dashboard-owned-page')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Allowances', exact: true })).toHaveCount(0);
        await expect(page.locator('[data-quota-open]')).toHaveCount(0);
      }
      await page.screenshot({ path: info.outputPath(`${label}-home.png`) });
      await page.goto('/config?profile=default');
      const nav = page.locator('.dashboard-settings-nav');
      await expect(nav).toBeVisible();
      await expect(nav.locator('[data-settings-group]')).toHaveCount(3);
      const more = nav.getByRole('button', { name: /More/ });
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      for (const href of ['/env', '/logs', '/config?workbench=versions']) {
        await expect(nav.locator(`[data-settings-group="more"] a[href^="${href}"]`)).toBeHidden();
      }
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await expect(nav.getByRole('link', { name: 'Credentials', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Version switching', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Logs', exact: true })).toBeVisible();
      await more.click();
      await page.screenshot({ path: info.outputPath(`${label}-settings.png`) });
      await nav.getByRole('link', { name: 'Models', exact: true }).click();
      await expect(page).toHaveURL(/\/models\?/);
      // The mock host serves native route fixtures on navigation, not through React Router.
      await page.reload();
      await expect(page.getByText('Models used', { exact: true })).toBeVisible();
      await expect(page.getByText('Total sessions', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Configure models' })).toBeVisible();
      await expect(page.getByText('Token & cost analytics are hidden', { exact: false })).toBeHidden();
      await page.screenshot({ path: info.outputPath(`${label}-models.png`) });
      if (mobile) await page.getByRole('button', { name: '← Settings', exact: true }).click();
      await nav.getByRole('link', { name: 'Subscription allowances', exact: true }).click();
      await expect(page).toHaveURL(/workbench=allowances/);
      const panel = page.locator('.quota-settings');
      await expect(panel.getByRole('status')).toHaveText('Refresh complete · 1 of 3 providers available');
      await expect(panel.locator('.quota-card')).toHaveCount(3);
      await expect(panel.getByText('75% remaining')).toBeVisible();
      await expect(panel.getByText('40% remaining')).toBeVisible();
      await expect(panel.locator('small').filter({ hasText: /^Reset:.*2030/ })).toHaveCount(2);
      const refresh = panel.getByRole('button', { name: 'Refresh', exact: true });
      await refresh.click();
      await expect(refresh).toBeDisabled();
      await expect(panel.getByRole('status')).toHaveText('Refresh complete · 1 of 3 providers available');
      expect(count).toBe(2);
      if (mobile) await panel.getByRole('heading', { name: 'Subscription allowances' }).scrollIntoViewIfNeeded();
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${label}-allowances.png`) });
      await expect(page).toHaveTitle('default');
      await expect(page.locator('#preview-errors')).toBeEmpty();
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      expect(errors).toEqual([]);
      if (mobile) {
        await page.getByRole('button', { name: '← Settings', exact: true }).click();
        await expect(nav).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Subscription allowances' })).toBeFocused();
      }
    });

    test('deep links keep More expanded and current routes reachable', async ({ page }) => {
      for (const [url, name] of [['/env', 'Credentials'], ['/logs', 'Logs'], ['/config?workbench=versions', 'Version switching'], ['/config?workbench=settings', 'Version switching']]) {
        await page.goto(url);
        const nav = page.locator('.dashboard-settings-nav');
        await expect(nav.getByRole('link', { name, exact: true, includeHidden: true })).toHaveAttribute('aria-current', 'page');
        if (mobile) await page.getByRole('button', { name: '← Settings', exact: true }).click();
        await expect(nav.getByRole('button', { name: /More/ })).toHaveAttribute('aria-expanded', 'true');
        await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
      }
    });

    test('provider timeout, unavailable, failed refresh and retry', async ({ page }, info) => {
      let fail = false;
      const payload = data();
      payload.providers[0].status = 'timeout';
      payload.providers[0].reason = 'Quota refresh timed out. Retry later.';
      await page.route('**/api/plugins/workbench/quotas?**', route => route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : payload }));
      await page.goto('/config?workbench=allowances&profile=default');
      const panel = page.locator('.quota-settings');
      await expect(panel.getByText('Timed out', { exact: true })).toBeVisible();
      await expect(panel.getByText('75% remaining')).toBeVisible();
      await expect(panel.getByText('Unavailable', { exact: true }).first()).toBeVisible();
      await panel.getByRole('heading', { name: 'Subscription allowances' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${label}-timeout.png`) });
      fail = true;
      await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText('Refresh failed · Retry available');
      await expect(panel.getByText('75% remaining')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${label}-error.png`) });
      fail = false;
      await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(panel.getByText('75% remaining')).toBeVisible();
    });

    test('hanging request times out and allows retry', async ({ page }) => {
      await page.route('**/api/plugins/workbench/quotas?**', () => new Promise(() => {}));
      await page.goto('/config?workbench=allowances&profile=default');
      const panel = page.locator('.quota-settings');
      await expect(panel.getByRole('status')).toHaveText('Refresh failed · Retry available', { timeout: 15000 });
      await expect(panel.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    });
  });
}
