// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const React = require("react");
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;
const { createRoot } = require("react-dom/client") as {
  createRoot: (host: HTMLElement) => {
    render: (node: unknown) => void;
    unmount: () => void;
  };
};
import { createTaskControlTower } from "../dashboard/src/task-control-tower";
import type { FetchJSON } from "../dashboard/src/workbench-api";
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
});
it("renders four responsive groups without toolbar, creation or duplicate attention panels", async () => {
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith("/fleetd/config"))
      return { mode: "live", extended_workflow: false } as T;
    if (url.endsWith("/fleetd/tasks/sync")) return { removed: [], cursors: {}, full: true, tasks: [] } as T;
    if (url.endsWith("/decisions")) return { decisions: [] } as T;
    if (url.endsWith("/workers")) return { workers: [] } as T;
    if (url.includes("profile-names")) return { profiles: [] } as T;
    return { items: [], sessions: [], groups: [] } as T;
  };
  const Component = createTaskControlTower(
    { React, hooks: React, fetchJSON },
    vi.fn(),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(Component, { profile: "default" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(host.querySelector(".tower-header, .tower-sidebar, .tower-create")).toBeNull();
  expect(host.querySelectorAll(".tower-board [data-column]")).toHaveLength(4);
  expect(host.querySelectorAll(".tower-action")).toHaveLength(0);
  expect(host.querySelectorAll(".tower-bottom-nav button")).toHaveLength(0);
  expect(host.querySelector(".tower-list")?.textContent).toContain("Pending");
});


it("retains the last complete snapshot on a failed refresh and recovers on retry", async () => {
  let title = "Previous successful task", fail = false;
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith("/config")) return { mode: "live", extended_workflow: false } as T;
    if (url.endsWith("/tasks/sync")) { if (fail) throw new Error("HTTP 504"); return { removed: [], cursors: {}, full: true, tasks: [{ id: "T-one", title, status: "running", risk: "R1", priority: "P1", revision: 0, created_at: new Date().toISOString(), acceptance: [], read_only: true }] } as T; }
    if (url.endsWith("/decisions")) { if (fail) throw new Error("HTTP 504"); return { decisions: [] } as T; }
    if (url.endsWith("/workers")) return { workers: [] } as T;
    return { profiles: [], items: [], sessions: [], groups: [] } as T;
  };
  const Component = createTaskControlTower({ React, hooks: React, fetchJSON }, vi.fn());
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => { root.render(React.createElement(Component, { profile: "default" })); await new Promise(r => setTimeout(r, 20)); });
  expect(host.textContent).toContain("Previous successful task");
  title = "New response task"; fail = true;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await new Promise(r => setTimeout(r, 20)); });
  expect(host.textContent).toContain("timed out");
  expect(host.textContent).toContain("Previous successful task");
  expect(host.textContent).not.toContain("New response task");
  fail = false;
  vi.useFakeTimers();
  await act(async () => { vi.setSystemTime(Date.now() + 16000); document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(1); });
  vi.useRealTimers();
  expect(host.textContent).toContain("New response task");
  expect(host.textContent).not.toContain("timed out");
});

