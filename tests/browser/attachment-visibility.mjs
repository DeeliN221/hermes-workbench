import { openSecondSession } from './navigation-helpers.mjs';
/** Real uploads, bridge persistence and history projection; deterministic agent peer. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createMockHost } from './mock-host.mjs';

const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const headers = { 'x-hermes-proxy-secret': 'local-proxy-secret', 'remote-user': 'preview' };
const env = { ...process.env, HERMES_DASHBOARD_TRUSTED_PROXY_SECRET: headers['x-hermes-proxy-secret'], HERMES_WORKBENCH_ALLOWED_USERS: 'preview' };
delete env.CODEX_HOME;
delete env.CODEX_APP_SERVER_ENDPOINT;
const backend = spawn('uv', ['run', '--no-project', '--with-requirements', 'requirements-dev.txt', 'python', '-m', 'uvicorn',
  'attachment-bridge-app:app', '--app-dir', 'tests/fixtures', '--host', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
backend.stdout.on('data', data => logs += data);
backend.stderr.on('data', data => logs += data);
const directory = await mkdtemp(path.join(tmpdir(), 'attachment-input-'));
const shots = process.env.SHOT_DIR;
let host, browser, page;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(origin + '/api/plugins/workbench/qa/attachments', { headers })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  assert.equal((await fetch(origin + '/api/plugins/workbench/qa/attachments')).status, 401);
  host = await createMockHost({ host: 'localhost', codexProxyOrigin: origin });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // The legacy Hermes search fixture is unrelated to this Codex test.
  await page.route('**/api/sessions/search?**', route => route.fulfill({ json: { results: [] } }));
  await mkdir(path.join(directory, 'project', 'sub'), { recursive: true });
  await writeFile(path.join(directory, 'project', 'sub', 'notes.txt'), 'Folder content');
  const png = await readFile(new URL('../fixtures/attachment-diagram.png', import.meta.url));
  const image = { name: 'diagram.png', mimeType: 'image/png', buffer: png };
  const file = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('File content') };
  const url = host.origin + '/chat?session=codex-preview&profile=default';
  await page.request.put(host.origin + '/api/plugins/workbench/attachment-preferences?profile=default', { data: { folderUploadEnabled: true } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.match(await page.title(), /Workbench local preview|default/);
  assert.match(page.url(), /localhost/);
  await page.locator('.codex-composer-wrap').waitFor();
  const messages = page.locator('.codex-message.is-user');
  async function clean() {
    const text = await messages.allTextContents();
    assert.ok(text.every(value => !/Path:|Image attachment:|User attachment|Read only what|Please review the attachment/.test(value)), text.join('\n'));
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__smokeErrors), []);
  }
  async function send(text, files, folder = false) {
    if (files.length) await page.locator('input[name="attachments"]').setInputFiles(files);
    if (folder) await page.locator('input[name="attachment-folder"]').setInputFiles(path.join(directory, 'project'));
    await page.locator('.codex-composer textarea').fill(text);
    const sent = page.waitForResponse(response => response.request().method() === 'POST' && /\/session\?/.test(response.url()));
    await page.locator('.codex-send').click();
    assert.equal((await sent).status(), 200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.codex-composer-wrap').waitFor();
    await page.waitForFunction(expected => ([...document.querySelectorAll('.codex-message.is-user')].at(-1)?.querySelector('.codex-message-body')?.textContent || '') === expected, text);
    assert.equal(await messages.last().locator('.codex-message-body').count() ? await messages.last().locator('.codex-message-body').textContent() : '', text);
    await clean();
  }
  await send('Please inspect this image.', [image]);
  await page.waitForFunction(() => document.querySelector('.codex-message-attachment')?.naturalWidth > 0);
  await send('Read the attached notes.', [file]);
  assert.match(await messages.last().innerText(), /notes.txt/);
  await send('Review this folder.', [], true);
  assert.match(await messages.last().innerText(), /project.*1 file/s);
  await send('Compare the image, file and folder.', [image, file], true);
  // Authenticated image loading initially renders a file placeholder. Wait for
  // the image projection before asserting the two remaining file/folder cards.
  await expect(messages.last().locator('.codex-message-attachment')).toHaveCount(1);
  await expect(messages.last().locator('.codex-message-file')).toHaveCount(2);
  await send('', [file]);
  const evidence = await (await fetch(origin + '/api/plugins/workbench/qa/attachments', { headers })).json();
  assert.equal(evidence.requests, 5);
  assert.equal(evidence.hiddenContexts, 5);
  assert.equal(evidence.readAttachments.length, 7);
  assert.equal(evidence.visibleTexts.at(-1), '');
  if (shots) {
    await mkdir(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { localStorage.setItem('hermes-dashboard-theme', theme); document.documentElement.dataset.theme = theme; }, theme);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.codex-composer-wrap').waitFor();
        await messages.last().scrollIntoViewIfNeeded();
        await clean();
        await page.screenshot({ path: `${shots}/attachments-${name}-${theme}.png` });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The existing project sidebar keeps this dialog trigger in the collapsed pane navigation.
  await page.evaluate(() => document.querySelector('.codex-session-search-trigger')?.click());
  await page.locator('input[name="session-search"]').fill('Compare the image');
  const snippet = page.locator('.codex-session-search-result-snippet');
  await snippet.first().waitFor();
  assert.match(await snippet.first().innerText(), /Compare the image, file and folder/);
  assert.doesNotMatch(await page.locator('.codex-session-search-dialog').innerText(), /Path:|private native search/);
  if (shots) await page.screenshot({ path: `${shots}/attachments-search.png` });
  await page.locator('input[name="session-search"]').fill('.workbench-attachments');
  await page.locator('.codex-session-search-results').getByText('No matching sessions or tasks', { exact: true }).waitFor();
  await page.locator('.codex-session-search-close').click();
  await openSecondSession(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.codex-message.is-user .codex-message-body')].some(node => node.textContent === 'Original legacy message.'));
  const legacy = page.locator('.codex-pane-slot').filter({ hasText: 'Original legacy message.' });
  assert.equal(await legacy.locator('.codex-message.is-user .codex-message-body').textContent(), 'Original legacy message.');
  await page.waitForFunction(() => document.querySelector('.codex-message-attachment')?.naturalWidth > 0);
  await clean();
  if (shots) await page.screenshot({ path: `${shots}/attachments-legacy.png` });
  assert.deepEqual(errors, []);
  console.log('PASS: real image/file/folder/mixed uploads, attachment-only input, hidden SQLite context, agent file reads, reload, legacy history, search, desktop/mobile and light/dark.');
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(error);
  console.error(logs);
  await page?.screenshot({ path: "/tmp/attachment-browser-failure.png" }).catch(() => {});
  throw error;
} finally {
  await page?.unrouteAll({ behavior: "ignoreErrors" });
  await browser?.close();
  await host?.close();
  backend.kill('SIGTERM');
  await new Promise(resolve => { if (backend.exitCode !== null) return resolve(); backend.once('exit', resolve); setTimeout(() => { backend.kill('SIGKILL'); resolve(); }, 3000).unref(); });
  await rm(directory, { recursive: true, force: true });
}
