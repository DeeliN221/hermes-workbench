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
  console.log(`Local validation: ${host.origin}/kanban?profile=default`);
  if (process.env.BASELINE_DIST) {
    const baseline = process.env.BASELINE_DIST;
    await page.route('**/workbench.js', route=>route.fulfill({path:path.join(baseline,'index.js'),contentType:'text/javascript'}));
    await page.route('**/style.css', route=>route.fulfill({path:path.join(baseline,'style.css'),contentType:'text/css'}));
    await page.goto(host.origin+'/kanban?profile=default');
    await page.getByText('Connected to Fleet',{exact:true}).waitFor();
    await page.addStyleTag({content:'#preview-banner {display:none}'});
    await page.locator('.tower-board [data-task-id="T-review"] .tower-card-title').click();
    await page.locator('.tower-drawer').waitFor();
    await page.screenshot({path:path.join(shotDir,'before-review.png')});
    await page.unroute('**/workbench.js');
    await page.unroute('**/style.css');
  }
  await page.goto(host.origin+'/kanban?profile=default');
  await page.getByText('Connected to Fleet',{exact:true}).waitFor();
  assert.equal(await page.title(),'default');
  assert.equal(new URL(page.url()).pathname,'/kanban');
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  assert.equal(await page.getByText('Demo mode',{exact:true}).count(),0);
  assert.equal(await page.getByText('Review the sample report',{exact:true}).count(),0);
  const tasks=await (await fetch(proxyOrigin+'/api/plugins/workbench/fleetd/tasks',{headers})).json();
  const decisions=await (await fetch(proxyOrigin+'/api/plugins/workbench/fleetd/decisions',{headers})).json();
  const expected = live ? ['T-e7b645c7','T-f7c8df07','T-cb98032e'] : ['T-example'];
  for (const id of expected) {
    assert.ok(tasks.tasks.some(t=>t.id===id),`Missing expected task ${id}`);
    if (tasks.tasks.find(t=>t.id===id).status==='archived') {
      await page.locator('.tower-archive').click();
      await page.locator(`.tower-archive-list [data-task-id="${id}"]`).waitFor();
      await page.locator('.tower-archive').click();
    } else await page.locator(`.tower-board [data-task-id="${id}"]`).waitFor();
  }
  if (!live) {
    for (const task of tasks.tasks) {
      if (task.status === 'archived') continue;
      await page.locator(`.column-${({ready:"pending",running:"active"})[task.status] || task.status} [data-task-id="${task.id}"]`).waitFor();
    }
    assert.equal(tasks.tasks.length, 14);
    assert.equal(await page.locator('.column-review [data-task-id]').count(), 4);
    await page.locator('.column-review [data-task-id="T-future-status"] .tower-card-title').click();
    await page.locator('.tower-drawer').getByText('Fleet: future-status', {exact:true}).waitFor();
    await page.getByRole('button',{name:'Close details'}).click();
    await page.locator('.tower-archive').click();
    for (const task of tasks.tasks.filter(t => t.status === 'archived')) {
      await page.locator(`.tower-archive-list [data-task-id="${task.id}"]`).waitFor();
    }
    await page.locator('.tower-archive').click();
  }
  if (decisions.decisions.length) {
    const d=decisions.decisions[0];
    await page.locator('.tower-sidebar').getByText(d.question,{exact:true}).waitFor();
    await page.locator('.tower-sidebar .tower-action').filter({hasText:d.question}).getByRole('button').click();
    await page.locator('.tower-decision').waitFor();
    assert.equal(await page.locator('.tower-decision button').count(),d.options.length);
    assert.ok(await page.locator('.tower-decision button').first().isDisabled());
    await page.screenshot({path:path.join(shotDir,'decision.png')});
    await page.getByRole('button',{name:'Close details'}).click();
  }
  await page.addStyleTag({content:'#preview-banner {display:none}'});
  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.workbenchTheme=theme,theme);
    await page.screenshot({path:path.join(shotDir,`desktop-${theme}.png`)});
  }
  if (!live) {
    const updated = structuredClone(tasks);
    updated.tasks[0].title = 'Updated release report';
    await page.route('**/fleetd/tasks', route=>route.fulfill({json:updated}));
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.locator('.tower-board').getByText('Updated release report',{exact:true}).waitFor();
    await page.unroute('**/fleetd/tasks');
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.locator('.tower-board').getByText(tasks.tasks[0].title,{exact:true}).waitFor();
  }
  const privacyMasks = () => [page.locator('.tower-card-title, .tower-card-meta span:not(:first-child), .tower-card-meta time, .tower-action strong, .tower-decision-summary p, .tower-running button')];
  if (live) await page.screenshot({path:path.join(shotDir,'redacted-desktop.png'),mask:privacyMasks(),maskColor:'#74776b'});
  const previous = await page.locator('.tower-connection').innerText();
  await page.waitForTimeout(1100);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Connected to Fleet',{exact:true}).waitFor();
  assert.notEqual(await page.locator('.tower-connection').innerText(),previous,'Refresh updates last-success time');
  // A partial feed failure must retain all previous task values and counts.
  const cardsBefore=await page.locator('.tower-board').innerText();
  await page.route('**/fleetd/decisions',route=>route.fulfill({status:504,json:{detail:'Fleet request timed out; retry'}}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Connection error · Data stale',{exact:true}).waitFor();
  assert.equal(await page.locator('.tower-board').innerText(),cardsBefore);
  await page.screenshot({path:path.join(shotDir,'partial-failure.png')});
  await page.unroute('**/fleetd/decisions');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('Connected to Fleet',{exact:true}).waitFor();
  await context.setOffline(true);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Connection error · Data stale',{exact:true}).waitFor();
  assert.equal(await page.locator('.tower-board').innerText(),cardsBefore);
  await page.screenshot({path:path.join(shotDir,'offline-desktop.png')});
  await context.setOffline(false);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('Connected to Fleet',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('.tower-list').isVisible());
  if (!live) await page.locator('.tower-list [data-task-id="T-review"]').first().waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.workbenchTheme=theme,theme);
    await page.screenshot({path:path.join(shotDir,`mobile-${theme}.png`)});
  }
  if (live) await page.screenshot({path:path.join(shotDir,'redacted-mobile.png'),mask:privacyMasks(),maskColor:'#74776b'});
  await page.reload();
  await page.addStyleTag({content:'#preview-banner {display:none}'});
  await page.getByText('Connected to Fleet',{exact:true}).waitFor();
  assert.equal(await page.getByText('Demo mode',{exact:true}).count(),0);
  await page.locator('.tower-list').getByRole('heading',{name:/Archived/}).waitFor();
  if (decisions.decisions.length) {
    await page.locator('.tower-bottom-nav').getByRole('button',{name:'Needs you',exact:true}).click();
    await page.locator('.tower-sidebar .tower-action').filter({hasText:decisions.decisions[0].question}).getByRole('button').click();
    await page.locator('.tower-decision button').first().waitFor();
    assert.ok(await page.locator('.tower-decision button').first().isDisabled());
    const drawer=await page.locator('.tower-drawer').boundingBox();
    assert.ok(drawer.x>=47 && drawer.x+drawer.width<=391,'Mobile detail stays inside the content area');
    assert.ok(await page.locator('.dashboard-global-nav').evaluate(n=>n.inert));
    await page.screenshot({path:path.join(shotDir,'mobile-decision.png')});
    await page.getByRole('button',{name:'Close details'}).click();
    await page.locator('.tower-bottom-nav').getByRole('button',{name:'Tasks',exact:true}).click();
  }
  const mobileBefore=await page.locator('.tower-list').innerText();
  await context.setOffline(true);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Connection error · Data stale',{exact:true}).waitFor();
  assert.equal(await page.locator('.tower-list').innerText(),mobileBefore);
  await page.screenshot({path:path.join(shotDir,'offline-mobile.png')});
  await context.setOffline(false);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('Connected to Fleet',{exact:true}).waitFor();
  // Visibility pause and immediate return refresh.
  const count=()=>requests.filter(u=>u.endsWith('/fleetd/tasks')).length;
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));
  const hiddenCount=count();
  await page.waitForTimeout(15500);
  assert.equal(count(),hiddenCount);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(1000);
  assert.ok(count()>hiddenCount);
  const secret=live ? (process.env.FLEET_TOKEN || await readFile(process.env.FLEET_TOKEN_FILE || '/opt/data/.fleet-token','utf8')).trim() : 'mock-fleet-token';
  const exposed=responses.join('')+await page.content()+await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))+await readFile('dashboard/dist/index.js','utf8');
  assert.ok(!exposed.includes(secret),'Credential must stay server-side');
  assert.ok(!logs.includes(secret),'Credential must not enter proxy logs');
  assert.ok(requests.every(u=>new URL(u).origin===host.origin),'Same-origin requests only');
  assert.deepEqual(errors,[]);
  if (!live) {
    const denied = await context.newPage();
    await denied.route('**/fleetd/tasks',route=>route.fulfill({status:401,json:{detail:'Fleet authentication failed (401)'}}));
    await denied.goto(host.origin+'/kanban?profile=default');
    await denied.getByText('Connection error · Data stale',{exact:true}).waitFor();
    assert.equal(await denied.locator('.tower-card').count(),0);
    assert.equal(await denied.getByText('Demo mode',{exact:true}).count(),0);
    assert.match(await denied.locator('.tower-connection').innerText(),/401/);
    await denied.screenshot({path:path.join(shotDir,'initial-401.png')});
    await denied.close();
  }
  if (!live) {
    for (const width of [1536, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({width, height: 960});
      await page.goto(host.origin+'/kanban?profile=default');
      await page.getByText('Connected to Fleet',{exact:true}).waitFor();
      await page.addStyleTag({content:'#preview-banner {display:none}'});
      await page.evaluate(theme=>document.documentElement.dataset.workbenchTheme=theme,theme);
      const content = await page.locator('.dashboard-owned-page').boundingBox();
      if (width > 800) {
        assert.equal(Math.round(content.x), 0);
        assert.equal(await page.locator('.dashboard-global-nav').isVisible(),false);
      } else assert.ok(content.x >= 48 && content.x <= 56, 'Mobile retains the compact rail and page spacing');
      if (width > 800) {
        const refresh = page.getByRole('button',{name:'Refresh',exact:true});
        await refresh.focus();
        await page.keyboard.press('w');
        const menu = page.locator('.workbench-actions-dialog[open]');
        await menu.waitFor();
        for (const label of ['Home','Settings','Kanban','Scheduled jobs','Terminal','Achievements'])
          assert.ok(await menu.getByRole('link',{name:label,exact:true}).isVisible());
        assert.ok(await menu.getByRole('button',{name:'Files',exact:true}).isVisible());
        assert.ok(await menu.locator('.workbench-profile-action > button').isVisible());
        for (let i=0;i<18;i++) {
          await page.keyboard.press('Tab');
          assert.ok(await menu.evaluate(n=>n.contains(document.activeElement)),'W menu traps focus');
        }
        await page.screenshot({path:path.join(shotDir,`menu-${theme}.png`)});
        await page.keyboard.press('Escape');
        assert.ok(await refresh.evaluate(n=>n===document.activeElement),'Escape restores focus');
      } else assert.ok(await page.locator('.dashboard-action-rail').isVisible());
      const layout = width > 800 ? '.tower-board' : '.tower-list';
      await page.locator(`${layout} [data-task-id="T-review"] .tower-card-title`).first().click();
      const approve = page.getByRole('button',{name:'Approve',exact:true});
      assert.ok(await approve.isEnabled());
      await page.getByRole('button',{name:'Request changes',exact:true}).click();
      const input = page.getByRole('textbox',{name:'Review feedback'});
      assert.ok(await input.evaluate(n=>n===document.activeElement));
      await input.fill('Improve contrast.\nAdd keyboard coverage.');
      await page.keyboard.press('w');
      assert.equal(await page.locator('.workbench-actions-dialog[open]').count(),0);
      await input.fill('Improve contrast.\nAdd keyboard coverage.');
      const submit = page.getByRole('button',{name:'Submit feedback',exact:true});
      await page.screenshot({path:path.join(shotDir,`review-ready-${width}-${theme}.png`)});
      let release;
      await page.route('**/fleetd/tasks/T-review/request_changes',async route=>{
        await new Promise(r=>release=r);
        await route.fulfill({status:503,json:{detail:'FLEET_REVIEW_TOKEN missing or invalid'}});
      });
      await submit.click();
      await page.getByRole('button',{name:'Submitting…',exact:true}).waitFor();
      assert.ok(await approve.isDisabled());
      release();
      await page.locator('.tower-drawer').getByRole('alert').filter({hasText:'FLEET_REVIEW_TOKEN'}).waitFor();
      assert.equal(await input.inputValue(),'Improve contrast.\nAdd keyboard coverage.');
      await page.screenshot({path:path.join(shotDir,`review-${width}-${theme}.png`)});
      await page.unroute('**/fleetd/tasks/T-review/request_changes');
      await page.getByRole('button',{name:'Close details'}).click();
    }
    // Exercise the authenticated proxy and both upstream writes, only on fixture data.
    await page.setViewportSize({width:1536,height:960});
    await page.locator('.tower-board [data-task-id="T-review"] .tower-card-title').click();
    await page.getByRole('button',{name:'Request changes',exact:true}).click();
    await page.getByRole('textbox',{name:'Review feedback'}).fill('Fix keyboard access.\nKeep multiline notes.');
    const savedResponse = page.waitForResponse(r=>r.url().endsWith('/T-review/request_changes') && r.request().method()==='POST');
    await page.getByRole('button',{name:'Submit feedback',exact:true}).click();
    const saved = await savedResponse;
    assert.equal(saved.status(),200,await saved.text());
    await page.getByRole('status').filter({hasText:'Feedback saved; task returned to running'}).waitFor();
    await page.locator('.column-active [data-task-id="T-review"]').waitFor();
    await page.locator('.tower-review-notes').getByText('Fix keyboard access.\nKeep multiline notes.',{exact:true}).waitFor();
    const writes = fleet.calls.filter(c=>c.method==='POST' && c.path.includes('/T-review/'));
    assert.deepEqual(writes.map(c=>c.path.split('/').at(-1)),['note','request_changes']);
    assert.equal(writes[0].body.text,'Fix keyboard access.\nKeep multiline notes.');
    await page.getByRole('button',{name:'Close details'}).click();
    // Reset a fixture card for approval, never a live task.
    fleet.reviewTask().status = 'review';
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.locator('.column-review [data-task-id="T-review"] .tower-card-title').click();
    await page.route('**/fleetd/tasks/T-review/approve',route=>route.fulfill({status:409,json:{detail:'Task changed (409)'}}));
    await page.getByRole('button',{name:'Approve',exact:true}).click();
    await page.locator('.tower-drawer').getByRole('alert').filter({hasText:'Task changed elsewhere'}).waitFor();
    await page.unroute('**/fleetd/tasks/T-review/approve');
    await page.getByRole('button',{name:'Approve',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Delivery approved'}).waitFor();
    await page.locator('.column-done [data-task-id="T-review"]').waitFor();
    await page.getByRole('button',{name:'Close details'}).click();
    assert.ok(!responses.join('').includes('mock-review-token'));
    assert.ok(!logs.includes('mock-review-token'));
    assert.deepEqual(errors,[]);
  }
  // Explicit demo is isolated and never selected as a fallback.
  await page.setViewportSize({width:1536,height:960});
  await page.goto(host.origin+'/kanban?profile=default&demo=1');
  await page.getByText('Demo mode',{exact:true}).waitFor();
  await page.locator('.tower-board [data-task-id="demo-review"]').waitFor();
  await page.addStyleTag({content:'#preview-banner {display:none}'});
  await page.screenshot({path:path.join(shotDir,'before-demo-reproduction.png')});
  console.log(`PASS ${live?'LIVE':'FIXTURE'}: default tasks, detail, decisions, refresh, partial failure retention, offline/retry, desktop/mobile, visibility polling, credential isolation, explicit demo. Evidence: ${shotDir}`);
} finally {
  await browser?.close(); await host?.close();
  proxy.kill('SIGTERM');
  await new Promise(resolve=>{if(proxy.exitCode!==null)return resolve();proxy.once('exit',resolve);setTimeout(()=>{proxy.kill('SIGKILL');resolve();},3000).unref();});
  await fleet?.close();
}
