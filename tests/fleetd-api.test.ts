import { describe, it, expect } from "vitest";
import { fleetAPI } from "../dashboard/src/task-control-api";
import type { FetchJSON } from "../dashboard/src/workbench-api";

describe("fleetd snapshot", () => {
  it("uses the read-only cursor endpoint and propagates failure atomically", async () => {
    let fail = false;
    const fetchJSON: FetchJSON = async <T>(url: string, init?: RequestInit) => {
      expect(url).toBe("/api/plugins/workbench/fleetd/tasks/sync");
      expect(JSON.parse(String(init?.body))).toEqual({lane: "fast", cursor: "opaque"});
      if (fail) throw new Error("HTTP 504");
      return { tasks: [], removed: [], cursors: {fast: "next"}, full: false } as T;
    };
    const api = fleetAPI(fetchJSON);
    expect((await api.sync("fast", "opaque")).cursors.fast).toBe("next");
    fail = true;
    await expect(api.sync("fast", "opaque")).rejects.toThrow("timed out");
  });
  it("uses v1 by default and rejects writes", async () => {
    const calls: string[] = [];
    const fetchJSON: FetchJSON = async <T>(url: string) => { calls.push(url); return { mode:"live" } as T; };
    const api = fleetAPI(fetchJSON);
    await api.config();
    expect(calls).toEqual(["/api/plugins/workbench/fleetd/config"]);
    await expect(api.create("No mutation")).rejects.toThrow("Read-only");
    expect(calls).toHaveLength(1);
  });
  it("uses the authenticated client for review and preserves actionable partial failures", async () => {
    let status = 200, detail = "";
    const calls: { url: string; body: unknown }[] = [];
    const fetchJSON: FetchJSON = async <T>() => ({} as T);
    const api = fleetAPI(fetchJSON, async (url, init) => {
      calls.push({url, body: JSON.parse(String(init?.body))});
      return new Response(JSON.stringify({detail}), {status});
    });
    await api.review("T-review", "request_changes", "First line\nSecond line");
    expect(calls[0]).toEqual({url:"/api/plugins/workbench/fleetd/tasks/T-review/request_changes", body:{text:"First line\nSecond line"}});
    status = 504; detail = "Feedback saved, but returning the task failed. Fleet request timed out";
    await expect(api.review("T-review", "request_changes", "Keep this")).rejects.toThrow("Feedback saved");
    status = 503; detail = "FLEET_REVIEW_TOKEN missing or invalid";
    await expect(api.review("T-review", "approve")).rejects.toThrow("FLEET_REVIEW_TOKEN");
    await expect(api.review("../unsafe", "approve")).rejects.toThrow("Read-only");
  });

});

it("sends Unicode search and opaque cursors to the server including archived scope", async () => {
  const calls: string[] = [];
  const api = fleetAPI(async <T>(url: string) => { calls.push(url); return { tasks: [], has_more: false, next_cursor: "" } as T; });
  await api.search("旧任务 %_", true, "page:a+/=");
  const url = new URL(calls[0], "http://localhost");
  expect(url.pathname).toBe("/api/plugins/workbench/fleetd/tasks/search");
  expect(Object.fromEntries(url.searchParams)).toEqual({q: "旧任务 %_", archived: "true", cursor: "page:a+/="});
});
