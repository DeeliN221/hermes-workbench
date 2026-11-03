import { describe, expect, it, vi } from "vitest";
import {
  attention,
  activeAttempt,
  canMove,
  columns,
  decisionOptions,
  delivered,
  expired,
  isZombieRunning,
  reordered,
  runtimeLine,
  sessionEntries,
  specMarkdown,
  verifyMode,
  type Task,
} from "../dashboard/src/task-control-model";
import { downloadArtifact, fleetAPI } from "../dashboard/src/task-control-api";
import type { FetchJSON } from "../dashboard/src/workbench-api";
const base: Task = {
  id: "one",
  title: "One",
  status: "running",
  revision: 1,
  risk: "R1",
  priority: "P2",
  created_at: "2026-10-30T00:00:00Z",
  repo: "sample/repo",
  machine: "dev-box",
  spec_json: { summary: "Brief" },
  acceptance: [{ label: "Works", checked: true }],
};
describe("task control tower", () => {
  it("maps exactly four columns and reserves review for human verification", () => {
    expect(columns.map((c) => c.statuses)).toEqual([
      ["review", "blocked", "triage"],
      ["ready", "scheduled"],
      ["running"],
      ["done"],
    ]);
    expect(canMove(base, "review")).toBeTruthy();
    expect(canMove(base, "done")).toBeNull();
    expect(canMove({ ...base, risk: "R2" }, "done")).toBeTruthy();
    expect(
      canMove(
        {
          ...base,
          risk: "R2",
          acceptance: [{ label: "Review deliverable", checked: false }],
        },
        "review",
      ),
    ).toBeNull();
    expect(
      canMove({ ...base, risk: "R2", status: "review" }, "done"),
    ).toBeNull();
    expect(verifyMode({ ...base, risk: "R3", verify_mode: "auto" })).toBe(
      "auto",
    );
  });
  it("only escalates decisions, human reviews and human blockers", () => {
    expect(attention(base)).toBe(false);
    expect(attention({ ...base, status: "blocked" })).toBe(false);
    expect(attention({ ...base, status: "blocked", needs_human: true })).toBe(
      true,
    );
    expect(attention({ ...base, status: "review" })).toBe(false);
    expect(attention({ ...base, status: "review", risk: "R2" })).toBe(true);
    expect(
      attention({ ...base, decision: { id: "d", question: "?", options: [] } }),
    ).toBe(true);
    expect(
      [base, { ...base, status: "done" as const }].filter(attention),
    ).toEqual([]);
  });
  it("blocks invalid transitions, incomplete dispatch and premature delivery", () => {
    expect(canMove({ ...base, status: "triage" }, "done")).toBeTruthy();
    expect(
      canMove({ ...base, status: "triage", repo: "" }, "ready"),
    ).toBeTruthy();
    expect(canMove({ ...base, status: "triage" }, "ready")).toBeNull();
    expect(canMove({ ...base, status: "ready" }, "triage")).toBeNull();
    expect(canMove(base, "blocked")).toBeNull();
    expect(canMove({ ...base, status: "blocked" }, "running")).toBeNull();
    expect(canMove({ ...base, acceptance: [] }, "done")).toBeTruthy();
    expect(
      canMove(
        { ...base, acceptance: [{ label: "Works", checked: false }] },
        "done",
      ),
    ).toBeTruthy();
  });
  it("reorders within a subgroup while delivered remains creation-sorted", () => {
    const second = { ...base, id: "two" };
    expect(reordered([base, second], "two", "one").map((t) => t.id)).toEqual([
      "two",
      "one",
    ]);
    expect(
      reordered([base, { ...second, status: "blocked" }], "two", "one")[0].id,
    ).toBe("one");
    expect(canMove({ ...base, status: "done" }, "done")).toBeTruthy();
    const now = Date.parse("2026-11-01T00:00:00Z");
    const old = {
      ...base,
      id: "old",
      status: "done" as const,
      created_at: "2026-10-27T00:00:00Z",
    };
    const earlier = {
      ...base,
      id: "earlier",
      status: "done" as const,
      completed_at: "2026-11-01T00:00:00Z",
    };
    const later = {
      ...base,
      id: "later",
      status: "done" as const,
      created_at: "2026-10-31T00:00:00Z",
      completed_at: "2026-10-31T00:00:00Z",
    };
    expect(delivered([earlier, old, later], now).map((t) => t.id)).toEqual([
      "later",
      "earlier",
    ]);
    expect(expired(old, now)).toBe(true);
    expect(expired({ ...old, created_at: "2026-10-29T00:00:00Z" }, now)).toBe(
      false,
    );
  });
  it("requires 2–4 complete distinct options and puts recommendation first", () => {
    const option = { id: "a", label: "A", impact: "Impact" };
    expect(
      decisionOptions({ id: "d", question: "?", options: [option] }),
    ).toEqual([]);
    expect(
      decisionOptions({ id: "d", question: "?", options: [option, option] }),
    ).toEqual([]);
    expect(
      decisionOptions({
        id: "d",
        question: "?",
        options: [option, { ...option, id: "b", recommended: true }],
      })[0].id,
    ).toBe("b");
    expect(
      decisionOptions({
        id: "d",
        question: "?",
        options: Array.from({ length: 5 }, (_, i) => ({
          ...option,
          id: String(i),
        })),
      }),
    ).toEqual([]);
  });
  it("forwards revisions and uses only contracted live operations", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchJSON: FetchJSON = async <T>(url: string, init?: RequestInit) => {
      if (url.endsWith("/config")) return { mode: "mock", extended_workflow: true } as T;
      calls.push({ url, init });
      return {} as T;
    };
    const api = fleetAPI(fetchJSON);

    await api.config();
    await api.move({ ...base, status: "triage" }, "ready", false);
    expect(calls[0].url).toMatch(/\/dispatch$/);
    expect(calls[0].init?.headers).toMatchObject({ "If-Match": "1" });
    await expect(api.move(base, "blocked", false)).rejects.toThrow();
    expect(calls).toHaveLength(1);
    await api.decide(base, "decision-1", "a");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      decision_id: "decision-1",
      option_id: "a",
      revision: 1,
    });
  });
  it("reports failed artifact downloads and never follows upstream URLs", async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("denied", { status: 403 }),
    );
    await expect(
      downloadArtifact(
        {
          id: "a",
          task_id: "one",
          name: "report.txt",
          kind: "report",
          size: 5,
          content_type: "text/plain",
          download_url: "https://wrong.example",
        },
        fetch,
      ),
    ).rejects.toThrow("403");
    expect(fetch.mock.calls[0][0]).toBe(
      "/api/plugins/workbench/fleet/artifacts/a/download?task_id=one",
    );
  });
});