it("renders compact runtime values, omits empty drawer blocks and hides archived cards by default", async () => {
  const task = {
    id: "T-runtime", title: "Runtime task", status: "review", risk: "R2", priority: "P1", revision: 0,
    created_at: new Date().toISOString(), acceptance: [{ label: "Pass", checked: true }], read_only: true,
    machine: "nas", capability: "codex", assignee: "W-nas", model_used: "gpt-5.2", reasoning_effort: "high",
    conversation_id: "c1", conversation_profile: "default", conversation_kind: "codex", conversation_local: true,
    source_session_id: "s1", source_profile: "default", source_session_kind: "hermes",
    attempts: [{ id: "a1", status: "ok", started_at: "2026-11-03T10:48:00Z", ended_at: "2026-11-03T11:00:00Z", model_used: "gpt-5.2", evidence_json: JSON.stringify({ duration_ms: 720000 }) }],
    spec_json: { prompt: "# Plan\n\n" + String.raw`- first\n- second` + "\n\n```ts\nconst ok = true;\n```\n\n[link](https://example.com)" },
  };
  const archived = { ...task, id: "T-archived", title: "Archived task", status: "archived" };
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith("/config")) return { mode: "live", extended_workflow: false } as T;
    if (url.endsWith("/tasks/archived")) return { removed: [], cursors: {}, full: true, tasks: [archived] } as T;
    if (url.endsWith("/tasks/sync")) return { removed: [], cursors: {}, full: true, tasks: [task] } as T;
    if (url.endsWith("/decisions")) return { decisions: [] } as T;
    if (url.endsWith("/workers")) return { workers: [] } as T;
    if (url.endsWith("/tasks/T-runtime")) return { task, artifacts: [], review_notes: [], attempts: task.attempts } as T;
    return { profiles: [], items: [], sessions: [], groups: [] } as T;
  };
  const Component = createTaskControlTower({ React, hooks: React, fetchJSON }, vi.fn());
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => { root.render(React.createElement(Component, { profile: "default" })); await new Promise(r => setTimeout(r, 30)); });
  const card = host.querySelector('.tower-card[data-task-id="T-runtime"]') as HTMLElement;
  expect(card.dataset.runtime).toMatch(/^nas codex gpt-5\.2 high \d+m$/);
  expect(card.textContent).not.toContain("未提供");
  expect(card.textContent).not.toMatch(/设备:|Device:|Model:/);
  expect(host.querySelector('[data-task-id="T-archived"]')).toBeNull();
  const archiveToggle = Array.from(host.querySelectorAll("button")).find(button => /Show archived|显示已归档/.test(button.textContent || "")) as HTMLButtonElement;
  await act(async () => { archiveToggle.click(); await new Promise(r => setTimeout(r, 20)); });
  expect(host.querySelector('.tower-card[data-task-id="T-archived"]')).not.toBeNull();
  await act(async () => { (Array.from(host.querySelectorAll("button")).find(button => /Hide archived|隐藏已归档/.test(button.textContent || "")) as HTMLButtonElement).click(); await new Promise(r => setTimeout(r, 10)); });
  expect(host.querySelector('[data-task-id="T-archived"]')).toBeNull();
  await act(async () => { (card.querySelector("button") as HTMLButtonElement).click(); await new Promise(r => setTimeout(r, 20)); });
  const drawer = host.querySelector(".tower-drawer") as HTMLElement;
  expect(drawer.querySelector("header")).toBeNull();
  expect(drawer.textContent).not.toContain("运行信息");
  expect(drawer.textContent).not.toContain("尚无产物");
  expect(drawer.textContent).toContain("Runtime task");
  await act(async () => { (drawer.querySelector("summary") as HTMLElement).click(); await new Promise(r => setTimeout(r, 10)); });
  expect(drawer.querySelector(".tower-markdown h1")?.textContent).toBe("Plan");
  expect(drawer.querySelectorAll(".tower-markdown li")).toHaveLength(2);
  expect(drawer.querySelector(".tower-markdown a")?.getAttribute("href")).toBe("https://example.com/");
  const toggle = Array.from(drawer.querySelectorAll("button")).find(button => button.textContent === "Show source")!;
  await act(async () => { toggle.click(); });
  expect(drawer.querySelector(".tower-spec-raw")?.textContent).toBe(task.spec_json.prompt);
  expect(drawer.querySelector(".tower-spec-raw")?.textContent).toContain(String.raw`- first\n- second`);
  await act(async () => { toggle.click(); });
  expect(drawer.querySelectorAll(".tower-markdown li")).toHaveLength(2);
});

