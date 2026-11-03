import { uiText } from "./ui-locale";
export type Status =
  | "triage"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "archived"
  | "scheduled";
export type Check = { label: string; checked: boolean };
export type Decision = {
  id: string;
  question: string;
  options: {
    id: string;
    label: string;
    impact: string;
    recommended?: boolean;
  }[];
};
export type Attempt = {
  id?: string;
  status?: string;
  worker_id?: string;
  machine?: string;
  capability?: string;
  runner?: string;
  model_used?: string;
  final_model?: string;
  reasoning_effort?: string;
  conversation_id?: string;
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  evidence_json?: string;
};
export type Task = {
  id: string;
  title: string;
  status: Status;
  revision: number;
  read_only?: boolean;
  review_actions?: boolean;
  lifecycle_actions?: boolean;
  capability?: string;
  model_used?: string;
  reasoning_effort?: string;
  duration_seconds?: number;
  fleet_status?: string;
  stale?: boolean;
  source_session_id?: string;
  source_profile?: string;
  source_session_kind?: string;
  conversation_id?: string;
  conversation_profile?: string;
  conversation_kind?: string;
  conversation_local?: boolean;
  source_local?: boolean;
  blocked_reason?: string;
  error?: string;
  assignee?: string;
  attempt_count?: number;
  created_at: string;
  updated_at?: string;
  status_changed_at?: string;
  completed_at?: string;
  repo?: string;
  machine?: string;
  risk: string;
  priority: string;
  verify_mode?: "auto" | "human";
  verified_by?: string;
  acceptance: Check[];
  spec_json?: {
    summary?: string;
    prompt?: string;
    raw?: string;
    model?: string;
    reasoning_effort?: string;
    [key: string]: unknown;
  };
  attempts?: Attempt[];
  needs_human?: boolean;
  server_lifecycle?: boolean;
  decision?: Decision | null;
};
export type Artifact = {
  id: string;
  task_id: string;
  kind: string;
  name: string;
  ref?: string;
  sha?: string;
  size: number;
  content_type: string;
  download_url?: string;
  external_url?: string;
};
export type Detail = {
  task: Task;
  artifacts: Artifact[];
  decision?: Decision | null;
  open_decision?: Decision | null;
  review_notes?: { text: string; at: string }[];
  events?: { type: string; created_at: string }[];
  attempts?: unknown[];
  links?: { label: string; url: string }[];
};
export const columns: {
  id: string;
  label: () => string;
  statuses: Status[];
}[] = [
  {
    id: "pending",
    label: () => uiText("待处理", "Pending"),
    statuses: ["review", "blocked", "triage"],
  },
  { id: "queued", label: () => uiText("排队中", "Queued"), statuses: ["ready", "scheduled"] },
  { id: "active", label: () => uiText("进行中", "In progress"), statuses: ["running"] },
  {
    id: "done",
    label: () => uiText("已完成", "Completed"),
    statuses: ["done"],
  },
];
export function statusLabel(s: Status): string {
  const labels: Record<Status, [string, string]> = {
    triage: ["待处理", "Needs attention"],
    ready: ["就绪", "Ready"],
    running: ["运行", "Running"],
    blocked: ["阻塞", "Blocked"],
    review: ["人工验收", "Human review"],
    done: ["已完成", "Completed"],
    archived: ["已归档", "Archived"],
    scheduled: ["等待重试", "Retry scheduled"],
  };
  return uiText(...labels[s]);
}
export function verifyMode(t: Task): "auto" | "human" {
  return t.verify_mode || (["R0", "R1"].includes(t.risk) ? "auto" : "human");
}
export function attention(t: Task): boolean {
  return (
    !!t.decision ||
    (t.status === "review" && verifyMode(t) === "human") ||
    (t.status === "blocked" && t.needs_human === true)
  );
}
export function expired(t: Task, now = Date.now()): boolean {
  return (
    !t.server_lifecycle &&
    t.status === "done" &&
    now - Date.parse(t.created_at) > 3 * 86400000
  );
}
export function delivered(tasks: Task[], now = Date.now()): Task[] {
  return tasks
    .filter((t) => t.status === "done" && !expired(t, now))
    .sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        a.id.localeCompare(b.id),
    );
}

