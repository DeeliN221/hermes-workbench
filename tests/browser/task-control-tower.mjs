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
  await page
    .getByRole("heading", { name: "Task control tower", exact: true })
    .waitFor();
  await page.locator('[data-task-id="review-task"]').first().waitFor();
  assert.equal(await page.locator("[data-column]").count(), 4);
  assert.equal(await page.locator(".tower-action").count(), 2);
  await page.waitForFunction(() =>
    document
      .querySelector(".tower-archive")
      ?.textContent.includes("1 archived"),
  );
  assert.equal(
    fleet.tasks.find((t) => t.id === "expired-delivery").status,
    "archived",
  );
  assert.deepEqual(
    await page
      .locator('[data-status="done"] .tower-card')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.taskId)),
    ["delivered-new", "delivered-old"],
  );
  await page.evaluate(
    () => (document.documentElement.dataset.workbenchTheme = "light"),
  );
  await page.screenshot({ path: path.join(shotDir, "desktop-light.png") });
  await page.evaluate(
    () => (document.documentElement.dataset.workbenchTheme = "dark"),
  );
  await page.screenshot({ path: path.join(shotDir, "desktop-dark.png") });
  await page.evaluate(
    () => (document.documentElement.dataset.workbenchTheme = "light"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shotDir, "mobile-light.png") });
  await page.evaluate(
    () => (document.documentElement.dataset.workbenchTheme = "dark"),
  );
  await page.screenshot({ path: path.join(shotDir, "mobile-dark.png") });
  await page.evaluate(
    () => (document.documentElement.dataset.workbenchTheme = "light"),
  );
  await page.setViewportSize({ width: 1536, height: 960 });
  const card = (id) => page.locator(`.tower-board [data-task-id="${id}"]`);
  const drop = async (id, status, before) => {
    const source = card(id),
      target = before
        ? card(before)
        : page.locator(`.tower-board [data-status="${status}"] > h3`);
    await source.dragTo(target);
  };
  await drop("ready-b", "ready", "ready-a");
  assert.deepEqual(
    await page
      .locator('[data-status="ready"] .tower-card')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.taskId)),
    ["ready-b", "ready-a"],
  );
  await drop("draft-brief", "done");
  await page.getByRole("alert").filter({ hasText: "not allowed" }).waitFor();
  assert.equal(
    fleet.tasks.find((t) => t.id === "draft-brief").status,
    "triage",
  );
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await drop("ready-a", "triage");
  await page
    .locator('[data-status="triage"] [data-task-id="ready-a"]')
    .waitFor();
  await drop("ready-a", "ready");
  await page
    .locator('[data-status="ready"] [data-task-id="ready-a"]')
    .waitFor();
  await drop("ready-a", "running");
  await page
    .locator('[data-status="running"] [data-task-id="ready-a"]')
    .waitFor();
  await drop("ready-a", "blocked");
  await page
    .locator('[data-status="blocked"] [data-task-id="ready-a"]')
    .waitFor();
  await drop("ready-a", "running");
  await page
    .locator('[data-status="running"] [data-task-id="ready-a"]')
    .waitFor();
  await drop("ready-a", "review");
  await page
    .getByRole("alert")
    .filter({ hasText: "Automatic verification" })
    .waitFor();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await drop("ready-a", "done");
  await page.locator('[data-status="done"] [data-task-id="ready-a"]').waitFor();
  assert.equal(
    fleet.tasks.find((t) => t.id === "ready-a").verified_by,
    "agent",
  );
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Prepare a human-verified package");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer
    .getByRole("button", { name: "Complete draft", exact: true })
    .click();
  await drawer.getByLabel("Repository", { exact: true }).fill("sample/package");
  await drawer.getByLabel("Machine", { exact: true }).fill("dev-box");
  await drawer
    .getByLabel("Specification", { exact: true })
    .fill("Prepare a versioned package and report.");
  await drawer
    .getByLabel("Acceptance criteria (one per line)", { exact: true })
    .fill("Package is valid");
  await drawer.getByLabel("Risk", { exact: true }).selectOption("R2");
  await drawer.getByRole("button", { name: "Save draft", exact: true }).click();
  await drawer.getByRole("button", { name: "Dispatch", exact: true }).click();
  await drawer.getByRole("button", { name: "Running", exact: true }).click();
  await drawer
    .getByRole("button", { name: "Human review", exact: true })
    .click();
  await drawer.getByLabel("Package is valid", { exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".tower-checklist input")?.checked,
  );
  await drawer
    .getByRole("button", { name: "Accept delivery", exact: true })
    .click();
  await drawer.getByRole("button", { name: "Archived", exact: true }).click();
  await drawer.getByRole("button", { name: "Draft", exact: true }).click();
  await drawer.getByRole("button", { name: "Close details" }).click();
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
  await drawer.getByRole("button", { name: "Close details" }).click();
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
  await page.screenshot({ path: path.join(shotDir, "artifact-drawer.png") });
  await drawer
    .getByRole("button", { name: "Accept delivery", exact: true })
    .click();
  await drawer.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  assert.ok(await page.locator(".tower-list").isVisible());
  await page.screenshot({ path: path.join(shotDir, "desktop-list.png") });
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(!(await page.locator(".tower-board").isVisible()));
  assert.ok(await page.locator(".tower-list").isVisible());
  assert.ok(await page.locator(".tower-bottom-nav").isVisible());
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(shotDir, "mobile-after-delivery-light.png"),
  });
  await page.evaluate(
    () => (document.documentElement.dataset.workbenchTheme = "dark"),
  );
  await page.screenshot({
    path: path.join(shotDir, "mobile-after-delivery-dark.png"),
  });
  await page
    .locator(".tower-bottom-nav")
    .getByRole("button", { name: "Needs you", exact: true })
    .click();
  assert.ok(await page.locator(".tower-sidebar").isVisible());
  fleet.emptyAttention();
  await page.reload();
  await page.addStyleTag({ content: "#preview-banner { display: none }" });
  await page.getByText("Nothing needs you now", { exact: true }).waitFor();
  assert.equal(await page.locator(".tower-action").count(), 0);
  await page.screenshot({ path: path.join(shotDir, "mobile-empty.png") });
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.evaluate(
    () => (document.documentElement.dataset.workbenchTheme = "light"),
  );
  await page.screenshot({ path: path.join(shotDir, "desktop-empty.png") });
  await page.locator('.overview-tabs').getByRole('link', { name: 'Project sessions' }).click();
  await page.locator('.profile-overview').waitFor();
  await page.locator('.overview-tabs').getByRole('link', { name: 'Kanban' }).click();
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
    `PASS: authenticated proxy lifecycle, four columns, all drag paths/reorder/rejections, auto/human review, decision, download, archive/restore, list/mobile, empty state, console. Screenshots: ${shotDir}`,
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
