import type { FetchJSON } from "./workbench-api";
import {
  canMove,
  type Decision,
  type Task,
  type Detail,
  type Status,
  type Artifact,
} from "./task-control-model";
import { uiText } from "./ui-locale";
export const FLEET_PROXY = "/api/plugins/workbench/fleet";
export type Worker = { id: string; machine?: string; status: string; last_heartbeat?: string };
export type FleetConfig = {
  mode: "live" | "mock" | "unconfigured";
  extended_workflow: boolean;
};
export function fleetAPI(fetchJSON: FetchJSON, authedFetch?: (url: string, init?: RequestInit) => Promise<Response>) {
  const explicitDemo = typeof location !== "undefined" && new URLSearchParams(location.search).get("demo") === "1";
  let base = explicitDemo
    ? FLEET_PROXY : "/api/plugins/workbench/fleetd";
  const request = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
    revision?: number,
  ) => {
    if (method !== "GET" && base !== FLEET_PROXY && !(method === "POST" && /^\/tasks\/[A-Za-z0-9_-]+\/(approve|request_changes|note|archive|retry|decide)$/.test(path)))
      throw new Error(uiText("只读连接：请在 Fleet 中操作", "Read-only connection: use Fleet to make changes"));
    try {
      const url = base + path + (explicitDemo ? (path.includes("?") ? "&" : "?") + "demo=1" : "");
      const reviewWrite = method === "POST" && base !== FLEET_PROXY;
      const init = {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(revision === undefined ? {} : { "If-Match": String(revision) }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(reviewWrite ? 35000 : 12000),
      };
      if (reviewWrite && authedFetch) {
        const response = await authedFetch(url, init);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof data.detail === "string" ? data.detail : "Review failed"}`);
        return data as T;
      }
      return await fetchJSON<T>(url, init);
    } catch (error) {
      if (/Feedback saved/.test(String(error)))
        throw new Error(uiText("意见已保存，但任务退回失败。请刷新状态后重试；输入已保留。", "Feedback saved, but returning the task failed. Refresh and retry; your input is preserved."));
      if (/FLEET_REVIEW_TOKEN/.test(String(error)))
        throw new Error(uiText("服务端缺少独立的 FLEET_REVIEW_TOKEN，请配置后重试", "Configure a separate FLEET_REVIEW_TOKEN on the server, then retry."));
      if (/\b409\b/.test(String(error)))
        throw new Error(
          uiText(
            "任务已在别处更新，请刷新后重试",
            "Task changed elsewhere. Reload and retry.",
          ),
        );
      for (const [code, zh, en] of [
        [501, "Fleet 搜索接口尚未部署，无法查询全量任务", "Fleet search API is unavailable. Full task search requires the server update."],
        [401, "Fleet 身份验证失败 (401)，请检查服务端 token 后重试", "Fleet authentication failed (401). Check the server token and retry."],
        [503, "Fleet token 缺失或服务端配置不可用，请检查后重试", "Fleet token missing or server configuration unavailable. Check and retry."],
        [504, "Fleet 请求超时，请重试", "Fleet request timed out. Retry."],
        [502, "无法连接 Fleet 或服务端错误，请重试", "Cannot connect to Fleet or server error. Retry."],
        [
          403,
          "权限不足，请管理员检查人工验收凭据或产物访问权限",
          "Permission denied. Ask the administrator to check review credentials or artifact access.",
        ],
        [
          404,
          "任务或产物不存在，请刷新任务列表",
          "Task or artifact no longer exists. Refresh the task list.",
        ],
        [
          410,
          "决策已过期，请刷新并让执行者创建新决策",
          "Decision expired. Refresh and ask the worker for a new decision.",
        ],
      ] as const) {
        if (new RegExp(`\\b${code}\\b`).test(String(error)))
          throw new Error(uiText(zh, en));
      }
      if (error instanceof DOMException || /fetch|network|timeout/i.test(String(error)))
        throw new Error(uiText("Fleet 连接失败或超时，请重试", "Fleet connection failed or timed out. Retry."));
      throw error;
    }
  };
  return {
    config: async () => {
      const config = await request<FleetConfig>("/config");
      if (config.mode === "mock") base = FLEET_PROXY;
      return config;
    },
    snapshot: async () => {
      if (base === FLEET_PROXY) {
        const data = await request<{ tasks: Task[] }>("/tasks");
        return { tasks: data.tasks, workers: [] as Worker[], truncated: false };
      }
      const [data, decisions, workers] = await Promise.all([
        request<{ tasks: Task[]; possibly_truncated?: boolean }>("/tasks"),
        request<{ decisions: (Decision & { task_id: string })[] }>("/decisions"),
        request<{ workers: Worker[] }>("/workers"),
      ]);
      // An open decision may belong to a task outside v1's recent-list window.
      const ids = new Set(data.tasks.map(t => t.id));
      const missing = [...new Set(decisions.decisions.map(d => d.task_id).filter(id => !ids.has(id)))];
      const details = await Promise.all(missing.map(id => request<Detail>(`/tasks/${encodeURIComponent(id)}`)));
      return {
        tasks: [...data.tasks, ...details.map(d => d.task)].map(t => ({ ...t, decision: decisions.decisions.find(d => d.task_id === t.id) || null })),
        workers: workers.workers, truncated: !!data.possibly_truncated,
      };
    },
    list: async () => {
      const data = await request<{ tasks: Task[] } | Task[]>("/tasks");
      return Array.isArray(data) ? data : data.tasks;
    },
    search: (q: string, archived = false, cursor = "") => request<{ tasks: Task[]; next_cursor: string; has_more: boolean }>(
      `/tasks/search?${new URLSearchParams({ q, archived: String(archived), cursor })}`),
    lifecycle: (id: string, action: "archive" | "retry") => request(`/tasks/${encodeURIComponent(id)}/${action}`, "POST", {}),
    review: (id: string, action: "approve" | "request_changes", text?: string) =>
      request(`/tasks/${encodeURIComponent(id)}/${action}`, "POST", action === "approve" ? {} : { text }),
    detail: (id: string) => request<Detail>(`/tasks/${encodeURIComponent(id)}`),
    patch: (t: Task, changes: Partial<Task>) =>
      request(
        `/tasks/${encodeURIComponent(t.id)}`,
        "PATCH",
        { ...changes, revision: t.revision },
        t.revision,
      ),
    create: (title: string) => request<Detail>("/tasks", "POST", { title }),
    decide: (t: Task, decisionId: string, optionId: string) =>
      request(
        `/tasks/${encodeURIComponent(t.id)}/decide`,
        "POST",
        { decision_id: decisionId, option_id: optionId, ...(base === FLEET_PROXY ? { revision: t.revision } : {}) },
        t.revision,
      ),
    move: (t: Task, to: Status, extended: boolean) => {
      const error = canMove(t, to);
      if (error) return Promise.reject(new Error(error));
      const action =
        t.status === "triage" && to === "ready"
          ? "dispatch"
          : to === "archived"
            ? "archive"
            : t.status === "archived"
              ? "restore"
              : !extended && t.status === "review" && to === "done"
                ? "approve"
                : !extended && t.status === "review" && to === "running"
                  ? "request_changes"
                  : "transition";
      if (action === "transition" && !extended)
        return Promise.reject(
          new Error(
            uiText(
              "Fleet 尚未提供此人工状态转换接口；可在演示模式体验",
              "Fleet has not provided this manual transition API yet; try demo mode",
            ),
          ),
        );
      return request(
        `/tasks/${encodeURIComponent(t.id)}/${action}`,
        "POST",
        {
          ...(action === "transition" ? { status: to } : {}),
          revision: t.revision,
        },
        t.revision,
      );
    },
  };
}
export async function downloadArtifact(
  a: Artifact,
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  const response = await authedFetch(
    `${FLEET_PROXY}/artifacts/${encodeURIComponent(a.id)}/download?task_id=${encodeURIComponent(a.task_id)}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw new Error(
      uiText(
        `下载失败 (${response.status})，请刷新；权限错误请管理员检查产物访问权限`,
        `Download failed (${response.status}). Refresh; for permission errors ask the administrator to check artifact access.`,
      ),
    );
  const blob = await response.blob();
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = a.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
