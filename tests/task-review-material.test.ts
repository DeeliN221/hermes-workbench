import { describe, expect, it } from "vitest";
import {
  finalDeliverables,
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

describe("execution session entry points", () => {
  it("opens same-instance sessions locally and builds a safe remote chat link", () => {
    const local = sessionEntries({
      ...base,
      conversation_id: "local-1", conversation_profile: "writer", conversation_kind: "codex", conversation_local: true,
      machine: "dev-box",
    });
    expect(local[0]).toMatchObject({ canOpen: true, local: true, device: "dev-box", remoteUrl: "" });

    const remote = sessionEntries({
      ...base,
      machine: "nas",
      conversation_id: "remote-1", conversation_profile: "default", conversation_kind: "codex", conversation_local: false,
      conversation_machine: "nas",
      conversation_workbench_url: "https://nas.example-tailnet.ts.net/",
    });
    expect(remote[0]).toMatchObject({
      canOpen: true,
      local: false,
      device: "nas",
      remoteUrl: "https://nas.example-tailnet.ts.net/chat?session=remote-1&profile=default",
    });
  });

  it("never emits remote links with credentials, tokens or unresolved local paths", () => {
    const unsafe = [
      "https://user:pass@nas.example/chat",
      "https://nas.example/chat?token=secret",
      "/home/user/workbench",
      "nas.local:3000",
    ];
    for (const conversation_workbench_url of unsafe) {
      const [entry] = sessionEntries({
        ...base,
        machine: "nas",
        conversation_id: "remote-1", conversation_profile: "default", conversation_kind: "codex", conversation_local: false,
        conversation_workbench_url,
      });
      expect(entry.remoteUrl).toBe("");
      expect(entry.canOpen).toBe(false);
    }
  });

  it("uses a recorded MagicDNS machine name as the remote Workbench base", () => {
    const [entry] = sessionEntries({
      ...base,
      machine: "nas.tailnet-example.ts.net",
      conversation_id: "remote-1", conversation_profile: "default", conversation_kind: "codex", conversation_local: false,
    });
    expect(entry.device).toBe("nas.tailnet-example.ts.net");
    expect(entry.remoteUrl).toBe("https://nas.tailnet-example.ts.net/chat?session=remote-1&profile=default");
  });
});
