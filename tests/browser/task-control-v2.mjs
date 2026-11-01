/** Real fdabd48 fleetd -> authenticated Workbench proxy -> browser. No production access. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createMockHost } from "./mock-host.mjs";
const binary = process.env.FLEET_TEST_BINARY;
assert.ok(binary, "Set FLEET_TEST_BINARY to fleetd built from fdabd48");
const dir = await mkdtemp("/tmp/workbench-v2-");
const shots = process.env.SHOT_DIR || "/tmp/fleet-T-01484b8f-v2-screenshots";
await mkdir(shots, { recursive: true });
const port = async () => {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const fp = await port(),
  pp = await port();
const origin = `http://127.0.0.1:${fp}`,
  proxyOrigin = `http://127.0.0.1:${pp}`;
const token = "test-v2-worker-only",
  review = "test-v2-human-only";
const children = [];
let host, browser, page;
let logs = "";
function start(cmd, args, env) {
  const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(p);
  p.stdout.on("data", (d) => (logs += d));
  p.stderr.on("data", (d) => (logs += d));
  return p;
}
const gate = {
  "x-hermes-proxy-secret": "local-proxy-secret",
  "remote-user": "preview",
};
const wait = async (url) => {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url, { headers: gate })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(logs);
};
const fleet = async (method, p, body, expected = 200) => {
  const r = await fetch(origin + "/api/v2/" + p, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  assert.equal(r.status, expected, JSON.stringify(v));
  return v;
};
const proxy = async (method, p, body, expected = 200) => {
  const r = await fetch(proxyOrigin + "/api/plugins/workbench/fleet/" + p, {
    method,
    headers: {
      ...gate,
      "Content-Type": "application/json",
      ...(body?.revision !== undefined
        ? { "If-Match": String(body.revision) }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  assert.equal(r.status, expected, JSON.stringify(v));
  return v;
};
try {
  start(
    binary,
    ["--listen", `127.0.0.1:${fp}`, "--db", path.join(dir, "fleet.db")],
    {
      ...process.env,
      FLEET_TOKEN: token,
      FLEET_REVIEW_TOKEN: review,
      FLEET_HERMES_KANBAN_DB: "",
      FLEET_NTFY_URL: "",
      FLEET_NTFY_TOPIC: "",
    },
  );
  await wait(origin + "/healthz");
  const env = {
    ...process.env,
    FLEET_URL: origin,
    FLEET_TOKEN: token,
    FLEET_REVIEW_TOKEN: review,
    HERMES_WORKBENCH_FLEET_MODE: "live",
    HERMES_DASHBOARD_TRUSTED_PROXY_SECRET: gate["x-hermes-proxy-secret"],
    HERMES_WORKBENCH_ALLOWED_USERS: "preview",
  };
  delete env.CODEX_HOME;
  delete env.CODEX_APP_SERVER_ENDPOINT;
  start(
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
      String(pp),
    ],
    env,
  );
  await wait(proxyOrigin + "/api/plugins/workbench/fleet/config");
  host = await createMockHost({ fleetProxyOrigin: proxyOrigin });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({
    viewport: { width: 1536, height: 960 },
    acceptDownloads: true,
  });
  page.setDefaultTimeout(10000);
  const errors = [],
    browserData = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource.*409/.test(message.text())
    )
      errors.push(message.text());
  });
  page.on("request", (r) => {
    assert.ok(!r.url().startsWith(origin));
    browserData.push(JSON.stringify(r.headers()), r.postData() || "");
  });
  page.on("response", async (r) => {
    if (
      r.url().includes("/fleet/") &&
      r.headers()["content-type"]?.includes("json")
    )
      try {
        browserData.push(await r.text());
      } catch {}
  });
  const load = async () => {
    await page.goto(host.origin + "/sessions?profile=default");
    await page
      .getByRole("heading", { name: "Task control tower", exact: true })
      .waitFor();
    await page
      .getByText("Loading tasks…", { exact: true })
      .waitFor({ state: "hidden" });
    await page.addStyleTag({ content: "#preview-banner { display:none }" });
    assert.equal(new URL(page.url()).pathname, "/sessions");
    assert.ok(await page.title());
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
  };
  const drawer = page.getByRole("dialog");
  const open = async (id) => {
    await page
      .locator(`.tower-board [data-task-id="${id}"]`)
      .getByRole("button")
      .click();
  };
  const close = async () => {
    await drawer.getByRole("button", { name: "Close details" }).click();
  };
  const create = async (title, human = false) => {
    await page.getByRole("button", { name: "New draft", exact: true }).click();
    await page.getByLabel("Task title", { exact: true }).fill(title);
    await page
      .getByRole("button", { name: "Create draft", exact: true })
      .click();
    await drawer
      .getByRole("button", { name: "Complete draft", exact: true })
      .click();
    await drawer
      .getByLabel("Repository", { exact: true })
      .fill("sample/package");
    await drawer.getByLabel("Machine", { exact: true }).fill("local");
    await drawer
      .getByLabel("Specification", { exact: true })
      .fill("Produce a local test report.");
    await drawer
      .getByLabel("Acceptance criteria (one per line)", { exact: true })
      .fill("Report passes");
    if (human)
      await drawer.getByLabel("Risk", { exact: true }).selectOption("R2");
    await drawer
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/dispatch") && r.request().method() === "POST",
      ),
      drawer.getByRole("button", { name: "Dispatch", exact: true }).click(),
    ]);
    const t = (await fleet("GET", "tasks")).tasks.find(
      (t) => t.title === title,
    );
    assert.equal(t.status, "ready");
    await close();
    return t;
  };
  const complete = async (t) => {
    const { attempt } = await fleet("POST", `tasks/${t.id}/claim`, {
      worker_id: "test-worker",
      machine: "local",
      caps: ["codex"],
      repos: [{ remote: "sample/package", path: dir }],
    });
    return fleet("POST", `tasks/${t.id}/complete`, {
      attempt_id: attempt.id,
      epoch: attempt.lease_epoch,
      result: "Checks pass",
      artifacts: [
        { kind: "commit", name: "commit.txt", ref: "a".repeat(40) },
        { kind: "pr", name: "Example PR", ref: "https://example.com/pull/1" },
      ],
    });
  };
  await load();
  assert.equal(await page.locator("[data-column]").count(), 4);
  const auto = await create("Automatic local delivery");
  assert.equal((await complete(auto)).status, "done");
  const human = await create("Human local delivery", true);
  assert.equal((await complete(human)).status, "review");
  await load();
  await open(human.id);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/request_changes") && r.request().method() === "POST",
    ),
    drawer
      .getByRole("button", { name: "Request changes", exact: true })
      .click(),
  ]);
  assert.equal(
    (await fleet("GET", `tasks/${human.id}`)).task.status,
    "running",
  );
  await close();
  assert.equal((await complete(human)).status, "review");
  const decision = await fleet(
    "POST",
    "tasks",
    { title: "Choose the rollout", risk: "R2" },
    201,
  );
  await fleet("POST", `tasks/${decision.task.id}/dispatch`);
  await fleet(
    "POST",
    `tasks/${decision.task.id}/decision`,
    {
      question: "Which rollout should proceed?",
      options: [
        { label: "Gradual rollout", impact: "Lower risk", recommended: true },
        {
          label: "All at once",
          impact: "Faster, wider impact",
          recommended: false,
        },
      ],
    },
    201,
  );
  await load();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.workbenchTheme = t),
      theme,
    );
    await page.screenshot({ path: path.join(shots, `desktop-${theme}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shots, "mobile-dark.png") });
  await page.evaluate(
    () => (document.documentElement.dataset.workbenchTheme = "light"),
  );
  await page.screenshot({ path: path.join(shots, "mobile-light.png") });
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(decision.task.id);
  await drawer.getByRole("button", { name: /A · Gradual rollout/ }).waitFor();
  await page.screenshot({ path: path.join(shots, "decision.png") });
  await drawer.getByRole("button", { name: /A · Gradual rollout/ }).click();
  await page.waitForFunction(() => !document.querySelector(".tower-decision"));
  assert.equal(
    (await fleet("GET", `tasks/${decision.task.id}`)).task.status,
    "ready",
  );
  await close();
  await open(human.id);
  const downloaded = page.waitForEvent("download");
  await drawer
    .getByRole("button", { name: "Download", exact: true })
    .first()
    .click();
  const d = await downloaded;
  await d.saveAs(path.join(shots, "commit.txt"));
  assert.match(await readFile(path.join(shots, "commit.txt"), "utf8"), /aaaa/);
  await page.screenshot({ path: path.join(shots, "download.png") });
  const detail = await proxy("GET", `tasks/${human.id}`);
  assert.equal(detail.artifacts[1].external_url, "https://example.com/pull/1");
  const wrong = await fetch(
    proxyOrigin +
      `/api/plugins/workbench/fleet/artifacts/${detail.artifacts[0].id}/download?task_id=${auto.id}`,
    { headers: gate },
  );
  assert.equal(wrong.status, 404);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/approve") && r.request().method() === "POST",
    ),
    drawer
      .getByRole("button", { name: "Accept delivery", exact: true })
      .click(),
  ]);
  assert.equal(
    (await fleet("GET", `tasks/${human.id}`)).task.verified_by,
    "human",
  );
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/archive") && r.request().method() === "POST",
    ),
    drawer.getByRole("button", { name: "Archived", exact: true }).click(),
  ]);
  assert.equal(
    (await fleet("GET", `tasks/${human.id}`)).task.status,
    "archived",
  );
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/restore") && r.request().method() === "POST",
    ),
    drawer.getByRole("button", { name: "Restore", exact: true }).click(),
  ]);
  assert.equal((await fleet("GET", `tasks/${human.id}`)).task.status, "done");
  await close();
  // Concurrent server edit while a draft form is open: UI must show actionable conflict.
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await page.getByLabel("Task title", { exact: true }).fill("Concurrent draft");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await drawer
    .getByRole("button", { name: "Complete draft", exact: true })
    .click();
  await drawer.getByLabel("Repository", { exact: true }).fill("sample/package");
  await drawer.getByLabel("Machine", { exact: true }).fill("local");
  await drawer
    .getByLabel("Specification", { exact: true })
    .fill("Concurrent edit");
  await drawer
    .getByLabel("Acceptance criteria (one per line)", { exact: true })
    .fill("Checks pass");
  const conflict = (await fleet("GET", "tasks")).tasks.find(
    (t) => t.title === "Concurrent draft",
  );
  await fleet("PATCH", `tasks/${conflict.id}`, {
    revision: conflict.revision,
    title: "Updated elsewhere",
  });
  await drawer.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: /Reload and retry/ })
    .first()
    .waitFor();
  await page.screenshot({ path: path.join(shots, "409-conflict.png") });
  // Real workspace file download and post-publication symlink escape protection.
  await mkdir(path.join(dir, "workspace"));
  await writeFile(
    path.join(dir, "workspace", "report.txt"),
    "Local report passes\n",
  );
  const fileTask = (
    await fleet(
      "POST",
      "tasks",
      {
        title: "File boundary",
        kind: "code",
        workspace: path.join(dir, "workspace"),
      },
      201,
    )
  ).task;
  await fleet("POST", `tasks/${fileTask.id}/dispatch`);
  const { attempt: fa } = await fleet("POST", `tasks/${fileTask.id}/claim`, {
    worker_id: "file-worker",
    machine: "local",
  });
  await fleet("POST", `tasks/${fileTask.id}/complete`, {
    attempt_id: fa.id,
    epoch: fa.lease_epoch,
    artifacts: [{ kind: "report", name: "report.txt", ref: "report.txt" }],
  });
  const fileDetail = await proxy("GET", `tasks/${fileTask.id}`);
  const downloadURL = proxyOrigin + fileDetail.artifacts[0].download_url;
  assert.equal(
    await (await fetch(downloadURL, { headers: gate })).text(),
    "Local report passes\n",
  );
  await rm(path.join(dir, "workspace", "report.txt"));
  await writeFile(path.join(dir, "outside.txt"), "must not download");
  await symlink(
    path.join(dir, "outside.txt"),
    path.join(dir, "workspace", "report.txt"),
  );
  assert.equal((await fetch(downloadURL, { headers: gate })).status, 403);
  await proxy("GET", "tasks/does-not-exist", undefined, 404);
  // An expired decision remains visible in detail, but v2 rejects its submission.
  const exp = (
    await fleet("POST", "tasks", { title: "Expired choice", risk: "R2" }, 201)
  ).task;
  await fleet("POST", `tasks/${exp.id}/dispatch`);
  await fleet(
    "POST",
    `tasks/${exp.id}/decision`,
    {
      question: "Expired?",
      ttl_seconds: 1,
      options: [
        { label: "A", impact: "Small", recommended: true },
        { label: "B", impact: "Large", recommended: false },
      ],
    },
    201,
  );
  const ed = await proxy("GET", `tasks/${exp.id}`);
  await new Promise((r) => setTimeout(r, 1100));
  await proxy(
    "POST",
    `tasks/${exp.id}/decide`,
    {
      revision: ed.task.revision,
      decision_id: ed.open_decision.id,
      option_id: ed.open_decision.options[0].id,
    },
    410,
  );
  assert.deepEqual(errors, []);
  for (const secret of [token, review, origin])
    assert.ok(
      !browserData.join("\n").includes(secret),
      `Browser leaked ${secret}`,
    );
  console.log(
    "PASS real v2: create/PATCH/dispatch/claim/auto+human complete/request_changes/approve/decision/decide/artifacts/ownership/archive/restore/409/404/410/file+symlink403; screenshots " +
      shots,
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(shots, "failure.png") });
    console.error(await page.locator("body").innerText());
  }
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  await host?.close();
  for (const p of children) {
    p.kill("SIGTERM");
    await new Promise((r) => {
      if (p.exitCode !== null) return r();
      p.once("exit", r);
      setTimeout(() => {
        p.kill("SIGKILL");
        r();
      }, 2000).unref();
    });
  }
  await rm(dir, { recursive: true, force: true });
}
