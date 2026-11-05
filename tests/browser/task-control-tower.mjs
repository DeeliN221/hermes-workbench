/** Real Workbench bundle -> authenticated Python proxy -> stateful mock Fleet. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createMockHost } from "./mock-host.mjs";
import { createMockFleet } from "../fixtures/mock-fleet.mjs";
const shotDir = process.env.SHOT_DIR || "/tmp/task-control-tower-screenshots";
await mkdir(shotDir, { recursive: true });
const fleet = await createMockFleet();
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
  const errors = [],
    responses = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("response", async (response) => {
    if (
      response.url().includes("/fleet/") &&
      response.headers()["content-type"]?.includes("application/json")
    ) {
      try {
        responses.push(await response.text());
      } catch {}
    }
  });
  await page.goto(host.origin + "/kanban?profile=default");
  await page.addStyleTag({ content: "#preview-banner { display: none }" });
  await page.locator('.tower-board [data-task-id="review-task"]').waitFor();
  // The fixture includes an expired delivery; wait for its automatic archive before enumerating cards.
  await page.locator('.tower-board [data-task-id="expired-delivery"]').waitFor({state: "hidden"});
  assert.equal(await page.locator('.tower-board [data-column]').count(), 4);
  assert.equal(await page.locator('.tower-header, .tower-sidebar, .tower-create, .tower-bottom-nav').count(), 0);
  const reviewCard = page.locator('.tower-board [data-task-id="review-task"]');
  await page.waitForFunction(() => /^nas codex gpt-5\.2 high \d+m$/.test(document.querySelector('.tower-board [data-task-id="review-task"]')?.getAttribute('data-runtime') || ''));
  assert.ok(!(await reviewCard.textContent()).includes('未提供'));
  assert.equal(await page.locator('[data-task-id="archived-a"]').count(), 0);
  const zombie = page.locator('.tower-board [data-task-id="zombie-running"]');
  await page.waitForFunction(() => document.querySelector('.tower-board [data-task-id="zombie-running"]')?.getAttribute('data-runtime')?.endsWith('2m'));
  assert.equal(await zombie.getAttribute('data-active-attempt'), 'false');
  assert.match(await zombie.textContent(), /Waiting \/ stale/);
  assert.equal(await page.locator('.tower-board [data-column="active"] h2').textContent(), 'In progress1');
  for (const width of [1536, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width, height: 960});
    await page.evaluate(theme => document.documentElement.dataset.workbenchTheme = theme, theme);
    assert.ok(await page.locator(width > 800 ? '.tower-board' : '.tower-list').isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const visibleCards = page.locator(`${width > 800 ? '.tower-board' : '.tower-list'} .tower-card`);
    for (const card of await visibleCards.all()) assert.ok(await card.evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.screenshot({path: path.join(shotDir, `${width}-${theme}.png`)});
  }
  await page.setViewportSize({width:1536,height:960});
  const card = id => page.locator(`.tower-board [data-task-id="${id}"]`);
  const drawer = page.getByRole('dialog');
  await card("decision-task").getByRole("button").click();
  await drawer
    .getByRole("button", { name: /A · Gradual rollout \(Recommended\)/ })
    .waitFor();
  assert.equal(await drawer.locator(".tower-decision button").count(), 3);
  await page.screenshot({ path: path.join(shotDir, "decision-drawer.png") });
  await drawer.getByRole("button", { name: /A · Gradual rollout/ }).click();
  await page.waitForFunction(() => !document.querySelector(".tower-decision"));
  assert.equal(
    fleet.tasks.find((t) => t.id === "decision-task").decision,
    null,
  );
  await page.locator('.tower-backdrop').click({ position: { x: 20, y: 20 } });
  await card("review-task").getByRole("button").click();
  const downloadEvent = page.waitForEvent("download");
  await drawer.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "acceptance-report.txt");
  await download.saveAs(path.join(shotDir, "acceptance-report.txt"));
  assert.match(
    await readFile(path.join(shotDir, "acceptance-report.txt"), "utf8"),
    /checks pass/,
  );
  await drawer.getByText("Details", { exact: true }).click();
  assert.equal(await drawer.locator(".tower-markdown h1").textContent(), "Delivery brief");
  assert.equal(await drawer.locator(".tower-markdown a[href]").first().getAttribute("target"), "_blank");
  assert.ok(await drawer.locator(".tower-markdown pre").evaluate((node) => node.scrollWidth >= node.clientWidth));
  assert.equal(await drawer.locator(".tower-runtime").count(), 0);
  assert.equal(await drawer.locator('header, .tower-markdown script, .tower-markdown a[href^="javascript:"]').count(), 0);
  assert.equal(await page.evaluate(() => window.towerXss), undefined);
  await drawer.locator('h2').first().click();
  assert.ok(await drawer.isVisible(), 'inside clicks keep the drawer open');
  for (const width of [1536, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width, height: 960});
    await page.evaluate(theme => document.documentElement.dataset.workbenchTheme = theme, theme);
    assert.ok(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth));
    await drawer.locator('.tower-markdown').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(shotDir, `details-${width}-${theme}.png`)});
  }
  await page.setViewportSize({width:1536,height:960});
  await drawer
    .getByRole("button", { name: "Accept delivery", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.locator('.tower-board').getByRole('button', {name:'Select', exact:true}).click();
  await page.locator('.tower-board').getByRole('button', {name:'Archive', exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('.tower-board .column-done .tower-card'));
  assert.ok(fleet.tasks.filter(t => ['review-task','delivered-new','delivered-old'].includes(t.id)).every(t => t.status === 'archived'));
  const archivedToggle = page.locator('.tower-board .column-done').getByRole('button', { name: /Show archived|显示已归档/ });
  await archivedToggle.click();
  await page.locator('.tower-board .column-done [data-task-id="archived-a"]').waitFor();
  assert.equal(await page.locator('.tower-board .column-done [data-task-id="archived-a"] .tower-archived-tag').textContent(), 'Archived');
  await page.locator('.tower-search-toggle').click();
  await page.locator('.tower-searchbar input').fill('Archived delivery');
  await page.locator('.tower-search-results [data-task-id="archived-a"]').waitFor();
  await page.locator('.tower-search-results').getByRole('button', { name: /Hide archived|隐藏已归档/ }).click();
  assert.equal(await page.locator('[data-task-id="archived-a"]').count(), 0);
  await page.locator('.tower-search-results').getByRole('button', { name: /Show archived|显示已归档/ }).click();
  await page.locator('.tower-search-results [data-task-id="archived-a"]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.tower-board .column-done').getByRole('button', { name: /Hide archived|隐藏已归档/ }).click();
  assert.equal(await page.locator('[data-task-id="archived-a"]').count(), 0);
  await page.keyboard.press('/');
  await page.locator('.tower-searchbar input').fill('Archived delivery');
  await page.waitForFunction(() => document.querySelectorAll('.tower-search-results [data-task-id="archived-a"]').length === 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await page.locator('.workbench-actions-dialog[open]').getByRole('link', { name: 'Home', exact: true }).click();
  await page.locator('.profile-overview').waitFor();
  await page.keyboard.press('w');
  await page.locator('.workbench-actions-dialog[open]').getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.locator('.task-tower').waitFor();
  assert.ok(!responses.join("").includes("mock-fleet-token"));
  assert.ok(!responses.join("").includes("RAW LOG"));
  assert.ok(!responses.join("").includes("never-open-this"));
  assert.ok(
    fleet.calls.some(
      (c) => c.path.endsWith("/decide") && c.body.option_id === "gradual",
    ),
  );
  assert.ok(fleet.calls.some((c) => c.path.endsWith("/archive")));
  assert.deepEqual(errors, []);
  console.log(
    `PASS: authenticated proxy lifecycle, four responsive columns, human review, decision, download, bulk archive, desktop/mobile themes, navigation, console. Screenshots: ${shotDir}`,
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(shotDir, "failure.png") })
      .catch(() => {});
    console.error(
      (
        await page
          .locator(".tower-drawer")
          .textContent()
          .catch(() => "No drawer")
      ).slice(0, 1500),
    );
  }
  throw error;
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
