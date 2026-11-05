import { describe, expect, it } from "vitest";
import {
  finalDeliverables,
  declaredDeliverables,
  sessionEntries,
  stageReport,
  type Artifact,
  type Task,
} from "../dashboard/src/task-control-model";

const base: Task = {
  id: "review-1",
  title: "Review delivery",
  status: "review",
  revision: 1,
  risk: "R2",
  priority: "P1",
  verify_mode: "human",
  created_at: "2026-11-04T00:00:00Z",
  acceptance: [{ label: "Checks pass", checked: true }],
  spec_json: { summary: "Brief" },
};

describe("review focus material", () => {
  it("prefers explicit final links and compact final artifacts", () => {
    const artifact: Artifact = {
      id: "artifact-demo", task_id: base.id, kind: "screenshot", name: "final-flow.png",
      size: 2048, content_type: "image/png", external_url: "https://example.com/final-flow.png",
    };
    const rows = finalDeliverables({
      ...base,
      final_deliverables: [{ kind: "pr", label: "Pull request #42", url: "https://github.com/example/repo/pull/42" }],
    }, [artifact], [{ label: "Merged commit", url: "https://github.com/example/repo/commit/abc" }]);
    expect(rows.map((row) => row.kind)).toEqual(["pr", "merge", "screenshot"]);
    expect(rows[0].label).toBe("Pull request #42");
    expect(rows[2].artifact).toBeUndefined();
    expect(rows[2].url).toBe("https://example.com/final-flow.png");
    expect(rows).toHaveLength(3);
  });

  it("keeps download artifacts and rejects credential-bearing links", () => {
    const artifact: Artifact = {
      id: "artifact-report", task_id: base.id, kind: "report", name: "delivery.md",
      size: 512, content_type: "text/markdown", ref: "/private/never-open",
    };
    const rows = finalDeliverables({
      ...base,
      deliverables: [
        { kind: "pr", label: "Unsafe", url: "https://example.com/pr?token=secret" },
        { kind: "report", label: "Report", artifact_id: "artifact-report" },
      ],
    }, [artifact]);
    expect(rows).toHaveLength(1);
    expect(rows[0].artifact?.id).toBe("artifact-report");
    expect(JSON.stringify(rows)).not.toContain("secret");
    expect(JSON.stringify(rows)).not.toContain("never-open");
  });

  it("reduces a Markdown stage report to at most five short points and keeps a diagram", () => {
    const report = stageReport({
      ...base,
      stage_report: [
        "- UI implementation is complete.",
        "- Review token is still missing.",
        "- Next: verify both themes.",
        "- Next: merge after review.",
        "- Extra point one.",
        "- Extra point two.",
        "```mermaid\nflowchart LR\n  A --> B\n```",
      ].join("\n"),
    });
    expect(report?.conclusions).toHaveLength(5);
    expect(report?.format).toBe("mermaid");
    expect(report?.diagram).toContain("flowchart LR");
    expect(report?.conclusions.every((point) => point.length <= 112)).toBe(true);
  });

  it("synthesizes a three-part Mermaid report from structured progress", () => {
    const report = stageReport({
      ...base,
      stage_report: { status: "UI complete", blocker: "Review token missing", next: "Merge after review" },
    });
    expect(report?.conclusions).toEqual(["UI complete", "Review token missing", "Merge after review"]);
    expect(report?.format).toBe("mermaid");
    expect(report?.diagram).toContain("Progress · UI complete");
    expect(report?.diagram).toContain("Blocker · Review token missing");
    expect(stageReport(base)).toBeNull();
  });
});

describe("execution session metadata is never authorization", () => {
  it("never opens from local flags, done status, or task-provided URLs", () => {
    for (const status of ["review", "done", "archived"] as const) {
      for (const local of [true, false]) {
        const [entry] = sessionEntries({ ...base, status, conversation_id: "thread", conversation_kind: "codex",
          conversation_local: local, machine: "nas", conversation_workbench_url: "https://evil.example" });
        expect(entry).toMatchObject({ id: "thread", device: "nas", canOpen: false, remoteUrl: "" });
      }
    }
  });
  it("distinguishes a deliverable requirement from evidence and retains all artifact URLs", () => {
    const task = { ...base, deliverables: "PR/commit and screenshots required" };
    expect(declaredDeliverables(task)).toBe(true);
    expect(finalDeliverables(task)).toEqual([]);
    const rows = finalDeliverables(task, Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, task_id: task.id,
      kind: "url", name: `URL ${i}`, external_url: `https://example.com/${i}`, size: 0, content_type: "text/plain" })));
    expect(rows).toHaveLength(6);
  });
});
