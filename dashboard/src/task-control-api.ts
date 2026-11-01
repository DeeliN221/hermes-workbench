import type { FetchJSON } from "./workbench-api";
import {
  canMove,
  type Task,
  type Detail,
  type Status,
  type Artifact,
} from "./task-control-model";
import { uiText } from "./ui-locale";
export const FLEET_PROXY = "/api/plugins/workbench/fleet";
export type FleetConfig = {
  mode: "live" | "mock" | "unconfigured";
  extended_workflow: boolean;
};
export function fleetAPI(fetchJSON: FetchJSON) {
  const request = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
    revision?: number,
  ) => {
    try {
      return await fetchJSON<T>(FLEET_PROXY + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(revision === undefined ? {} : { "If-Match": String(revision) }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      if (/\b409\b/.test(String(error)))
        throw new Error(
          uiText(
            "任务已在别处更新，请刷新后重试",
            "Task changed elsewhere. Reload and retry.",
          ),
        );
      throw error;
    }
  };
  return {
    config: () => request<FleetConfig>("/config"),
    list: async () => {
      const data = await request<{ tasks: Task[] } | Task[]>("/tasks");
      return Array.isArray(data) ? data : data.tasks;
    },
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
        { decision_id: decisionId, option_id: optionId, revision: t.revision },
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
        `下载失败 (${response.status})`,
        `Download failed (${response.status})`,
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
