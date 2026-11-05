import { test, expect } from '@playwright/test';

const data = () => ({ providers: ['opencode', 'gemini', 'openai'].map(id => ({
  id, description: 'Plan unverified', name: id === 'openai' ? 'OpenAI ChatGPT Pro' : id === 'gemini' ? 'Gemini AI Pro' : 'OpenCode Go',
  service: id, plan: 'Test plan', adapter: id === 'openai' ? 'codex' : 'unsupported', enabled: true,
  status: id === 'openai' ? 'available' : 'unavailable',
  reason: id === 'openai' ? 'Codex allowance only; not a ChatGPT-wide balance.' : 'No verified quota connection. Check the provider console.',
  source: id === 'gemini' ? "agy -p '/usage' · Gemini Models" : id === 'opencode' ? 'OpenCode Go · GET /zen/go/v1/usage' : undefined,
  windows: id === 'openai' ? [{ minutes: 300, remainingPercent: 75, resetsAt: '2030-01-01T00:00:00Z' },
    { minutes: 10080, remainingPercent: 40, resetsAt: '2030-01-07T00:00:00Z' }] : [],
  updatedAt: id === 'openai' ? '2030-01-01T00:00:00Z' : null, checkedAt: '2030-01-01T00:00:00Z',
})), entries: ['opencode', 'gemini', 'openai'].map(id => ({
  id, name: id, service: id, plan: 'Test plan', adapter: id === 'openai' ? 'codex' : 'unsupported', preset: id,
  enabled: true, minutes: 300, resetsAt: null, amount: null, limit: null, mode: 'remaining', unit: 'credits', observedAt: null,
})), revision: 1, presets: [] });

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  const mobile = viewport.width < 800;
  const label = mobile ? 'mobile' : 'desktop';
  test.describe(label, () => {
    test.use({ viewport });

    test('settings navigation, models summary and compact allowance refresh', async ({ page }, info) => {
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
      await expect(nav.locator('[data-settings-group]')).toHaveCount(4);
      await expect(nav.locator('[data-settings-group]').first()).toHaveAttribute('data-settings-group', 'versions');
      await expect(nav.getByRole('link', { name: 'Version switching', exact: true })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'General settings', exact: true })).toHaveAttribute('aria-expanded', 'false');
      const more = nav.getByRole('button', { name: /More/ });
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      for (const href of ['/env', '/logs']) {
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
      await expect(panel.locator('.quota-row')).toHaveCount(3);
      await expect(panel.locator('.quota-row-summary')).toHaveText(['Unavailable', 'Unavailable', '5h 75% · Weekly 40%']);
      await expect(panel.locator('.quota-updated')).toHaveCount(1);
      await expect(panel.getByText('Source:', { exact: false })).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
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

    test('deep links keep current routes reachable without expanding More for versions', async ({ page }) => {
      for (const [url, name] of [['/env', 'Credentials'], ['/logs', 'Logs'], ['/config?workbench=versions', 'Version switching'], ['/config?workbench=settings', 'Version switching']]) {
        await page.goto(url);
        const nav = page.locator('.dashboard-settings-nav');
        await expect(nav.getByRole('link', { name, exact: true, includeHidden: true })).toHaveAttribute('aria-current', 'page');
        if (mobile) await page.getByRole('button', { name: '← Settings', exact: true }).click();
        await expect(nav.getByRole('button', { name: /More/ })).toHaveAttribute('aria-expanded', name === 'Version switching' ? 'false' : 'true');
        await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
      }
    });

    for (const color of ['light', 'dark'] as const) {
      test(`${color}: cached first paint, structured loading, compact rows and evidence`, async ({ page }) => {
        await page.addInitScript(theme => localStorage.setItem('hermes-dashboard-theme', `workbench-${theme}`), color);
        let release!: () => void;
        let request = 0;
        await page.route('**/api/plugins/workbench/quotas?**', async route => {
          request++;
          if (request === 1) await new Promise<void>(resolve => { release = resolve; });
          else await new Promise(resolve => setTimeout(resolve, 1500));
          await route.fulfill({ json: data() });
        });
        await page.goto('/config?workbench=allowances&profile=default');
        const panel = page.locator('.quota-settings');
        await expect(panel.locator('.quota-skeleton-row')).toHaveCount(3);
        await expect(panel.getByRole('status')).toHaveText('Loading subscriptions…');
        await page.screenshot({ path: `artifacts/subscription-allowances-compact/${label}-${color}-loading.png`, fullPage: true });
        release();
        await expect(panel.locator('.quota-row')).toHaveCount(3);
        await expect(panel.locator('.quota-updated')).toHaveText(/^Updated /);
        await page.screenshot({ path: `artifacts/subscription-allowances-compact/${label}-${color}-list.png`, fullPage: true });

        // A reload paints the persisted profile cache before the delayed request resolves.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('.quota-row')).toHaveCount(3, { timeout: 1000 });
        await expect(page.locator('.quota-updated')).toHaveText(/^Updated /);
        await expect(page.locator('.quota-statusline')).toContainText('Refreshing in background');
        await expect(page.locator('.quota-statusline')).toContainText('Refresh complete');
        await page.screenshot({ path: `artifacts/subscription-allowances-compact/${label}-${color}-cached.png`, fullPage: true });
      });
    }

    test('provider timeout, unavailable, failed refresh and inline retry', async ({ page }, info) => {
      let fail = false;
      const payload = data();
      payload.providers[0].status = 'timeout';
      payload.providers[0].reason = 'Quota refresh timed out. Retry later.';
      await page.route('**/api/plugins/workbench/quotas?**', route => route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : payload }));
      await page.goto('/config?workbench=allowances&profile=default');
      const panel = page.locator('.quota-settings');
      await expect(panel.locator('.quota-row-summary')).toHaveText(['Timed out', 'Unavailable', '5h 75% · Weekly 40%']);
      await expect(panel.getByText('75% remaining', { exact: true })).toHaveCount(0);
      await panel.getByRole('heading', { name: 'Subscription allowances' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${label}-timeout.png`) });
      fail = true;
      await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText(/^Refresh failed · Showing cached data/);
      await expect(panel.locator('.quota-error')).toContainText('Refresh failed');
      await expect(panel.locator('.quota-row-summary')).toHaveText(['Timed out', 'Unavailable', '5h 75% · Weekly 40%']);
      await page.screenshot({ path: info.outputPath(`${label}-error.png`) });
      fail = false;
      await panel.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText('Refresh complete · 1 of 3 providers available');
      await expect(panel.locator('.quota-row')).toHaveCount(3);
    });

    test('operation menu and detail drawer stay out of the default compact list', async ({ page }) => {
      await page.route('**/api/plugins/workbench/quotas?**', route => route.fulfill({ json: data() }));
      await page.goto('/config?workbench=allowances&profile=default');
      const panel = page.locator('.quota-settings');
      const first = panel.locator('.quota-row').first();
      await first.getByRole('button', { name: /Actions for/ }).click();
      await expect(first.getByRole('menuitem')).toHaveText(['Edit', 'Disable', 'Move up', 'Move down', 'Delete…']);
      await first.getByRole('button', { name: /OpenCode Go|openai|Actions for/ }).first().click();
      const drawer = panel.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText('Source:');
      await drawer.getByRole('button', { name: 'Delete…' }).click();
      await expect(drawer).toContainText('This cannot be undone');
      await drawer.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(drawer).not.toContainText('This cannot be undone');
      await drawer.getByRole('button', { name: 'Close details' }).click();
      await expect(drawer).toHaveCount(0);
    });

    test('hanging request times out and allows retry without a blank page', async ({ page }) => {
      test.setTimeout(35000);
      await page.route('**/api/plugins/workbench/quotas?**', () => new Promise(() => {}));
      await page.goto('/config?workbench=allowances&profile=default');
      const panel = page.locator('.quota-settings');
      await expect(panel.locator('.quota-skeleton-row')).toHaveCount(3);
      await expect(panel.getByRole('status')).toHaveText('Could not load subscriptions', { timeout: 25000 });
      await expect(panel.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
      await expect(panel.locator('.quota-subtitle')).toContainText('Unavailable does not mean zero.');
    });
  });
}
