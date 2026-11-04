// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cardRefresh, mergeCards, type CardDelta } from "../dashboard/src/task-control-refresh";
import type { Task } from "../dashboard/src/task-control-model";
afterEach(() => vi.useRealTimers());
const delta = (tasks: Task[] = [], full = false): CardDelta => ({ tasks, full, removed: [], cursors: { fast: "fast-cursor", slow: "slow-cursor" } });
it("polls active summaries at 7.5s / 30s with cursors; never requests terminal details", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => delta());
  const controller = cardRefresh({ fetch, apply: vi.fn(), error: vi.fn(), visible: () => true });
  controller.start();
  await vi.advanceTimersByTimeAsync(60001);
  expect(fetch.mock.calls.map((args: any[]) => args[0])).toEqual(["all", "fast", "fast", "fast", "fast", "slow", "fast", "fast", "fast", "fast", "slow"]);
  expect((fetch.mock.calls[1] as any[])[1]).toBe("fast-cursor");
  controller.stop();
});
it("pauses hidden pages, aborts in flight and coalesces resume/explicit refresh", async () => {
  vi.useFakeTimers(); let visible = true;
  const fetch = vi.fn(async (_lane, _cursor, signal: AbortSignal) => {
    await new Promise<void>(resolve => { setTimeout(resolve, 100); signal.addEventListener("abort", () => resolve()); });
    return delta();
  });
  const apply = vi.fn();
  const controller = cardRefresh({ fetch, apply, error: vi.fn(), visible: () => visible });
  controller.start(); await vi.advanceTimersByTimeAsync(1);
  visible = false; controller.visibility();
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetch).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
  visible = true; controller.visibility(); controller.refresh(); controller.refresh();
  await vi.advanceTimersByTimeAsync(101);
  expect(fetch).toHaveBeenCalledTimes(2); expect(apply).toHaveBeenCalledTimes(1);
  controller.stop();
});
it("backs off 15/30/60/120 seconds, preserves cursors on failure and never overlaps", async () => {
  vi.useFakeTimers(); let inflight = 0, peak = 0, fails = false;
  const fetch = vi.fn(async () => {
    peak = Math.max(peak, ++inflight);
    try { await new Promise(r => setTimeout(r, 100)); if (fails) throw new Error("offline"); return delta(); }
    finally { inflight--; }
  });
  const controller = cardRefresh({ fetch, apply: vi.fn(), error: vi.fn(), visible: () => true });
  controller.start(); await vi.advanceTimersByTimeAsync(101); fails = true;
  await vi.advanceTimersByTimeAsync(7600); expect(fetch).toHaveBeenCalledTimes(2);
  controller.refresh(); controller.refresh();
  await vi.advanceTimersByTimeAsync(14900); expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(200); expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(29900); expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(200); expect(fetch).toHaveBeenCalledTimes(4);
  expect(peak).toBe(1); controller.stop();
});
it("retains unchanged references, freezes terminal rows, and applies transitions/removals", () => {
  const running = { id: "active", status: "running", title: "Before" } as Task;
  const done = { id: "finished", status: "done", title: "Stable" } as Task;
  const rows = [running, done];
  expect(mergeCards(rows, delta())).toBe(rows);
  const changed = mergeCards(rows, delta([{ ...running, status: "done" }]));
  expect(changed[0].status).toBe("done"); expect(changed[1]).toBe(done);
  expect(mergeCards(changed, { ...delta(), removed: ["active"] })).toEqual([done]);
});
