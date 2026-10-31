import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: './browser', testMatch: 'quota-dashboard.spec.ts', workers: 1,
  outputDir: '../test-results/quota', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4179', browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    trace: 'retain-on-failure' },
  webServer: { cwd: path.resolve(__dirname, '..'), command: 'node scripts/preview-local.mjs', env: { WORKBENCH_PREVIEW_PORT: '4179' },
    url: 'http://127.0.0.1:4179/sessions?profile=default', reuseExistingServer: false },
});