/** Attempt metadata is authoritative; a bare task status is not a run timer. */
export function taskAttempts(task: Task): Attempt[] {
  return Array.isArray(task.attempts) ? task.attempts.filter((attempt): attempt is Attempt => !!attempt && typeof attempt === "object") : [];
}

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function attemptEvidence(attempt: Attempt): Record<string, any> {
  if (!attempt.evidence_json) return {};
  try {
    const value = JSON.parse(attempt.evidence_json);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function attemptTime(attempt: Attempt, field: "started_at" | "ended_at"): number | null {
  return timestamp(attempt[field]);
}

/** Newest attempt first, independent of the server's list ordering. */
export function orderedAttempts(task: Task): Attempt[] {
  return [...taskAttempts(task)].sort((left, right) =>
    (attemptTime(right, "started_at") || 0) - (attemptTime(left, "started_at") || 0),
  );
}

export function hasStarted(task: Task): boolean {
  return taskAttempts(task).length > 0
    || Number(task.attempt_count || 0) > 0
    || !!task.conversation_id;
}

/** A task only ticks while its latest attempt is open and still assigned. */
export function activeAttempt(task: Task): Attempt | null {
  if (["done", "archived"].includes(task.status) || !task.assignee) return null;
  const latest = orderedAttempts(task)[0];
  if (!latest || attemptTime(latest, "started_at") === null || !!latest.ended_at) return null;
  return latest;
}

export function isZombieRunning(task: Task): boolean {
  return task.stale === true || (task.status === "running" && (!task.assignee || Array.isArray(task.attempts)) && !activeAttempt(task));
}

function latestAttempt(task: Task): Attempt | null {
  return orderedAttempts(task)[0] || null;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function plannedModel(task: Task): string {
  return firstText(task.spec_json?.model, task.model_used);
}

function attemptDurationMs(attempt: Attempt): number | null {
  const evidence = attemptEvidence(attempt);
  const direct = attempt.duration_ms ?? evidence.duration_ms;
  if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) return direct;
  const started = attemptTime(attempt, "started_at");
  const ended = attemptTime(attempt, "ended_at");
  if (started !== null && ended !== null) return Math.max(0, ended - started);
  return null;
}

/** Sum every finished attempt plus the live segment of the active one. */
export function elapsedMs(task: Task, now = Date.now()): number | null {
  const attempts = taskAttempts(task);
  const active = activeAttempt(task);
  let total = 0;
  let measured = false;
  for (const attempt of attempts) {
    if (active && attempt === active) continue;
    const duration = attemptDurationMs(attempt);
    if (duration !== null) {
      total += duration;
      measured = true;
    }
  }
  if (active) {
    const started = attemptTime(active, "started_at");
    if (started !== null) {
      total += Math.max(0, now - started);
      measured = true;
    }
  }
  if (!measured && typeof task.duration_seconds === "number" && Number.isFinite(task.duration_seconds)) {
    return Math.max(0, task.duration_seconds * 1000);
  }
  return measured ? total : null;
}

export function durationMinutes(task: Task, now = Date.now()): string {
  const elapsed = elapsedMs(task, now);
  if (elapsed === null) return "";
  return `${Math.max(0, Math.round(elapsed / 60000))}m`;
}

/** Plain values in the fixed card order; missing fields disappear entirely. */
export function runtimeParts(task: Task, now = Date.now()): string[] {
  if (!hasStarted(task)) {
    return [firstText(task.machine), plannedModel(task)].filter(Boolean);
  }
  const latest = latestAttempt(task);
  const evidence = latest ? attemptEvidence(latest) : {};
  const device = firstText(latest?.machine, evidence.machine, task.machine === "auto" ? "" : task.machine);
  const cli = firstText(latest?.runner, evidence.runner, latest?.capability, task.capability);
  const model = firstText(latest?.final_model, evidence.final_model, latest?.model_used, task.model_used);
  const effort = firstText(latest?.reasoning_effort, evidence.reasoning_effort, task.reasoning_effort, task.spec_json?.reasoning_effort);
  return [device, cli, model, effort, durationMinutes(task, now)].filter(Boolean);
}

export function runtimeLine(task: Task, now = Date.now()): string {
  return runtimeParts(task, now).join(" ");
}

/** The prompt/raw markdown is the detail body; never expose JSON wrapper fields. */
export function specMarkdown(task: Task): string {
  let spec: unknown = task.spec_json;
  if (typeof spec === "string") {
    const text = spec;
    try {
      spec = JSON.parse(text);
    } catch {
      return text.trim();
    }
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return "";
  const row = spec as Record<string, unknown>;
  for (const key of ["prompt", "raw", "summary"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function latestAttemptEnded(task: Task): boolean {
  const latest = latestAttempt(task);
  return !!latest && attemptTime(latest, "ended_at") !== null;
}

export function sessionEntries(task: Task): {
  label: "source" | "conversation";
  id: string;
  profile: string;
  kind: "hermes" | "codex" | "";
  canOpen: boolean;
}[] {
  const validKind = (kind: string | undefined): kind is "hermes" | "codex" => kind === "hermes" || kind === "codex";
  const finished = task.status === "done" || task.status === "archived";
  return [
    { label: "source" as const, id: task.source_session_id || "", profile: task.source_profile || "", kind: validKind(task.source_session_kind) ? task.source_session_kind : "" as const },
    { label: "conversation" as const, id: task.conversation_id || "", profile: task.conversation_profile || "", kind: validKind(task.conversation_kind) ? task.conversation_kind : "" as const },
  ].filter((row) => !!row.id).map((row) => ({
    ...row,
    canOpen: !!row.kind && (
      (row.label === "source" ? task.source_local !== false : task.conversation_local === true) || finished
    ),
  }));
}
export function decisionOptions(d: Decision, readOnly = false): Decision["options"] {
  if (readOnly) return d.options.filter(o => !!o.label);
  if (
    d.options.length < 2 ||
    d.options.length > 4 ||
    d.options.filter((o) => o.recommended).length !== 1 ||
    new Set(d.options.map((o) => o.id)).size !== d.options.length ||
    d.options.some((o) => !o.id || !o.label || !o.impact)
  )
    return [];
  return [...d.options].sort(
    (a, b) => Number(!!b.recommended) - Number(!!a.recommended),
  );
}
export function canMove(t: Task, to: Status): string | null {
  if (t.read_only) return uiText("只读连接：请在 Fleet 中操作", "Read-only connection: use Fleet to make changes");
  if (t.status === to)
    return to === "done"
      ? uiText(
          "已交付按建卡时间排序，不能手动重排",
          "Delivered is ordered by creation time; manual reordering is disabled",
        )
      : null;
  if (t.server_lifecycle) {
    if (
      to === "archived" &&
      ["triage", "ready", "scheduled", "blocked", "done"].includes(t.status)
    )
      return null;
    if (t.status === "archived" && to === "triage") return null;
    if (
      !(t.status === "triage" && to === "ready") &&
      !(t.status === "review" && ["running", "done"].includes(to))
    )
      return uiText(
        "此状态由执行者推进，请等待任务更新",
        "The worker controls this state. Wait for a task update.",
      );
  }
  const graph: Record<Status, Status[]> = {
    triage: ["ready"],
    ready: ["triage", "running"],
    running: ["blocked", "review", "done"],
    blocked: ["running"],
    review: ["running", "done"],
    done: ["archived"],
    archived: ["triage"],
    scheduled: ["ready"],
  };
  if (!graph[t.status].includes(to))
    return uiText("不允许此状态跳转", "This status transition is not allowed");
  if (t.decision) return uiText("请先完成决策", "Resolve the decision first");
  if (
    to === "ready" &&
    (!t.spec_json?.summary?.trim() ||
      !t.acceptance.length ||
      t.acceptance.some((c) => !c.label.trim()) ||
      !t.repo ||
      !t.machine)
  )
    return uiText(
      "请先补全规格、验收清单、仓库和机器",
      "Complete the specification, acceptance checklist, repository and machine first",
    );
  if (to === "review" && verifyMode(t) !== "human")
    return uiText(
      "自动验收任务直接交付",
      "Automatic verification goes directly to Delivered",
    );
  if (to === "done" && verifyMode(t) === "human" && t.status !== "review")
    return uiText(
      "请先进行人工验收",
      "Human verification must pass through Your review",
    );
  if (
    to === "done" &&
    (!t.acceptance.length || t.acceptance.some((c) => !c.checked))
  )
    return uiText("验收清单尚未完成", "The acceptance checklist is incomplete");
  return null;
}
export function reordered(tasks: Task[], id: string, before: string): Task[] {
  const task = tasks.find((t) => t.id === id),
    target = tasks.find((t) => t.id === before);
  if (
    !task ||
    !target ||
    task.status !== target.status ||
    task.status === "done" ||
    id === before
  )
    return tasks;
  const rest = tasks.filter((t) => t.id !== id);
  rest.splice(
    rest.findIndex((t) => t.id === before),
    0,
    task,
  );
  return rest;
}
export function safeLink(value: string): string | null {
  try {
    const u = new URL(value, location.origin);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
