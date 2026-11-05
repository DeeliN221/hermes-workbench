import { uiText as tr } from "./ui-locale";
import type { FetchJSON } from "./workbench-api";
import {
  fleetAPI,
  downloadArtifact,
  type FleetConfig,
} from "./task-control-api";
import {
  attention,
  activeAttempt,
  canMove,
  columns,
  decisionOptions,
  delivered,
  durationMinutes,
  finalDeliverables,
  hasStarted,
  expired,
  isZombieRunning,
  runtimeLine,
  reordered,
  safeLink,
  sessionEntries,
  stageReport,
  specMarkdown,
  statusLabel,
  verifyMode,
  type Artifact,
  type Detail,
  type FinalDeliverable,
  type StageReport,
  type Status,
  type Task,
} from "./task-control-model";
import { cardRefresh, mergeCards } from "./task-control-refresh";
import { renderMarkdownSource } from "./markdown-source";
import { renderMermaidBlocks } from "./file-preview";
import { renderPlantUMLBlocks } from "./plantuml-renderer";

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
) {
  const h = sdk.React.createElement,
    { useState, useEffect, useRef } = sdk.hooks,
    api = fleetAPI(sdk.fetchJSON, sdk.authedFetch);
  const btn = (
    label: string,
    onClick: () => void,
    extra: Record<string, unknown> = {},
  ) => h("button", { type: "button", onClick, ...extra }, label);

  function StageReportDiagram({ report }: { report: StageReport }) {
    const host = useRef(null as HTMLDivElement | null);
    useEffect(() => {
      const root = host.current;
      if (!root) return;
      let disposed = false;
      const draw = async () => {
        if (disposed) return;
        root.replaceChildren();
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.className = `language-${report.format}`;
        code.textContent = report.diagram;
        pre.append(code);
        root.append(pre);
        if (report.format === "plantuml") await renderPlantUMLBlocks(root);
        else await renderMermaidBlocks(root);
      };
      void draw();
      // Re-render locally when the operator switches theme; no network is involved.
      const observer = new MutationObserver(() => void draw());
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-workbench-theme"] });
      return () => { disposed = true; observer.disconnect(); };
    }, [report.diagram, report.format]);
    return h("div", { className: `tower-stage-diagram${/^\s*flowchart\s+(?:TB|TD)\b/i.test(report.diagram) ? " is-vertical" : ""}`, ref: host });
  }

  function ReviewFocus({
    task, artifacts, links, busy, onDownload,
  }: {
    task: Task;
    artifacts: Artifact[];
    links: { label: string; url: string }[];
    busy: boolean;
    onDownload: (artifact: Artifact) => void;
  }) {
    const rows = finalDeliverables(task, artifacts, links);
    if (rows.length) {
      const labels: Record<FinalDeliverable["kind"], [string, string]> = {
        pr: ["PR", "PR"], merge: ["合并", "Merge"], commit: ["提交", "Commit"],
        demo: ["DEMO", "DEMO"], screenshot: ["截图", "IMAGE"], report: ["报告", "REPORT"],
        artifact: ["产物", "FILE"], link: ["链接", "LINK"],
      };
      return h("section", { className: "tower-delivery", "data-review-material": "deliverable" },
        h("h3", null, tr("最终交付物", "Final deliverable")),
        h("div", { className: "tower-delivery-list" }, ...rows.map((row) => {
          const badge = tr(...labels[row.kind]);
          const body = h(sdk.React.Fragment, null,
            h("span", { className: "tower-delivery-kind" }, badge),
            h("strong", null, row.label));
          return row.url
            ? h("a", { key: row.id, className: "tower-delivery-row", href: row.url, target: "_blank", rel: "noopener noreferrer" }, body, h("span", { "aria-hidden": "true" }, "↗"))
            : h("button", {
                key: row.id, type: "button", className: "tower-delivery-row", disabled: busy || !row.artifact,
                onClick: () => row.artifact && onDownload(row.artifact),
              }, body, h("span", { "aria-hidden": "true" }, "↓"));
        })));
    }
    const report = stageReport(task);
    if (report) {
      return h("section", { className: "tower-delivery tower-stage-report", "data-review-material": "report" },
        h("h3", null, tr("阶段报告", "Stage report")),
        h(StageReportDiagram, { report }),
        h("ul", { className: "tower-stage-points" }, ...report.conclusions.slice(0, 5).map((point, index) => h("li", { key: index }, point))));
    }
    return h("section", { className: "tower-delivery tower-review-empty", "data-review-material": "empty", role: "status" },
      h("h3", null, tr("审核重点", "Review focus")),
      h("p", { className: "tower-review-warning" }, tr("暂无交付物/阶段报告", "No final deliverable or stage report")),
      h("p", { className: "tower-muted" }, tr("请通过执行会话核对，或要求执行者补充后再确认。", "Check the execution session or ask the worker to add delivery details before approving.")));
  }

  function SessionLinks({ task, profile, navigate }: { task: Task; profile: string; navigate: (path: string, profile: string) => void }) {
    const [copied, setCopied] = useState("");
    const entries = sessionEntries(task);
    const copy = async (key: string, value: string) => {
      try { await navigator.clipboard.writeText(value); setCopied(key); }
      catch { setCopied(`${key}:error`); }
    };
    const openLocal = (entry: ReturnType<typeof sessionEntries>[number]) =>
      navigate(`/chat?${entry.kind === "hermes" ? "hermesSession" : "session"}=${encodeURIComponent(entry.id)}`, entry.profile || profile);
    if (!entries.length) return h("section", { className: "tower-sessions" }, h("h3", null, tr("会话", "Sessions")), h("p", { className: "tower-muted" }, tr("未记录执行会话", "No execution session recorded")));
    return h("section", { className: "tower-sessions" }, h("h3", null, tr("会话", "Sessions")),
      ...entries.map((entry) => {
        const key = `${entry.label}:${entry.id}`;
        const title = entry.label === "source" ? tr("来源会话", "Source conversation") : tr("执行会话", "Execution conversation");
        const fallback = () => {
          const query = entry.kind === "hermes" ? "hermesSession" : "session";
          const profileQuery = entry.profile ? `&profile=${encodeURIComponent(entry.profile)}` : "";
          return h("div", { className: "tower-session-fallback" },
            h("p", null, tr(`会话位于设备 ${entry.device || "未记录"}；此入口未配置可访问的远程地址。`, `This session is on ${entry.device || "an unrecorded device"}; no reachable remote address is configured.`)),
            h("div", { className: "tower-session-fallback-actions" },
              btn(copied === key ? tr("已复制", "Copied") : copied === `${key}:error` ? tr("复制失败", "Copy failed") : tr("复制会话 ID", "Copy session ID"), () => void copy(key, entry.id)),
              h("a", { href: `/chat?${query}=${encodeURIComponent(entry.id)}${profileQuery}`, target: "_blank", rel: "noopener noreferrer" }, tr("打开 Workbench + 会话 ID", "Open Workbench + session ID"))));
        };
        let action: any;
        if (entry.local) {
          action = btn(tr("继续执行会话 →", "Continue execution session →"), () => openLocal(entry), { className: "tower-session-open" });
        } else if (entry.remoteUrl) {
          action = h("div", { className: "tower-session-remote-row" },
            h("a", { href: entry.remoteUrl, target: "_blank", rel: "noopener noreferrer", className: "tower-session-remote" }, tr("打开远程 Workbench →", "Open remote Workbench →")),
            btn(copied === key ? tr("已复制", "Copied") : copied === `${key}:error` ? tr("复制失败", "Copy failed") : tr("复制链接", "Copy link"), () => void copy(key, entry.remoteUrl), { "aria-label": tr("复制远程会话链接", "Copy remote session link") }));
        } else if (entry.canOpen) {
          action = h(sdk.React.Fragment, null,
            entry.remote ? fallback() : null,
            btn(tr("打开执行会话 →", "Open execution session →"), () => openLocal(entry), { className: "tower-session-open" }));
        } else {
          action = fallback();
        }
        return h("div", { className: "tower-session-entry", key, "data-session": entry.label },
          h("div", { className: "tower-session-heading" }, h("h4", null, title),
            h("span", { className: "tower-session-device" }, `${tr("设备", "Device")} · ${entry.device || tr("未记录", "Not recorded")}`)),
          h("small", { className: "tower-session-id" }, `ID ${entry.id}`),
          action);
      }));
  }
  function SpecDetails({ task }: { task: Task }) {
    const [raw, setRaw] = useState(false);
    const markdown = useRef(null as HTMLElement | null);
    const source = specMarkdown(task);
    useEffect(() => {
      const element = markdown.current;
      if (!element || raw) return;
      element.innerHTML = renderMarkdownSource(source);
      for (const anchor of Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
        const href = safeLink(anchor.getAttribute("href") || "");
        if (!href) { anchor.removeAttribute("href"); continue; }
        anchor.href = href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
    }, [source, raw]);
    return h("details", { className: "tower-details" },
      h("summary", null, tr("详情", "Details")),
      h("div", { className: "tower-detail-meta" },
        h("p", null, task.id), h("p", null, task.repo || "—"),
        h("p", null, `${tr("完成时刻", "Completed at")}: ${task.completed_at ? new Date(task.completed_at).toLocaleString() : "—"}`)),
      source
        ? h(sdk.React.Fragment, null,
            raw ? h("pre", { className: "tower-spec-raw" }, source) : h("div", { className: "tower-markdown hti-rich-markdown", ref: markdown }),
            btn(raw ? tr("查看渲染", "Show rendered") : tr("查看原文", "Show source"), () => setRaw(value => !value), { className: "tower-spec-toggle" }))
        : h("p", { className: "tower-muted" }, tr("未提供详情", "No details recorded")),
    );
  }
  const MemoCard = sdk.React.memo(({ render }: { render: () => unknown }) => render(),
    (a: any, b: any) => a.task === b.task && a.runtime === b.runtime && a.compact === b.compact
      && a.archived === b.archived && a.busy === b.busy && a.checked === b.checked);
  function TaskControlTower({ profile }: { profile: string }) {
    const [tasks, setTasks] = useState([] as Task[]),
      [config, setConfig] = useState(null as FleetConfig | null);
    const [archiveVersion, setArchiveVersion] = useState(0),
      [connectionError, setConnectionError] = useState("");
    const [query, setQuery] = useState(""), [searchOpen, setSearchOpen] = useState(false),
      [searchRows, setSearchRows] = useState([] as Task[]),
      [searchError, setSearchError] = useState(""), [searchBusy, setSearchBusy] = useState(false),
      [cursor, setCursor] = useState(""), [checked, setChecked] = useState([] as string[]);
    const [showArchived, setShowArchived] = useState(false),
      [archivedTasks, setArchivedTasks] = useState([] as Task[]),
      [archivedBusy, setArchivedBusy] = useState(false),
      [now, setNow] = useState(Date.now());
    const searchVersion = useRef(0);
    const searchAbort = useRef(null as AbortController | null);
    const searchPage = async (more = false, signal?: AbortSignal) => {
      if (!signal) {
        searchAbort.current?.abort();
        searchAbort.current = new AbortController();
        signal = searchAbort.current.signal;
      }
      const version = ++searchVersion.current;
      setSearchBusy(true); setSearchError("");
      try {
        const page = await api.search(query, false, more ? cursor : "", signal);
        if (version !== searchVersion.current) return;
        setSearchRows(previous => [...new Map([...(more ? previous : []), ...page.tasks].map(t => [t.id, t])).values()]);
        setCursor(page.next_cursor);
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        if (version === searchVersion.current) setSearchError(String(e instanceof Error ? e.message : e));
      }
      finally { if (version === searchVersion.current) setSearchBusy(false); }
    };
    useEffect(() => {
      searchAbort.current?.abort();
      ++searchVersion.current; setSearchRows([]); setCursor(""); setSearchError(""); setSearchBusy(false);
      if (!searchOpen || !query.trim()) return;
      const controller = new AbortController();
      searchAbort.current = controller;
      const timer = setTimeout(() => void searchPage(false, controller.signal), 250);
      return () => { clearTimeout(timer); controller.abort(); ++searchVersion.current; };
    }, [query, searchOpen]);
    useEffect(() => {
      const timer = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 30000);
      return () => clearInterval(timer);
    }, []);
    useEffect(() => {
      if (!showArchived) { setArchivedTasks([]); setArchivedBusy(false); return; }
      let cancelled = false;
      setArchivedBusy(true);
      api.archived().then(result => {
        if (!cancelled) setArchivedTasks(result.tasks || []);
      }).catch(() => {
        if (!cancelled) setArchivedTasks([]);
      }).finally(() => {
        if (!cancelled) setArchivedBusy(false);
      });
      return () => { cancelled = true; };
    }, [showArchived, archiveVersion]);
    useEffect(() => {
      const focusSearch = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector(".tower-drawer")) return;
        if (event.key === "Escape" && searchOpen) {
          event.preventDefault(); event.stopImmediatePropagation();
          setSearchOpen(false); setQuery(""); return;
        }
        if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
        if (event.key === "/" || event.key === "f" || event.key === "F") {
          event.preventDefault();
          setSearchOpen(true);
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".tower-searchbar input")?.focus());
        }
      };
      document.addEventListener("keydown", focusSearch, true);
      return () => document.removeEventListener("keydown", focusSearch, true);
    }, [searchOpen]);
    const [detail, setDetail] = useState(null as Detail | null),
      [selected, setSelected] = useState("");
    const [error, setError] = useState(""),
      [busy, setBusy] = useState(false),
      [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState(null as Task | null);
    const [feedbackOpen, setFeedbackOpen] = useState(false),
      [feedback, setFeedback] = useState({} as Record<string, string>),
      [reviewStatus, setReviewStatus] = useState("");
    const feedbackInput = useRef(null as HTMLTextAreaElement | null);
    useEffect(() => { if (feedbackOpen) feedbackInput.current?.focus(); }, [feedbackOpen]);
    const archiving = useRef(new Set<string>());
    const writing = useRef(false);
    const selection = useRef(""),
      alive = useRef(true),
      dialog = useRef(null as HTMLElement | null),
      opener = useRef(null as HTMLElement | null),
      order = useRef([] as string[]);
    const refresher = useRef(null as ReturnType<typeof cardRefresh> | null);
    const refresh = async () => {
      await refresher.current?.refresh();
      const id = selection.current;
      if (id) {
        const data = await api.detail(id);
        if (alive.current && selection.current === id) setDetail(data);
      }
    };
    const load = refresh;
    useEffect(() => {
      alive.current = true;
      let configured = false;
      const controller = cardRefresh({
        fetch: async (lane, cursor, signal) => {
          if (!configured) {
            const cfg = await api.config();
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            setConfig(cfg);
            configured = cfg.mode !== "unconfigured";
            if (!configured) return { tasks: [], removed: [], cursors: {}, full: true };
          }
          return api.sync(lane, cursor, signal);
        },
        apply: delta => {
          setTasks(previous => {
            const merged = mergeCards(previous, delta);
            if (previous.length || !order.current.length) return merged;
            const index = new Map(order.current.map((id, i) => [id, i]));
            return [...merged].sort((a, b) => (index.get(a.id) ?? 1e6) - (index.get(b.id) ?? 1e6));
          });
          setConnectionError(""); setLoading(false);
          if (delta.full) setArchiveVersion(value => value + 1);
        },
        error: e => {
          setLoading(false);
          setConnectionError(e instanceof Error ? e.message : tr("连接失败，请重试", "Connection failed. Retry."));
        },
      });
      refresher.current = controller;
      controller.start();
      const visibility = () => controller.visibility();
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("focus", controller.focus);
      return () => {
        alive.current = false;
        controller.stop();
        refresher.current = null;
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("focus", controller.focus);
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
    const close = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("task") === selection.current) {
        url.searchParams.delete("task");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
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
        if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
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
      document.addEventListener("keydown", key, true);
      dialog.current?.focus();
      return () => {
        document.removeEventListener("keydown", key, true);
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
      setFeedbackOpen(false);
      setReviewStatus("");
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
    // Search links can target older tasks outside the board's recent snapshot.
    useEffect(() => {
      if (!config) return;
      const selectFromURL = () => {
        const id = new URLSearchParams(window.location.search).get("task");
        if (id && id !== selection.current) void open(id);
      };
      selectFromURL();
      window.addEventListener("popstate", selectFromURL);
      return () => window.removeEventListener("popstate", selectFromURL);
    }, [config?.mode]);
    const review = async (task: Task, action: "approve" | "request_changes") => {
      if (writing.current) return;
      writing.current = true;
      setBusy(true);
      setError("");
      setReviewStatus(tr("正在提交…", "Submitting…"));
      try {
        await api.review(task.id, action, feedback[task.id]);
        if (selection.current === task.id) {
          setReviewStatus(action === "approve" ? tr("已确认验收", "Delivery approved") : tr("意见已保存，任务已退回处理中", "Feedback saved; task returned to running"));
          setFeedbackOpen(false);
          if (action === "approve") close();
        }
        setFeedback(previous => ({ ...previous, [task.id]: "" }));
        try { await refresh(); }
        catch { setError(tr("操作已成功，但刷新失败，请点击刷新", "Action succeeded, but refresh failed. Refresh to see the latest state.")); }
      } catch (e) {
        if (selection.current === task.id) {
          setReviewStatus("");
          setError(e instanceof Error ? e.message : tr("操作失败，请重试", "Action failed. Retry."));
        }
      } finally {
        writing.current = false;
        setBusy(false);
      }
    };
    const move = (task: Task, to: Status, before?: string) => {
      const reason = task.status === to ? canMove(task, to) : "";
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
        const current = (await api.detail(task.id)).task;
        await api.move(current, to, !!config?.extended_workflow);
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
      running = tasks.filter((t) => !!activeAttempt(t)),
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
    const actions = useRef({ open, dropProps, setChecked });
    actions.current = { open, dropProps, setChecked };
    const renderCard = (t: Task, compact = false, archived = false) => {
      const runtime = runtimeLine(t, now);
      const duration = hasStarted(t) ? durationMinutes(t, now) : "";
      const values = duration ? runtime.slice(0, -duration.length).trim() : runtime;
      const stale = isZombieRunning(t);
      const blocked = t.status === "blocked" || t.fleet_status === "blocked";
      return (
      h(
        "article",
        {
          key: t.id,
          className: `tower-card ${compact ? "is-row" : ""}${archived ? " is-archived-card" : ""}${blocked ? " is-blocked" : ""}`,
          "data-task-id": t.id,
          "data-status": t.status,
          "data-blocked": blocked ? "true" : undefined,
          "data-archived": archived ? "true" : undefined,
          "data-runtime": runtime,
          "data-active-attempt": activeAttempt(t) ? "true" : "false",
          onClick: (e: MouseEvent) => { if (!(e.target as Element).closest("button, a, input, label")) void actions.current.open(t.id); },
          draggable: !archived && !busy && !t.read_only && t.status !== "done",
          onDragStart: (e: DragEvent) => {
            e.dataTransfer?.setData("text/workbench-task", t.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          },
          ...(archived ? {} : {
            onDragOver: (e: DragEvent) => actions.current.dropProps(t.status, t.id).onDragOver(e),
            onDrop: (e: DragEvent) => actions.current.dropProps(t.status, t.id).onDrop(e),
          }),
        },
        h("div", { className: "tower-card-heading" },
          t.status === "done" && !archived ? h("label", { className: "tower-select" }, h("input", {
            type: "checkbox", checked: checked.includes(t.id), disabled: busy,
            "aria-label": tr("选择任务", "Select task"),
            onChange: () => setChecked(previous => previous.includes(t.id) ? previous.filter(id => id !== t.id) : [...previous, t.id]),
          })) : null,
          btn(t.title, () => void actions.current.open(t.id), { className: "tower-card-title", title: t.title }),
          archived ? h("span", { className: "tower-archived-tag" }, tr("已归档", "Archived")) : null,
          stale ? h("span", { className: "tower-stale-tag", title: tr("最新执行已结束或没有负责人，计时已停止", "The latest attempt ended or has no assignee; the timer is stopped") }, tr("等待/异常", "Waiting / stale")) : null,
        ),
        h(
          "div",
          { className: "tower-card-meta", title: runtime || undefined },
          blocked
            ? h("span", { className: "tower-blocked-label", "aria-label": tr("阻塞", "Blocked") }, tr("阻塞", "Blocked"))
            : null,
          values ? h("span", { className: "tower-runtime-values" }, values) : null,
          duration ? h("span", { className: "tower-runtime-duration" }, `${values ? " " : ""}${duration}`) : null,
        ),
      ));
    };
    const card = (t: Task, compact = false, archived = false) => h(MemoCard, {
      key: t.id, task: t, compact, archived, busy, checked: checked.includes(t.id),
      runtime: runtimeLine(t, now), render: () => renderCard(t, compact, archived),
    });
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
    const completed = tasks.filter(t => t.status === "done");
    const bulkArchive = () => void run(async () => {
      const targets = completed.filter(t => checked.includes(t.id));
      const results = await Promise.allSettled(targets.map(t => t.lifecycle_actions ? api.lifecycle(t.id, "archive") : api.move(t, "archived", !!config?.extended_workflow)));
      const failed = targets.filter((_, i) => results[i].status === "rejected").map(t => t.id);
      setChecked(failed);
      if (failed.length) throw new Error(tr(`${failed.length} 个任务归档失败，已保留选择，可重试`, `${failed.length} tasks could not be archived. Selection retained; retry.`));
    });
    const columnTools = (id: string) => id === "done" ? h("div", { className: "tower-column-actions" },
        btn(tr("选择", "Select"), () => setChecked(completed.map(t => t.id)), { disabled: busy || !completed.length }),
        btn(tr("取消", "Clear"), () => setChecked([]), { disabled: busy || !checked.length }),
        btn(tr("归档", "Archive"), bulkArchive, { disabled: busy || !completed.some(t => checked.includes(t.id)) }),
        btn(showArchived ? tr("隐藏已归档", "Hide archived") : tr("显示已归档", "Show archived"),
          () => setShowArchived(value => !value), { "aria-pressed": showArchived, disabled: archivedBusy })) : null;
    const t = detail?.task,
      decision = detail?.open_decision || detail?.decision || t?.decision;
    const hasReviewMaterial = !!t && !!(finalDeliverables(t, detail?.artifacts || [], detail?.links || []).length || stageReport(t));
    const nextAction = (task: Task) => {
      if (task.decision)
        return tr("选择一个方案继续", "Choose an option to continue");
      if (isZombieRunning(task)) return tr("等待重新调度", "Waiting for rescheduling");
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
    const searching = searchOpen && !!query.trim();
    const visibleSearchRows = searchRows.filter((task) => showArchived || task.status !== "archived");
    const columnRows = (column: (typeof columns)[number]) => tasks.filter((task) => column.statuses.includes(task.status));
    const columnCount = (column: (typeof columns)[number]) =>
      column.id === "active" ? columnRows(column).filter((task) => !!activeAttempt(task)).length : columnRows(column).length;
    const closeSearch = () => { setSearchOpen(false); setQuery(""); setSearchRows([]); };
    return h(
      "main",
      {
        className: "task-tower",
        "aria-label": tr("看板", "Kanban"),
        "aria-busy": busy || loading,
      },
      connectionError ? h("div", { role: "alert", className: "tower-error" }, connectionError,
        btn(tr("重试", "Retry"), () => void load()), btn(tr("关闭", "Dismiss"), () => setConnectionError(""))) : null,
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
              "Task service is not connected.",
            ),
          )
        : null,
      h("div", { className: "tower-layout" },
        h("div", { className: "tower-workspace" },
          h("div", { className: "tower-searchbar" },
            searchOpen ? h(sdk.React.Fragment, null,
              h("input", { type: "search", value: query, maxLength: 256, autoFocus: true,
                "aria-label": tr("搜索任务", "Search tasks"), placeholder: tr("搜索全部任务", "Search all tasks"),
                onChange: (e: any) => setQuery(e.target.value),
                onKeyDown: (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeSearch(); } } }),
              query ? btn("×", () => setQuery(""), { className: "tower-search-clear", "aria-label": tr("清空搜索", "Clear search") }) : null,
              btn(tr("关闭", "Close"), closeSearch, { className: "tower-search-close" })) : null,
            btn(searchOpen ? tr("搜索", "Search") : tr("搜索任务", "Search tasks"),
              () => { setSearchOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".tower-searchbar input")?.focus()); },
              { className: "tower-search-toggle", "aria-expanded": searchOpen, "aria-label": tr("搜索任务", "Search tasks"), title: tr("搜索任务（/ 或 f）", "Search tasks (/ or f)") })),
          searching ? h("section", { className: "tower-search-results", "aria-label": tr("搜索结果", "Search results") },
            btn(showArchived ? tr("隐藏已归档", "Hide archived") : tr("显示已归档", "Show archived"),
              () => setShowArchived(value => !value), { "aria-pressed": showArchived }),
            searchError ? h("p", { role: "alert" }, searchError, btn(tr("重试", "Retry"), () => void searchPage())) : null,
            searchBusy && !visibleSearchRows.length ? h("p", { role: "status" }, tr("搜索中…", "Searching…")) : null,
            !searchBusy && !searchError && !visibleSearchRows.length ? h("p", { className: "tower-muted" }, tr("没有匹配任务", "No matching tasks")) : null,
            ...visibleSearchRows.map(t => card(t, true, t.status === "archived")),
            cursor ? btn(tr("加载更多", "Load more"), () => void searchPage(true), { disabled: searchBusy }) : null)
          : h(sdk.React.Fragment, null, h("div", { className: "tower-board" }, columns.map(c =>
            h("section", { key: c.id, className: `tower-column column-${c.id}`, "data-column": c.id },
              h("h2", null, c.label(), h("span", null, columnCount(c))),
              columnTools(c.id),
              h("div", { className: "tower-column-scroll" },
                columnRows(c).map(t => card(t)),
                c.id === "done" && showArchived
                  ? h("div", { className: "tower-archived-group", "data-archived-group": "true" },
                      h("h3", null, tr("已归档", "Archived"), h("span", null, archivedBusy ? "…" : archivedTasks.length)),
                      archivedTasks.map(t => card(t, false, true)))
                  : null)))),
          h("div", { className: "tower-list" }, columns.map(c =>
            h("section", { key: c.id, "data-column": c.id },
              h("h2", null, c.label(), h("span", null, columnCount(c))), columnTools(c.id),
              columnRows(c).map(t => card(t, true)),
              c.id === "done" && showArchived
                ? h("div", { className: "tower-archived-group", "data-archived-group": "true" },
                    h("h3", null, tr("已归档", "Archived"), h("span", null, archivedBusy ? "…" : archivedTasks.length)),
                    archivedTasks.map(t => card(t, true, true)))
                : null)))),
      )),
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
                "h2",
                { id: "tower-detail-title" },
                t?.title || tr("正在读取…", "Loading…"),
              ),
              error
                ? h("p", { role: "alert", className: "tower-error" }, error)
                : null,
              reviewStatus ? h("p", { role: "status", "aria-live": "polite" }, reviewStatus) : null,
              t
                ? h(
                    sdk.React.Fragment,
                    null,
                    h(ReviewFocus, {
                      task: t,
                      artifacts: detail?.artifacts || [],
                      links: detail?.links || [],
                      busy,
                      onDownload: (artifact: Artifact) => void run(() => downloadArtifact(
                        artifact,
                        sdk.authedFetch || ((url, init) => fetch(url, { ...init, credentials: "same-origin" })),
                      )),
                    }),
                    h(
                      "section",
                      { className: "tower-next" },
                      h("h3", null, tr("摘要", "Summary")),
                      h("p", null, t.review_actions ? hasReviewMaterial ? tr("核对交付后确认，或提交修改意见", "Review the delivery, then approve or request changes") : tr("暂无交付物/阶段报告，请先核对执行会话或要求补充。", "No final deliverable or stage report. Check the execution session or request details before approving.") : t.lifecycle_actions ? tr("任务状态由执行者推进，可使用下方可用操作", "The worker advances this task. Use the available actions below.") : t.read_only ? tr("只读连接：请在 Fleet 中操作", "Read-only connection: use Fleet to make changes") : nextAction(t)),

                      t.spec_json?.summary ? h("p", { style: { whiteSpace: "pre-wrap" } }, t.spec_json.summary) : null,
                      t.review_actions ? h("section", { className: "tower-review", "aria-busy": busy },
                        h("div", { className: "tower-move-actions" },
                          btn(tr("确认", "Approve"), () => void review(t, "approve"), { disabled: busy, className: "tower-primary" }),
                          btn(tr("根据意见修改", "Request changes"), () => setFeedbackOpen(true), { disabled: busy, "aria-expanded": feedbackOpen, "aria-controls": "tower-review-feedback" })),
                        feedbackOpen ? h("form", { id: "tower-review-feedback", onSubmit: (e: Event) => { e.preventDefault(); if (feedback[t.id]?.trim()) void review(t, "request_changes"); } },
                          h("label", { htmlFor: "tower-review-note" }, tr("修改意见", "Review feedback")),
                          h("textarea", { id: "tower-review-note", ref: feedbackInput, rows: 5, maxLength: 8000, required: true, disabled: busy,
                            value: feedback[t.id] || "", placeholder: tr("请说明需要修改的内容…", "Describe what needs to change…"),
                            onChange: (e: any) => setFeedback(previous => ({ ...previous, [t.id]: e.target.value })) }),
                          h("button", { type: "submit", disabled: busy || !feedback[t.id]?.trim(), className: "tower-primary" }, busy ? tr("正在提交…", "Submitting…") : tr("提交修改意见", "Submit feedback"))) : null) : null,
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
                    t.status === "blocked" || t.status === "triage" ? h("section", { className: "tower-blocker" },
                      h("h3", null, tr("需要处理", "Needs attention")),
                      t.lifecycle_actions && t.status === "blocked" && !decision ? btn(tr("解除阻塞并重试", "Unblock and retry"), () => void run(() => api.lifecycle(t.id, "retry")), { disabled: busy }) : null,
                      h("p", { style: { whiteSpace: "pre-wrap" } }, t.blocked_reason || t.error || decision?.question || tr("任务未提供原因，请查看执行会话或联系执行者补充。", "No reason was recorded. Inspect the execution conversation or ask the worker for details."))) : null,
                    h(
                      "section",
                      { className: "tower-checklist" },
                      h("h3", null, tr("验收", "Acceptance")),
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
                                  { key: o.id, disabled: busy || (!!t.read_only && !t.lifecycle_actions), title: t.read_only && !t.lifecycle_actions ? tr("只读：请在 Fleet 中提交决策", "Read-only: submit decisions in Fleet") : undefined },
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
                    h(SessionLinks, { task: t, profile, navigate }),
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
                                  spec_json: { ...draft.spec_json, summary: e.target.value },
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
                    detail.artifacts.length ? h(
                      "section",
                      { className: "tower-artifacts" },
                      h("h3", null, tr("产物", "Artifacts")),
                      ...detail.artifacts.map((a) =>
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
                          ),
                    ) : null,
                    h(SpecDetails, { task: t }),
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
                  )
                : null,
            ),
          )
        : null,
    );
  }
  return TaskControlTower;
}
