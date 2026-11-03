import { describe, it, expect } from "vitest";
import { fleetAPI } from "../dashboard/src/task-control-api";
import type { FetchJSON } from "../dashboard/src/workbench-api";

describe("fleetd snapshot", () => {
  it("keeps all feeds atomic, supports empty lists, and attaches real decisions", async () => {
    let fail = false;
    const fetchJSON: FetchJSON = async <T>(url: string) => {
      if (url.endsWith("decisions")) {
        if (fail) throw new Error("HTTP 504");
        return { decisions: [{ id: "1", task_id: "T-one", question: "Choose?", options: [{id:"0",label:"A Retry",impact:""}] }] } as T;
      }
      if (url.endsWith("workers")) return { workers: [] } as T;
      return { tasks: [{ id: "T-one", title: "Task", status: "review" }] } as T;
    };
    const api = fleetAPI(fetchJSON);
    const previous = await api.snapshot();
    expect(previous.tasks[0].decision?.question).toBe("Choose?");
    expect(previous.workers).toEqual([]);
    fail = true;
    await expect(api.snapshot()).rejects.toThrow("timed out");
    expect(previous.tasks[0].title).toBe("Task");
    const empty: FetchJSON = async <T>() => ({tasks:[],decisions:[],workers:[]} as T);
    expect((await fleetAPI(empty).snapshot()).tasks).toEqual([]);
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
