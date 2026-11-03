/** Browser plugin not available. Localhost host + real authenticated Python proxy. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';
import { createMockFleet } from '../fixtures/mock-fleet.mjs';

const live = process.env.FLEET_LIVE_TEST === '1';
assert.ok(!live, 'This mutation suite only accepts disposable fixture tasks. Use the isolated fleetd binary suite for real integration.');
const shotDir = process.env.SHOT_DIR || '/tmp/fleetd-console-screenshots';
await mkdir(shotDir, {recursive:true});
const fleet = live ? null : await createMockFleet();
const reserve = createServer();
await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise(r => reserve.close(r));
const env = {...process.env, HERMES_DASHBOARD_TRUSTED_PROXY_SECRET:'local-proxy-secret', HERMES_WORKBENCH_ALLOWED_USERS:'preview'};
for (const key of ['CODEX_HOME','CODEX_APP_SERVER_ENDPOINT','HERMES_WORKBENCH_FLEET_MODE','HERMES_WORKBENCH_FLEET_DEMO_URL']) delete env[key];
if (fleet) Object.assign(env, {FLEETD_URL: fleet.origin + '/api/v1', FLEET_TOKEN:'mock-fleet-token', FLEET_REVIEW_TOKEN:'mock-review-token'});
const proxy = spawn('uv', ['run','--no-project','--with-requirements','requirements-dev.txt','python','-m','uvicorn','fleet-proxy-app:app','--app-dir','tests/fixtures','--host','127.0.0.1','--port',String(port)], {env, stdio:['ignore','pipe','pipe']});
let logs = '', host, browser;
proxy.stdout.on('data', data => logs += data);
proxy.stderr.on('data', data => logs += data);
const headers = {'x-hermes-proxy-secret':'local-proxy-secret','remote-user':'preview'};
const proxyOrigin = `http://127.0.0.1:${port}`;
try {
  let ready=false;
  for (let i=0;i<200;i++) {
    try { if ((await fetch(proxyOrigin+'/api/plugins/workbench/fleetd/config',{headers})).ok) {ready=true;break;} } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'Local proxy did not start');
  assert.equal((await fetch(proxyOrigin+'/api/plugins/workbench/fleetd/tasks')).status,401);
  host=await createMockHost({fleetProxyOrigin:proxyOrigin});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined});
  const context=await browser.newContext({viewport:{width:1536,height:960}});
  const page=await context.newPage();
  const errors=[],responses=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  page.on('response',async response=>{
    if (response.url().includes('/fleet')) responses.push(await response.text().catch(()=>''));
  });
  const loaded = async () => page.locator('.tower-board [data-task-id="T-review"]').waitFor({state:'attached'});
  const refresh = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  console.log(`Local validation: ${host.origin}/kanban`);
  for (const width of [1536, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width, height:960});
    await page.goto(host.origin+'/kanban?profile=writer&panel=1');
    await loaded();
    assert.equal(new URL(page.url()).searchParams.has('profile'),false);
    assert.equal(new URL(page.url()).searchParams.has('panel'),false);
    assert.equal(await page.title(),'Kanban');
    await page.addStyleTag({content:'#preview-banner {display:none}'});
    await page.evaluate(theme=>document.documentElement.dataset.workbenchTheme=theme,theme);
    assert.equal(await page.locator('.tower-header, .tower-sidebar, .tower-create, .tower-bottom-nav').count(),0);
    const layout = width > 800 ? '.tower-board' : '.tower-list';
    assert.ok(await page.locator(layout).isVisible());
    assert.equal(await page.locator(layout+' > section').count(),4);
    assert.deepEqual(await page.locator(layout+' > section > h2').allTextContents(), width > 800
      ? (await page.locator(layout+' > section > h2').allTextContents()).map((s,i)=>['Pending','Queued','In progress','Completed'][i]+s.match(/\d+$/)[0])
      : ['Pending','Queued','In progress','Completed']);
    if (width > 800) assert.equal(await page.locator('.dashboard-global-nav').isVisible(),false);
    else assert.ok(await page.locator('.dashboard-action-rail').isVisible());
    await page.screenshot({path:path.join(shotDir,`kanban-${width}-${theme}.png`)});
    await page.locator(`${layout} [data-task-id="T-review"] .tower-card-title`).click();
    await page.getByText('Source conversation',{exact:true}).waitFor();
    await page.getByText('Execution conversation',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Request changes',exact:true}).click();
    const input = page.getByRole('textbox',{name:'Review feedback'});
    await input.fill('Improve contrast.\nKeep keyboard coverage.');
    await page.route('**/fleetd/tasks/T-review/request_changes',route=>route.fulfill({status:503,json:{detail:'FLEET_REVIEW_TOKEN missing or invalid'}}));
    await page.getByRole('button',{name:'Submit feedback',exact:true}).click();
    await page.locator('.tower-drawer [role="alert"]').filter({hasText:'FLEET_REVIEW_TOKEN'}).waitFor();
    assert.equal(await input.inputValue(),'Improve contrast.\nKeep keyboard coverage.');
    await page.screenshot({path:path.join(shotDir,`review-${width}-${theme}.png`)});
    await page.unroute('**/fleetd/tasks/T-review/request_changes');
    await page.keyboard.press('Escape');
    assert.equal(new URL(page.url()).pathname,'/kanban');
  }
  await page.setViewportSize({width:1536,height:960});
  await page.locator('.tower-board [data-task-id="T-review"] .tower-card-title').click();
  await page.getByRole('button',{name:'Request changes',exact:true}).click();
  await page.getByRole('textbox',{name:'Review feedback'}).fill('Fix keyboard access.\nKeep multiline notes.');
  await page.getByRole('button',{name:'Submit feedback',exact:true}).click();
  await page.locator('.tower-drawer [role="status"]').filter({hasText:'Feedback saved'}).waitFor();
  await page.locator('.column-active [data-task-id="T-review"]').waitFor();
  assert.deepEqual(fleet.calls.filter(c=>c.method==='POST' && c.path.includes('/T-review/')).map(c=>c.path.split('/').at(-1)),['note','request_changes']);
  await page.getByRole('button',{name:'Close details'}).click();
  fleet.reviewTask().status='review'; await refresh();
  await page.locator('.column-pending [data-task-id="T-review"] .tower-card-title').click();
  await page.getByRole('button',{name:'Approve',exact:true}).click();
  await page.locator('.column-done [data-task-id="T-review"]').waitFor();
  await page.getByRole('button',{name:'Close details'}).click();
  await page.goto(host.origin+'/chat?session=codex-preview&profile=default');
  const composer = page.locator('textarea:visible').first();
  await composer.fill('Unsent draft\nKeep my input');
  // Opening W from a non-editable control must leave the mounted conversation intact.
  await composer.evaluate(node=>node.blur());
  await page.keyboard.press('w');
  await page.locator('.workbench-actions-dialog[open]').getByRole('link',{name:'Kanban',exact:true}).click();
  await loaded();
  assert.equal(new URL(page.url()).searchParams.has('profile'),false);
  await page.keyboard.press('Escape');
  await composer.waitFor({state:'visible'});
  assert.equal(await composer.inputValue(),'Unsent draft\nKeep my input');
  assert.equal(new URL(page.url()).searchParams.get('session'),'codex-preview');
  await page.goto(host.origin+'/sessions?profile=default');
  await page.locator('.profile-session').first().waitFor();
  assert.equal(await page.locator('.profile-overview-heading, .profile-order-toolbar, .profile-order-controls, .profile-project-actions').count(),0);
  assert.equal(await page.locator('.profile-column-heading button').count(),await page.locator('.profile-overview-column').count());
  await page.addStyleTag({content:'#preview-banner {display:none}'});
  for (const width of [1536,390]) for (const theme of ['light','dark']) {
    await page.setViewportSize({width,height:960});
    await page.evaluate(theme=>document.documentElement.dataset.workbenchTheme=theme,theme);
    await page.screenshot({path:path.join(shotDir,`home-${width}-${theme}.png`)});
  }
  await page.goto(host.origin+'/config?workbench=display&profile=default');
  const labels = page.getByRole('checkbox', {name:'Show session project labels · default'});
  await labels.uncheck();
  await page.getByRole('button',{name:'writer Move up',exact:true}).click();
  await page.goto(host.origin+'/sessions?profile=default');
  await page.locator('.profile-session').first().waitFor();
  assert.equal(await page.locator('.profile-overview-column').first().getAttribute('data-profile'),'writer');
  assert.equal(await page.locator('[data-profile="default"] .profile-session-project').count(),0);
  await page.goto(host.origin+'/config?workbench=display&profile=default');
  await labels.waitFor();
  assert.equal(await labels.isChecked(),false);
  const exposed=responses.join('')+await page.content()+await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))+await readFile('dashboard/dist/index.js','utf8');
  for (const secret of ['mock-fleet-token','mock-review-token']) { assert.ok(!exposed.includes(secret)); assert.ok(!logs.includes(secret)); }
  assert.deepEqual(errors,[]);
  console.log(`PASS localhost fixture: global route, four responsive columns/groups, desktop/mobile light/dark, review writes, failure retention, source/execution fallback, chat draft return, compact home. Evidence: ${shotDir}`);

} finally {
  await browser?.close(); await host?.close();
  proxy.kill('SIGTERM');
  await new Promise(resolve=>{if(proxy.exitCode!==null)return resolve();proxy.once('exit',resolve);setTimeout(()=>{proxy.kill('SIGKILL');resolve();},3000).unref();});
  await fleet?.close();
}
