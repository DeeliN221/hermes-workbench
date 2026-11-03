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
export type Task = {
  id: string;
  title: string;
  status: Status;
  revision: number;
  read_only?: boolean;
  review_actions?: boolean;
  fleet_status?: string;
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
  spec_json?: { summary?: string };
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
    statuses: ["triage", "ready"],
  },
  {
    id: "active",
    label: () => uiText("进行中", "In progress"),
    statuses: ["running", "blocked"],
  },
  {
    id: "review",
    label: () => uiText("待你验收", "Your review"),
    statuses: ["review"],
  },
  {
    id: "done",
    label: () => uiText("已交付", "Delivered"),
    statuses: ["done"],
  },
];
export function statusLabel(s: Status): string {
  const labels: Record<Status, [string, string]> = {
    triage: ["草稿", "Draft"],
    ready: ["就绪", "Ready"],
    running: ["运行", "Running"],
    blocked: ["阻塞", "Blocked"],
    review: ["人工验收", "Human review"],
    done: ["已交付", "Delivered"],
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
