// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const React = require("react");
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
    if (url.endsWith("/fleet/config"))
      return { mode: "mock", extended_workflow: true } as T;
    if (url.endsWith("/fleet/tasks")) return { tasks: [] } as T;
    if (url.includes("profile-names")) return { profiles: [] } as T;
    return { items: [], sessions: [], groups: [] } as T;
  };
  const Component = createTaskControlTower(
    { React, hooks: React, fetchJSON },
    vi.fn(),
    () => null,
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
  expect(host.querySelectorAll(".tower-bottom-nav button")).toHaveLength(3);
  expect(host.querySelector(".tower-list")?.textContent).toContain("Needs you");
});