describe("real v2 UI boundary", () => {
  it("keeps worker states authoritative and restores old deliveries visibly", () => {
    const live = { ...base, server_lifecycle: true };
    expect(canMove(live, "done")).toBeTruthy();
    expect(canMove({ ...live, status: "ready" }, "running")).toBeTruthy();
    expect(canMove({ ...live, status: "triage" }, "archived")).toBeNull();
    expect(expired({ ...live, status: "done", created_at: "2000-01-01" })).toBe(
      false,
    );
  });
  it("uses review endpoints only for explicit live review actions", async () => {
    const fetchJSON = vi.fn(async () => ({ mode: "mock", extended_workflow: true })) as unknown as FetchJSON;
    const api = fleetAPI(fetchJSON);

    await api.config();
    vi.mocked(fetchJSON).mockClear();
    const review = {
      ...base,
      status: "review" as const,
      verify_mode: "human" as const,
      acceptance: [{ label: "Pass", checked: true }],
    };
    await api.move(review, "done", false);
    await api.move(review, "running", false);
    expect(vi.mocked(fetchJSON).mock.calls.map((c) => c[0])).toEqual([
      "/api/plugins/workbench/fleet/tasks/one/approve",
      "/api/plugins/workbench/fleet/tasks/one/request_changes",
    ]);
  });
  it.each([403, 404, 409, 410])("makes HTTP %s actionable", async (code) => {
    const api = fleetAPI(async () => {
      throw new Error(`HTTP ${code}`);
    });
    await expect(api.detail("one")).rejects.toThrow(
      /administrator|Refresh|Reload/,
    );
  });
});

