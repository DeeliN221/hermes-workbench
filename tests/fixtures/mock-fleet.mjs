/** Stateful Fleet v2 stand-in. Extended lifecycle endpoints are mock-only. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const v1 = JSON.parse(readFileSync(new URL("./fleetd-v1.json", import.meta.url), "utf8"));
const iso = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
export function fixtureTask(id, status, extra = {}) {
  return {
    id,
    title: id,
    status,
    revision: 1,
    created_at: iso(5),
    status_changed_at: iso(1),
    repo: "sample/workbench",
    machine: "dev-box",
    risk: "R1",
    priority: "P2",
    spec_json: { summary: "Deliver an accessible task interface." },
    acceptance: [{ label: "Checks pass", checked: status !== "triage" }],
    ...extra,
  };
}
export async function createMockFleet() {
  const v1 = structuredClone(JSON.parse(readFileSync(new URL("./fleetd-v1.json", import.meta.url), "utf8")));
  v1.tasks.tasks.push({...v1.tasks.tasks.find(t => t.id === 'T-blocked'), id:'T-decision', title:'Choose an execution approach'});
  v1.decisions.decisions.push({id:'D-choice', task_id:'T-decision', status:'open', question:'Choose the next step', options:['Retry safely','Stop here']});
  Object.assign(v1.tasks.tasks.find(t => t.id === 'T-review'), {
    source_session_id:'codex-preview', source_profile:'default', source_session_kind:'codex',
    conversation_id:'codex-preview', conversation_profile:'writer', conversation_kind:'codex',
    model_used:'sample-model', reasoning_effort:'high', duration_seconds:632,
  });
  const reviewEvents = {};
  const decision = {
    id: "decision-1",
    question: "Which rollout should the agent prepare?",
    options: [
      {
        id: "gradual",
        label: "Gradual rollout",
        impact: "Lower risk; takes one extra day.",
        recommended: true,
      },
      {
        id: "all",
        label: "All at once",
        impact: "Faster delivery; broader rollback scope.",
      },
      {
        id: "hold",
        label: "Hold the change",
        impact: "No rollout risk; delivery is postponed.",
      },
    ],
  };
  let rows = [
    fixtureTask("draft-brief", "triage", {
      title: "Outline the export experience",
      acceptance: [],
      spec_json: {},
    }),
    fixtureTask("ready-a", "ready", {
      title: "Polish keyboard navigation",
      priority: "P1",
    }),
    fixtureTask("ready-b", "ready", { title: "Check attachment names" }),
    fixtureTask("running-a", "running", {
      title: "Improve workspace search",
      acceptance: [
        { label: "Search tests pass", checked: false },
        { label: "Keyboard navigation works", checked: true },
      ],
    }),
    fixtureTask("decision-task", "blocked", {
      title: "Choose the rollout approach",
      risk: "R2",
      needs_human: true,
      decision,
    }),
    fixtureTask("blocked-agent", "blocked", {
      title: "Retry the integration suite",
      needs_human: false,
    }),
    fixtureTask("review-task", "review", {
      title: "Verify the download experience",
      risk: "R2",
      verify_mode: "human",
      priority: "P1",
    }),
    fixtureTask("delivered-new", "done", {
      title: "Ship accessible empty states",
      created_at: iso(2),
      completed_at: iso(1),
      verified_by: "agent",
    }),
    fixtureTask("delivered-old", "done", {
      title: "Document the task workflow",
      created_at: iso(20),
      completed_at: iso(0.5),
      verified_by: "agent",
    }),
    fixtureTask("expired-delivery", "done", {
      title: "Previous delivery",
      created_at: iso(74),
      completed_at: iso(1),
    }),
  ];
  const calls = [];
  const artifacts = [
    {
      id: "artifact-report",
      task_id: "review-task",
      kind: "report",
      name: "acceptance-report.txt",
      ref: "/private/never-open-this",
      size: 24,
      content_type: "text/plain",
      download_url: "https://untrusted.example/never-follow",
    },
  ];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const send = (status, data) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(data));
    };
    if (!["Bearer mock-fleet-token", "Bearer mock-review-token"].includes(request.headers.authorization))
      return send(401, { detail: "Unauthorized" });
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({
      path: url.pathname,
      method: request.method,
      body,
      ifMatch: request.headers["if-match"],
    });
    const lifecycle = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/(archive|retry|decide)$/);
    if (request.method === "POST" && lifecycle) {
      const [, id, action] = lifecycle;
      const task = v1.tasks.tasks.find(t => t.id === id);
      if (!task || task.status !== (action === "archive" ? "done" : "blocked")) return send(409, {});
      task.status = action === "archive" ? "archived" : "ready";
      v1.decisions.decisions = v1.decisions.decisions.filter(d => d.task_id !== id);
      return send(200, {task});
    }
    const reviewMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/(approve|request_changes|note)$/);
    if (request.method === "POST" && reviewMatch) {
      const [, id, action] = reviewMatch;
      const task = v1.tasks.tasks.find(t => t.id === id);
      if (!task) return send(404, {});
      if (action !== "note" && request.headers.authorization !== "Bearer mock-review-token") return send(403, {});
      if (task.status !== "review") return send(409, {});
      if (action === "note") (reviewEvents[id] ||= []).push({type: "task.note", payload: body.text});
      else task.status = action === "approve" ? "done" : "running";
      return send(200, {ok: true});
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/v1/")) {
      const resource = url.pathname.slice("/api/v1/".length);
      if (resource === "tasks") {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        const rows = v1.tasks.tasks.filter(t => (url.searchParams.get("include_archived") === "1" || t.status !== "archived")
          && (!url.searchParams.has("status") || t.status === url.searchParams.get("status"))
          && [t.title, t.id, t.repo].some(v => String(v || "").toLowerCase().includes(q)));
        const start = Number(url.searchParams.get("cursor") || 0), limit = url.searchParams.has("q") ? 2 : 100;
        const has_more = rows.length > start + limit;
        return send(200, {tasks: rows.slice(start, start + limit), has_more, next_cursor: has_more ? String(start + limit) : ""});
      }
      if (resource.startsWith("tasks/")) {
        const task = v1.tasks.tasks.find(t => t.id === resource.slice(6));
        return task ? send(200, {...v1.task, task, events: reviewEvents[task.id] || []}) : send(404, {detail: "Not found"});
      }
      return send(200, v1[resource] || {});
    }
    const match = url.pathname.match(
      /^\/api\/v2\/tasks\/([^/]+)(?:\/([^/]+))?$/,
    );
    if (url.pathname === "/api/v2/tasks" && request.method === "GET")
      return send(200, {
        tasks: rows.filter(
          (t) =>
            !url.searchParams.has("status") ||
            t.status === url.searchParams.get("status"),
        ),
      });
    if (url.pathname === "/api/v2/tasks" && request.method === "POST") {
      const task = fixtureTask(`created-${rows.length}`, "triage", {
        title: body.title,
        repo: "",
        machine: "",
        acceptance: [],
        spec_json: {},
        created_at: iso(0),
      });
      rows.push(task);
      return send(201, { task });
    }
    if (url.pathname === "/api/v2/artifacts/artifact-report/download") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("Acceptance checks pass.\n");
      return;
    }
    if (!match) return send(404, { detail: "Not found" });
    const [, id, action] = match,
      task = rows.find((t) => t.id === id);
    if (!task) return send(404, { detail: "Not found" });
    const detail = () => ({
      task,
      artifacts: artifacts.filter((a) => a.task_id === id),
      open_decision: task.decision || null,
      attempts: [{ log: "RAW LOG MUST NOT REACH BROWSER" }],
      events: [{ raw: "RAW EVENT" }],
    });
    if (request.method === "GET") return send(200, detail());
    if (
      String(task.revision) !== request.headers["if-match"] ||
      body.revision !== task.revision
    )
      return send(409, { detail: "Revision conflict" });
    if (request.method === "PATCH") Object.assign(task, body);
    else if (action === "decide") {
      task.decision = null;
      task.needs_human = false;
    } else {
      task.status =
        { dispatch: "ready", archive: "archived", restore: "triage" }[action] ||
        body.status;
      task.status_changed_at = iso(0);
      if (task.status === "done") {
        task.completed_at = iso(0);
        task.verified_by =
          task.verify_mode === "human" ||
          (!task.verify_mode && ["R2", "R3"].includes(task.risk))
            ? "human"
            : "agent";
      }
    }
    task.revision++;
    return send(200, detail());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    calls,
    reviewTask: () => v1.tasks.tasks.find(t => t.id === "T-review"),
    get tasks() {
      return rows;
    },
    emptyAttention() {
      rows = rows.filter(
        (t) =>
          !t.decision &&
          t.status !== "review" &&
          !(t.status === "blocked" && t.needs_human),
      );
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
