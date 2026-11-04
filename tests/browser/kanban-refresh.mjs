/** Real Workbench bundle -> authenticated Python proxy -> stateful mock Fleet. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createMockHost } from "./mock-host.mjs";
import { createMockFleet } from "../fixtures/mock-fleet.mjs";
const shotDir = process.env.SHOT_DIR || "/tmp/kanban-refresh-evidence";
const baseline = process.env.REFRESH_BASELINE === "1";
await mkdir(shotDir, { recursive: true });
const fleet = await createMockFleet();
fleet.tasks.splice(fleet.tasks.findIndex(t => t.id === "expired-delivery"), 1);
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const env = {
  ...process.env,
  HERMES_WORKBENCH_FLEET_DEMO_URL: fleet.origin,
  HERMES_WORKBENCH_FLEET_TOKEN: "mock-fleet-token",
  HERMES_WORKBENCH_FLEET_MODE: "mock",
  HERMES_DASHBOARD_TRUSTED_PROXY_SECRET: "local-proxy-secret",
  HERMES_WORKBENCH_ALLOWED_USERS: "preview",
};
delete env.CODEX_HOME;
delete env.CODEX_APP_SERVER_ENDPOINT;
const proxy = spawn(
  "uv",
  [
    "run",
    "--no-project",
    "--with-requirements",
    "requirements-dev.txt",
    "python",
    "-m",
    "uvicorn",
    "fleet-proxy-app:app",
    "--app-dir",
    "tests/fixtures",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
proxy.stdout.on("data", (chunk) => (logs += chunk));
proxy.stderr.on("data", (chunk) => (logs += chunk));
let host, browser, page;
try {
  const proxyOrigin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(
        proxyOrigin + "/api/plugins/workbench/fleet/config",
        {
          headers: {
            "x-hermes-proxy-secret": "local-proxy-secret",
            "remote-user": "preview",
          },
        },
      );
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  assert.equal(
    (await fetch(proxyOrigin + "/api/plugins/workbench/fleet/tasks")).status,
    401,
    "Proxy authentication gate",
  );
  host = await createMockHost({ fleetProxyOrigin: proxyOrigin });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  page = await browser.newPage({
    viewport: { width: 1536, height: 960 },
    acceptDownloads: true,
  });
  page.setDefaultTimeout(10000);
  const errors = [], requests = [], payloads = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/\/fleetd?\//.test(request.url())) requests.push({url: request.url(), body: request.postDataJSON(), at: Date.now()}); });
  page.on("response", async response => {
    if (response.url().endsWith("/tasks/sync") && response.ok()) payloads.push(await response.json());
  });
  await page.clock.install();
  await page.goto(host.origin + "/kanban");
  await page.locator('.tower-board [data-task-id="review-task"]').waitFor();
  // Allow network-backed hydration to settle in the legacy baseline too.
  await new Promise(resolve => setTimeout(resolve, 300));
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  await page.addStyleTag({content: '#preview-banner { display: none }'});
  assert.equal(new URL(page.url()).pathname, "/kanban");
  assert.ok(await page.title());
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  const prefix = baseline ? "before" : "after";
  await page.screenshot({path: path.join(shotDir, `${prefix}-desktop.png`)});
  const initialRequests = requests.length;
  for (let i = 0; i < 8; i++) {
    await page.clock.runFor(7500);
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.clock.runFor(1);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const minuteRequests = requests.slice(initialRequests);
  const detailRequests = minuteRequests.filter(r => /\/tasks\/[^/?]+$/.test(r.url) && !r.url.endsWith('/sync'));
  const report = { initialRequests, minuteRequests: minuteRequests.length, minuteDetails: detailRequests.length,
    syncLanes: minuteRequests.filter(r => r.body?.lane).map(r => r.body.lane),
    unchangedCardsReturned: payloads.slice(1).reduce((n, p) => n + p.tasks.length, 0) };
  console.log(JSON.stringify({[prefix]: report}));
  await (await import('node:fs/promises')).writeFile(path.join(shotDir, `${prefix}-requests.json`), JSON.stringify(report, null, 2));
  if (!baseline) {
    assert.equal(minuteRequests.length, 10);
    assert.equal(detailRequests.length, 0);
    assert.equal(report.unchangedCardsReturned, 0);
    assert.equal(report.syncLanes.filter(lane => lane === "slow").length, 2);
    const done = page.locator('.tower-board [data-task-id="delivered-new"]');
    await done.evaluate(element => {
      window.stableDone = element; window.doneMutations = 0;
      new MutationObserver(rows => window.doneMutations += rows.length).observe(element, {subtree: true, childList: true, attributes: true, characterData: true});
    });
    fleet.tasks.find(t => t.id === "running-a").title = "Updated running task";
    fleet.tasks.find(t => t.id === "delivered-new").title = "Changed completed task";
    await page.clock.runFor(7500);
    await page.locator('.tower-board').getByText("Updated running task", {exact: true}).waitFor();
    assert.equal(await done.getByText("Ship accessible empty states", {exact: true}).count(), 1);
    assert.equal(await done.evaluate(element => element === window.stableDone && window.doneMutations === 0), true);
    // Archived list is loaded only when explicitly shown, not on each sync.
    await page.locator('.tower-board').getByRole('button', {name: 'Show archived', exact: true}).click();
    await page.locator('.tower-board [data-task-id="archived-a"]').waitFor();
    const archivedRequests = () => requests.filter(r => r.url.includes('status=archived')).length;
    const archiveCount = archivedRequests();
    await page.clock.runFor(30000); await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(archivedRequests(), archiveCount);
    const hide = hidden => page.evaluate(hidden => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: hidden});
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await hide(true); const hiddenStart = requests.length;
    await page.clock.runFor(120000);
    assert.equal(requests.length, hiddenStart);
    await hide(false); await page.clock.runFor(1);
    await done.getByText("Changed completed task", {exact: true}).waitFor();
    const latest = requests.filter(r => r.body?.lane).at(-1);
    assert.equal(latest.body.lane, 'all');
    // Opening a completed card is the only task-detail fetch in this flow.
    const detailBefore = requests.filter(r => r.url.endsWith('/tasks/delivered-new')).length;
    await done.getByRole('button', {name: 'Changed completed task'}).click();
    await page.locator('.tower-drawer .tower-details').waitFor();
    assert.equal(requests.filter(r => r.url.endsWith('/tasks/delivered-new')).length, detailBefore + 1);
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.locator('.tower-list').isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path:path.join(shotDir, 'after-mobile.png')});
    // Error backoff: no immediate retry on repeated visibility notifications.
    let failures = 0;
    await page.route('**/tasks/sync', async route => { failures++; await route.fulfill({status:503, json:{detail:'Offline test'}}); });
    await page.clock.runFor(7500); await page.getByRole('alert').waitFor();
    assert.equal(failures, 1);
    await hide(false); await hide(false);
    await page.clock.runFor(14900); assert.equal(failures, 1);
    await page.clock.runFor(101); await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(failures, 2);
    await page.clock.runFor(29900); assert.equal(failures, 2);
    await page.unroute('**/tasks/sync');
    await page.clock.runFor(101); await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.getByRole('alert').count(), 0);
    // Hold one request while timers and user resume events fire: still single flight.
    let held = 0, release;
    const gate = new Promise(resolve => release = resolve);
    await page.route('**/tasks/sync', async route => { held++; await gate; await route.continue(); });
    await page.clock.runFor(7500); await new Promise(resolve => setTimeout(resolve, 100));
    await hide(false); await hide(false); await page.clock.runFor(10000);
    assert.equal(held, 1);
    release(); await new Promise(resolve => setTimeout(resolve, 100));
    await page.unroute('**/tasks/sync');
    assert.deepEqual(errors, []);
    console.log('PASS: incremental lanes, frozen terminal DOM, on-demand detail, hidden pause, backoff, single flight, desktop/mobile');
  }
} finally {
  if (browser) await browser.close();
  if (host) await host.close();
  proxy.kill("SIGTERM");
  await new Promise((resolve) => {
    if (proxy.exitCode !== null) return resolve();
    proxy.once("exit", resolve);
    setTimeout(() => {
      proxy.kill("SIGKILL");
      resolve();
    }, 3000).unref();
  });
  await fleet.close();
}
