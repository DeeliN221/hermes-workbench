import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const fixture = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/allowances/opencode-usage.json'), 'utf8'));
const gemini = fs.readFileSync(path.resolve('tests/fixtures/allowances/gemini-usage.tsv'), 'utf8').trim().split('\n')
  .map(row => row.split('\t')).filter(row => row[0] === 'Gemini Models')
  .map(row => ({ minutes: row[1].startsWith('Weekly') ? 10080 : 300, remainingPercent: Number(row[2].replace('%', '')), resetsAt: row[3] }));
const providers = () => [
  { id: 'gemini', name: 'Gemini AI Pro', source: "agy -p '/usage' · Gemini Models", windows: gemini },
  { id: 'opencode', name: 'OpenCode Go', source: 'OpenCode Go · GET /zen/go/v1/usage', windows:
    Object.entries(fixture.usage).map(([label, w]: [string, any]) => ({ minutes: label === 'rolling' ? 300 : label === 'weekly' ? 10080 : 43200,
      label: `${label[0].toUpperCase()}${label.slice(1)} window`, remainingPercent: 100 - w.percent, resetsAt: w.resetsAt })) },
].map(p => ({ ...p, service: p.name, plan: 'Fixture', adapter: 'unsupported', enabled: true, status: 'available',
  reason: p.id === 'opencode' ? 'Contract fixture · authenticated account not configured' : 'Captured agy TSV · Gemini Models only',
  updatedAt: '2026-11-02T11:04:04Z', checkedAt: '2026-11-02T11:04:04Z' }));

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(viewport.width < 800 ? 'mobile' : 'desktop', () => {
    test.use({ viewport });
    test('live providers success, actionable errors and refresh recovery', async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
      let failed = false;
      await page.route('**/api/plugins/workbench/quotas?**', async route => {
        await new Promise(resolve => setTimeout(resolve, 250));
        const values = providers();
        if (failed) for (const p of values) {
          p.status = p.id === 'gemini' ? 'timeout' : 'access_denied';
          p.reason = p.id === 'gemini' ? 'agy usage exceeded 20 seconds. Check login and Refresh.' :
            'OpenCode usage access denied (403). The provider or its edge may have blocked this request. Verify server connectivity and Go access, then Refresh.';
          p.windows = [];
        }
        await route.fulfill({ json: { providers: values } });
      });
      await page.goto('/config?workbench=allowances&profile=default');
      const panel = page.locator('.quota-settings');
      await expect(panel.getByRole('status')).toContainText('2 of 2');
      await expect(page).toHaveTitle('default');
      await expect(page).toHaveURL(/workbench=allowances/);
      await expect(panel.getByText('85% remaining')).toBeVisible();
      await expect(panel.getByText('75% remaining')).toBeVisible();
      await expect(panel.getByText('Monthly window', { exact: true })).toBeVisible();
      await expect(panel.getByText("Source: agy -p '/usage' · Gemini Models")).toBeVisible();
      await expect(panel.getByText('Claude', { exact: false })).toHaveCount(0);
      await panel.scrollIntoViewIfNeeded();
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('success.png'), fullPage: true });
      failed = true;
      const refresh = panel.getByRole('button', { name: 'Refresh', exact: true });
      await refresh.click();
      await expect(refresh).toBeDisabled();
      await expect(panel.getByRole('status')).toHaveText('Refreshing…');
      await expect(panel.getByText('Timed out', { exact: true })).toBeVisible();
      await expect(panel.getByText('Access denied', { exact: true })).toBeVisible();
      await expect(panel.getByText('OpenCode usage access denied (403).', { exact: false })).toBeVisible();
      await expect(panel.getByText('85% remaining')).toHaveCount(0);
      await expect(panel.getByText('75% remaining')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('errors.png'), fullPage: true });
      failed = false;
      await refresh.click();
      await expect(panel.getByRole('status')).toContainText('2 of 2');
      await expect(panel.getByText('100% remaining')).toBeVisible();
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      await expect(page.locator('#preview-errors')).toBeEmpty();
      expect(errors).toEqual([]);
    });
  });
}
