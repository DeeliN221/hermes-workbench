import { uiText as tr } from "./ui-locale";
import type { FetchJSON } from "./workbench-api";
import {
  fleetAPI,
  downloadArtifact,
  type FleetConfig,
  type Worker,
} from "./task-control-api";
import {
  attention,
  canMove,
  columns,
  decisionOptions,
  delivered,
  expired,
  reordered,
  safeLink,
  statusLabel,
  verifyMode,
  type Detail,
  type Status,
  type Task,
} from "./task-control-model";
import { loadHomeProfiles } from "./home-profiles";
import { openHomeConversation } from "./home-navigation";
import type { RecentSession } from "./recent-home";

type SDK = {
  React: any;
  hooks: {
    useState: <T>(
      initial: T | (() => T),
    ) => [T, (value: T | ((previous: T) => T)) => void];
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => void;
    useRef: <T>(initial: T) => { current: T };
  };
  fetchJSON: FetchJSON;
  authedFetch?: (url: string, init?: RequestInit) => Promise<Response>;
};
export function createTaskControlTower(
  sdk: SDK,
  navigate: (path: string, profile: string) => void,
  RecentHome: any,
) {
  const h = sdk.React.createElement,
    { useState, useEffect, useRef } = sdk.hooks,
    api = fleetAPI(sdk.fetchJSON);
  const btn = (
    label: string,
    onClick: () => void,
    extra: Record<string, unknown> = {},
  ) => h("button", { type: "button", onClick, ...extra }, label);
  function TaskControlTower({ profile }: { profile: string }) {
    const [tasks, setTasks] = useState([] as Task[]),
      [config, setConfig] = useState(null as FleetConfig | null);
    const [workers, setWorkers] = useState([] as Worker[]),
      [lastSuccess, setLastSuccess] = useState(""),
      [connectionError, setConnectionError] = useState(""),
      [refreshing, setRefreshing] = useState(false),
      [truncated, setTruncated] = useState(false);
    const refreshLock = useRef(false);
    const [detail, setDetail] = useState(null as Detail | null),
      [selected, setSelected] = useState("");
    const [error, setError] = useState(""),
      [busy, setBusy] = useState(false),
      [loading, setLoading] = useState(true);
    const [view, setView] = useState("board"),
      [archive, setArchive] = useState(false),
      [mobileTab, setMobileTab] = useState("tasks");
    const [sessions, setSessions] = useState([] as RecentSession[]),
      [sessionError, setSessionError] = useState("");
    const [pins, setPins] = useState(() => {
      try {
        return JSON.parse(
          localStorage.getItem("workbench:tower:pins:v1") || "[]",
        ) as string[];
      } catch {
        return [] as string[];
      }
    });
    const [draft, setDraft] = useState(null as Task | null),
      [newTitle, setNewTitle] = useState(""),
      [creating, setCreating] = useState(false);
    const archiving = useRef(new Set<string>());
    const writing = useRef(false);
    const selection = useRef(""),
      alive = useRef(true),
      dialog = useRef(null as HTMLElement | null),
      opener = useRef(null as HTMLElement | null),
      order = useRef([] as string[]);
    const refresh = async () => {
      const snapshot = await api.snapshot();
      const rows = snapshot.tasks;
      if (!alive.current) return;
      const index = new Map<string, number>(
        order.current.map((id: string, i: number) => [id, i]),
      );
      setTasks(
        [...rows].sort(
          (a, b) => (index.get(a.id) ?? 1e6) - (index.get(b.id) ?? 1e6),
        ),
      );
      setWorkers(snapshot.workers);
      setTruncated(snapshot.truncated);
      setLastSuccess(new Date().toISOString());
      setConnectionError("");
      const id = selection.current;
      if (id) {
        try {
          const data = await api.detail(id);
          if (alive.current && id === selection.current) setDetail(data);
        } catch {
          if (alive.current) setError(tr("详情已过期，请重新打开重试", "Details are stale. Reopen to retry."));
        }
      }
    };
    const load = async () => {
      if (refreshLock.current) return;
      refreshLock.current = true;
      setRefreshing(true);
      try {
        const cfg = await api.config();
        if (!alive.current) return;
        setConfig(cfg);
        if (cfg.mode !== "unconfigured") await refresh();
      } catch (e) {
        if (alive.current) setConnectionError(e instanceof Error ? e.message : tr("连接失败，请重试", "Connection failed. Retry."));
      } finally {
        refreshLock.current = false;
        if (alive.current) { setLoading(false); setRefreshing(false); }
      }
    };
    useEffect(() => {
      alive.current = true;
      void load();
      const visibleLoad = () => { if (!document.hidden) void load(); };
      const timer = setInterval(visibleLoad, 15000);
      document.addEventListener("visibilitychange", visibleLoad);
      window.addEventListener("focus", visibleLoad);
      return () => {
        alive.current = false;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", visibleLoad);
        window.removeEventListener("focus", visibleLoad);
      };
    }, []);
    useEffect(() => {
      if (!config || config.mode !== "mock") return;
      const overdue = tasks.filter(
        (t) => expired(t) && !archiving.current.has(`${t.id}:${t.revision}`),
      );
      if (!overdue.length) return;
      for (const t of overdue) archiving.current.add(`${t.id}:${t.revision}`);
      void (async () => {
        const results = await Promise.allSettled(
          overdue.map((t) => api.move(t, "archived", config.extended_workflow)),
        );
        if (!alive.current) return;
        if (results.some((r) => r.status === "rejected"))
          setError(
            tr(
              "部分旧交付归档失败，请刷新重试",
              "Some older deliveries could not be archived. Reload to retry.",
            ),
          );
        try {
          await refresh();
        } catch {
          setError(tr("归档后刷新失败", "Refresh after archiving failed"));
        }
      })();
    }, [tasks, config?.mode]);
    useEffect(() => {
      const controller = new AbortController();
      loadHomeProfiles(sdk.fetchJSON, controller.signal, {
        initialProfile: profile,
      })
        .then((data) => {
          if (!controller.signal.aborted) {
            setSessions(data.rows);
            if (data.failed.length)
              setSessionError(
                tr("部分会话暂不可用", "Some sessions are unavailable"),
              );
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setSessionError(tr("会话暂不可用", "Sessions unavailable"));
        });
      return () => controller.abort();
    }, [profile]);
    const close = () => {
      selection.current = "";
      setSelected("");
      setDetail(null);
      setDraft(null);
      opener.current?.focus();
    };
    useEffect(() => {
      if (!selected) return;
      const nav = document.querySelector<HTMLElement>(".dashboard-global-nav");
      const wasInert = nav?.inert;
      if (nav) nav.inert = true;
      const key = (event: KeyboardEvent) => {
        if (event.key === "Escape") close();
        if (event.key === "Tab") {
          const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), a[href], input, textarea, select, summary",
            ) || [],
          );
          const first = nodes[0],
            last = nodes.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      };
      document.addEventListener("keydown", key);
      dialog.current?.focus();
      return () => {
        document.removeEventListener("keydown", key);
        if (nav) nav.inert = !!wasInert;
      };
    }, [selected]);
    const run = async (work: () => Promise<unknown>) => {
      if (writing.current) return;
      writing.current = true;
      setBusy(true);
      setError("");
      try {
        await work();
        await refresh();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : tr("操作失败，请重试", "Action failed. Retry."),
        );
        try {
          await refresh();
        } catch {
          /* Keep the actionable original error. */
        }
      } finally {
        writing.current = false;
        setBusy(false);
      }
    };
    const open = async (id: string) => {
      opener.current = document.activeElement as HTMLElement;
      selection.current = id;
      setSelected(id);
      setDetail(null);
      setDraft(null);
      setError("");
      try {
        const data = await api.detail(id);
        if (selection.current === id) setDetail(data);
      } catch (e) {
        if (selection.current === id)
          setError(e instanceof Error ? e.message : tr("详情加载失败，请关闭后重试", "Details failed to load. Close and retry."));
      }
    };
    const move = (task: Task, to: Status, before?: string) => {
      const reason = canMove(task, to);
      if (reason) {
        setError(reason);
        return;
      }
      if (task.status === to) {
        if (before) {
          const rows = reordered(tasks, task.id, before);
          order.current = rows.map((t) => t.id);
          setTasks(rows);
          try {
            localStorage.setItem(
              "workbench:tower:order:v1",
              JSON.stringify(order.current),
            );
          } catch {
            /* Optional preference. */
          }
        }
        return;
      }
      void run(async () => {
        await api.move(task, to, !!config?.extended_workflow);
        if (before) {
          order.current = reordered(
            tasks.map((t) => (t.id === task.id ? { ...t, status: to } : t)),
            task.id,
            before,
          ).map((t) => t.id);
        }
      });
    };
    useEffect(() => {
      try {
        order.current = JSON.parse(
          localStorage.getItem("workbench:tower:order:v1") || "[]",
        );
      } catch {
        order.current = [];
      }
    }, []);
    const dropProps = (to: Status, before?: string) => ({
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const t = tasks.find(
          (t) => t.id === e.dataTransfer?.getData("text/workbench-task"),
        );
        if (t && !busy) move(t, to, before);
      },
    });
    const pending = tasks.filter(attention),
      running = tasks.filter((t) => t.status === "running"),
      blocked = tasks.filter((t) => t.status === "blocked" || t.fleet_status === "blocked"),
      done = delivered(tasks);
    const decisions = pending.filter((t) => t.decision).length,
      reviews = pending.filter(
        (t) => t.status === "review" && !t.decision && verifyMode(t) === "human",
      ).length;
    const today = tasks.filter(
      (t) =>
        ["done", "archived"].includes(t.status) &&
        t.completed_at &&
        new Date(t.completed_at).toDateString() === new Date().toDateString(),
    ).length;
    const age = (t: Task) => {
      const hours = Math.max(
        0,
        Math.floor(
          (Date.now() -
            Date.parse(t.status_changed_at || t.updated_at || t.created_at)) /
            3600000,
        ),
      );
      return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
    };
    const card = (t: Task, compact = false) =>
      h(
        "article",
        {
          key: t.id,
          className: `tower-card ${compact ? "is-row" : ""}`,
          "data-task-id": t.id,
          draggable: !busy && !t.read_only && t.status !== "done",
          onDragStart: (e: DragEvent) => {
            e.dataTransfer?.setData("text/workbench-task", t.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          },
          ...dropProps(t.status, t.id),
        },
        btn(t.title, () => void open(t.id), { className: "tower-card-title" }),
        h(
          "div",
          { className: "tower-card-meta" },
          h("span", null, t.id),
          h("span", null, statusLabel(t.status)),
          h("span", null, t.repo || "—"),
          h("span", null, [t.machine, t.assignee].filter(Boolean).join(" / ") || "—"),
          t.attempt_count !== undefined ? h("span", { title: tr("Fleet 列表计数；详情显示实际执行记录数", "Fleet list counter; details show execution records") }, `${t.attempt_count} attempts`) : null,
          t.updated_at ? h("time", { dateTime: t.updated_at }, new Date(t.updated_at).toLocaleString()) : null,
        ),
        h(
          "div",
          { className: "tower-card-foot" },
          h("span", { className: `tower-risk risk-${t.risk}` }, t.risk),
          h("span", null, t.priority),
          h("time", null, age(t)),
          !t.read_only ? h(
            "span",
            null,
            `${t.acceptance.filter((c) => c.checked).length}/${t.acceptance.length}`,
          ) : null,
          !t.read_only && verifyMode(t) === "auto"
            ? h(
                "span",
                { className: "tower-auto" },
                tr("自动验收", "Auto verify"),
              )
            : null,
        ),
        !t.read_only ? h("progress", {
          value: t.acceptance.filter((c) => c.checked).length,
          max: t.acceptance.length || 1,
          "aria-label": tr("交付进度", "Delivery progress"),
        }) : null,
      );
    const group = (status: Status) => {
      const rows =
        status === "done"
          ? done
          : tasks.filter(
              (t) =>
                t.status === status &&
                (status !== "review" || verifyMode(t) === "human"),
            );
      return h(
        "section",
        {
          key: status,
          className: "tower-subgroup",
          "data-status": status,
          ...dropProps(status),
        },
        h("h3", null, statusLabel(status), h("span", null, rows.length)),
        rows.length
          ? rows.map((t) => card(t))
          : h(
              "p",
              { className: "tower-muted tower-empty" },
              tr("暂无任务", "No tasks"),
            ),
      );
    };
    const sessionKey = (s: RecentSession) => `${s.profile}:${s.source}:${s.id}`;
    const pin = (s: RecentSession) => {
      const key = sessionKey(s);
      const next = pins.includes(key)
        ? pins.filter((p: string) => p !== key)
        : [...pins.slice(-1), key];
      setPins(next);
      localStorage.setItem("workbench:tower:pins:v1", JSON.stringify(next));
    };
    const sessionRow = (s: RecentSession) =>
      h(
        "div",
        { key: sessionKey(s), className: "tower-session" },
        btn(s.title, () =>
          openHomeConversation(
            `/chat?${s.source === "Codex" ? "session" : "hermesSession"}=${encodeURIComponent(s.id)}`,
            s.profile,
            navigate,
          ),
        ),
        btn(pins.includes(sessionKey(s)) ? "★" : "☆", () => pin(s), {
          "aria-label": pins.includes(sessionKey(s))
            ? tr("取消置顶", "Unpin session")
            : tr("置顶会话", "Pin session"),
        }),
      );
    const t = detail?.task,
      decision = detail?.open_decision || detail?.decision || t?.decision;
    const nextAction = (task: Task) => {
      if (task.decision)
        return tr("选择一个方案继续", "Choose an option to continue");
      return {
        triage: tr("补全规格后派遣", "Complete the brief, then dispatch"),
        ready: tr("等待智能体认领", "Ready for an agent to claim"),
        running: tr("智能体正在处理", "Agent is working"),
        blocked: task.needs_human
          ? tr("解除阻塞后继续", "Resolve the blocker to continue")
          : tr("智能体正在处理阻塞", "Agent is resolving the blocker"),
        review: tr(
          "核对验收清单与产物",
          "Check the acceptance checklist and artifacts",
        ),
        done: tr("打开产物或归档", "Open the deliverables or archive"),
        archived: tr("恢复归档前状态", "Restore the previous status"),
        scheduled: tr("等待重试", "Waiting for retry"),
      }[task.status];
    };
    const listGroups = [
      { id: "attention", label: tr("待你处理", "Needs you"), rows: pending },
      ...columns.map((c) => ({
        id: c.id,
        label: c.label(),
        rows:
          c.id === "done"
            ? done
            : tasks.filter(
                (t) =>
                  c.statuses.includes(t.status) &&
                  (t.status !== "review" || verifyMode(t) === "human"),
              ),
      })),
      ...(config?.mode === "live" ? [{ id: "archived", label: tr("已归档", "Archived"), rows: tasks.filter(t => t.status === "archived") }] : []),
    ];
    return h(
      "main",
      {
        className: `task-tower mobile-${mobileTab}`,
        "aria-label": tr("任务控制台", "Task control tower"),
        "aria-busy": busy || loading,
      },
      h(
        "header",
        { className: "tower-header" },
        h(
          "div",
          null,
          h("p", { className: "tower-eyebrow" }, "WORKBENCH / CONTROL"),
          h("h1", null, tr("任务控制台", "Task control tower")),
        ),
        h(
          "div",
          { className: "tower-toolbar" },
          config?.mode === "mock"
            ? h(
                "span",
                { className: "tower-mode" },
                tr("演示模式", "Demo mode"),
              )
            : null,
          btn(tr("看板", "Board"), () => setView("board"), {
            "aria-pressed": view === "board",
          }),
          btn(tr("列表", "List"), () => setView("list"), {
            "aria-pressed": view === "list",
          }),
          btn(tr("新建草稿", "New draft"), () => setCreating(true), {
            className: "tower-primary",
            disabled: config?.mode !== "mock" || busy,
            title: config?.mode !== "mock"
              ? tr(
                  "等待 Fleet 新建任务接口",
                  "Waiting for Fleet task creation API",
                )
              : undefined,
          }),
        ),
      ),
      h("div", { className: "tower-connection", role: "status" },
        h("span", null, connectionError
          ? tr("连接错误 · 数据已过期", "Connection error · Data stale")
          : refreshing ? tr("正在连接…", "Connecting…") : lastSuccess ? config?.mode === "mock" ? tr("演示数据", "Demo data") : tr("已连接 Fleet", "Connected to Fleet") : tr("尚未连接", "Not connected")),
        h("span", null, tr("最后成功：", "Last success: ") + (lastSuccess ? new Date(lastSuccess).toLocaleString() : tr("尚无", "Never"))),
        btn(connectionError ? tr("重试", "Retry") : tr("刷新", "Refresh"), () => void load(), { disabled: refreshing }),
        connectionError ? h("span", { role: "alert" }, connectionError) : null,
        truncated ? h("span", null, tr("当前为最近 100 项；计数仅覆盖已加载任务", "Latest 100 tasks; counts cover loaded tasks only")) : null,
      ),
      h(
        "div",
        { className: `tower-attention ${pending.length ? "" : "is-quiet"}` },
        h(
          "div",
          null,
          h(
            "strong",
            null,
            !lastSuccess
              ? loading ? tr("正在读取任务…", "Loading tasks…") : tr("任务数据不可用", "Task data unavailable")
              : pending.length
              ? tr(
                  `现在需要你 ${pending.length} 件`,
                  `${pending.length} need you now`,
                )
              : tr("现在没有需要你的事", "Nothing needs you now"),
          ),
          pending.length
            ? h(
                "span",
                null,
                tr(
                  `决策 ${decisions} · 审核 ${reviews}`,
                  `Decisions ${decisions} · Reviews ${reviews}`,
                ),
              )
            : null,
        ),
        h("span", null, tr(
          `${running.length} 在跑 · ${blocked.length} 阻塞 · ${today} 今日交付`,
          `${running.length} running · ${blocked.length} blocked · ${today} delivered today`,
        )),
      ),
      error
        ? h(
            "div",
            { role: "alert", className: "tower-error" },
            error,
            btn(tr("关闭", "Dismiss"), () => setError("")),
          )
        : null,
      loading
        ? h("p", { role: "status" }, tr("正在读取任务…", "Loading tasks…"))
        : null,
      config?.mode === "unconfigured"
        ? h(
            "p",
            { className: "tower-empty" },
            tr(
              "任务服务尚未连接。最近会话仍可使用。",
              "Task service is not connected. Recent sessions remain available.",
            ),
          )
        : null,
      creating
        ? h(
            "form",
            {
              className: "tower-create",
              onSubmit: (e: Event) => {
                e.preventDefault();
                void run(async () => {
                  const data = await api.create(newTitle);
                  setCreating(false);
                  setNewTitle("");
                  await open(data.task.id);
                });
              },
            },
            h(
              "label",
              null,
              tr("任务标题", "Task title"),
              h("input", {
                required: true,
                maxLength: 200,
                value: newTitle,
                onChange: (e: any) => setNewTitle(e.target.value),
              }),
            ),
            h(
              "button",
              { type: "submit", disabled: busy },
              tr("创建草稿", "Create draft"),
            ),
            btn(tr("取消", "Cancel"), () => setCreating(false)),
          )
        : null,
      h(
        "div",
        { className: "tower-layout" },
        h(
          "div",
          { className: "tower-workspace" },
          h(
            "div",
            { className: `tower-board ${view === "list" ? "is-hidden" : ""}` },
            columns.map((c) =>
              h(
                "section",
                {
                  key: c.id,
                  className: `tower-column column-${c.id}`,
                  "data-column": c.id,
                },
                h(
                  "h2",
                  null,
                  c.label(),
                  h(
                    "span",
                    null,
                    tasks.filter(
                      (t) =>
                        c.statuses.includes(t.status) &&
                        !expired(t) &&
                        (t.status !== "review" || verifyMode(t) === "human"),
                    ).length,
                  ),
                ),
                c.statuses.filter(s => config?.mode === "mock" || !["triage", "blocked"].includes(s)).map(group),
                c.id === "done"
                  ? btn(
                      tr(
                        `已归档 ${tasks.filter((t) => t.status === "archived").length}`,
                        `${tasks.filter((t) => t.status === "archived").length} archived`,
                      ),
                      () => setArchive(!archive),
                      { className: "tower-archive" },
                    )
                  : null,
              ),
            ),
          ),
          h(
            "div",
            { className: `tower-list ${view === "list" ? "is-selected" : ""}` },
            listGroups.map((g) =>
              h(
                "section",
                { key: g.id },
                h("h2", null, g.label, h("span", null, g.rows.length)),
                g.rows.length
                  ? g.rows.map((t) => card(t, true))
                  : h(
                      "p",
                      { className: "tower-muted" },
                      tr("暂无任务", "No tasks"),
                    ),
              ),
            ),
          ),
          tasks.some((t) => t.status === "scheduled")
            ? h(
                "details",
                null,
                h("summary", null, tr("等待重试", "Retry scheduled")),
                tasks
                  .filter((t) => t.status === "scheduled")
                  .map((t) => card(t, true)),
              )
            : null,
          archive
            ? h(
                "section",
                { className: "tower-archive-list" },
                h("h2", null, tr("归档", "Archive")),
                tasks
                  .filter((t) => t.status === "archived")
                  .map((t) => card(t, true)),
              )
            : null,
        ),
        h(
          "aside",
          { className: "tower-sidebar" },
          h(
            "section",
            null,
            h("h2", null, tr("待你处理", "Needs you")),
            pending.length
              ? pending.map((t) =>
                  h(
                    "div",
                    { key: t.id, className: "tower-action" },
                    h("strong", null, t.title),
                    t.decision ? h("div", { className: "tower-decision-summary" },
                      h("p", null, t.decision.question),
                      ...decisionOptions(t.decision, t.read_only).map((o, i) => h("p", { key: o.id }, `${/^[A-Z][ .·]/.test(o.label) ? "" : String.fromCharCode(65 + i) + " · "}${o.label}`)),
                      t.read_only ? h("small", null, tr("只读：请在 Fleet 中提交决策", "Read-only: submit decisions in Fleet")) : null,
                    ) : null,
                    btn(
                      t.decision
                        ? tr("做决策 →", "Decide →")
                        : t.status === "review"
                          ? tr("验收 →", "Review →")
                          : tr("解除阻塞 →", "Unblock →"),
                      () => void open(t.id),
                    ),
                  ),
                )
              : h(
                  "p",
                  { className: "tower-muted" },
                  tr("一切就绪，无需操作", "All clear. No action needed."),
                ),
          ),
          h(
            "section",
            null,
            h("h2", null, tr("在跑", "Running")),
            h("p", { className: "tower-muted" }, tr(`执行器 ${workers.length}`, `${workers.length} workers`)),
            running.slice(0, 4).map((t) =>
              h(
                "div",
                { key: t.id, className: "tower-running" },
                btn(t.title, () => void open(t.id)),
                h("time", null, age(t)),
              ),
            ),
          ),
          h(
            "details",
            { className: "tower-pulse" },
            h(
              "summary",
              null,
              tr(
                `交付脉搏 · 今日 ${today} 件`,
                `Delivery pulse · ${today} today`,
              ),
            ),
            done
              .slice(0, 3)
              .map((t) => btn(t.title, () => void open(t.id), { key: t.id })),
          ),
          h(
            "section",
            null,
            h(
              "h2",
              null,
              tr("主会话", "Main sessions"),
              h("span", null, `${pins.length}/2`),
            ),
            sessions
              .filter((s) => pins.includes(sessionKey(s)))
              .slice(0, 2)
              .map(sessionRow),
            !pins.length
              ? h(
                  "p",
                  { className: "tower-muted" },
                  tr("从最近会话中置顶 1–2 个", "Pin 1–2 recent sessions"),
                )
              : null,
            h("h3", null, tr("最近会话", "Recent sessions")),
            sessions
              .filter((s) => !pins.includes(sessionKey(s)))
              .slice(0, 3)
              .map(sessionRow),
            sessionError
              ? h("p", { className: "tower-muted" }, sessionError)
              : null,
            btn(tr("全部最近会话", "All recent sessions"), () =>
              navigate("/sessions?view=recent", profile),
            ),
          ),
        ),
      ),
      h(
        "nav",
        {
          className: "tower-bottom-nav",
          "aria-label": tr("控制台导航", "Tower navigation"),
        },
        btn(tr("任务", "Tasks"), () => setMobileTab("tasks"), {
          "aria-pressed": mobileTab === "tasks",
        }),
        btn(tr("待你处理", "Needs you"), () => setMobileTab("attention"), {
          "aria-pressed": mobileTab === "attention",
        }),
        btn(tr("会话", "Sessions"), () => setMobileTab("sessions"), {
          "aria-pressed": mobileTab === "sessions",
        }),
      ),
      selected
        ? h(
            "div",
            {
              className: "tower-backdrop",
              onClick: (e: any) => {
                if (e.target === e.currentTarget) close();
              },
            },
            h(
              "section",
              {
                className: "tower-drawer",
                role: "dialog",
                "aria-modal": true,
                "aria-labelledby": "tower-detail-title",
                tabIndex: -1,
                ref: dialog,
              },
              h(
                "header",
                null,
                h(
                  "p",
                  { className: "tower-eyebrow" },
                  t ? statusLabel(t.status) : tr("详情", "Details"),
                ),
                btn("×", close, {
                  "aria-label": tr("关闭详情", "Close details"),
                }),
              ),
              h(
                "h2",
                { id: "tower-detail-title" },
                t?.title || tr("正在读取…", "Loading…"),
              ),
              error
                ? h("p", { role: "alert", className: "tower-error" }, error)
                : null,
              t
                ? h(
                    sdk.React.Fragment,
                    null,
                    h(
                      "section",
                      { className: "tower-next" },
                      h("h3", null, tr("下一步动作", "Next action")),
                      h("p", null, t.read_only ? tr("只读连接：请在 Fleet 中操作", "Read-only connection: use Fleet to make changes") : nextAction(t)),
                      h("p", null, [t.id, t.fleet_status, t.machine, t.assignee, t.attempt_count !== undefined ? `${t.attempt_count} attempts` : ""].filter(Boolean).join(" · ")),
                      t.spec_json?.summary ? h("p", { style: { whiteSpace: "pre-wrap" } }, t.spec_json.summary) : null,
                      t.status === "triage"
                        ? btn(
                            tr("补全草稿", "Complete draft"),
                            () => setDraft(structuredClone(t)),
                            { disabled: busy || !!t?.read_only },
                          )
                        : null,
                      h(
                        "div",
                        { className: "tower-move-actions" },
                        (
                          [
                            "triage",
                            "ready",
                            "running",
                            "blocked",
                            "review",
                            "done",
                            "archived",
                          ] as Status[]
                        )
                          .filter((s) => s !== t.status && !canMove(t, s))
                          .map((s) =>
                            btn(
                              s === "ready" && t.status === "triage"
                                ? tr("派遣", "Dispatch")
                                : s === "done" && t.status === "review"
                                  ? tr("验收通过", "Accept delivery")
                                  : t.server_lifecycle &&
                                      t.status === "archived"
                                    ? tr("恢复", "Restore")
                                    : t.server_lifecycle &&
                                        t.status === "review" &&
                                        s === "running"
                                      ? tr("要求修改", "Request changes")
                                      : statusLabel(s),
                              () => move(t, s),
                              {
                                key: s,
                                disabled: busy,
                                className: "tower-primary",
                              },
                            ),
                          ),
                      ),
                    ),
                    h(
                      "section",
                      { className: "tower-checklist" },
                      h("h3", null, tr("验收清单", "Acceptance checklist")),
                      t.acceptance.length
                        ? t.acceptance.map((c, i) =>
                            h(
                              "label",
                              { key: i },
                              h("input", {
                                type: "checkbox",
                                checked: c.checked,
                                disabled:
                                  busy || !!t.read_only ||
                                  (!config?.extended_workflow &&
                                    !["triage"].includes(t.status)),
                                onChange: () =>
                                  void run(() =>
                                    api.patch(t, {
                                      acceptance: t.acceptance.map((row, j) =>
                                        i === j
                                          ? { ...row, checked: !row.checked }
                                          : row,
                                      ),
                                    }),
                                  ),
                              }),
                              c.label,
                            ),
                          )
                        : h(
                            "p",
                            { className: "tower-muted" },
                            tr(
                              "草稿需要至少一个验收项",
                              "Add at least one acceptance criterion",
                            ),
                          ),
                      h(
                        "p",
                        { className: "tower-muted" },
                        t.read_only ? `Fleet: ${t.fleet_status}` : verifyMode(t) === "auto"
                          ? tr(
                              "智能体自动验收",
                              "Verified automatically by the agent",
                            )
                          : tr("需要人工验收", "Human verification required"),
                        t.verified_by ? ` · ${t.verified_by}` : "",
                      ),
                    ),
                    decision
                      ? h(
                          "section",
                          { className: "tower-decision" },
                          h("h3", null, tr("需要你的决策", "Your decision")),
                          h("p", null, decision.question),
                          decisionOptions(decision, t.read_only).length
                            ? decisionOptions(decision, t.read_only).map((o, i) =>
                                btn(
                                  `${/^[A-Z][ .·]/.test(o.label) ? "" : String.fromCharCode(65 + i) + " · "}${o.label}${o.recommended ? tr("（推荐）", " (Recommended)") : ""}\n${o.impact}`,
                                  () =>
                                    void run(() =>
                                      api.decide(t, decision.id, o.id),
                                    ),
                                  { key: o.id, disabled: busy || !!t.read_only, title: t.read_only ? tr("只读：请在 Fleet 中提交决策", "Read-only: submit decisions in Fleet") : undefined },
                                ),
                              )
                            : h(
                                "p",
                                { role: "alert" },
                                tr(
                                  "决策需要 2–4 个完整选项和一个推荐项，请任务负责人补全",
                                  "The task owner must provide 2–4 complete options with one recommendation",
                                ),
                              ),
                        )
                      : null,
                    draft
                      ? h(
                          "form",
                          {
                            className: "tower-edit",
                            onSubmit: (e: Event) => {
                              e.preventDefault();
                              void run(async () => {
                                await api.patch(t, {
                                  title: draft.title,
                                  spec_json: draft.spec_json,
                                  repo: draft.repo,
                                  machine: draft.machine,
                                  risk: draft.risk,
                                  priority: draft.priority,
                                  verify_mode: verifyMode(draft),
                                  acceptance: draft.acceptance,
                                });
                                setDraft(null);
                              });
                            },
                          },
                          ...(["title", "repo", "machine"] as const).map(
                            (field) =>
                              h(
                                "label",
                                { key: field },
                                {
                                  title: tr("标题", "Title"),
                                  repo: tr("仓库", "Repository"),
                                  machine: tr("机器", "Machine"),
                                }[field],
                                h("input", {
                                  required: true,
                                  value: draft[field] || "",
                                  onChange: (e: any) =>
                                    setDraft({
                                      ...draft,
                                      [field]: e.target.value,
                                    }),
                                }),
                              ),
                          ),
                          h(
                            "label",
                            null,
                            tr("规格", "Specification"),
                            h("textarea", {
                              required: true,
                              value: draft.spec_json?.summary || "",
                              onChange: (e: any) =>
                                setDraft({
                                  ...draft,
                                  spec_json: { summary: e.target.value },
                                }),
                            }),
                          ),
                          h(
                            "label",
                            null,
                            tr(
                              "验收项（每行一项）",
                              "Acceptance criteria (one per line)",
                            ),
                            h("textarea", {
                              required: true,
                              value: draft.acceptance
                                .map((c) => c.label)
                                .join("\n"),
                              onChange: (e: any) =>
                                setDraft({
                                  ...draft,
                                  acceptance: e.target.value
                                    .split("\n")
                                    .map((label: string) => ({
                                      label,
                                      checked: false,
                                    })),
                                }),
                            }),
                          ),
                          h(
                            "label",
                            null,
                            tr("风险", "Risk"),
                            h(
                              "select",
                              {
                                "aria-label": tr("风险", "Risk"),
                                value: draft.risk,
                                onChange: (e: any) =>
                                  setDraft({
                                    ...draft,
                                    risk: e.target.value,
                                    verify_mode: undefined,
                                  }),
                              },
                              ["R0", "R1", "R2", "R3"].map((v) =>
                                h("option", { key: v }, v),
                              ),
                            ),
                          ),
                          h(
                            "label",
                            null,
                            tr("优先级", "Priority"),
                            h(
                              "select",
                              {
                                "aria-label": tr("优先级", "Priority"),
                                value: draft.priority,
                                onChange: (e: any) =>
                                  setDraft({
                                    ...draft,
                                    priority: e.target.value,
                                  }),
                              },
                              ["P0", "P1", "P2", "P3"].map((v) =>
                                h("option", { key: v }, v),
                              ),
                            ),
                          ),
                          h(
                            "label",
                            null,
                            tr("验收方式", "Verification"),
                            h(
                              "select",
                              {
                                "aria-label": tr("验收方式", "Verification"),
                                value: draft.verify_mode || "default",
                                onChange: (e: any) =>
                                  setDraft({
                                    ...draft,
                                    verify_mode:
                                      e.target.value === "default"
                                        ? undefined
                                        : e.target.value,
                                  }),
                              },
                              h(
                                "option",
                                { value: "default" },
                                tr("按风险默认", "Risk default"),
                              ),
                              h(
                                "option",
                                { value: "auto" },
                                tr("自动", "Automatic"),
                              ),
                              h(
                                "option",
                                { value: "human" },
                                tr("人工", "Human"),
                              ),
                            ),
                          ),
                          h(
                            "button",
                            { type: "submit", disabled: busy },
                            tr("保存草稿", "Save draft"),
                          ),
                          btn(tr("取消", "Cancel"), () => setDraft(null)),
                        )
                      : null,
                    h(
                      "section",
                      { className: "tower-artifacts" },
                      h("h3", null, tr("产物", "Artifacts")),
                      detail.artifacts.length
                        ? detail.artifacts.map((a) =>
                            h(
                              "div",
                              { key: a.id },
                              h("strong", null, a.name),
                              h(
                                "span",
                                { className: "tower-muted" },
                                `${a.kind} · ${a.content_type} · ${a.size < 1024 ? `${a.size} B` : `${(a.size / 1024).toFixed(1)} KB`}`,
                              ),
                              a.external_url && safeLink(a.external_url)
                                ? h(
                                    "a",
                                    {
                                      href: safeLink(a.external_url)!,
                                      target: "_blank",
                                      rel: "noopener noreferrer",
                                    },
                                    tr("打开链接", "Open link"),
                                  )
                                : btn(
                                    tr("下载", "Download"),
                                    () =>
                                      void run(() =>
                                        downloadArtifact(
                                          a,
                                          sdk.authedFetch ||
                                            ((url, init) =>
                                              fetch(url, {
                                                ...init,
                                                credentials: "same-origin",
                                              })),
                                        ),
                                      ),
                                    { disabled: busy || !!t?.read_only },
                                  ),
                            ),
                          )
                        : h(
                            "p",
                            { className: "tower-muted" },
                            tr("尚无产物", "No artifacts yet"),
                          ),
                    ),
                    h(
                      "details",
                      null,
                      h("summary", null, tr("规格", "Specification")),
                      h("p", null, t.spec_json?.summary || "—"),
                    ),
                    h(
                      "details",
                      null,
                      h("summary", null, tr("时间线", "Timeline")),
                      h(
                        "p",
                        null,
                        `${tr("建卡", "Created")} · ${new Date(t.created_at).toLocaleString()}`,
                      ),
                      h(
                        "p",
                        null,
                        `${tr("当前状态", "Current status")} · ${statusLabel(t.status)}`,
                      ),
                    ),
                    h(
                      "details",
                      null,
                      h(
                        "summary",
                        null,
                        tr("关联会话 / PR", "Linked sessions / PRs"),
                      ),
                      (detail.links || [])
                        .filter((l) => safeLink(l.url))
                        .map((l) =>
                          h(
                            "a",
                            {
                              key: l.url,
                              href: safeLink(l.url)!,
                              target: "_blank",
                              rel: "noopener noreferrer",
                            },
                            l.label,
                          ),
                        ),
                    ),
                  )
                : null,
            ),
          )
        : null,
    );
  }
  return function TaskControlHome(props: { profile: string }) {
    if (location.pathname !== "/kanban" && new URLSearchParams(location.search).get("view") === "recent") {
      return h(
        "section",
        { className: "tower-recent-secondary" },
        btn(tr("返回任务控制台", "Back to task control tower"), () =>
          navigate("/sessions", props.profile),
        ),
        h(RecentHome, props),
      );
    }
    return h(TaskControlTower, props);
  };
}
