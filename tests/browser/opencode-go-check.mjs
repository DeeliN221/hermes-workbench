import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const provider = {
  slug: 'opencode-go', name: 'OpenCode Go', authenticated: true,
  models: ['opencode-go/kimi-k3', 'opencode-go/deepseek-v4.1-flash'],
};
const modelOptions = {
  providers: [
    { slug: 'openai', name: 'OpenAI', authenticated: true, models: ['gpt-6.1-sol', 'gpt-6-astra'] },
    { slug: 'deepseek', name: 'DeepSeek', authenticated: true, models: ['deepseek/deepseek-flash'] },
  ],
  provider: 'openai', model: 'gpt-6.1-sol',
};
const opencodeModels = { data: [
  { id: 'opencode-go/kimi-k3', model: 'opencode-go/kimi-k3', displayName: 'Kimi K3', isDefault: false },
  { id: 'opencode-go/deepseek-v4.1-flash', model: 'opencode-go/deepseek-v4.1-flash', displayName: 'DeepSeek V4.1 Flash', isDefault: false },
] };
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      colorScheme: theme,
    });
    const errors = [];
    let saved = null;
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/api/model/options**', route => route.fulfill({ json: modelOptions }));
    await page.route('**/api/plugins/workbench/opencode/model-options**', route => route.fulfill({ json: provider }));
    await page.route('**/api/plugins/workbench/opencode/models**', route => route.fulfill({ json: opencodeModels }));
    await page.route('**/api/profiles/default/model', async route => {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto(host.origin + '/profiles?edit=default&section=model');
    await page.locator('.workbench-profile-editor').waitFor({ state: 'visible', timeout: 10000 });
    await page.evaluate(theme => {
      document.documentElement.dataset.workbenchTheme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, theme);
    const select = page.locator('.workbench-profile-editor select').first();
    await select.waitFor({ state: 'visible', timeout: 10000 });
    const options = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
    assert.ok(options.includes('opencode-go'), `OpenCode Go provider missing: ${options.join(',')}`);
    await select.selectOption('opencode-go');
    await page.locator('.workbench-profile-editor datalist option[value="opencode-go/kimi-k3"]').waitFor({ state: 'attached', timeout: 5000 });
    const models = await page.locator('.workbench-profile-editor datalist option').evaluateAll(nodes => nodes.map(node => node.value));
    assert.ok(models.includes('opencode-go/kimi-k3'), `OpenCode Go model missing: ${models.join(',')}`);
    await page.screenshot({ path: `/tmp/opencode-go-${mobile ? 'mobile' : 'desktop'}-${theme}.png`, fullPage: false });
    await page.locator('.workbench-profile-editor').getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.workbench-profile-editor').waitFor({ state: 'hidden' });
    assert.deepEqual(saved, { provider: 'opencode-go', model: 'opencode-go/kimi-k3' });
    assert.deepEqual(errors, [], 'no console/page errors');
    await page.close();
  }
  console.log('PASS: OpenCode Go provider and models visible in profile editor, desktop/mobile x light/dark, no console errors');
} finally {
  await browser.close();
  await host.close();
}

