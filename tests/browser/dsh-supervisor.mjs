/** Real standalone UI/host + explicitly simulated protocol updates.
 * Native execution is independently covered by runtime/scripts/supervisor-probe.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {chromium, expect} from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const state = await mkdtemp(path.join(tmpdir(), 'dsh-supervisor-ui-'));
const shots = path.resolve(process.env.SHOT_DIR || 'node_modules/.cache/dsh-supervisor-ui');
await mkdir(shots, {recursive: true});
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const env = {...process.env, WORKBENCH_AUTH_MODE: 'local'};
delete env.WORKBENCH_RUNTIME_BRIDGE_TOKEN_FILE; delete env.WORKBENCH_RUNTIME_TOKEN;
const server = spawn('uv', ['run', '--no-project', '--with-requirements', 'requirements-dev.txt', 'python',
  'tests/browser/session-model-host.py', '--state', state, '--port', String(port)],
  {cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
let logs = '', browser;
server.stdout.on('data', x => { logs = (logs + x).slice(-10000); });
server.stderr.on('data', x => { logs = (logs + x).slice(-10000); });
try {
  let token;
  await expect(async () => { token = (await readFile(path.join(state, 'host/bootstrap-token'), 'utf8')).trim();
    assert.equal((await fetch(origin + '/api/runtime/models')).status, 401); }).toPass({timeout: 30000});
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'en-US', colorScheme: 'light'});
  const api = context.request, headers = {'X-Workbench-Request': '1'};
  assert.equal((await api.post(origin + '/api/standalone/bootstrap', {headers: {...headers, Authorization: 'Bearer ' + token}})).status(), 200);
  const created = await api.post(origin + '/api/runtime/sessions', {headers, data: {profile_id: 'default', model: 'model-alpha', title: 'Project validation'}});
  assert.equal(created.status(), 200); const session = (await created.json()).id;
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const delivery = {delivery_id: 'validation-result', source: 'fleet', task_id: 'validation-task', attempt_id: 'validation-attempt', epoch: 1,
    kind: 'result', content: 'Validation finished: all 14 checks passed. Evidence is ready for review.'};
  const update = async (supervisor, reply) => {
    assert.equal((await api.post(origin + '/__fixture/control', {data: {session_id: session, delivery: {...delivery, ...(supervisor ? {supervisor} : {})}, reply}})).status(), 200);
  };
  await page.goto(origin + '/chat?profile=default&session=' + encodeURIComponent(session));
  await update();
  const card = page.locator('.codex-pane-slot.is-active .runtime-fleet-notification');
  await expect(card).toHaveCount(1); await expect(card).toContainText('14 checks passed');
  await page.screenshot({path: path.join(shots, 'before-desktop.png'), fullPage: true});
  await update({status: 'queued'});
  await expect(card).toContainText('Waiting for supervisor reply');
  await update({status: 'delivered'}, 'Your validation task is complete. All 14 checks passed; the evidence is ready to review.');
  await expect(card).toContainText('Supervisor replied');
  await expect(page.getByText('Your validation task is complete.', {exact: false})).toBeVisible();
  await page.screenshot({path: path.join(shots, 'after-desktop.png'), fullPage: true});
  await page.reload(); await expect(card).toContainText('Supervisor replied'); await expect(card).toHaveCount(1);
  const failedSession = await api.post(origin + '/api/runtime/sessions', {headers, data: {profile_id: 'default', model: 'model-alpha', title: 'Dependency check'}});
  const failureId = (await failedSession.json()).id;
  assert.equal((await api.post(origin + '/__fixture/control', {data: {session_id: failureId,
    delivery: {...delivery, delivery_id: 'failed-result', task_id: 'dependency-check',
      content: 'Build stopped: a dependency is missing. The worker log is saved.', supervisor: {status: 'failed', fallback: true}}}})).status(), 200);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(origin + '/chat?profile=default&session=' + encodeURIComponent(failureId));
  await page.reload(); await expect(card).toHaveCount(1); await expect(card).toContainText('worker log is saved');
  await expect(card).toContainText('Automatic receipt');
  await page.screenshot({path: path.join(shots, 'failure-mobile.png'), fullPage: true});
  assert.deepEqual(errors, []);
  const evidence = {status: 'passed', fixture: 'Real standalone host/UI; simulated protocol events, not native inference',
    checks: ['live receipt state and assistant reply', 'no duplicate notification after refresh', 'desktop and mobile failure visibility']};
  await writeFile(path.join(shots, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) { console.error(logs); throw error; }
finally { await browser?.close(); try { process.kill(-server.pid, 'SIGTERM'); } catch {} await rm(state, {recursive: true, force: true}); }
