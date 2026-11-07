/** Actual standalone bundle + host API; two isolated browsers share server state. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const state = await mkdtemp(path.join(tmpdir(), 'workbench-model-sync-'));
const shots = path.resolve(process.env.SHOT_DIR || 'node_modules/.cache/session-model-sync');
await mkdir(shots, { recursive: true });
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const baseline = process.env.MODEL_BASELINE_ASSETS;
const env = { ...process.env, WORKBENCH_AUTH_MODE: 'local' };
delete env.WORKBENCH_RUNTIME_BRIDGE_TOKEN_FILE;
delete env.WORKBENCH_RUNTIME_TOKEN;
const server = spawn('uv', ['run', '--no-project', '--with-requirements', 'requirements-dev.txt', 'python', 'tests/browser/session-model-host.py', '--state', state, '--port', String(port), ...(baseline ? ['--assets', baseline] : [])], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
let browser;
const evidence = { fixture: 'Real standalone host, neutral protocol runtime fixture; no provider/model invocation', cases: [] };
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  let token;
  await expect(async () => {
    token = (await readFile(path.join(state, 'host/bootstrap-token'), 'utf8')).trim();
    const response = await fetch(origin + '/api/runtime/models');
    assert.equal(response.status, 401);
  }).toPass({ timeout: 30000 });
  const newDevice = async (mobile = false) => {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light' });
    const result = await context.request.post(origin + '/api/standalone/bootstrap', { headers: { Authorization: 'Bearer ' + token, 'X-Workbench-Request': '1' } });
    assert.equal(result.status(), 200);
    return context;
  };
  const first = await newDevice(), second = await newDevice(true);
  const api = first.request;
  const headers = { 'X-Workbench-Request': '1' };
  assert.equal((await api.put(origin + '/api/config', { headers, data: { model: 'model-alpha', agent: { reasoning_effort: 'low' } } })).status(), 200);
  const create = async model => {
    const result = await api.post(origin + '/api/runtime/sessions', { headers, data: { profile_id: 'default', model, reasoning_effort: 'low' } });
    assert.equal(result.status(), 200, await result.text());
    return (await result.json()).id;
  };
  const a = await create('model-alpha'), b = await create('model-gamma');
  const page = await first.newPage(), peer = await second.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  peer.on('pageerror', error => errors.push(String(error)));
  const url = id => origin + '/chat?profile=default&session=' + encodeURIComponent(id);
  const pane = page => page.locator('.codex-pane-slot.is-active');
  const summary = page => pane(page).locator('.codex-model-summary');
  const choose = async (page, label) => {
    const options = pane(page).getByRole('button', { name: 'Chat options', exact: true });
    if (!(await pane(page).getByRole('dialog', { name: 'Chat options', exact: true }).isVisible())) await options.click();
    const modelButton = pane(page).getByRole('button', { name: 'Select model', exact: true });
    if (await modelButton.isVisible()) await modelButton.click();
    await pane(page).getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
  };
  const model = async id => (await (await api.get(origin + `/api/runtime/sessions/${id}/snapshot?profile_id=default`)).json()).session.model;
  await Promise.all([page.goto(url(a)), peer.goto(url(a))]);
  await expect(summary(page)).toContainText('Model Alpha');
  await choose(page, 'Model Beta');
  await expect(summary(page)).toContainText('Model Beta');
  if (baseline) {
    await page.reload();
    await expect(summary(page)).toContainText('Model Alpha');
    assert.equal(await model(a), 'model-alpha');
    await page.screenshot({ path: path.join(shots, 'before-desktop-light.png'), fullPage: true });
    evidence.cases.push('Baseline reproduces: an unsent model choice disappears after refresh');
  } else {
    await expect.poll(() => model(a)).toBe('model-beta');
    await expect(summary(peer)).toContainText('Model Beta');
    await page.reload();
    await expect(summary(page)).toContainText('Model Beta');
    await page.screenshot({ path: path.join(shots, 'after-desktop-light.png'), fullPage: true });
    await peer.screenshot({ path: path.join(shots, 'after-mobile-light.png'), fullPage: true });
    await page.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'dark'; });
    await peer.evaluate(() => { document.documentElement.dataset.workbenchTheme = 'dark'; });
    await page.screenshot({ path: path.join(shots, 'after-desktop-dark.png'), fullPage: true });
    await peer.screenshot({ path: path.join(shots, 'after-mobile-dark.png'), fullPage: true });
    evidence.cases.push('Selection saved before a message; second isolated context updates live; refresh preserves it');
    let releaseCatalog, capturedCatalog;
    const catalogHold = new Promise(resolve => { releaseCatalog = resolve; });
    const catalogSeen = new Promise(resolve => { capturedCatalog = resolve; });
    await page.route('**/api/runtime/models', async route => {
      const response = await route.fetch(); capturedCatalog(); await catalogHold; await route.fulfill({ response });
    });
    await page.reload(); await catalogSeen;
    await expect(summary(page)).toContainText('model-beta');
    releaseCatalog();
    await expect(summary(page)).toContainText('Model Beta');
    await page.unroute('**/api/runtime/models');
    evidence.cases.push('A late model catalog keeps the conversation model instead of restoring the profile default');
    await page.goto(url(b));
    await expect(summary(page)).toContainText('Model Gamma');
    await page.goto(url(a));
    await expect(summary(page)).toContainText('Model Beta');
    assert.equal(await model(b), 'model-gamma');
    evidence.cases.push('Two conversations retain different models when navigating away and back');

    // A real server response is delayed after being read; no mocked model value.
    let releaseSnapshot, snapshotCaptured;
    const held = new Promise(resolve => { releaseSnapshot = resolve; });
    const captured = new Promise(resolve => { snapshotCaptured = resolve; });
    let holdOne = true;
    await page.route('**/api/runtime/sessions/*/snapshot?*', async route => {
      const response = await route.fetch();
      if (holdOne) { holdOne = false; snapshotCaptured(); await held; }
      await route.fulfill({ response });
    });
    await page.reload(); await captured;
    await choose(page, 'Model Gamma');
    await expect.poll(() => model(a)).toBe('model-gamma');
    releaseSnapshot();
    await expect(summary(page)).toContainText('Model Gamma');
    await page.unroute('**/api/runtime/sessions/*/snapshot?*');
    evidence.cases.push('A late snapshot cannot overwrite a more recent saved selection');

    let releaseWrite, capturedWrite;
    const writeHold = new Promise(resolve => { releaseWrite = resolve; });
    const writeSeen = new Promise(resolve => { capturedWrite = resolve; });
    let holdWrite = true;
    await page.route('**/api/runtime/sessions/*/model?*', async route => {
      const response = await route.fetch();
      if (holdWrite) { holdWrite = false; capturedWrite(); await writeHold; }
      await route.fulfill({ response });
    });
    await choose(page, 'Model Alpha'); await writeSeen;
    await choose(page, 'Model Beta');
    await expect(summary(page)).toContainText('Model Beta');
    releaseWrite();
    await expect.poll(() => model(a)).toBe('model-beta');
    await expect(summary(page)).toContainText('Model Beta');
    await page.unroute('**/api/runtime/sessions/*/model?*');
    evidence.cases.push('Rapid choices remain ordered while the first save acknowledgement is delayed');

    await choose(page, 'Model Gamma');
    await expect.poll(() => model(a)).toBe('model-gamma');
    await api.post(origin + '/__fixture/control', { data: { fail: true } });
    await choose(page, 'Model Beta');
    await expect(page.getByText(/Model settings were not saved/)).toBeVisible();
    await expect(summary(page)).toContainText('Model Beta');
    const input = pane(page).locator('.codex-composer [contenteditable="true"], .codex-composer textarea').first();
    await input.fill('This message must not use a fallback model');
    await pane(page).getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForTimeout(300);
    await expect.poll(async () => (await (await api.get(origin + `/api/runtime/sessions/${a}/snapshot`)).json()).messages.length).toBe(0);
    assert.equal(await model(a), 'model-gamma');
    await api.post(origin + '/__fixture/control', { data: { fail: false } });
    await choose(page, 'Model Beta');
    await expect.poll(() => model(a)).toBe('model-beta');
    evidence.cases.push('Failed save preserves the visible choice, exposes the error and prevents a message with the default model');

    const third = await newDevice(), reopened = await third.newPage();
    await reopened.goto(url(a));
    await expect(summary(reopened)).toContainText('Model Beta');
    await third.close();
    evidence.cases.push('A fresh browser context restores the server selection without sharing localStorage');
    const draftContext = await newDevice(), draft = await draftContext.newPage();
    await draft.goto(origin + '/chat?profile=default&new=1');
    await expect(summary(draft)).toContainText('Model Alpha');
    const beforeDraft = (await (await api.get(origin + '/api/runtime/sessions')).json()).length;
    await choose(draft, 'Model Gamma');
    assert.equal((await (await api.get(origin + '/api/runtime/sessions')).json()).length, beforeDraft);
    const created = draft.waitForResponse(response => new URL(response.url()).pathname === '/api/runtime/sessions' && response.request().method() === 'POST');
    const composer = pane(draft).locator('.codex-composer [contenteditable="true"], .codex-composer textarea').first();
    await composer.fill('Remember the model chosen before creating this conversation');
    await pane(draft).getByRole('button', { name: 'Send', exact: true }).click();
    const creationResponse = await created;
    assert.equal(Object.hasOwn(creationResponse.request().postDataJSON(), 'reasoning_effort'), false);
    const newSession = await creationResponse.json();
    assert.equal(newSession.model, 'model-gamma');
    await expect.poll(() => model(newSession.id)).toBe('model-gamma');
    await expect(summary(draft)).toContainText('Model Gamma');
    await expect.poll(async () => (await (await api.get(origin + `/api/runtime/sessions/${newSession.id}/snapshot`)).json()).messages.length).toBeGreaterThan(0);
    await draftContext.close();
    evidence.cases.push('A choice in a new unsaved draft does not change another session and is used for creation and the first message');
    assert.deepEqual(errors, []);
  }
  await first.close(); await second.close();
  await writeFile(path.join(shots, baseline ? 'before-evidence.json' : 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  await rm(state, { recursive: true, force: true });
}
