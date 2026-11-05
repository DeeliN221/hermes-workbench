import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './auth-browser', workers: 1, use: { browserName: 'chromium', headless: true }, reporter: 'list' });
