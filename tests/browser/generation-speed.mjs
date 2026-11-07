/** Browser plugin not available: validate the built app on localhost. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';

// Use the production collector, so the browser cannot pass with a timing basis
// that the backend never produces (the original permanent-dash regression).
const measured = JSON.parse(execFileSync('python3', ['-c', `
import json, sqlite3, sys
sys.path.insert(0, 'dashboard')
from generation_metrics import install_schema, observe
c = sqlite3.connect(':memory:')
install_schema(c)
def event(method, seconds, **params):
    return observe(c, ('preview', 'default', 'session'), method, {
        'emittedAtMs': 1800000000000 + seconds * 1000,
        'params': {'turnId': 'preview-turn', **params}}, 1800000000)
def usage(seconds, output):
    return event('thread/tokenUsage/updated', seconds, tokenUsage={
        'total': {'outputTokens': output, 'reasoningOutputTokens': 24},
        'last': {'outputTokens': 84, 'reasoningOutputTokens': 24}})
event('turn/started', 0)
initial = usage(2, 84)
event('item/started', 2, item={'id': 'tool', 'type': 'commandExecution'})
event('item/completed', 100, item={'id': 'tool', 'type': 'commandExecution'})
updated = usage(101, 168)
completed = event('turn/completed', 102)
assert initial['tokensPerSecond'] == 42 and updated['tokensPerSecond'] == 56
print(json.dumps(dict(initial=initial, updated=updated, completed=completed)))
`], { encoding: 'utf8', cwd: new URL('../..', import.meta.url) }));

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
      const displayPreferences = host.origin + '/api/plugins/workbench/chat-display-preferences?profile=default';
      await page.request.put(displayPreferences, { data: { generationSpeedEnabled: false, userMessageNavigatorEnabled: false } });
      let generationMetrics = measured.initial, turnStatus = 'running';
      await page.route('**/api/plugins/workbench/codex/session?*', async route => {
        const response = await route.fetch(), data = await response.json();
        for (const turn of data.turns || []) {
          turn.generationMetrics = generationMetrics;
          turn.status = turnStatus;
          for (const item of turn.items || []) if (item.type === 'agentMessage') item.content = [{ type: 'text', text: 'The response is complete. Generation speed stays available below this turn.' }];
        }
        await route.fulfill({ response, json: data });
      });
      await page.route('**/api/plugins/workbench/codex/session/preview?*', async route => {
        const response = await route.fetch(), data = await response.json();
        for (const turn of data.turns || []) {
          turn.generationMetrics = generationMetrics;
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
      await expect(page.getByTestId('codex-generation-speed')).toHaveCount(0);
      await expect(page.getByTestId('mobile-generation-speed')).toHaveCount(0);
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
      await page.goto(host.origin + '/config?workbench=display&profile=default');
      const tpsToggle = page.getByTestId('generation-speed-toggle');
      await expect(tpsToggle).toHaveAttribute('aria-checked', 'false');
      await expect(tpsToggle).toBeEnabled();
      await tpsToggle.click();
      await expect(tpsToggle).toHaveAttribute('aria-checked', 'true');
      await page.goto(chat);
      await page.addStyleTag({ content: '#preview-banner { display: none; }' });
      await expect(page.locator('.codex-composer')).toBeVisible();
      const chip = page.getByTestId('codex-generation-speed');
      await expect(chip).toHaveCount(1);
      await expect(page.locator('.codex-center-header .codex-generation-speed')).toHaveCount(0);
      await expect(page.locator('.codex-conversation-dock > .codex-generation-speed')).toHaveCount(1);
      assert.deepEqual(await page.locator('.codex-center-header').evaluate(node => [...node.children].map(child => child.className)), ['codex-center-title']);
      await expect(page.locator('.codex-pane-close')).toHaveCount(0);
      await expect(chip).toBeHidden();
      await expect(chip.locator('summary')).toHaveText('≈42.0 tok/s');
      if (mobile) {
        const railSpeed = page.getByTestId('mobile-generation-speed');
        await expect(railSpeed).toBeVisible();
        await expect(railSpeed).toContainText('42.0');
        await expect(railSpeed).toHaveAttribute('title', /Estimated speed/);
        await expect(railSpeed).toHaveAttribute('title', /84 output tokens \/ 2.00 s/);
        await expect(railSpeed).toHaveAttribute('title', /Includes 24 reasoning/);
      } else {
        await expect(page.getByTestId('mobile-generation-speed')).toHaveCount(0);
      }
      const composerBox = await page.locator('.codex-composer-wrap').boundingBox();
      const messagesBox = await page.locator('.codex-message-list').boundingBox();
      const dockBox = await page.locator('.codex-conversation-dock').boundingBox();
      assert.equal(dockBox.height, 0, 'TPS must not reserve a full-width row');
      assert.ok(Math.abs(messagesBox.y + messagesBox.height - composerBox.y) < 1, 'Transcript reaches the composer without a blank TPS strip');
      async function event(method, params, seq) {
        await page.evaluate(({ method, params, seq }) => {
          const socket = window.__previewSockets.findLast(socket => socket.readyState === 1 && socket.url.includes('codex'));
          if (!socket) throw new Error('Missing Codex realtime socket');
          socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'event', method, payload: { method, params }, seq }) }));
        }, { method, params, seq });
      }
      await event('thread/tokenUsage/updated', { turnId: 'preview-turn', generationMetrics: measured.updated }, 10000);
      await expect(chip.locator('summary')).toHaveText('≈56.0 tok/s');
      if (mobile) await expect(page.getByTestId('mobile-generation-speed')).toContainText('56.0');
      await event('turn/completed', { turn: { id: 'preview-turn', status: 'completed' }, generationMetrics: measured.completed }, 10001);
      await expect(chip.locator('summary')).toHaveText('≈56.0 tok/s');
      await event('token_usage_record', { turnId: 'preview-turn', generationMetrics: { turnId: 'preview-turn', outputTokens: 168, activeSeconds: 3, samples: 4, timingBasis: 'observed-event-gaps' } }, 10002);
      await expect(chip.locator('summary')).toHaveText('—');
      await expect(chip.locator('summary')).toHaveAttribute('title', /TPS is unavailable/);
      generationMetrics = measured.completed; turnStatus = 'completed';
      await page.reload();
      await expect(chip.locator('summary')).toHaveText('≈56.0 tok/s');
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
  console.log('PASS localhost desktop/mobile light/dark: TPS hidden on desktop, optional mobile rail TPS, reload, insufficient samples, fast mode, folder settings and ordinary upload.');
} finally { await browser.close(); await host.close(); }
