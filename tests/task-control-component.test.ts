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
it("renders quiet empty state, four columns and a mobile navigation without attention actions", async () => {
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith("/fleetd/config"))
      return { mode: "live", extended_workflow: false } as T;
    if (url.endsWith("/fleetd/tasks")) return { tasks: [] } as T;
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
  expect(host.textContent).toContain("Nothing needs you now");
  expect(host.querySelectorAll("[data-column]")).toHaveLength(4);
  expect(host.querySelectorAll(".tower-action")).toHaveLength(0);
  expect(host.querySelectorAll(".tower-bottom-nav button")).toHaveLength(2);
  expect(host.querySelector(".tower-list")?.textContent).toContain("Needs you");
});


it("retains the last complete snapshot on a failed refresh and recovers on retry", async () => {
  let title = "Previous successful task", fail = false;
  const fetchJSON: FetchJSON = async <T>(url: string) => {
    if (url.endsWith("/config")) return { mode: "live", extended_workflow: false } as T;
    if (url.endsWith("/tasks")) return { tasks: [{ id: "T-one", title, status: "running", risk: "R1", priority: "P1", revision: 0, created_at: new Date().toISOString(), acceptance: [], read_only: true }] } as T;
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
  await act(async () => { (host.querySelector(".tower-connection button") as HTMLButtonElement).click(); await new Promise(r => setTimeout(r, 20)); });
  expect(host.textContent).toContain("Data stale");
  expect(host.textContent).toContain("Previous successful task");
  expect(host.textContent).not.toContain("New response task");
  fail = false;
  await act(async () => { (host.querySelector(".tower-connection button") as HTMLButtonElement).click(); await new Promise(r => setTimeout(r, 20)); });
  expect(host.textContent).toContain("New response task");
  expect(host.textContent).not.toContain("Data stale");
});
