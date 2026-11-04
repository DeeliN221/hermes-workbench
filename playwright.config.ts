import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/acceptance',
  globalSetup: './tests/acceptance/setup.ts',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  outputDir: process.env.ACCEPTANCE_OUTPUT || 'test-results/real-stack',
  reporter: [['list'], ['json', { outputFile: 'test-results/real-stack/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:9120',
    browserName: 'chromium', locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce', serviceWorkers: 'block', screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: ['light', 'dark'].flatMap(colorScheme => [
    { name: `desktop-${colorScheme}`, use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: colorScheme as 'light' | 'dark' } },
    { name: `mobile-${colorScheme}`, use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: colorScheme as 'light' | 'dark' } },
  ]),
});