describe("card runtime metadata", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  const started = {
    ...base,
    status: "review" as const,
    machine: "nas",
    capability: "codex",
    assignee: "W-nas",
    attempts: [{
      id: "A-1", status: "ok", started_at: "2026-11-03T10:48:00Z", ended_at: "2026-11-03T11:00:00Z",
      model_used: "gpt-5.2", evidence_json: JSON.stringify({ final_model: "gpt-5.2", runner: "codex", duration_ms: 720000 }),
    }],
    spec_json: { reasoning_effort: "high" },
  };
  it("renders fixed-order plain values and final minutes for executed review tasks", () => {
    expect(runtimeLine(started, now)).toBe("nas codex gpt-5.2 high 12m");
  });
  it("shows only preference values before any attempt", () => {
    const queued = { ...base, status: "ready" as const, machine: "home", attempts: [], spec_json: { model: "gpt-5.2" } };
    expect(runtimeLine(queued, now)).toBe("home gpt-5.2");
    expect(runtimeLine({ ...queued, status: "blocked" as const, attempts: [], conversation_id: undefined }, now)).toBe("home gpt-5.2");
  });
  it("keeps blocked attempts visible instead of treating the status as unstarted", () => {
    const blocked = { ...started, status: "blocked" as const };
    expect(runtimeLine(blocked, now)).toBe("nas codex gpt-5.2 high 12m");
  });
  it("stops ticking zombie running tasks and freezes completed totals", () => {
    const zombie = { ...started, status: "running" as const, assignee: undefined,
      attempts: [{ ...started.attempts[0], model_used: "gpt-5.2" }] };
    expect(activeAttempt(zombie)).toBeNull();
    expect(isZombieRunning(zombie)).toBe(true);
    expect(runtimeLine(zombie, now)).toBe("nas codex gpt-5.2 high 12m");
    const active = { ...started, status: "running" as const, attempts: [{
      ...started.attempts[0], ended_at: undefined, evidence_json: undefined, started_at: "2026-11-03T11:50:00Z",
    }] };
    expect(activeAttempt(active)).not.toBeNull();
    expect(runtimeLine(active, now)).toBe("nas codex gpt-5.2 high 10m");
  });
  it("omits missing metadata instead of writing placeholders", () => {
    const sparse = { ...started, machine: undefined, capability: undefined, attempts: [],
      attempt_count: 1, conversation_id: "c", spec_json: { reasoning_effort: "medium" } };
    expect(runtimeLine(sparse, now)).toBe("medium");
    expect(runtimeLine(sparse, now)).not.toMatch(/未提供|Not recorded|未知/);
  });
  it("opens local sessions immediately and remote sessions only after the run ends", () => {
    const local = { ...started, status: "running" as const, source_session_id: "s", source_profile: "default", source_session_kind: "hermes" as const,
      conversation_id: "c", conversation_profile: "writer", conversation_kind: "codex" as const, conversation_local: true };
    expect(sessionEntries(local).filter((row) => row.canOpen)).toHaveLength(2);
    const remote = { ...local, conversation_local: false, attempts: [{ ...started.attempts[0], ended_at: undefined }] };
    expect(sessionEntries(remote).find((row) => row.label === "conversation")?.canOpen).toBe(false);
    expect(sessionEntries({ ...remote, status: "done" as const }).find((row) => row.label === "conversation")?.canOpen).toBe(true);
  });
  it("renders spec prompt Markdown and never exposes the JSON wrapper", () => {
    expect(specMarkdown({ ...base, spec_json: { prompt: "# Title\n- one", model: "x" } })).toBe("# Title\n- one");
    expect(specMarkdown({ ...base, spec_json: { raw: "## Raw" } })).toBe("## Raw");
  });
});