it("keeps the done-card checkbox in the title row and labels bulk actions compactly", async () => {
  const task = {
    id: "T-done", title: "A completed task with a deliberately long title that may wrap", status: "done",
    risk: "R1", priority: "P1", revision: 0, created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    acceptance: [{ label: "Pass", checked: true }], read_only: true,
  };
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith("/config")) return { mode: "live", extended_workflow: false } as T;
    if (url.endsWith("/tasks/sync")) return { removed: [], cursors: {}, full: true, tasks: [task] } as T;
    if (url.endsWith("/decisions")) return { decisions: [] } as T;
    if (url.endsWith("/workers")) return { workers: [] } as T;
    return { profiles: [], items: [], sessions: [], groups: [] } as T;
  };
  const Component = createTaskControlTower({ React, hooks: React, fetchJSON }, vi.fn());
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => { root.render(React.createElement(Component, { profile: "default" })); await new Promise(r => setTimeout(r, 30)); });
  const card = host.querySelector('.tower-card[data-task-id="T-done"]') as HTMLElement;
  const select = card.querySelector(".tower-select") as HTMLElement;
  expect(select.parentElement?.classList.contains("tower-card-heading")).toBe(true);
  expect(select.querySelector('input[type="checkbox"]')?.getAttribute("aria-label")).toBe("Select task");
  expect(Array.from(host.querySelectorAll('.column-done .tower-column-actions button')).map(button => button.textContent)).toEqual(["Select", "Clear", "Archive", "Show archived"]);
});

it("does not render unchanged cards when another card changes", async () => {
  const renders: Record<string, number> = {};
  const ReactWithCounts = { ...React, memo: (component: any, equal: any) => React.memo((props: any) => {
    renders[props.task.id] = (renders[props.task.id] || 0) + 1;
    return component(props);
  }, equal) };
  let title = "Running";
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith("/config")) return { mode: "live", extended_workflow: false } as T;
    return { full: true, removed: [], cursors: {}, tasks: [
      { id: "running", title, status: "running", acceptance: [] },
      { id: "done", title: "Finished", status: "done", acceptance: [] },
    ] } as T;
  };
  const Component = createTaskControlTower({React: ReactWithCounts, hooks: React, fetchJSON}, vi.fn());
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => { root.render(React.createElement(Component, {profile: "default"})); });
  const before = {...renders};
  title = "Changed";
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await new Promise(r => setTimeout(r, 20)); });
  expect(renders.done).toBe(before.done);
  expect(renders.running).toBeGreaterThan(before.running);
  expect(host.textContent).toContain("Changed");
});

it("tints only pending blockers, labels their status and retains the tint when selected", async () => {
  const tasks = [
    { id: "blocked", status: "blocked" },
    { id: "fleet-blocked", status: "triage", fleet_status: "blocked" },
    { id: "ready", status: "ready" },
    { id: "triage", status: "triage" },
  ].map(t => ({ ...t, title: `Task ${t.id}`, revision: 1, created_at: new Date().toISOString(), acceptance: [], read_only: true }));
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith("/config")) return { mode: "live", extended_workflow: false } as T;
    if (url.endsWith("/tasks/sync")) return { removed: [], cursors: {}, full: true, tasks } as T;
    const task = tasks.find(t => url.endsWith(`/tasks/${t.id}`));
    if (task) return { task, artifacts: [], review_notes: [], attempts: [] } as T;
    return { decisions: [], workers: [], profiles: [], items: [], sessions: [], groups: [] } as T;
  };
  const Component = createTaskControlTower({ React, hooks: React, fetchJSON }, vi.fn());
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => { root.render(React.createElement(Component, { profile: "default" })); await new Promise(r => setTimeout(r, 20)); });
  for (const layout of [".tower-board", ".tower-list"]) {
    for (const id of ["blocked", "fleet-blocked", "ready", "triage"]) {
      const card = host.querySelector(`${layout} [data-task-id="${id}"]`)!;
      expect(card.classList.contains("is-pending-blocked")).toBe(id.includes("blocked"));
      if (id.includes("blocked")) {
        expect(card.getAttribute("aria-label")).toContain("Blocked");
        expect(card.querySelector(".tower-blocked-label")?.textContent).toBe("Blocked");
      }
    }
  }
  await act(async () => { host.querySelector<HTMLButtonElement>('.tower-board [data-task-id="blocked"] .tower-card-title')!.click(); await new Promise(r => setTimeout(r, 20)); });
  expect(host.querySelector('.tower-board [data-task-id="blocked"]')?.classList.contains("is-selected")).toBe(true);
  expect(host.querySelector('.tower-board [data-task-id="blocked"]')?.classList.contains("is-pending-blocked")).toBe(true);
});
