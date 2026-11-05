import { test, expect } from '@playwright/test';
import { build } from 'vite';

for (const failure of [401, 302]) test(`browser polling pauses on ${failure} and manual retry recovers without navigation`, async ({ page }) => {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false,
    lib: { entry: 'dashboard/src/auth-polling.ts', name: 'AuthGuard', formats: ['iife'] } } });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing browser test bundle');
  const compiled = output.output.find(item => item.type === 'chunk')!;

  let valid = false, requests = 0, navigations = 0;
  await page.route('http://auth.test/**', route => {
    if (route.request().url().includes('/api/')) {
      requests++;
      return route.fulfill({ status: valid ? 200 : failure, headers: !valid && failure === 302 ? { location: '/login' } : {}, contentType: 'application/json', body: JSON.stringify(valid ? { ok: true } : { code: 'auth_required' }) });
    }
    return route.fulfill({ contentType: 'text/html', body: '<body>Workbench</body>' });
  });
  await page.goto('http://auth.test/');
  page.on('framenavigated', () => navigations++);
  await page.addScriptTag({ content: compiled.code + ';AuthGuard.installAuthPollingGuard();' });
  await page.evaluate(() => {
    localStorage.setItem('session', 'preserve');
    (window as any).poll = setInterval(() => fetch('/api/plugins/workbench/versions/update-status').catch(() => {}), 30);
  });
  await expect(page.getByRole('alert')).toHaveCount(1);
  await page.waitForTimeout(150); // Allow requests already in flight at expiry to settle.
  const stoppedAt = requests;
  expect(stoppedAt).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  expect(requests).toBe(stoppedAt);
  await page.getByRole('button', { name: '手动重试' }).click();
  await page.waitForTimeout(150);
  expect(requests).toBe(stoppedAt + 1);
  await expect(page.getByRole('alert')).toHaveCount(1);
  valid = true;
  await page.getByRole('button', { name: '手动重试' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => requests).toBeGreaterThan(stoppedAt + 2);
  expect(navigations).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('session'))).toBe('preserve');
  await page.evaluate(() => clearInterval((window as any).poll));
});
