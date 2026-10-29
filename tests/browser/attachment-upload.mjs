/** Exercise attachment drag-and-drop, folder selection and image previews. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const uploadDir = await mkdtemp(path.join(tmpdir(), 'workbench-upload-'));
try {
  await mkdir(path.join(uploadDir, 'project', 'sub'), { recursive: true });
  await writeFile(path.join(uploadDir, 'project', 'a.txt'), 'alpha');
  await writeFile(path.join(uploadDir, 'project', 'sub', 'b.txt'), 'beta');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await page.locator('.codex-composer-wrap').waitFor({ state: 'visible', timeout: 5000 });
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    document.querySelector('.codex-composer-wrap').dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
    );
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.codex-attachment-chip')]
    .some(node => node.textContent.includes('notes.txt')), null, { timeout: 5000 });
  await page.locator('input[name="attachment-folder"]').setInputFiles(path.join(uploadDir, 'project'));
  await page.waitForFunction(() => [...document.querySelectorAll('.codex-attachment-chip')]
    .some(node => node.textContent.includes('project') && node.textContent.includes('2 files')), null, { timeout: 5000 });
  await page.evaluate(() => {
    const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'preview.png', { type: 'image/png' }));
    document.querySelector('.codex-composer-wrap').dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
    );
  });
  const previewThumb = page.locator('.codex-attachment-preview-image').first();
  await previewThumb.waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await previewThumb.getAttribute('src') || '', /^blob:/, 'Composer image attachments must expose a thumbnail');
  await page.locator('.codex-send').click();
  const sentThumb = page.locator('.codex-message.is-user .codex-message-attachment').first();
  await sentThumb.waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(await sentThumb.evaluate(node => node.naturalWidth > 0), 'The sent user message must render a loaded thumbnail');
  assert.deepEqual(errors, [], `Browser errors in attachment upload:\n${errors.join('\n')}`);
  assert.deepEqual(await page.evaluate(() => window.__smokeErrors), [], 'Attachment upload must not report fixture errors');
  await page.close();
  console.log('Workbench attachment browser check passed: file drop, folder selection, composer thumbnail and sent-message thumbnail rendered without page errors.');
} finally {
  await browser.close();
  await host.close();
  await rm(uploadDir, { recursive: true, force: true });
}
