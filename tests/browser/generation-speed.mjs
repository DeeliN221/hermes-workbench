/** Browser plugin not available: validate the built app on localhost. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost({ host: 'localhost' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const evidence = process.env.WORKBENCH_SCREENSHOT_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
try {
  for (const theme of ['light', 'dark']) {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme: theme });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      let outputTokens = 84, activeSeconds = 2, samples = 3, turnStatus = 'running';
      await page.route('**/api/plugins/workbench/codex/session?*', async route => {
        const response = await route.fetch(), data = await response.json();
        for (const turn of data.turns || []) {
          turn.generationMetrics = { outputTokens, activeSeconds, samples, reasoningOutputTokens: 24 };
          turn.status = turnStatus;
          for (const item of turn.items || []) if (item.type === 'agentMessage') item.content = [{ type: 'text', text: 'The response is complete. Generation speed stays available below this turn.' }];
        }
        await route.fulfill({ response, json: data });
      });
      await page.route('**/api/plugins/workbench/codex/session/preview?*', async route => {
        const response = await route.fetch(), data = await response.json();
        for (const turn of data.turns || []) {
          turn.generationMetrics = { outputTokens, activeSeconds, samples, reasoningOutputTokens: 24 };
          for (const item of turn.items || []) if (item.type === 'agentMessage') item.content = [{ type: 'text', text: 'The response is complete. Generation speed stays available below this turn.' }];
        }
        await route.fulfill({ response, json: data });
      });
      const chat = host.origin + '/chat?session=codex-preview&profile=default';
      await page.request.put(host.origin + '/api/plugins/workbench/attachment-preferences?profile=default', { data: { folderUploadEnabled: false } });
      await page.goto(chat);
      await page.addStyleTag({ content: '#preview-banner { display: none; }' });
      assert.match(new URL(page.url()).hostname, /^localhost$/);
      assert.match(await page.title(), /Workbench|default/);
      await expect(page.locator('.codex-composer')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add folder', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Add attachment', exact: true })).toBeVisible();
      await expect(page.locator('.codex-model-summary')).not.toContainText(/standard|标准/i);
      await page.getByRole('button', { name: 'Chat options', exact: true }).click();
      const fast = page.getByRole('switch', { name: 'Fast mode', exact: true });
      await expect(fast).toBeEnabled();
      await fast.click();
      await expect(page.locator('.codex-model-summary')).toContainText('fast');
      await fast.click();
      await expect(page.locator('.codex-model-summary')).not.toContainText('fast');
      await fast.click();
      await page.getByRole('button', { name: 'Select model', exact: true }).click();
      await page.getByRole('button', { name: 'ds', exact: true }).click();
      await expect(fast).toBeDisabled();
      await expect(page.locator('.codex-model-summary')).not.toContainText(/fast|standard|标准/i);
      await page.keyboard.press('Escape');
      const chip = page.getByTestId('codex-generation-speed');
      await expect(chip).toHaveCount(1);
      if (mobile) await expect(chip).toBeHidden();
      else {
        await expect(chip.locator('summary')).toHaveText('42.0 tok/s');
        await chip.locator('summary').click();
        await expect(chip.getByRole('tooltip')).toContainText('84 output tokens / 2.00 s');
        await expect(chip.getByRole('tooltip')).toContainText('Includes 24 reasoning');
        await chip.locator('summary').click();
      }
      async function event(method, params, seq) {
        await page.evaluate(({ method, params, seq }) => {
          const socket = window.__previewSockets.findLast(socket => socket.readyState === 1 && socket.url.includes('codex'));
          if (!socket) throw new Error('Missing Codex realtime socket');
          socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'event', method, payload: { method, params }, seq }) }));
        }, { method, params, seq });
      }
      await event('token_usage_record', { turnId: 'preview-turn', generationMetrics: { turnId: 'preview-turn', outputTokens: 168, activeSeconds: 3, samples: 4, reasoningOutputTokens: 24 } }, 10000);
      await expect(chip.locator('summary')).toHaveText('56.0 tok/s');
      await event('turn/completed', { turn: { id: 'preview-turn', status: 'completed' } }, 10001);
      await expect(chip.locator('summary')).toHaveText('56.0 tok/s');
      outputTokens = 168; activeSeconds = 3; samples = 4; turnStatus = 'completed';
      await page.reload();
      await expect(chip.locator('summary')).toHaveText('56.0 tok/s');
      await expect(page.getByText('The response is complete. Generation speed stays available below this turn.', { exact: true })).toBeVisible();
      await page.evaluate(theme => document.documentElement.dataset.workbenchTheme = theme, theme);
      await page.addStyleTag({ content: '#preview-banner { display: none; }' });
      if (evidence) await page.screenshot({ path: `${evidence}/${mobile ? 'mobile' : 'desktop'}-${theme}.png` });
      await event('token_usage_record', { turnId: 'preview-turn', generationMetrics: { turnId: 'preview-turn', outputTokens: 1, activeSeconds: .01, samples: 1 } }, 10002);
      await expect(chip.locator('summary')).toHaveText('—');
      await page.goto(host.origin + '/config?workbench=display&profile=default');
      const toggle = page.getByTestId('folder-upload-toggle');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(toggle).toBeEnabled();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await page.reload();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await page.goto(chat);
      await page.addStyleTag({ content: '#preview-banner { display: none; }' });
      await expect(page.getByRole('button', { name: 'Add folder', exact: true })).toBeVisible();
      await page.locator('input[name="attachments"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
      await expect(page.locator('.codex-attachment-chip')).toContainText('notes.txt');
      // Disabling only removes the picker, leaving existing attachments intact.
      await page.request.put(host.origin + '/api/plugins/workbench/attachment-preferences?profile=default', { data: { folderUploadEnabled: false } });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('workbench:attachment-preferences-change', { detail: { profile: 'default', enabled: false } })));
      await expect(page.getByRole('button', { name: 'Add folder', exact: true })).toHaveCount(0);
      await expect(page.locator('.codex-attachment-chip')).toContainText('notes.txt');
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__smokeErrors), []);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log('PASS localhost desktop/mobile light/dark: live/final TPS, reload, insufficient samples, tooltip, fast mode, folder settings and ordinary upload.');
} finally { await browser.close(); await host.close(); }
