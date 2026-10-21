import { createWorkbenchTerminal } from './terminal-runtime';
import { renderMarkdownSource as S2 } from './markdown-source';
import { reconcileMarkdownHtml } from './markdown-html';
import { EditorView as Te, lineNumbers as aS, highlightActiveLine as iS, highlightActiveLineGutter as cS,
  syntaxHighlighting as Su, defaultHighlightStyle as mS, codeHighlightStyle as O2,
  codeLanguage as w2, fileLanguage as AL, fileLanguage as fM } from './editor-runtime';
import { normalizeSession as Ll, listCodexSessions as i0, normalizeGroup as yd, listCodexGroups as XL, createCodexGroup as WL, renameCodexGroup as qL, deleteCodexGroup as ZL, organizeCodexSession as jL, normalizeGoal as FL, readCodexGoal as HL, updateCodexGoal as n0, deleteCodexGoal as VL, listCodexWorkspaces as UL, loadCodexModels as YL, markCodexSessionRead as kd, createCodexSession as KL, sendCodexMessage as JL, normalizeAttachment as i5, uploadCodexAttachment as e5, stopCodexTurn as o0, answerCodexApproval as t5, CodexSendError as t0 } from './codex-api';
import { shouldSubmitComposerMessage } from './composer-command';
import { messagePhase as NL, turnStatus as Al, messageStatus as Rl, itemStatus as vd, completedItemStatus as BL, mergeMessage as zL, contentText as Wn, userContentText as r5, normalizeMessage as mn, notification as l0, messageFromNotification as n5, messagesFromTurns as GL, applyChatEvent as c0 } from './codex-messages';
import { optionalNumber as pn, firstDefined as oi, timestamp as El, record as mt, text as Ae } from './api-values';
import { cronList as Sn, cronSchedule as I5, cronTimezone as $0, cronForm as N5, cronPayload as Td, nativeCronPayload as B5, needsExtendedCron as z5, cronSessionId as T0, mergeCronHistory as E0, cronTimestamp as A0, listCronJobs as q5, listCronRuns as Z5, listCronExecutions as j5, createNativeCronJob as F5, createExtendedCronJob as H5, updateCronJob as V5, changeCronJobState as U5, deleteCronJob as Y5 } from './cron-api';
import { listSkills as iM, readSkillDescription as rM, listSkillEntries as B0, readSkillFile as nM, saveSkillFile as sM, mutateSkillFile as Md, skillPreviewUrl as oM, skillArchiveUrl as aM, isSkillTextPath as zl, skillPreviewKind as z0, downloadSkillFile as lM, uploadSkillArchive as cM, uploadSkillFile as hM } from './skills-api';
import { ProcessSummary } from './process-summary';
import { displayCommand } from './command-display';
import { createShortcutSettings, useSendShortcut, shouldSendMessage, sendShortcutHint } from './send-shortcut';
import { createCodexUserInput, pendingAsyncQuestions, formatQuestionAnswers } from './codex-user-input';
import './codex-user-input.css';
import { createLanguageControl } from './language-control';
import { useWorkbenchLocale } from './workbench-locale';
import { uiText as runtimeText } from './ui-locale';
import { createWorkbenchDialog, OPEN_WORKBENCH } from './workbench-launcher';
import { createRecentHome } from './recent-home';
import { installHomeChatNavigation } from './home-navigation';
import { renderPlantUMLBlocks, isPlantUMLLanguage } from './plantuml-renderer';
import { currentProfile, rememberProfile, rememberChat, profileDrafts, profileAttachments } from './profile-scope';
import { createProfileControls } from './profile-controls';
import { groupWorkspaceEntries, workspaceEntryKey, uniqueWorkspaceEntries, workspaceAbsolutePath, downloadWorkspaceFile } from './workspace-file-actions';
import { installManagedFilesListing } from './files-listing';
installManagedFilesListing();
import { installKanbanWorkflowBridge } from './kanban-workflow-bridge';
import { subscribeChatLists, stableChatList, createChatEventBatch } from './chat-update-scheduler';
import { useSelectableMarkdown } from './selectable-markdown';
import { cronSortOptions, cronSections, readCronSidebarPrefs } from './cron-sidebar';
import { version as workbenchVersion } from '../../package.json';
import { observeTerminalTheme } from './terminal-theme';
import { craftingIcon } from './crafting-icons';
import { profileTabName, agentDisplayName, loadKanbanProfiles, populateKanbanAgentSelect } from './kanban-agent-picker';
import { createKanbanDiscussionPreview } from './kanban-discussion-preview';
import { imageFilesFromTransfer as Nc } from './workbench-image-paste';
import { createKanbanChatContext } from './kanban-chat-context';
import { connectRealtime } from './realtime-connection';
import { runtimeErrorText, sameMessage, insertRequest, withTurnError } from './chat-runtime-errors';
import { installChatFileLinks, openChatFilePreview } from './chat-file-links';
import { readManagedFile } from './files-preview';
import { openFilePreview, showFilePreviewLoading } from './file-preview';
import { prepareProfileKanban } from './profile-kanban';

// Capture local file references before the host router treats them as app routes.
installChatFileLinks('/opt/data/workspace', openChatFilePreview);
import { createChatComposerInput } from './chat-composer-input';
import { processBlocks } from './chat-process-messages';
import { visibleChatText } from './chat-line-output';
import { resolveSessionTitle } from './session-title';
import { createProjectNavigation, PANE_DRAG_TYPE } from './project-navigation';
/** Maintain the complete buildable Workbench runtime; locate sidebar grouping via hti-session-group-toggle. */
(function () {
  "use strict";
  const nf = "/api/plugins/kanban";
  function sf() {
    return new URLSearchParams(window.location.search).get("board") || window.localStorage.getItem("hermes.kanban.selectedBoard") || "";
  }
  function of(i) {
    const e = sf();
    return e
      ? `${nf}${i}${i.includes("?") ? "&" : "?"}board=${encodeURIComponent(e)}`
      : `${nf}${i}`;
  }
  async function af(i, init) {
    const sdk = window.__HERMES_PLUGIN_SDK__;
    return sdk?.authedFetch
      ? sdk.authedFetch(i, init)
      : fetch(i, { credentials: "same-origin", ...init });
  }
  // Kanban mutations are JSON API calls. Use the host JSON client so the
  // loopback token and gated-cookie auth paths both work consistently.
  async function fetchKanbanJSON(i, init) {
    const sdk = window.__HERMES_PLUGIN_SDK__;
    if (typeof sdk?.fetchJSON === "function") return sdk.fetchJSON(i, init);
    const response = await fetch(i, { credentials: "same-origin", ...init });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  function Ds(i, e) {
    const t = i instanceof HTMLSelectElement ? HTMLSelectElement.prototype : i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    (Object.getOwnPropertyDescriptor(t, "value")?.set?.call(i, e),
      i.dispatchEvent(new Event("change", { bubbles: !0 })),
      i.dispatchEvent(new Event("input", { bubbles: !0 })));
  }
  function lf(i) {
    const t = Array.from(i.querySelectorAll("label")).find((n) =>
        /workspace|工作区/i.test(n.textContent || ""),
      )?.parentElement,
      r = t?.querySelector("select");
    return r ? { kind: r, path: t?.querySelector("input") } : null;
  }
  async function Pv() {
    const i = await af(of("/projects"));
    if (!i.ok) return [];
    const e = await i.json();
    return Array.isArray(e.projects)
      ? e.projects.filter((t) => t.primary_path)
      : [];
  }
  async function $v() {
    const i = await af(of("/boards"));
    if (!i.ok) return "";
    const e = await i.json(),
      t = sf() || e.current,
      r = (e.boards || []).find((n) => n.slug === t);
    return String(r?.default_workdir || "").trim();
  }
  function Tv(i) {
    const e = i.querySelector(".hermes-kanban-dialog-title");
    e?.textContent?.trim().startsWith("New task") &&
      (e.textContent = e.textContent.replace(/^\s*New task/, "新建任务"));
  }
  function cf(i) {
    const e = getComputedStyle(document.documentElement),
      t = e.getPropertyValue("--color-popover-foreground").trim() || e.getPropertyValue("--color-card-foreground").trim() || e.getPropertyValue("--midground").trim(),
      r = e.getPropertyValue("--color-muted-foreground").trim() || t;
    for (const n of Array.from(i.querySelectorAll(".hti-kanban-create-workspace label, .hti-kanban-create-workspace select, .hti-kanban-create-body-label"))) n.style.setProperty("color", t, "important");
    for (const n of Array.from(i.querySelectorAll(".hti-kanban-create-workspace p"))) n.style.setProperty("color", r, "important");
  }
  function EvLabel(i) { return i.textContent?.replace(/\s+/g, " ").trim() || ""; }
  function Ev(i) {
    if ((Tv(i), cf(i), i.dataset.htiCreateDialog === "ready")) return;
    const e = i.querySelector(".flex.flex-col.gap-3");
    if (!e || !e.children.length) return;
    i.dataset.htiCreateDialog = "ready";
    const t = e.children[0], existing = e.querySelector("textarea");
    if (!existing) {
      const body = document.createElement("textarea");
      body.name = "body"; body.className = "hti-kanban-create-body"; body.placeholder = "任务说明（可选）"; body.rows = 4;
      const label = document.createElement("label"); label.textContent = "说明"; label.className = "hti-kanban-create-body-label";
      const wrapper = document.createElement("div"); wrapper.className = "hti-kanban-create-body-field"; wrapper.append(label, body); t.after(wrapper);
    } else { existing.name = existing.name || "body"; existing.classList.add("hti-kanban-create-body"); }
    const keep = /priority|父任务|parent|目标模式|goal mode|workspace|工作区/i;
    for (const child of Array.from(e.children).slice(1)) {
      if (child.classList.contains("hti-kanban-create-body-field") || child.querySelector("textarea")) continue;
      if (!keep.test(EvLabel(child))) child.remove();
    }
    const s = document.createElement("div"); s.className = "hti-kanban-create-workspace";
    const o = document.createElement("label"); o.textContent = "工作区";
    const a = document.createElement("select"); a.setAttribute("aria-label", "选择工作区");
    const l = document.createElement("option"); l.value = "board-default"; l.textContent = "使用看板默认工作区";
    const c = document.createElement("option"); c.value = "scratch"; c.textContent = "临时工作区（任务结束后清理）"; a.append(l,c);
    const u = document.createElement("p"); u.textContent = "默认使用看板配置；如需其他项目，请从列表选择，无需手动输入路径。"; s.append(o,a,u); t.after(s);
    const h = lf(i), d = h?.kind.value || "scratch", f = h?.path?.value || "";
    a.addEventListener("change", () => { if (!h) return; const b=a.value; if (b==="board-default") { Ds(h.kind,d); h.path&&Ds(h.path,f); return; } if (b==="scratch") { Ds(h.kind,"scratch"); return; } const p=S.get(b); if (p?.primary_path) { Ds(h.kind,"worktree"); window.setTimeout(()=>{const m=lf(i); m?.path&&Ds(m.path,p.primary_path||"");},0); } });
    const S = new Map(); $v().then(b=>{if(b) l.textContent=`使用看板默认工作区（${b}）`;}).catch(()=>{}); Pv().then(b=>{for(const p of b){S.set(p.id,p);const m=document.createElement("option");m.value=p.id;m.textContent=p.name||p.slug||p.primary_path||p.id;a.append(m);}}).catch(()=>{}); cf(i);
  }
  function Av() {
    if (window.__HERMES_WORKBENCH_CREATE_DIALOG_BRIDGE__) return;
    window.__HERMES_WORKBENCH_CREATE_DIALOG_BRIDGE__ = !0;
    let i = !1;
    const e = () => {
      i ||
        ((i = !0),
        window.requestAnimationFrame(() => {
          i = !1;
          for (const t of Array.from(
            document.querySelectorAll(".hermes-kanban-create-dialog"),
          ))
            Ev(t);
        }));
    };
    (new MutationObserver(e).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
    }),
      new MutationObserver(e).observe(document.documentElement, {
        attributes: !0,
        attributeFilter: ["style"],
      }),
      e());
  }
  function Hf(i = document) {
    return i.documentElement.lang.toLowerCase().startsWith("zh");
  }
  function ge(i, e, t = document) {
    return Hf(t) ? i : e;
  }
  const Sc = "hermes-dashboard-theme",
    bc = "data-workbench-theme",
    zs = "hermes-workbench:theme-change",
    _c = { light: "workbench-light", dark: "workbench-dark" };
  function Vf(i = window.localStorage) {
    try {
      return i.getItem(Sc) || "";
    } catch {
      return "";
    }
  }
  function sr(i) {
    const e = String(i ?? "")
      .trim()
      .toLowerCase();
    return /(?:^|-)dark$/.test(e)
      ? "dark"
      : /(?:^|-)light$/.test(e)
        ? "light"
        : null;
  }
  function na(i) {
    const e = i.trim().toLowerCase().replace(/\s+/g, "");
    return e
      ? e === "#000" ||
        e === "#000000" ||
        e === "rgb(0,0,0)" ||
        e === "rgba(0,0,0,1)"
        ? "dark"
        : e === "#fff" ||
            e === "#ffffff" ||
            e === "rgb(255,255,255)" ||
            e === "rgba(255,255,255,1)"
          ? "light"
          : null
      : null;
  }
  function Uf(i = document.documentElement) {
    const e =
      sr(i.getAttribute("data-theme")) ?? sr(i.getAttribute("data-color-mode"));
    if (e) return e;
    const t =
      na(i.style.getPropertyValue("--background-base")) ??
      na(i.style.getPropertyValue("--color-card"));
    if (t) return t;
    const r = getComputedStyle(i);
    return (
      na(r.getPropertyValue("--background-base")) ??
      na(r.getPropertyValue("--color-card"))
    );
  }
  function Yf(i = document.documentElement, e = window.localStorage) {
    return sr(Vf(e)) ?? Uf(i) ?? "light";
  }
  function Gf(i, e) {
    const t = document.documentElement;
    t.dataset.workbenchTheme = i;
    const r = { mode: i, theme: _c[i], source: e };
    window.dispatchEvent(new CustomEvent(zs, { detail: r }));
  }
  function Kf(i, e = "user", t = window.localStorage) {
    try {
      t.setItem(Sc, _c[i]);
    } catch {}
    Gf(i, e);
  }
  async function p1(i, e, t) {
    const r = await i(e, t);
    if (!r.ok) throw new Error(runtimeText(`主题设置请求失败（${r.status}）`, `Theme settings request failed (${r.status})`));
    return await r.json();
  }
  function m1() {
    return (
      window.__HERMES_PLUGIN_SDK__?.authedFetch ??
      ((e, t) => fetch(e, { ...t, credentials: "same-origin" }))
    );
  }
  async function O1(i, e = {}) {
    const r = sr(document.documentElement.dataset.workbenchTheme) ?? Yf(),
      n = e.request ?? m1();
    Kf(i, "user");
    try {
      await p1(n, "/api/dashboard/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: _c[i] }),
      });
    } catch (s) {
      throw (Kf(r, "rollback"), s);
    }
  }
  function g1(i) {
    const e = document.documentElement;
    let t = e.dataset.workbenchTheme;
    const r = (a = null, l = "host") => {
        const c = a ?? Yf(e);
        c !== t &&
          ((t = c),
          (e.dataset.workbenchTheme = c),
          i(c),
          (l === "host" || l === "storage") && Gf(c, l));
      },
      n = (a) => {
        const l = a.detail;
        r(sr(l?.mode), l?.source ?? "host");
      },
      s = (a) => {
        a.key === Sc && r(sr(a.newValue), "storage");
      },
      o = new MutationObserver(() => r());
    return (
      o.observe(e, {
        attributes: !0,
        attributeFilter: ["data-theme", "data-color-mode", "style"],
      }),
      window.addEventListener(zs, n),
      window.addEventListener("storage", s),
      r(sr(e.dataset.workbenchTheme), "host"),
      () => {
        (o.disconnect(),
          window.removeEventListener(zs, n),
          window.removeEventListener("storage", s));
      }
    );
  }
  const Jf = "hti-mermaid-runtime",
    S1 = "/dashboard-plugins/workbench/dist/mermaid.min.js";
  let Xs,
    vc = [],
    b1 = 0;
  function _1(i, e = "") {
    const t = i.toLowerCase();
    return /\.(?:md|markdown|mdown|mdx)$/.test(t) || e.includes("markdown")
      ? "markdown"
      : /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/.test(t) ||
          e.startsWith("image/")
        ? "image"
        : t.endsWith(".pdf") || e === "application/pdf"
          ? "pdf"
          : /\.(?:txt|log|csv|json|ya?ml|toml|ini|cfg|conf|xml|py|ts|tsx|js|jsx|sh|bash|css|html?|sql|c|cc|cpp|h|hpp|rs|go|java)$/.test(
                t,
              ) || e.startsWith("text/")
            ? "text"
            : "download";
  }
  function yc() {
    document.getElementById("hti-file-preview")?.remove();
    for (const i of vc) URL.revokeObjectURL(i);
    vc = [];
  }
  function wc(i) {
    const e = URL.createObjectURL(i);
    return (vc.push(e), e);
  }
  function ep() {
    return window.mermaid;
  }
  function kc() {
    const i = ep();
    return i
      ? Promise.resolve(i)
      : Xs ||
          ((Xs = new Promise((e, t) => {
            const r = document.getElementById(Jf),
              n = r || document.createElement("script"),
              s = () => {
                const o = ep();
                o
                  ? e(o)
                  : t(
                      new Error(
                        ge(
                          "Mermaid 运行时未注册",
                          "Mermaid runtime is unavailable",
                        ),
                      ),
                    );
              };
            (n.addEventListener("load", s, { once: !0 }),
              n.addEventListener(
                "error",
                () =>
                  t(
                    new Error(
                      ge(
                        "Mermaid 运行时加载失败",
                        "Could not load Mermaid runtime",
                      ),
                    ),
                  ),
                { once: !0 },
              ),
              r ||
                ((n.id = Jf),
                (n.src = S1),
                (n.async = !0),
                document.head.appendChild(n)));
          }).catch((e) => {
            throw ((Xs = void 0), e);
          })),
          Xs);
  }
  function v1() {
    const i = document.documentElement,
      e = sr(i.getAttribute(bc)),
      t = i.getAttribute("data-theme") || "",
      r =
        e === "dark" ||
        i.classList.contains("dark") ||
        t.toLowerCase().includes("dark"),
      n =
        getComputedStyle(i).getPropertyValue("--theme-font-sans").trim() ||
        (document.body
          ? getComputedStyle(document.body)
              .getPropertyValue("--theme-font-sans")
              .trim()
          : "") ||
        '"Workbench Sans SC", ui-sans-serif, system-ui, sans-serif';
    return { theme: r ? "dark" : "default", themeVariables: { fontFamily: n } };
  }
  async function y1(i) {
    const e = Array.from(i.querySelectorAll("pre > code.language-mermaid"));
    if (!e.length) return 0;
    const t = await kc(),
      r = v1();
    t.initialize({
      startOnLoad: !1,
      securityLevel: "strict",
      suppressErrorRendering: !0,
      layout: "dagre",
      look: "classic",
      ...r,
    });
    let n = 0;
    for (const s of e) {
      const o = s.textContent || "",
        a = document.createElement("div");
      ((a.className = "hti-mermaid"),
        a.setAttribute("role", "img"),
        a.setAttribute("aria-label", ge("Mermaid 图表", "Mermaid diagram")));
      try {
        const l = await t.render(`hti-mermaid-${Date.now()}-${b1++}`, o);
        ((a.innerHTML = l.svg),
          l.bindFunctions?.(a),
          s.parentElement?.replaceWith(a),
          (n += 1));
      } catch (l) {
        s.parentElement?.classList.add("hti-mermaid-error");
        const c = document.createElement("small");
        ((c.className = "hti-mermaid-error-note"),
          (c.textContent = ge(
            `Mermaid 渲染失败：${l instanceof Error ? l.message : String(l)}`,
            `Mermaid rendering failed: ${l instanceof Error ? l.message : String(l)}`,
          )),
          s.parentElement?.appendChild(c));
      }
    }
    return n;
  }
  function w1(i) {
    yc();
    const e = document.createElement("div");
    ((e.id = "hti-file-preview"),
      (e.className = "hti-file-preview"),
      e.addEventListener("click", (a) => {
        a.target === e && yc();
      }));
    const t = document.createElement("article");
    t.className = "hti-file-preview-panel";
    const r = document.createElement("header"),
      n = document.createElement("strong");
    n.textContent = i;
    const s = document.createElement("button");
    ((s.type = "button"),
      (s.textContent = ge("关闭", "Close")),
      s.setAttribute("aria-label", ge("关闭预览", "Close preview")),
      s.addEventListener("click", yc),
      r.append(n, s));
    const o = document.createElement("div");
    return (
      (o.className = "hti-file-preview-body"),
      t.append(r, o),
      e.append(t),
      document.body.append(e),
      { overlay: e, body: o }
    );
  }
  async function tp(i, e, t = e.type) {
    return openFilePreview(i, e, t);
  }

  const ip = "/api/plugins/kanban";
  function k1() {
    return new URLSearchParams(window.location.search).get("board") || "";
  }
  function rp(i) {
    const e = k1();
    return e
      ? `${ip}${i}${i.includes("?") ? "&" : "?"}board=${encodeURIComponent(e)}`
      : `${ip}${i}`;
  }
  async function np(i) {
    const e = window.__HERMES_PLUGIN_SDK__;
    return e?.authedFetch
      ? await e.authedFetch(i)
      : await fetch(i, { credentials: "same-origin" });
  }
  function x1() {
    document.getElementById("hti-file-preview")?.remove();
  }
  async function C1(i) {
    x1();
    const e = await np(rp(`/attachments/${encodeURIComponent(i.id)}`));
    if (!e.ok) throw new Error(runtimeText(`附件读取失败（${e.status}）`, `Attachment read failed (${e.status})`));
    const t = await e.blob();
    await tp(i.filename, t, i.content_type || t.type);
  }
  async function Q1(i) {
    const e =
      i.querySelector(".hermes-kanban-drawer-head span")?.textContent?.trim() ||
      "";
    if (!e) return;
    const t = await np(rp(`/tasks/${encodeURIComponent(e)}/attachments`));
    if (!t.ok) return;
    const r = await t.json(),
      n = Array.isArray(r.attachments) ? r.attachments : [];
    for (const s of Array.from(
      i.querySelectorAll(".hermes-kanban-attachment-link"),
    )) {
      const o = s.getAttribute("title") || s.textContent?.trim() || "",
        a = n.find((u) => u.filename === o),
        l = s.parentElement;
      if (!a || !l || l.querySelector(".hti-kanban-attachment-preview-button"))
        continue;
      const c = document.createElement("button");
      ((c.type = "button"),
        (c.className = "hti-kanban-attachment-preview-button"),
        (c.textContent = runtimeText("预览", "Preview")),
        c.addEventListener("click", (u) => {
          (u.preventDefault(),
            u.stopPropagation(),
            C1(a).catch((h) => {
              ((c.textContent = runtimeText("预览失败", "Preview failed")), (c.title = String(h)));
            }));
        }),
        l.insertBefore(c, s.nextSibling));
    }
  }
  function P1() {
    if (window.__HERMES_WORKBENCH_ATTACHMENT_PREVIEW__) return;
    window.__HERMES_WORKBENCH_ATTACHMENT_PREVIEW__ = !0;
    let i = !1;
    const e = () => {
      i ||
        ((i = !0),
        window.requestAnimationFrame(() => {
          i = !1;
          for (const t of Array.from(
            document.querySelectorAll(".hermes-kanban-drawer"),
          ))
            Q1(t).catch(() => {});
        }));
    };
    (new MutationObserver(e).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
    }),
      e());
  }
  const $1 = "/files";
  function sp() {
    return window.location.pathname.replace(/\/+$/, "") === $1;
  }
  function T1(i = document) {
    const e = i.querySelector('input[aria-label="Path"]');
    return e?.value.trim()
      ? e.value.trim()
      : (
          i.querySelector('button[aria-label="Upload files"] [title]') ||
          i.querySelector('button[aria-label="上传文件"] [title]')
        )
          ?.getAttribute("title")
          ?.trim() || "";
  }
  function E1(i, e) {
    const t = i.includes("\\") && !i.includes("/") ? "\\" : "/";
    return i.endsWith("/") || i.endsWith("\\") ? `${i}${e}` : `${i}${t}${e}`;
  }
  function op(i, e = document) {
    const t = i.querySelector("span.truncate")?.textContent?.trim() || "",
      r = i.closest("div.grid"),
      n = T1(e);
    return !t || !r || !n
      ? ""
      : Array.from(r.querySelectorAll("button[aria-label]"))
            .map((a) => a.getAttribute("aria-label")?.trim() || "")
            .some((a) => /^download\s/i.test(a) || /^下载(?:\s|：|:)/.test(a))
        ? E1(n, t)
        : "";
  }
  function A1(i, e = document) {
    const r = i.target?.closest?.("button");
    if (!r) return "";
    const n = op(r, e);
    return n
      ? (i.preventDefault(),
        i.stopPropagation(),
        i.stopImmediatePropagation(),
        n)
      : "";
  }
  function R1(i = document) {
    const t = Array.from(i.querySelectorAll("button")).find(
      (s) => s.textContent?.trim() === "..",
    );
    if (!t) return 0;
    let r = 0,
      n = t.previousElementSibling;
    for (; n; ) {
      const s = n.previousElementSibling;
      if (!n.matches("div.grid") || !n.querySelector("button")) break;
      (n.remove(), (r += 1), (n = s));
    }
    return r;
  }
  async function L1(i) {
    const e = window.__HERMES_PLUGIN_SDK__;
    return e?.authedFetch
      ? await e.authedFetch(i)
      : await fetch(i, { credentials: "same-origin" });
  }
  async function M1(i) {
    const e = await L1(`/api/files/read?path=${encodeURIComponent(i)}`);
    if (!e.ok)
      throw new Error(
        ge(`文件读取失败（${e.status}）`, `Could not read file (${e.status})`),
      );
    const t = await e.json(),
      r = await fetch(t.data_url);
    if (!r.ok)
      throw new Error(ge("文件内容解码失败", "Could not decode file content"));
    return { name: t.name, blob: await r.blob(), mime: t.mime_type || "" };
  }
  function D1(i = document) {
    for (const e of Array.from(i.querySelectorAll("button span.truncate"))) {
      const t = e.closest("button");
      if (!t || !op(t, i)) continue;
      t.dataset.htiFilesPreview = "true";
      const r = e.textContent?.trim() || ge("文件", "file");
      t.title = ge(
        `预览 ${r}（右侧按钮可下载）`,
        `Preview ${r} (use the action on the right to download)`,
      );
    }
  }
  function I1() {
    sp() && D1();
  }
  function N1() {
    if (window.__HERMES_WORKBENCH_FILES_PREVIEW__) return;
    ((window.__HERMES_WORKBENCH_FILES_PREVIEW__ = !0),
      document.addEventListener(
        "click",
        (t) => {
          if (!sp()) return;
          const r = A1(t);
          if (!r) return;
          const n = t.target?.closest("button");
          (n?.setAttribute("aria-busy", "true"),
            M1(r)
              .then((s) => tp(s.name, s.blob, s.mime))
              .catch((s) => {
                n &&
                  (n.title = ge(
                    `预览失败：${s instanceof Error ? s.message : String(s)}`,
                    `Preview failed: ${s instanceof Error ? s.message : String(s)}`,
                  ));
              })
              .finally(() => n?.removeAttribute("aria-busy")));
        },
        !0,
      ));
    let i = !1;
    const e = () => {
      i ||
        ((i = !0),
        window.requestAnimationFrame(() => {
          ((i = !1), I1());
        }));
    };
    (new MutationObserver(e).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
      attributes: !0,
      attributeFilter: ["lang"],
    }),
      window.addEventListener("popstate", e),
      e());
  }
  const ap = "/api/plugins/workbench",
    lp = 3e4,
    B1 = 2e3,
    sa = new Map();
  function xc(i, e) {
    return `${e}\0${i}`;
  }
  function Cc(i, e) {
    return `hermes.workbench.kanban-link.v2.${encodeURIComponent(e)}.${encodeURIComponent(i)}`;
  }
  function z1(i, e) {
    const t = xc(i, e),
      r = sa.get(t);
    if (r && r.expiresAt > Date.now()) return r.items;
    try {
      const n = window.sessionStorage.getItem(Cc(i, e));
      if (!n) return null;
      const s = JSON.parse(n);
      return !Array.isArray(s?.items) || Number(s?.expiresAt) <= Date.now()
        ? null
        : (sa.set(t, s), s.items);
    } catch {
      return null;
    }
  }
  function X1(i) {
    const e = { expiresAt: Date.now() + lp, items: [i] };
    sa.set(xc(i.task_id, i.board), e);
    try {
      window.sessionStorage.setItem(Cc(i.task_id, i.board), JSON.stringify(e));
    } catch {}
  }
  function cp(i) {
    return encodeURIComponent(i);
  }
  async function W1(i, e) {
    const t = await i(`${ap}/kanban-sessions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(e),
    });
    return (X1(t.link), t.link);
  }
  async function q1(i, e = "") {
    const t = z1(i, e);
    if (t) return t;
    const r = e ? `&board=${cp(e)}` : "",
      n = await af(`${ap}/kanban-sessions?task_id=${cp(i)}${r}`);
    if (!n.ok)
      throw new Error(`Unable to load task conversation (${n.status})`);
    const s = await n.json(),
      o = Array.isArray(s?.items) ? s.items.slice(0, 1) : [],
      a = { expiresAt: Date.now() + (o.length ? lp : B1), items: o };
    sa.set(xc(i, e), a);
    try {
      window.sessionStorage.setItem(Cc(i, e), JSON.stringify(a));
    } catch {}
    return o;
  }
  function Z1(i, e, t, r = "default") {
    const n = new URL("/chat", "https://dashboard.invalid");
    return (
      n.searchParams.set("profile", t?.profile || r),
      n.searchParams.set("kanban_task", i),
      e && n.searchParams.set("kanban_board", e),
      t?.session_id && n.searchParams.set("session", t.session_id),
      `${n.pathname}${n.search}`
    );
  }
  function j1(i, e, t, r) {
    return Z1(i, e, r[0], t);
  }
  function J1() { installKanbanWorkflowBridge(); }
  const ek = "/api/plugins/workbench",
    pp = new Set(["running", "blocked", "review"]),
    tk = 8192,
    mp = 3e3,
    ik = 15e3,
    Op = 180,
    gp = 32,
    rk = [
      /^Query:\s+work kanban task\b/i,
      /^Initializing agent\.\.\.$/i,
      /^[─━═\-]{8,}$/,
      /^Resume this session with:$/i,
      /^hermes\s+(?:-p\s+\S+\s+)?--resume\b/i,
      /^hermes\s+-c\s+["']?Work kanban task\b/i,
      /^(?:Session|Title|Duration|Messages):\s*/i,
      /^⚠\s*Deprecated\b/i,
      /^Move to config\.yaml instead:/i,
      /^Then remove the old entries from\b/i,
      /^┊\s*review diff\b/i,
      /^@@\s/,
      /^[+-]$/,
    ],
    oa = new Map();
  let Sp = 0;
  function nk(i) {
    const e = i.slice(-2e5),
      t = [];
    for (let r = 0; r < e.length; r += 1) {
      const n = e.charCodeAt(r);
      if (n === 27) {
        const s = e[r + 1] || "";
        if (s === "[")
          for (r += 2; r < e.length && !/[@-~]/.test(e[r]); ) r += 1;
        else if (s === "]" || s === "P" || s === "_" || s === "^")
          for (r += 2; r < e.length && e.charCodeAt(r) !== 7; ) {
            if (e.charCodeAt(r) === 27 && e[r + 1] === "\\") {
              r += 1;
              break;
            }
            r += 1;
          }
        else r += 1;
        continue;
      }
      if (n === 8) {
        t.length &&
          t[t.length - 1] !==
            `
` &&
          t.pop();
        continue;
      }
      (n === 9 || n === 10 || n === 13 || n >= 32) && t.push(e[r]);
    }
    return t.join("");
  }
  function sk(i) {
    return nk(i)
      .replace(
        /\r\n/g,
        `
`,
      )
      .split(
        `
`,
      )
      .flatMap((e) => e.split("\r").slice(-1))
      .map((e) => e.trim())
      .filter(Boolean);
  }
  function bp(i) {
    return !rk.some((e) => e.test(i));
  }
  function _p(i) {
    return i
      .replace(
        /(\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+)[^\s"'`]+/gi,
        "$1[REDACTED]",
      )
      .replace(
        /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
        "[REDACTED_JWT]",
      )
      .replace(
        /\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|_KEY))\s*=\s*[^\s"'`]+/gi,
        "$1=[REDACTED]",
      )
      .replace(
        /(\b(?:token|secret|password|api[_-]?key|access[_-]?key)=)[^&\s"'`]+/gi,
        "$1[REDACTED]",
      )
      .replace(/https?:\/\/[^\s<>"'`]+/gi, (e) => {
        try {
          return `${new URL(e.replace(/[),.;]+$/, "")).origin}/…`;
        } catch {
          return "[REDACTED_URL]";
        }
      });
  }
  function vp(i) {
    const e = Array.from(i);
    return e.length > Op
      ? `${e
          .slice(0, Op - 1)
          .join("")
          .trimEnd()}…`
      : i;
  }
  function ok(i) {
    let e = "";
    for (const t of i) {
      if (!e) {
        e = t;
        continue;
      }
      const r = /[A-Za-z0-9]$/.test(e) && /^[A-Za-z0-9]/.test(t);
      e += `${r ? " " : ""}${t}`;
    }
    return e;
  }
  function ak(i) {
    const e = sk(i);
    let t = -1;
    for (let n = e.length - 1; n >= 0; n -= 1)
      if (/\b⚕\s*Hermes\b/i.test(e[n])) {
        t = n + 1;
        break;
      }
    if (t >= 0) {
      const n = [];
      for (
        let o = t;
        o < e.length &&
        !/^(?:Resume this session with:|[─━═\-]{8,})$/i.test(e[o]);
        o += 1
      )
        bp(e[o]) && n.push(e[o]);
      const s = ok(n);
      if (s) return vp(_p(s));
    }
    const r = [];
    for (const n of e) {
      if (!bp(n)) continue;
      const s = vp(_p(n));
      r[r.length - 1] !== s && r.push(s);
    }
    return r.slice(-2).join(`
`);
  }
  function yp(i) {
    return i.closest("[data-kanban-column]")?.dataset.kanbanColumn || "";
  }
  function $c() {
    const i = new URLSearchParams(window.location.search).get("board")?.trim();
    if (i) return i;
    try {
      return (
        window.localStorage.getItem("hermes.kanban.selectedBoard") || ""
      ).trim();
    } catch {
      return "";
    }
  }
  function wp(i) {
    const e = document.documentElement.lang.toLowerCase().startsWith("zh");
    return ({
      triage: ["待分类", "Triage"],
      todo: ["待办", "Todo"],
      scheduled: ["已排期", "Scheduled"],
      ready: ["就绪", "Ready"],
      running: [runtimeText("进行中", "Running"), "Running"],
      blocked: [runtimeText("已阻塞", "Blocked"), "Blocked"],
      review: ["待审核", "Review"],
      done: [runtimeText("已完成", "Completed"), "Done"],
    }[i] || [i, i])[e ? 0 : 1];
  }
  function kp(i, e) {
    return `${i}\0${e}`;
  }
  function xp(i, e) {
    const t = new Set(
        (i.dataset.htiDescriptionIds || "").split(/\s+/).filter(Boolean),
      ),
      r = (i.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((o) => o && !t.has(o)),
      n = e.map((o) => o.id).filter(Boolean),
      s = [...r, ...n];
    (s.length
      ? i.setAttribute("aria-describedby", s.join(" "))
      : i.removeAttribute("aria-describedby"),
      (i.dataset.htiDescriptionIds = n.join(" ")));
  }
  function Cp(i, e, t) {
    i.dataset.htiKanbanState = e;
    const r = i.querySelector(".hermes-kanban-card-content");
    if (!r) return;
    let n = r.querySelector(".hti-kanban-state-mark");
    (n ||
      ((n = document.createElement("span")),
      (n.className = "hti-kanban-state-mark"),
      n.setAttribute("role", "img"),
      (n.id = `hti-kanban-state-${++Sp}`),
      r.prepend(n)),
      n.setAttribute("aria-label", wp(e)),
      n.setAttribute("title", wp(e)));
    let s = r.querySelector(".hti-kanban-recent-output");
    if (!pp.has(e) || !t) {
      (s?.remove(), xp(i, [n]));
      return;
    }
    if (!s) {
      ((s = document.createElement("pre")),
        (s.className = "hti-kanban-recent-output"),
        (s.id = `hti-kanban-output-${++Sp}`));
      const a = r.querySelector(".hermes-kanban-card-meta");
      r.insertBefore(s, a);
    }
    s.textContent !== t && (s.textContent = t);
    const o = document.documentElement.lang.toLowerCase().startsWith("zh")
      ? "最近输出"
      : "Recent output";
    (s.setAttribute("aria-label", `${o}: ${t.replace(/\n/g, "；")}`),
      (s.title = t.replace(/\n/g, " · ")),
      xp(i, [n, s]));
  }
  async function lk(i, e, t = fetch) {
    const r = new Map();
    for (let n = 0; n < i.length; n += gp) {
      const s = i.slice(n, n + gp);
      try {
        const o = await t(`${ek}/kanban-activity`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ board: e, task_ids: s, tail_bytes: tk }),
        });
        if (!o.ok) continue;
        const a = await o.json();
        if (e && String(a?.board || "") !== e) continue;
        for (const l of Array.isArray(a?.items) ? a.items : []) {
          const c = String(l?.task_id || "");
          s.includes(c) && r.set(c, ak(String(l?.content || "")));
        }
      } catch {}
    }
    return r;
  }
  function ck(i, e) {
    return $c() !== e
      ? []
      : Array.from(
          document.querySelectorAll(".hermes-kanban-card[data-task-id]"),
        ).filter((t) => t.dataset.taskId === i);
  }
  function hk() {
    if (window.__HERMES_WORKBENCH_KANBAN_CARD_ACTIVITY__) return;
    window.__HERMES_WORKBENCH_KANBAN_CARD_ACTIVITY__ = !0;
    let i = 0,
      e = 0,
      t = !1,
      r = "";
    const n = async () => {
        if (((e = 0), !(document.hidden || t))) {
          if (!window.location.pathname.includes("kanban")) {
            s();
            return;
          }
          t = !0;
          try {
            const a = $c();
            a !== r && (oa.clear(), (r = a));
            const l = Date.now(),
              c = Array.from(
                document.querySelectorAll(".hermes-kanban-card[data-task-id]"),
              ),
              u = new Set();
            for (const d of c) {
              const f = yp(d),
                S = d.dataset.taskId || "",
                b = kp(a, S);
              (Cp(d, f, oa.get(b)?.summary || ""),
                S &&
                  pp.has(f) &&
                  (oa.get(b)?.nextFetchAt || 0) <= l &&
                  u.add(S));
            }
            const h = await lk(Array.from(u), a, fetch);
            if ($c() !== a) return;
            for (const d of u) {
              const f = h.get(d) || "";
              oa.set(kp(a, d), {
                summary: f,
                nextFetchAt: Date.now() + (f ? mp : ik),
              });
              for (const S of ck(d, a)) Cp(S, yp(S), f);
            }
          } finally {
            ((t = !1), s());
          }
        }
      },
      s = () => {
        (e && window.clearTimeout(e),
          (e = window.setTimeout(() => {
            n();
          }, mp)));
      },
      o = () => {
        i ||
          (i = window.requestAnimationFrame(() => {
            ((i = 0), n());
          }));
      };
    (new MutationObserver(o).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
    }),
      document.addEventListener("visibilitychange", o),
      window.addEventListener("popstate", o),
      o());
  }
  const aa = "/files",
    la = "/chat",
    Qp = "workbench=terminal",
    uk = "hermes-sidebar-plugin-nav-heading";
  function Pp() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }
  function $p(i) {
    (window.history.pushState(null, "", i),
      window.dispatchEvent(new PopStateEvent("popstate")));
  }
  function Tc(i = Pp()) {
    try {
      const e = new URL(i, "https://dashboard.invalid");
      return (
        e.pathname === la && e.searchParams.get("workbench") === "terminal"
      );
    } catch {
      return !1;
    }
  }
  function Tp(i = Pp()) {
    try {
      return new URL(i, "https://dashboard.invalid").pathname === la;
    } catch {
      return !1;
    }
  }
  function Ep(i, e) {
    (i.setAttribute("aria-current", e ? "page" : "false"),
      i.classList.toggle("text-midground", e),
      i.classList.toggle("text-text-secondary", !e),
      i.classList.toggle("hover:text-midground", !e));
    let t = i.querySelector(".hti-sidebar-tool-active-marker");
    e && !t
      ? ((t = document.createElement("span")),
        (t.className =
          "hti-sidebar-tool-active-marker absolute left-0 top-0 bottom-0 w-px bg-midground"),
        t.setAttribute("aria-hidden", "true"),
        i.appendChild(t))
      : e || t?.remove();
  }
  function dk(i, e, t, r) {
    const n = i.cloneNode(!0);
    ((n.id = e),
      (n.href = t),
      n.removeAttribute("data-discover"),
      n.removeAttribute("aria-current"),
      n
        .querySelectorAll(".hti-sidebar-tool-active-marker")
        .forEach((o) => o.remove()));
    const s = Array.from(n.querySelectorAll("span")).filter(
      (o) => !o.hasAttribute("aria-hidden"),
    );
    return (
      s[0] && (s[0].textContent = r),
      n.setAttribute("aria-label", r),
      n.setAttribute("title", r),
      n
    );
  }
  function Ap(i, e) {
    const t = i.querySelector("a");
    if (!t) return;
    const r = Array.from(t.querySelectorAll("span")).find(
      (n) =>
        !n.hasAttribute("aria-hidden") ||
        n.hasAttribute("data-hti-sidebar-collapsed-label"),
    );
    (r && r.textContent !== e && (r.textContent = e),
      t.setAttribute("aria-label", e),
      t.setAttribute("title", e));
  }
  function Rp(i, e, t, r, n, s) {
    let o = Array.from(i.children).find(
      (a) => a instanceof HTMLLIElement && a.dataset.htiSidebarTool === t,
    );
    if (!o) {
      ((o = document.createElement("li")), (o.dataset.htiSidebarTool = t));
      const a = dk(e, t, r, n);
      (a.addEventListener("click", (l) => {
        (l.preventDefault(), l.stopPropagation(), s());
      }),
        o.appendChild(a),
        i.appendChild(o));
    }
    return o;
  }
  function fk(i = document) {
    const t = i.getElementById(uk)?.closest('[role="group"]'),
      r = t
        ? Array.from(t.children).find((d) => d.tagName.toLowerCase() === "ul")
        : void 0,
      n = Array.from(
        i.querySelectorAll('#app-sidebar nav a[href="/files"]'),
      ).find((d) => !d.closest("[data-hti-sidebar-tool]")),
      s = i.querySelector('#app-sidebar nav a[href="/chat"]');
    if (!r || !n || !s) return !1;
    const o = Rp(
        r,
        s,
        "hti-sidebar-terminal-tab",
        `${la}?${Qp}`,
        ge("终端", "Terminal", i),
        () => $p(`${la}?${Qp}`),
      ),
      a = Rp(r, n, "hti-sidebar-files-tab", aa, ge("文件", "Files", i), () =>
        $p(aa),
      ),
      l = Array.from(r.children);
    (l.at(-2) !== o || l.at(-1) !== a) && r.append(o, a);
    const c = o.querySelector("a"),
      u = a.querySelector("a");
    (Ap(o, ge("终端", "Terminal", i)),
      Ap(a, ge("文件", "Files", i)),
      Ep(c, Tc()),
      Ep(u, window.location.pathname === aa));
    const h = n.closest("li") || n;
    return (
      h.classList.add("hti-native-files-nav-hidden"),
      h.setAttribute("aria-hidden", "true"),
      a.classList.remove("hti-native-files-nav-hidden"),
      a.removeAttribute("aria-hidden"),
      i.querySelector(".hti-host-header-tools")?.remove(),
      (document.documentElement.dataset.workbenchRoute = String(Tp())),
      !0
    );
  }
  function pk(i = document) {
    if (window.location.pathname !== aa) return !1;
    const e = i.querySelector(
        'button[aria-label="Refresh files"], button[aria-label="刷新文件"]',
      ),
      r = Array.from(i.querySelectorAll("button")).find(
        (n) =>
          n.textContent?.trim() === "Create" ||
          ["Create", "创建"].includes(n.textContent?.trim() || ""),
      )?.parentElement;
    return !e || !r
      ? !1
      : (e.classList.add("hti-files-inline-refresh"),
        e.setAttribute("title", ge("刷新文件", "Refresh files")),
        e.parentElement !== r && r.prepend(e),
        !0);
  }
  function mk() {
    if (window.__HERMES_WORKBENCH_SIDEBAR_TOOLS__) return;
    window.__HERMES_WORKBENCH_SIDEBAR_TOOLS__ = !0;
    let i = !1;
    const e = () => {
      i ||
        ((i = !0),
        window.requestAnimationFrame(() => {
          ((i = !1), fk(), pk());
        }));
    };
    (new MutationObserver(e).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
      attributes: !0,
      attributeFilter: ["lang"],
    }),
      window.addEventListener("popstate", e),
      e());
  }
  const Ok = "hermes-sidebar-plugin-nav-heading",
    gk = "hti-sidebar-plugin-nav-first",
    Sk = "lg:w-14",
    ca = "data-hti-sidebar-collapsed-label";
  function bk(i = document) {
    const t = i.getElementById(Ok)?.closest('[role="group"]'),
      r = t?.parentElement;
    return !t || !r || r.tagName.toLowerCase() !== "nav"
      ? !1
      : (t.classList.add(gk),
        r.firstElementChild !== t && r.insertBefore(t, r.firstElementChild),
        !0);
  }
  function _k(i = document) {
    const e = i.getElementById("app-sidebar");
    if (!e) return !1;
    const t = e.classList.contains(Sk);
    e.dataset.htiDesktopCollapsed !== String(t) &&
      (e.dataset.htiDesktopCollapsed = String(t));
    const r = new Set();
    for (const n of e.querySelectorAll("[data-hti-sidebar-tool]")) {
      const s = n.dataset.htiSidebarTool;
      if (s && r.has(s)) {
        n.remove();
        continue;
      }
      s && r.add(s);
      for (const o of n.querySelectorAll("a > span"))
        (o.hasAttribute("aria-hidden") && !o.hasAttribute(ca)) ||
          (t
            ? (o.setAttribute(ca, "true"),
              o.setAttribute("aria-hidden", "true"))
            : o.hasAttribute(ca) &&
              (o.removeAttribute(ca), o.removeAttribute("aria-hidden")));
    }
    return !0;
  }
  function vk(i, e) {
    let t = i;
    for (; t?.parentElement && t.parentElement !== e; ) t = t.parentElement;
    return t?.parentElement === e ? t : null;
  }
  function yk(i = document) {
    const e = i.getElementById("app-sidebar");
    if (!e) return !1;
    (e.classList.add("hti-sidebar-adaptive-width"), _k(i));
    const t = Array.from(e.querySelectorAll('button[aria-haspopup="listbox"]'));
    if (t.length < 2) return !1;
    const r = Array.from(new Set(t.map((o) => vk(o, e))))
        .filter((o) => !!o)
        .find((o) => t.filter((a) => o.contains(a)).length >= 2),
      n = r ? t.filter((o) => r.contains(o)) : [];
    if (!r || n.length < 2) return !1;
    let s = n[0].parentElement;
    for (; s && s !== r && !s.contains(n[1]); ) s = s.parentElement;
    return !s || s === e
      ? !1
      : (s.classList.add("hti-sidebar-preferences"),
        s.parentElement?.classList.add("hti-sidebar-preferences-row"),
        !0);
  }
  function wk() {
    if (window.__HERMES_WORKBENCH_PLUGIN_NAV_FIRST__) return;
    window.__HERMES_WORKBENCH_PLUGIN_NAV_FIRST__ = !0;
    let i = !1;
    const e = () => {
      i ||
        ((i = !0),
        window.requestAnimationFrame(() => {
          ((i = !1), bk(), yk());
        }));
    };
    (new MutationObserver(records => {
      if (records.some(record => record.type !== "attributes" ||
          record.oldValue !== record.target.getAttribute(record.attributeName))) e();
    }).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
      attributes: !0,
      attributeFilter: ["class"],
      attributeOldValue: !0,
    }),
      e());
  }
  const Lp = "hermes-dashboard-theme",
    Ec = "data-hti-sidebar-more",
    Mp = "data-hti-theme-toggle",
    kk = "hti-system-section-collapsed",
    xk = "hti-sidebar-identity-hidden",
    Ck = "hti-profile-scope-banner-hidden",
    Ac = [
      "/models",
      "/logs",
      "/plugins",
      "/mcp",
      "/channels",
      "/webhooks",
      "/pairing",
      "/env",
      "/system",
      "/docs",
    ];
  function Dp(i = window.localStorage) {
    return /(?:^|-)dark$/.test(i.getItem(Lp) || "") ? "dark" : "light";
  }
  function Qk() {
    const i = new URLSearchParams(window.location.search).get("profile");
    return i ? `/api/config?profile=${encodeURIComponent(i)}` : "/api/config";
  }
  async function Rc(i) {
    if (!i.ok) throw new Error(`HTTP ${i.status}`);
    return await i.json();
  }
  async function Pk(i, e = window.fetch.bind(window)) {
    const t = `workbench-${i}`,
      r = Qk(),
      n = await Rc(await e(r)),
      s = n.display && typeof n.display == "object" ? { ...n.display } : {};
    ((s.skin = t),
      (s.tui_theme = i),
      await Rc(
        await e(r, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { ...n, display: s } }),
        }),
      ),
      await Rc(
        await e("/api/dashboard/theme", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: t }),
        }),
      ),
      window.localStorage.setItem(Lp, t));
  }
  function Lc(i, e) {
    return (
      Array.from(i.querySelectorAll(`#app-sidebar nav a[href="${e}"]`)).find(
        (t) => !t.closest(`[${Ec}]`),
      ) ?? null
    );
  }
  function Mc(i) {
    return (window.location.pathname.replace(/\/$/, "") || "/") === i;
  }
  function $k(i) {
    (window.history.pushState(null, "", `${i}${window.location.search}`),
      window.dispatchEvent(new PopStateEvent("popstate")));
  }
  function Ip(i) {
    return (
      Array.from(i.querySelectorAll("span")).find(
        (e) => !e.hasAttribute("aria-hidden"),
      ) ?? null
    );
  }
  function Tk(i, e, t) {
    const r = Ip(e)?.textContent?.trim() || t.slice(1),
      n = Ip(i);
    (n && n.textContent !== r && (n.textContent = r),
      i.setAttribute("aria-label", r),
      i.setAttribute("title", r),
      i.setAttribute("aria-current", Mc(t) ? "page" : "false"),
      i.classList.toggle("text-midground", Mc(t)));
  }
  function Ek(i, e) {
    const t = document.createElement("li");
    t.dataset.htiSecondaryPath = e;
    const r = i.cloneNode(!0);
    return (
      (r.href = e),
      r.removeAttribute("data-discover"),
      r
        .querySelectorAll(".hti-sidebar-tool-active-marker")
        .forEach((n) => n.remove()),
      r.addEventListener("click", (n) => {
        (n.preventDefault(), n.stopPropagation());
        const s = Lc(document, e);
        (s ? s.click() : $k(e), t.closest("details")?.removeAttribute("open"));
      }),
      t.appendChild(r),
      t
    );
  }
  function Ak(i, e) {
    const t = document.createElement("li");
    t.setAttribute(Ec, "true");
    const r = document.createElement("details");
    r.className = "hti-sidebar-more-details";
    const n = document.createElement("summary");
    ((n.className = i.className), n.setAttribute("role", "button"));
    const s = i.querySelector("svg")?.cloneNode(!0);
    s && n.appendChild(s);
    const o = document.createElement("span");
    ((o.className = "hti-sidebar-more-label"),
      (o.textContent = ge("更多", "More", e)),
      n.appendChild(o));
    const a = document.createElement("span");
    ((a.className = "hti-sidebar-more-chevron"),
      a.setAttribute("aria-hidden", "true"),
      (a.textContent = "›"),
      n.appendChild(a));
    const l = document.createElement("ul");
    return (
      (l.className = "hti-sidebar-more-menu"),
      r.append(n, l),
      t.appendChild(r),
      t
    );
  }
  function Rk(i = document) {
    const e = Ac.map((u) => Lc(i, u));
    if (e.some((u) => !u)) return !1;
    const t = e[0].closest("li"),
      r = t?.parentElement;
    if (!t || !r || r.tagName.toLowerCase() !== "ul") return !1;
    let n = i.querySelector(`[${Ec}]`);
    n || (n = Ak(e[0], i));
    const s = Lc(i, "/config")?.closest("li");
    if (!s || s.parentElement !== r) return !1;
    (n.parentElement !== r || s.nextElementSibling !== n) &&
      r.insertBefore(n, s.nextElementSibling);
    const o = n.querySelector("summary"),
      a = ge("更多", "More", i);
    ((n.querySelector(".hti-sidebar-more-label").textContent !== a && (n.querySelector(".hti-sidebar-more-label").textContent = a)),
      o.setAttribute("aria-label", a),
      o.setAttribute("title", a));
    const l = Ac.some(Mc);
    (o.setAttribute("aria-current", l ? "page" : "false"),
      o.classList.toggle("text-midground", l));
    const c = n.querySelector(".hti-sidebar-more-menu");
    return (
      Ac.forEach((u, h) => {
        const d = e[h],
          f = d.closest("li") ?? d;
        (f.classList.add("hti-secondary-nav-hidden"),
          f.setAttribute("aria-hidden", "true"));
        let S = Array.from(c.children).find(
          (b) => b instanceof HTMLLIElement && b.dataset.htiSecondaryPath === u,
        );
        (S || ((S = Ek(d, u)), c.appendChild(S)),
          Tk(S.querySelector("a"), d, u));
      }),
      !0
    );
  }
  function Np(i) {
    const e = i.getElementById("app-sidebar"),
      t = Array.from(
        e?.querySelectorAll('button[aria-haspopup="listbox"]') ?? [],
      );
    if (!e || t.length < 2) return null;
    const r = t.filter((o) => {
      let a = o.parentElement;
      for (; a?.parentElement && a.parentElement !== e; ) a = a.parentElement;
      return a && t.filter((l) => a.contains(l)).length >= 2;
    });
    if (r.length < 2) return null;
    let n = r[0].parentElement;
    for (; n && n !== e && !n.contains(r[1]); ) n = n.parentElement;
    return !n || n === e
      ? null
      : (n.classList.add("hti-sidebar-preferences"),
        n.parentElement?.classList.add("hti-sidebar-preferences-row"),
        (r.find((o) => !o.querySelector("svg")) ?? r[1]).setAttribute(
          "data-hti-language-trigger",
          "true",
        ),
        n);
  }
  function Lk(i) {
    const e = i.querySelector("[data-hti-theme-trigger]");
    if (e) return e;
    const r =
      (
        i.querySelector(
          'button[aria-haspopup="listbox"][title*="theme" i], button[aria-haspopup="listbox"][aria-label*="theme" i], button[aria-haspopup="listbox"][title*="主题"], button[aria-haspopup="listbox"][aria-label*="主题"]',
        ) ??
        Array.from(i.querySelectorAll('button[aria-haspopup="listbox"]')).find(
          (n) => !!n.querySelector("svg"),
        ) ??
        null
      )?.parentElement ?? null;
    return (r?.setAttribute("data-hti-theme-trigger", "true"), r);
  }
  function Mk(i, e) {
    return i === "dark"
      ? ge("切换到亮色主题", "Switch to light theme", e)
      : ge("切换到暗色主题", "Switch to dark theme", e);
  }
  function Dk(i = document) {
    const e = Np(i),
      t = e ? Lk(e) : null,
      r = t?.querySelector('button[aria-haspopup="listbox"]');
    if (!r || !t) return !1;
    (r.classList.add("hti-native-theme-picker-hidden"),
      r.setAttribute("aria-hidden", "true"),
      (r.tabIndex = -1));
    let n = e.querySelector(`button[${Mp}]`);
    n ||
      ((n = r.cloneNode(!1)),
      n.setAttribute(Mp, "true"),
      n.classList.remove("hti-native-theme-picker-hidden"),
      n.removeAttribute("aria-haspopup"),
      n.removeAttribute("aria-expanded"),
      n.removeAttribute("aria-hidden"),
      (n.tabIndex = 0),
      n.addEventListener("click", async () => {
        const l = Dp() === "dark" ? "light" : "dark";
        ((n.disabled = !0), n.setAttribute("aria-busy", "true"));
        try {
          (await Pk(l), window.location.reload());
        } catch (c) {
          ((n.disabled = !1),
            n.removeAttribute("aria-busy"),
            (n.dataset.themeError = String(c)));
        }
      }),
      t.insertBefore(n, r));
    const s = Dp(),
      o = Mk(s, i);
    n.getAttribute("aria-label") !== o && n.setAttribute("aria-label", o);
    n.getAttribute("title") !== o && n.setAttribute("title", o);
    const icon = s === "dark" ? "☀" : "☾";
    let span = n.querySelector(".hti-theme-toggle-icon");
    if (!span) {
      span = document.createElement("span");
      span.className = "hti-theme-toggle-icon";
      span.setAttribute("aria-hidden", "true");
      n.replaceChildren(span);
    }
    if (span.textContent !== icon) span.textContent = icon;
    return !0;
  }

  function Ik(i = document) {
    const e = i.getElementById("app-sidebar"),
      r = e?.querySelector('a[href*="nousresearch.com"]')?.parentElement;
    if (!e || !r) return !1;
    const n = Array.from(r.querySelectorAll("span,p,div"))
      .map((l) => l.textContent?.trim() || "")
      .find((l) => /^v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/i.test(l));
    if (!n) return !1;
    const s = e.firstElementChild;
    let o = s?.querySelector("[data-hti-version-brand]") ?? null;
    if (
      (o ||
        (o =
          Array.from(s?.querySelectorAll("p,span,div") ?? []).find(
            (l) =>
              (l.textContent || "").replace(/\s+/g, "").toLocaleLowerCase() ===
              "hermesagent",
          ) ?? null),
      !o)
    )
      return !1;
    (o.hasAttribute("data-hti-version-brand") ||
      (o.dataset.htiVersionBrand = "true"),
      o.textContent?.trim() !== n && (o.textContent = n));
    const a = `Hermes Agent ${n}`;
    return (
      o.getAttribute("title") !== a && o.setAttribute("title", a),
      r.parentElement?.classList.add(xk),
      !0
    );
  }
  function Nk(i = document) {
    const e = i.getElementById("app-sidebar"),
      t = Np(i);
    if (!e) return !1;
    e.querySelector("[data-hti-quick-actions]")?.remove();
    const r =
      Array.from(e.children)
        .filter(
          (n) =>
            n instanceof HTMLElement && !!n.querySelector("ul > li > button"),
        )
        .find((n) => !t || !n.contains(t)) ?? null;
    return r ? (r.classList.add(kk), !0) : !1;
  }
  function Bk(i = document) {
    const e = Array.from(i.querySelectorAll("div")).find(
      (t) =>
        t.classList.contains("border-amber-500/40") &&
        t.classList.contains("bg-amber-500/10") &&
        t.classList.contains("text-amber-300") &&
        !!t.querySelector("svg") &&
        !t.hasAttribute("role") &&
        !t.querySelector("button"),
    );
    return e
      ? (e.classList.add(Ck), e.setAttribute("aria-hidden", "true"), !0)
      : !1;
  }
  function zk() {
    if (window.__HERMES_WORKBENCH_SIDEBAR_SIMPLIFY__) return;
    window.__HERMES_WORKBENCH_SIDEBAR_SIMPLIFY__ = !0;
    let i = !1;
    const e = () => {
      i ||
        ((i = !0),
        window.requestAnimationFrame(() => {
          ((i = !1), Rk(), Dk(), Nk(), Ik(), Bk());
        }));
    };
    (new MutationObserver(e).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
      attributes: !0,
      attributeFilter: ["lang"],
    }),
      window.addEventListener("popstate", e),
      e());
  }
  function jk(i) {
    try {
      const e = JSON.parse(String(i ?? "")),
        t = e?.method === "event" ? e.params : null;
      return t?.type !== "session.info"
        ? null
        : String(t.session_id ?? "").trim() || null;
    } catch {
      return null;
    }
  }
  function Fk(i, e) {
    return !!(i && e && i === e);
  }
  function Hk(i, e, t) {
    return !e || i ? "ignore" : t ? "adopt" : "probe";
  }
  function Vk(i, e, t) {
    return (
      t && i.type === "keydown" && i.key === "Enter" && (e || i.isComposing)
    );
  }
  function Uk(i, e, t) {
    return i === "chat" && e && t.includes("\r");
  }
  function Yk(i, e) {
    return !!i && e === i;
  }
  function Gk(i) {
    i && ((i.value = ""), i.setSelectionRange(0, 0));
  }
  const Xp = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/bmp": "bmp",
    },
    Kk = 25 * 1024 * 1024;
  function Jk(i, e, t) {
    const r = i.trim().replace(/\/+$/, "") || "/opt/data/workspace",
      n =
        e
          .trim()
          .replace(/[\\/\u0000-\u001f]/g, "_")
          .replace(/^\.+/, "")
          .slice(0, 180) || "attachment.bin",
      s = t.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) || String(Date.now());
    return `${r}/uploads/${s}-${n}`;
  }
  function ex(i) {
    return i
      ? Array.from(i.items || []).some(
          (e) => e.kind === "file" && (!e.type || e.type.startsWith("image/")),
        ) || Array.from(i.files || []).some((e) => e.type.startsWith("image/"))
      : !1;
  }
  async function tx(i) {
    if (!i || typeof i.read != "function") return [];
    const e = [];
    for (const t of await i.read()) {
      const r = t.types.find((o) => o.startsWith("image/"));
      if (!r) continue;
      const n = await t.getType(r),
        s = Xp[r] || r.split("/")[1]?.split("+")[0] || "png";
      e.push(new File([n], `clipboard.${s}`, { type: r }));
    }
    return e;
  }
  function ix(i) {
    return new Promise((e, t) => {
      const r = new FileReader();
      ((r.onerror = () => t(r.error ?? new Error("image read failed"))),
        (r.onload = () =>
          typeof r.result == "string"
            ? e(r.result)
            : t(new Error("image read failed"))),
        r.readAsDataURL(i));
    });
  }
  async function rx(i, e) {
    if (!i.size) throw new Error("clipboard image is empty");
    if (i.size > Kk) throw new Error("image too large (max 25 MB)");
    const t = i.type || "image/png",
      r = Xp[t] || "png",
      n = i.name || `clipboard.${r}`,
      s = await fetch(
        `/api/chat/image-upload?profile=${encodeURIComponent(e)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data_url: await ix(i), filename: n }),
        },
      );
    if (!s.ok)
      throw new Error((await s.text().catch(() => "")) || `HTTP ${s.status}`);
    const o = await s.json();
    if (!o?.path) throw new Error("image upload did not return a path");
    return String(o.path);
  }
  async function nx(i, e) {
    if (!i.size) throw new Error("selected file is empty");
    const t =
        globalThis.crypto?.randomUUID?.().slice(0, 8) ||
        Math.random().toString(36).slice(2, 10),
      r = Jk(e, i.name, `${Date.now()}-${t}`),
      n = new FormData();
    (n.append("file", i, i.name || "attachment.bin"),
      n.append("path", r),
      n.append("overwrite", "false"));
    const s = await fetch("/api/files/upload-stream", {
      method: "POST",
      credentials: "same-origin",
      body: n,
    });
    if (!s.ok)
      throw new Error((await s.text().catch(() => "")) || `HTTP ${s.status}`);
    const o = await s.json();
    return String(o?.path || r);
  }
  const sx = {
      escape: "\x1B",
      tab: "	",
      arrowUp: "\x1B[A",
      arrowDown: "\x1B[B",
      arrowLeft: "\x1B[D",
      arrowRight: "\x1B[C",
    },
    ox = {
      arrowUp: "\x1B[1;5A",
      arrowDown: "\x1B[1;5B",
      arrowLeft: "\x1B[1;5D",
      arrowRight: "\x1B[1;5C",
    },
    ax = { " ": "\0", "[": "\x1B", "\\": "", "]": "", "^": "", _: "" };
  function Wp(i, e) {
    return (e ? ox[i] : void 0) || sx[i];
  }
  function qp(i) {
    if (i.length === 1) {
      const r = i.toLowerCase();
      return r >= "a" && r <= "z"
        ? String.fromCharCode(r.charCodeAt(0) - 96)
        : ax[i] || null;
    }
    const t = {
      ArrowUp: "arrowUp",
      ArrowDown: "arrowDown",
      ArrowLeft: "arrowLeft",
      ArrowRight: "arrowRight",
      Escape: "escape",
      Tab: "tab",
    }[i];
    return t ? Wp(t, !0) : null;
  }
  function lx(i, e) {
    const t = e.trim();
    return i === "chat" && t.toLowerCase() === "default"
      ? "current"
      : t || "current";
  }
  function cx(i, e, t) {
    const r = `hermes.workbench.${i}.${e}.${t}.attach`;
    try {
      const n = window.sessionStorage.getItem(r);
      if (n) return n;
      const s =
        globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      return (window.sessionStorage.setItem(r, s), s);
    } catch {
      return `${Date.now()}-${Math.random()}`;
    }
  }
  function or(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function hx(i) {
    if (i instanceof ArrayBuffer) return new Uint8Array(i);
    const e = String(i ?? "");
    if (!e.startsWith("{")) return e;
    try {
      const t = JSON.parse(e);
      return t.type === "pong"
        ? null
        : typeof t.data == "string"
          ? t.data
          : typeof t.output == "string"
            ? t.output
            : e;
    } catch {
      return e;
    }
  }
  function ux(i, e) {
    return i === "open"
      ? e === "chat"
        ? "Hermes TUI"
        : "Shell"
      : i === "connecting"
        ? ge("连接中", "Connecting")
        : i === "closed"
          ? ge("已断开", "Disconnected")
          : i === "error"
            ? ge("连接失败", "Connection failed")
            : ge("等待连接", "Idle");
  }
  function Zp(i) {
    const e = i.React,
      { useEffect: t, useRef: r, useState: n } = i.hooks;
    return function ({
      mode: o,
      profile: a,
      instanceId: l,
      resumeSessionId: c = "",
      initialInput: u = "",
      onSessionActivity: h,
      workspaceId: d,
      workspacePath: f,
      active: S = !0,
      visible: b = !0,
      autoFocus: p = !1,
      attachmentInputRef: m,
      onAttachmentUploadState: O,
    }) {
      const g = r(null),
        _ = r(null),
        w = r(null),
        v = r(null),
        x = r((N) => {}),
        y = r(null),
        C = m || y,
        P = r(async (N) => {}),
        E = r(!1),
        D = r(h);
      D.current = h;
      const [A, R] = n(0),
        [M, H] = n("idle"),
        [F, j] = n(!1);
      ((E.current = F),
        t(() => {
          if (!S || !g.current || !l || !d) return;
          let N = !1,
            B = null,
            T = null,
            Y = null,
            te = null;
          const { terminal: X, fit: q } = createWorkbenchTerminal(g.current);
          _.current = X; w.current = q;
          const stopThemeObserver = observeTerminalTheme(g.current, X);
          const $ = window.matchMedia("(max-width: 640px)").matches;
          let Z = !1,
            V = !1;
          const z = () => {
              const J = X.textarea?.value || "";
              if (!J) return;
              let le = !1;
              const we = () => {
                if (le || !Yk(J, X.textarea?.value || "")) return;
                const Re = v.current;
                (Re?.readyState === WebSocket.OPEN && Re.send(""),
                  Gk(X.textarea),
                  (le = !0));
              };
              (window.setTimeout(we, 96), window.setTimeout(we, 240));
            },
            G = (J) => {
              const le = v.current;
              (le?.readyState === WebSocket.OPEN && le.send(J),
                Uk(o, $, J) && z());
            };
          x.current = G;
          const ae = () => {
              Z = !0;
            },
            Ce = () => {
              ((Z = !1),
                V &&
                  ((V = !1),
                  window.setTimeout(
                    () => window.setTimeout(() => G("\r"), 0),
                    0,
                  )));
            };
          (g.current.addEventListener("compositionstart", ae, { capture: !0 }),
            g.current.addEventListener("compositionend", Ce, { capture: !0 }));
          let Qe = !1;
          const Xe = async (J) => {
            for (const le of J) {
              if (Qe) return;
              const we = await rx(le, a),
                Re = v.current;
              if (!Re || Re.readyState !== WebSocket.OPEN)
                throw new Error("chat is not connected");
              (Re.send(`/image ${we}`),
                await new Promise((Ye) => window.setTimeout(Ye, 100)),
                v.current?.readyState === WebSocket.OPEN &&
                  v.current.send("\r"));
            }
            X.focus();
          };
          P.current = async (J) => {
            for (const le of J) {
              if (Qe) return;
              if (le.type.startsWith("image/")) {
                await Xe([le]);
                continue;
              }
              const we = await nx(le, f),
                Re = v.current;
              if (!Re || Re.readyState !== WebSocket.OPEN)
                throw new Error("chat is not connected");
              Re.send(`${we} `);
            }
            X.focus();
          };
          const be = (J) => {
              if (o !== "chat") return;
              const le = Nc(J.clipboardData);
              le.length &&
                (J.preventDefault(),
                J.stopPropagation(),
                Xe(le).catch((we) => {
                  X.writeln(`\r
\x1B[31mImage paste failed: ${String(we)}\x1B[0m`);
                }));
            },
            We = (J) => {
              o !== "chat" ||
                !ex(J.dataTransfer) ||
                (J.preventDefault(),
                J.dataTransfer && (J.dataTransfer.dropEffect = "copy"));
            },
            wt = (J) => {
              if (o !== "chat") return;
              const le = Nc(J.dataTransfer);
              le.length &&
                (J.preventDefault(),
                J.stopPropagation(),
                Xe(le).catch((we) => {
                  X.writeln(`\r
\x1B[31mImage drop failed: ${String(we)}\x1B[0m`);
                }));
            };
          (g.current.addEventListener("paste", be, { capture: !0 }),
            g.current.addEventListener("dragover", We, { capture: !0 }),
            g.current.addEventListener("drop", wt, { capture: !0 }),
            X.attachCustomKeyEventHandler((J) => {
              if (
                E.current &&
                J.type === "keydown" &&
                !J.ctrlKey &&
                !J.metaKey &&
                !J.altKey
              ) {
                const le = qp(J.key);
                if (le)
                  return (J.preventDefault(), J.stopPropagation(), G(le), !1);
              }
              return o === "chat" && Vk(J, Z, $)
                ? ((V = !0), J.preventDefault(), !1)
                : o !== "chat" ||
                    J.type !== "keydown" ||
                    (!J.ctrlKey && !J.metaKey) ||
                    J.key.toLowerCase() !== "v"
                  ? !0
                  : (J.preventDefault(),
                    (async () => {
                      try {
                        const le = await tx(navigator.clipboard);
                        if (le.length) {
                          await Xe(le);
                          return;
                        }
                      } catch {}
                      try {
                        const le = await navigator.clipboard?.readText();
                        le && X.paste(le);
                      } catch (le) {
                        X.writeln(`\r
\x1B[31mClipboard paste failed: ${String(le)}\x1B[0m`);
                      }
                    })(),
                    !1);
            }),
            H("connecting"));
          const lt = () => {
            if (N) return;
            try {
              q.fit();
            } catch {
              return;
            }
            const J = v.current;
            !J ||
              J.readyState !== WebSocket.OPEN ||
              J.send(`\x1B[RESIZE:${X.cols};${X.rows}]`);
          };
          ((B = new ResizeObserver(() => lt())),
            B.observe(g.current),
            window.requestAnimationFrame(lt));
          const Ue = (J) => {
            if (N || v.current) return;
            te !== null && (window.clearTimeout(te), (te = null));
            const le = new WebSocket(J);
            ((le.binaryType = "arraybuffer"),
              (v.current = le),
              (le.onopen = () => {
                if (!N && (H("open"), lt(), o === "chat" && !c && u)) {
                  const we = `hermes.workbench.initial-input.${a}.${l}`;
                  try {
                    window.sessionStorage.getItem(we) !== "sent" &&
                      (window.sessionStorage.setItem(we, "sent"),
                      window.setTimeout(() => {
                        !N &&
                          le.readyState === WebSocket.OPEN &&
                          le.send(`${u}\r`);
                      }, 250));
                  } catch {
                    window.setTimeout(() => {
                      !N &&
                        le.readyState === WebSocket.OPEN &&
                        le.send(`${u}\r`);
                    }, 250);
                  }
                }
              }),
              (le.onmessage = (we) => {
                const Re = hx(we.data);
                Re !== null && X.write(Re);
              }),
              (le.onerror = () => !N && H("error")),
              (le.onclose = () => !N && H("closed")),
              (T = X.onData((we) => {
                const Re = E.current ? qp(we) : null;
                G(Re || we);
              })));
          };
          return (
            (async () => {
              const J =
                  o === "chat" ? "/api/pty" : "/api/plugins/workbench/shell",
                le = {
                  channel: `workbench-${o}-${l}`,
                  profile: lx(o, a),
                  workspace: d,
                  cwd: f,
                };
              o === "chat" && ((le.attach = cx(o, a, l)), c && (le.resume = c));
              try {
                const we = i.buildWsUrl(J, le),
                  Re =
                    o === "chat"
                      ? i
                          .buildWsUrl("/api/events", { channel: le.channel })
                          .catch(() => null)
                      : Promise.resolve(null),
                  [Ye, ct] = await Promise.all([we, Re]);
                if (N) return;
                if (!ct) {
                  Ue(Ye);
                  return;
                }
                ((Y = new WebSocket(ct)),
                  (Y.onmessage = (Dt) => {
                    const ot = jk(Dt.data);
                    ot && D.current?.(ot);
                  }),
                  (Y.onopen = () => Ue(Ye)),
                  (Y.onerror = () => Ue(Ye)),
                  c ? Ue(Ye) : (te = window.setTimeout(() => Ue(Ye), 500)));
              } catch (we) {
                N ||
                  (X.writeln(`\r
\x1B[31m${String(we)}\x1B[0m`),
                  H("error"));
              }
            })(),
            () => {
              ((N = !0),
                (Qe = !0),
                g.current?.removeEventListener("paste", be, { capture: !0 }),
                g.current?.removeEventListener("dragover", We, { capture: !0 }),
                g.current?.removeEventListener("drop", wt, { capture: !0 }),
                g.current?.removeEventListener("compositionstart", ae, {
                  capture: !0,
                }),
                g.current?.removeEventListener("compositionend", Ce, {
                  capture: !0,
                }),
                te !== null && window.clearTimeout(te),
                B?.disconnect(),
                stopThemeObserver(),
                T?.dispose(),
                Y?.close());
              const J = v.current;
              (J?.readyState === WebSocket.CONNECTING
                ? ((J.onmessage = null),
                  (J.onerror = null),
                  (J.onclose = null),
                  (J.onopen = () => J.close()))
                : J?.close(),
                (v.current = null),
                (x.current = () => {}),
                (P.current = async () => {}),
                X.dispose(),
                (_.current = null),
                (w.current = null));
            }
          );
        }, [S, u, l, o, a, c, A, d, f]),
        t(() => {
          if (!b) return;
          const N = window.requestAnimationFrame(() => {
            const B = _.current,
              T = w.current;
            if (!B || !T) return;
            p && B.focus();
            try {
              T.fit();
            } catch {
              return;
            }
            const Y = v.current;
            Y?.readyState === WebSocket.OPEN &&
              Y.send(`\x1B[RESIZE:${B.cols};${B.rows}]`);
          });
          return () => window.cancelAnimationFrame(N);
        }, [p, b]));
      const Q = [
          { key: "escape", label: "Esc", ariaLabel: ge("退出键", "Escape") },
          { key: "tab", label: "Tab", ariaLabel: ge("制表键", "Tab") },
          { key: "arrowLeft", label: "←", ariaLabel: ge("向左", "Arrow left") },
          { key: "arrowDown", label: "↓", ariaLabel: ge("向下", "Arrow down") },
          { key: "arrowUp", label: "↑", ariaLabel: ge("向上", "Arrow up") },
          {
            key: "arrowRight",
            label: "→",
            ariaLabel: ge("向右", "Arrow right"),
          },
        ],
        k = (N) => {
          (x.current(Wp(N, E.current)), _.current?.focus());
        };
      return or(
        e,
        "div",
        {
          className: `hti-terminal-frame is-${o}${b ? "" : " is-prewarming"}`,
          "aria-hidden": !b,
        },
        or(
          e,
          "div",
          { className: "hti-terminal-status" },
          or(e, "span", {
            className: `hti-status-dot is-${M}`,
            "aria-hidden": !0,
          }),
          or(e, "span", null, ux(M, o)),
          M === "closed" || M === "error"
            ? or(
                e,
                "button",
                { type: "button", onClick: () => R((N) => N + 1) },
                ge("重连", "Reconnect"),
              )
            : null,
        ),
        or(e, "div", { ref: g, className: "hti-terminal-host" }),
        or(e, "input", {
          ref: C,
          className: "hti-terminal-upload-input",
          type: "file",
          multiple: !0,
          tabIndex: -1,
          "aria-hidden": !0,
          onChange: (N) => {
            const B = N.currentTarget,
              T = Array.from(B.files || []);
            ((B.value = ""),
              T.length &&
                (O?.(!0),
                P.current(T)
                  .catch((Y) => {
                    _.current?.writeln(`\r
\x1B[31m${ge("文件上传失败", "File upload failed")}: ${String(Y)}\x1B[0m`);
                  })
                  .finally(() => O?.(!1))));
          },
        }),
        b
          ? or(
              e,
              "div",
              {
                className: "hti-terminal-keybar",
                role: "toolbar",
                "aria-label": ge("终端快捷辅助键", "Terminal helper keys"),
              },
              or(
                e,
                "button",
                {
                  type: "button",
                  className: "hti-terminal-helper-key is-ctrl",
                  "aria-label": ge("控制键", "Control"),
                  "aria-pressed": F,
                  onPointerDown: (N) => N.preventDefault(),
                  onPointerUp: (N) => {
                    (N.preventDefault(), j((B) => !B), _.current?.focus());
                  },
                  onKeyDown: (N) => {
                    (N.key !== "Enter" && N.key !== " ") ||
                      (N.preventDefault(), j((B) => !B));
                  },
                },
                "Ctrl",
              ),
              ...Q.map((N) =>
                or(
                  e,
                  "button",
                  {
                    key: N.key,
                    type: "button",
                    className: "hti-terminal-helper-key",
                    "aria-label": N.ariaLabel,
                    onPointerDown: (B) => {
                      (B.preventDefault(), k(N.key));
                    },
                    onKeyDown: (B) => {
                      (B.key !== "Enter" && B.key !== " ") ||
                        (B.preventDefault(), k(N.key));
                    },
                  },
                  N.label,
                ),
              ),
            )
          : null,
      );
    };
  }
  function fx(i, e, t, r = 0) {
    const n = Math.max(i.bottom, e.offsetTop),
      s = t ? e.offsetLeft : Math.max(e.offsetLeft, r),
      o = Math.max(0, e.width - (s - e.offsetLeft)),
      a = Math.max(160, e.height - (n - e.offsetTop));
    return {
      left: `${Math.round(s)}px`,
      top: `${Math.round(n)}px`,
      width: `${Math.round(o)}px`,
      height: `${Math.round(a)}px`,
    };
  }
  function px(i) {
    return {
      ...i,
      position: "fixed",
      zIndex: "1001",
      display: "grid",
      pointerEvents: "auto",
      gridTemplateRows: "auto minmax(0, 1fr)",
      maxWidth: "none",
      minWidth: "0",
      minHeight: "0",
      gap: "0",
      overflow: "hidden",
      borderRadius: "0",
      padding: "0",
      transform: "none",
      translate: "none",
    };
  }
  function mx(i, e) {
    return i && !!(e.width && e.height && e.left && e.top);
  }
  let ha = null;
  const ua = new Set();
  function jp() {
    return ha;
  }
  function Ox(i) {
    return (ua.add(i), () => ua.delete(i));
  }
  function gx(i) {
    ha = i;
    for (const e of ua) e();
  }
  function Fp(i) {
    if (ha?.ownerPaneId === i) {
      ha = null;
      for (const e of ua) e();
    }
  }
  const da = "default",
    Vp = "hermes-dashboard-nav-width",
    Up = 180,
    Sx = 420,
    bx = "hermes-sidebar-plugin-nav-heading",
    _x = new Set([
      "/achievements",
      "/analytics",
      "/chat",
      "/config",
      "/cron",
      "/docs",
      "/env",
      "/files",
      "/kanban",
      "/logs",
      "/mcp",
      "/models",
      "/pairing",
      "/plugins",
      "/profiles",
      "/sessions",
      "/skills",
      "/system",
      "/webhooks",
    ]),
    Yp = () => [
      ["/config", runtimeText("常规", "General")],
      ["/config?workbench=shortcuts", runtimeText("快捷键", "Keyboard shortcuts")],
      ["/profiles", runtimeText("配置档案", "Profiles")],
      ["/models", runtimeText("模型", "Models")],
      ["/env", runtimeText("凭据", "Credentials")],
      ["/plugins", runtimeText("插件", "Plugins")],
      ["/mcp", runtimeText("外部工具", "External tools")],
      ["/channels", runtimeText("消息渠道", "Channels")],
      ["/webhooks", runtimeText("网络回调", "Webhooks")],
      ["/pairing", runtimeText("设备配对", "Pairing")],
      ["/system", runtimeText("系统", "System")],
      ["/logs", runtimeText("日志", "Logs")],
      ["/docs", runtimeText("帮助", "Help")],
    ];
  function Ws(i) {
    const e = new URL(i, "http://localhost");
    return {
      path: e.pathname,
      profile: currentProfile(e.search),
      profileManager: e.searchParams.get("workbench") === "manage",
      settingsTab: e.searchParams.get("workbench") || "",
      terminal:
        e.pathname === "/chat" &&
        e.searchParams.get("workbench") === "terminal",
    };
  }
  function Gp(i) {
    const e = new URL(i, "http://localhost");
    return (
      !e.searchParams.get("profile") && e.searchParams.set("profile", currentProfile()),
      `${e.pathname}${e.search}${e.hash}`
    );
  }
  function vx() {
    if (typeof window > "u") return;
    const i = `${window.location.pathname}${window.location.search}${window.location.hash}`,
      e = Gp(i);
    e !== i && window.history.replaceState(null, "", e);
  }
  function Cn(i, e) {
    const t = new URL(i, "http://localhost"),
      r = t.searchParams.get("profile") || e.trim() || currentProfile();
    return (
      r ? t.searchParams.set("profile", r) : t.searchParams.delete("profile"),
      `${t.pathname}${t.search}${t.hash}`
    );
  }
  function Kp(i, e) {
    const t =
        new URL(Cn(i, e), "http://localhost").searchParams.get("profile") ?? "",
      r = new CustomEvent("workbench:before-navigate", {
        cancelable: !0,
        detail: { path: i, profile: t },
      });
    window.dispatchEvent(r) &&
      (rememberChat(), window.history.pushState(null, "", Cn(i, e)),
      window.dispatchEvent(new PopStateEvent("popstate")));
  }
  function yx(i, e) {
    return i.trim() || e.trim();
  }
  function Bc(i) {
    const e = Number.isFinite(i) && i > 0 ? i : 1280;
    return { min: Up, max: Math.max(Up, Math.min(Sx, e * 0.45)) };
  }
  function Jp(i) {
    const e = Number.isFinite(i) && i > 0 ? i : 1280,
      t = Math.min(260, Math.max(190, e * 0.16)),
      r = Bc(e);
    return Math.min(r.max, Math.max(r.min, t));
  }
  function em(i, e) {
    const t = Bc(e),
      r = Number.isFinite(i) ? i : Jp(e);
    return Math.min(t.max, Math.max(t.min, r));
  }
  function kx() {
    try {
      const i = Number.parseFloat(window.localStorage.getItem(Vp) || "");
      return Number.isFinite(i) ? i : null;
    } catch {
      return null;
    }
  }
  function tm() {
    const i = typeof window > "u" ? 1280 : window.innerWidth;
    return em(kx() ?? Jp(i), i);
  }
  function im(i) {
    try {
      window.localStorage.setItem(Vp, String(Math.round(i)));
    } catch {}
  }
  function xx(i = document) {
    const t = i.querySelector(`#${bx}`)?.closest('[role="group"]');
    if (!t) return [];
    const r = [];
    for (const n of Array.from(t.querySelectorAll("a[href]"))) {
      if (n.closest("[data-hti-sidebar-tool]")) continue;
      const s = n.getAttribute("href") || "";
      let o;
      try {
        o = new URL(s, window.location.origin);
      } catch {
        continue;
      }
      const a = o.pathname;
      if (!a || _x.has(a)) continue;
      const l =
          Array.from(n.querySelectorAll("span"))
            .find((u) => !u.hasAttribute("aria-hidden"))
            ?.textContent?.trim() ||
          n.getAttribute("aria-label")?.trim() ||
          n.textContent?.trim() ||
          a,
        c = `${a}${o.search}${o.hash}`;
      r.some((u) => u.href === c) || r.push({ href: c, path: a, label: l });
    }
    return r;
  }
  function Cx(i) {
    return Yp().some(([e]) => e === i);
  }
  function Qx(i, e) {
    return (
      i.length === e.length &&
      i.every((t, r) => {
        const n = e[r];
        return t.href === n.href && t.label === n.label;
      })
    );
  }
  function zc(i, e) {
    const t = {
      workbench: "M3 4h18v16H3z M8 4v16 M8 9h13",
      cron: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
      skills: "M4 4h6v4h4V4h6v6h-4v4h4v6h-6v-4h-4v4H4v-6h4v-4H4z",
      achievements:
        "M8 3h8v8a4 4 0 0 1-8 0z M8 5H4v3a4 4 0 0 0 4 4 M16 5h4v3a4 4 0 0 1-4 4 M12 15v6 M8 21h8",
      analytics: "M4 19V5 M4 19h16 M8 15v-4 M12 15V7 M16 15V4",
      files: "M3 6h7l2 2h9v10H3z",
      kanban: "M4 4h5v16H4z M10 4h5v11h-5z M16 4h4v7h-4z",
      sessions: "M4 5h16v11H4z M8 20h8 M12 16v4",
      terminal: "M3 4h18v16H3z M7 8l3 4-3 4 M13 16h4",
      settings:
        "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
      "chevron-down": "m6 9 6 6 6-6",
      "chevron-right": "m9 6 6 6-6 6",
      menu: "M4 6h16 M4 12h16 M4 18h16",
      close: "M6 6l12 12 M18 6 6 18",
    };
    return i.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 18,
        height: 18,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": !0,
      },
      i.createElement("path", { d: t[e] }),
    );
  }
  function Px(i, e) {
    vx();
    const t = i.React,
      { useEffect: r, useRef: n, useState: s } = i.hooks,
      o = e.cron(i),
      a = e.skills(i),
      { ProfileAction, ProfilesPage } = createProfileControls(i),
      WorkbenchDialog = createWorkbenchDialog(i),
      LanguageControl = createLanguageControl(i),
      ShortcutSettings = createShortcutSettings(i),
      RecentHome = createRecentHome(i, Kp),
      l = t.createElement;
    return function () {
      const [u, h] = s(() => Ws(window.location.href)),
        [d, f] = s(!1),
        [mobileActions, setMobileActions] = s(() => window.innerWidth <= 800),
        [actionsOpen, setActionsOpen] = s(false),
        [p, m] = s(tm),
        [O, g] = s([]),
        [_, w] = s(() => jp()),
        [v, x] = s(() => Yf()),
        [y, C] = s(!1),
        [P, E] = s(""),
        D = n(null),
        A = n(p),
        R = n(null);
      A.current = p;
      const isHome = u.path === "/" || u.path === "/home" || u.path === "/sessions",
        isProfiles = u.path === "/profiles" && !u.profileManager,
        isShortcuts = u.path === "/config" && u.settingsTab === "shortcuts",
        M = isHome || u.path === "/cron" || u.path === "/skills" || isProfiles || isShortcuts,
        H = Cx(u.path),
        F = yx(u.profile, da),
        j = u.path === "/chat" && !u.terminal;
      r(() => {
        const media = window.matchMedia('(max-width: 800px)');
        const resize = () => { setMobileActions(media.matches); setActionsOpen(false); };
        const open = () => { if (!media.matches) setActionsOpen(true); };
        media.addEventListener('change', resize);
        window.addEventListener(OPEN_WORKBENCH, open);
        return () => { media.removeEventListener('change', resize); window.removeEventListener(OPEN_WORKBENCH, open); };
      }, []);
      r(() => { setActionsOpen(false); }, [u.path, u.profile, u.terminal]);
      (r(() => g1(x), []),
        r(() => {
          const z = window.location.href,
            G = Gp(z);
          G !==
            `${window.location.pathname}${window.location.search}${window.location.hash}` &&
            (window.history.replaceState(null, "", G),
            h(Ws(G)),
            window.dispatchEvent(new PopStateEvent("popstate")));
        }, [u.path, u.profile, u.terminal]),
        r(() => Ox(() => w(jp())), []),
        r(() => {
          const z = document.documentElement,
            G = z.style.getPropertyValue("--dashboard-nav-width");
          return () => {
            G
              ? z.style.setProperty("--dashboard-nav-width", G)
              : z.style.removeProperty("--dashboard-nav-width");
          };
        }, []),
        r(() => {
          document.documentElement.style.setProperty(
            "--dashboard-nav-width",
            `${p}px`,
          );
        }, [p]),
        r(() => {
          const z = () => m(tm());
          return (
            window.addEventListener("resize", z),
            () => window.removeEventListener("resize", z)
          );
        }, []),
        r(() => {
          let z = window.location.href;
          const G = () => {
              const Ce = window.location.href;
              z !== Ce && ((z = Ce), h(Ws(z)), f(!1));
              const Qe = xx(document);
              g((Xe) => (Qx(Xe, Qe) ? Xe : Qe));
            },
            ae = new MutationObserver(G);
          return (
            ae.observe(document.body, { childList: !0, subtree: !0 }),
            window.addEventListener("popstate", G),
            G(),
            () => {
              (ae.disconnect(), window.removeEventListener("popstate", G));
            }
          );
        }, []),
        r(() => {
          const z = () => f(!1),
            G = () => {
              f(!0);
            };
          return (
            window.addEventListener("workbench:session-navigation-select", z),
            window.addEventListener("workbench:session-navigation-open", G),
            () => {
              (window.removeEventListener(
                "workbench:session-navigation-select",
                z,
              ),
                window.removeEventListener(
                  "workbench:session-navigation-open",
                  G,
                ));
            }
          );
        }, []),
        r(() => {
          ((document.documentElement.dataset.workbenchShell = "true"),
            (document.documentElement.dataset.workbenchPage = M
              ? "custom"
              : H
                ? "settings"
                : "native"),
            (document.documentElement.dataset.workbenchView = u.path));
          const z = document.querySelector("#app-sidebar + div"),
            G = z?.inert ?? !1,
            ae = z?.getAttribute("aria-hidden");
          if (
            (z &&
              ((z.inert = M),
              M
                ? z.setAttribute("aria-hidden", "true")
                : z.removeAttribute("aria-hidden")),
            M &&
              (z?.contains(document.activeElement) ||
                document.activeElement === document.body) &&
              D.current?.focus({ preventScroll: !0 }),
            !M && document.activeElement === document.body)
          ) {
            const Ce = z?.querySelector('main, [role="main"], h1');
            Ce &&
              (Ce.hasAttribute("tabindex") || (Ce.tabIndex = -1),
              Ce.focus({ preventScroll: !0 }));
          }
          return () => {
            (z &&
              ((z.inert = G),
              ae == null
                ? z.removeAttribute("aria-hidden")
                : z.setAttribute("aria-hidden", ae)),
              delete document.documentElement.dataset.workbenchShell,
              delete document.documentElement.dataset.workbenchPage,
              delete document.documentElement.dataset.workbenchView);
          };
        }, [M, H, u.path]));
      const Q = (z, G) => {
          if (G === "/kanban" && !z.metaKey && !z.ctrlKey && !z.shiftKey && !z.altKey && z.button === 0) {
            z.preventDefault();
            const source = window.location.href;
            E("");
            prepareProfileKanban(i.fetchJSON, u.profile, () => window.location.href === source)
              .then(board => {
                if (!board) return;
                // An already-mounted native board keeps its own React selection.
                if (u.path === "/kanban") window.location.assign(Cn("/kanban", u.profile));
                else Kp("/kanban", u.profile);
                f(false);
              }).catch(error => E(error instanceof Error ? error.message : String(error)));
            return;
          }
          z.metaKey ||
            z.ctrlKey ||
            z.shiftKey ||
            z.altKey ||
            z.button !== 0 ||
            (z.preventDefault(), Kp(G, u.profile), f(!1));
        },
        k = (z, G, ae, Ce, Qe) =>
          l(
            "a",
            {
              key: z,
              id: Qe,
              "data-dashboard-terminal-trigger":
                Qe === "hti-dashboard-terminal-trigger" ? "true" : void 0,
              href: Cn(z, u.profile),
              "aria-current": Ce ? "page" : void 0,
              "aria-label": G,
              title: G,
              onClick: (Xe) => Q(Xe, z),
            },
            craftingIcon(t, ae),
            l("span", null, G),
          ),
        N = () => {
          if (y) return;
          const z = v === "dark" ? "light" : "dark";
          (C(!0),
            E(""),
            O1(z)
              .catch(() => {
                E(runtimeText("主题保存失败，请重试", "Could not save the theme. Please retry."));
              })
              .finally(() => C(!1)));
        },
        B = v === "dark" ? runtimeText("切换到亮色主题", "Switch to light theme") : runtimeText("切换到暗色主题", "Switch to dark theme"),
        Y = _?.toolbar ?? l("div", { className: "codex-navigation-create-actions" },
          l("button", { type: "button", disabled: true, "aria-label": runtimeText("搜索", "Search"), title: runtimeText("会话列表加载后可搜索", "Search is available after sessions load") },
            craftingIcon(t, "search"), l("span", null, runtimeText("搜索", "Search")))),
        te = Bc(window.innerWidth),
        X = (z, G = !1) => {
          const ae = em(z, window.innerWidth);
          ((A.current = ae), m(ae), G && im(z));
        },
        q = (z) => {
          window.innerWidth <= 800 ||
            (z.button !== void 0 && z.button !== 0) ||
            (z.preventDefault(),
            (R.current = {
              pointerId: Number(z.pointerId),
              startX: Number(z.clientX),
              startWidth: A.current,
            }),
            z.currentTarget?.setPointerCapture?.(z.pointerId));
        },
        $ = (z) => {
          const G = R.current;
          !G ||
            G.pointerId !== Number(z.pointerId) ||
            X(G.startWidth + Number(z.clientX) - G.startX);
        },
        Z = (z) => {
          const G = R.current;
          !G ||
            (z.pointerId !== void 0 && G.pointerId !== Number(z.pointerId)) ||
            (im(A.current),
            (R.current = null),
            z.currentTarget?.releasePointerCapture?.(z.pointerId));
        },
        V = (z) => {
          const G = z.shiftKey ? 32 : 16;
          let ae = null;
          (z.key === "ArrowLeft" && (ae = p - G),
            z.key === "ArrowRight" && (ae = p + G),
            z.key === "Home" && (ae = te.min),
            z.key === "End" && (ae = te.max),
            ae !== null && (z.preventDefault(), X(ae, !0)));
        };
      const renderActions = (mobile) => l("div", { className: mobile ? "dashboard-rail-actions" : "dashboard-crafting-grid", "aria-label": runtimeText("工作台操作", "Workbench actions"),
            onClickCapture: (event) => { const action = event.target.closest("a, button"); if (!mobile && action && !action.closest(".workbench-theme-action, .workbench-profile-action")) setActionsOpen(false); } },
            l("div", { className: "dashboard-nav-pair dashboard-chat-actions" }, l(ProfileAction, { profile: F }), Y, k("/config", runtimeText("设置", "Settings"), "settings", H)),
            l("div", { className: "dashboard-nav-pair" },
              k("/kanban", runtimeText("看板", "Kanban"), "kanban", u.path === "/kanban"),
              k("/cron", runtimeText("定时", "Scheduled jobs"), "cron", u.path === "/cron"),
              k("/chat?workbench=terminal", runtimeText("终端", "Terminal"), "terminal", u.terminal, "hti-dashboard-terminal-trigger"),
            ),
            l("div", { className: "dashboard-nav-pair" },
              l("button", { type: "button", className: "dashboard-workspace-button", "aria-label": runtimeText("文件", "Files"), onClick: () => { f(false); if (u.path === "/chat" && !u.terminal) window.dispatchEvent(new Event("workbench:open-workspace")); else Kp("/chat?workbench=files", u.profile); } }, craftingIcon(t, "files"), l("span", null, runtimeText("文件", "Files"))),
              l("button", { type: "button", className: "dashboard-workspace-button workbench-theme-action", "aria-label": B, title: B, "aria-pressed": v === "dark", disabled: y, onClick: N }, craftingIcon(t, v === "dark" ? "sun" : "moon"), l("span", null, runtimeText("主题", "Theme"))),
              k("/achievements", runtimeText("成就", "Achievements"), "achievements", u.path === "/achievements"),
            ),
          );
      return l(
        t.Fragment,
        null,
        mobileActions ? l("nav", { className: "dashboard-action-rail", "aria-label": runtimeText("快捷功能", "Quick actions") },
          l("div", { className: "dashboard-rail-top", "aria-label": runtimeText("页面导航", "Page navigation") },
          l("button", {
            className: "dashboard-mobile-toggle", type: "button",
            "aria-label": d ? runtimeText("收起全局导航", "Collapse navigation") : runtimeText("打开全局导航", "Open navigation"),
            "aria-expanded": d, title: d ? runtimeText("收起全局导航", "Collapse navigation") : runtimeText("打开全局导航", "Open navigation"),
            onClick: () => f(!d),
          }, zc(t, "menu")),
          k("/sessions", runtimeText("首页", "Home"), "home", isHome)),
          renderActions(true),
          P ? l("p", { className: "workbench-theme-error", role: "status" }, P) : null) : null,
        d
          ? l("button", {
              className: "dashboard-nav-backdrop",
              type: "button",
              "aria-label": runtimeText("关闭全局导航", "Close navigation"),
              onClick: () => f(!1),
            })
          : null,
        l(
          "aside",
          {
            className: `dashboard-global-nav${d ? " is-open" : ""}`,
            "aria-label": runtimeText("全局导航", "Navigation"),
          },
          l(
            "nav",
            { className: "dashboard-nav-primary", "aria-label": runtimeText("主要功能", "Main features") },
            !mobileActions ? l(WorkbenchDialog, { open: actionsOpen, onClose: () => setActionsOpen(false),
              headerAction: k("/sessions", runtimeText("首页", "Home"), "home", isHome) },
              renderActions(false), P ? l("p", { className: "workbench-theme-error", role: "status" }, P) : null) : null,
            l(
              "div",
              {
                className: `dashboard-workbench-group${j ? " is-active" : ""}`,
              },
              l(
                "div",
                {
                  id: "dashboard-workbench-sessions",
                  className: "dashboard-workbench-sessions",
                  "data-workbench-profile": F,
                  "aria-label": runtimeText("会话列表", "Sessions"),
                  hidden: false,
                },
                _?.element ?? l("div", { className: "project-section-heading workbench-project-placeholder" }, l("span", null, runtimeText("项目", "Projects"))),
              ),
            ),
          ),
          P
            ? l(
                "span",
                { className: "dashboard-theme-error", role: "status" },
                P,
              )
            : null,
          l("div", {
            className: "dashboard-nav-resizer",
            role: "separator",
            "aria-orientation": "vertical",
            "aria-label": runtimeText("调整全局导航宽度", "Resize navigation"),
            "aria-valuemin": te.min,
            "aria-valuemax": te.max,
            "aria-valuenow": Math.round(p),
            tabIndex: 0,
            onPointerDown: q,
            onPointerMove: $,
            onPointerUp: Z,
            onPointerCancel: Z,
            onLostPointerCapture: Z,
            onKeyDown: V,
          }),
        ),
        H
          ? l(
              "nav",
              { className: "dashboard-settings-nav", "aria-label": runtimeText("设置分类", "Settings categories") },
              l("div", { className: "workbench-settings-heading" },
                l("h1", null, runtimeText("设置", "Settings")), l(LanguageControl)),
              Yp().map(([z, G]) =>
                l(
                  "a",
                  {
                    key: z,
                    href: Cn(z, u.profile),
                    "aria-current": (z === "/config?workbench=shortcuts" ? isShortcuts : z === "/config" ? u.path === z && !u.settingsTab : u.path === z || z === "/profiles" && u.path.startsWith("/profiles/")) ? "page" : void 0,
                    onClick: (ae) => Q(ae, z),
                  },
                  G,
                ),
              ),
              O.length
                ? l(
                    "section",
                    {
                      className: "dashboard-plugin-links",
                      "aria-labelledby": "dashboard-plugin-links-title",
                    },
                    l("h2", { id: "dashboard-plugin-links-title" }, runtimeText("插件入口", "Plugin links")),
                    O.map((z) =>
                      l(
                        "a",
                        {
                          key: z.href,
                          href: Cn(z.href, u.profile),
                          "aria-current": u.path === z.path ? "page" : void 0,
                          onClick: (G) => Q(G, z.href),
                        },
                        z.label,
                      ),
                    ),
                  )
                : null,
            )
          : null,
        M
          ? l(
              "main",
              {
                ref: D,
                className: `dashboard-owned-page${isProfiles ? " dashboard-profile-page" : isShortcuts ? " dashboard-shortcuts-page" : ""}`,
                tabIndex: -1,
                "aria-label": isShortcuts ? runtimeText("快捷键", "Keyboard shortcuts") : isHome ? runtimeText("首页", "Home") : isProfiles ? runtimeText("配置档案", "Profiles") : u.path === "/cron" ? runtimeText("定时", "Scheduled jobs") : runtimeText("技能", "Skills"),
              },
              isShortcuts ? l(ShortcutSettings) : isHome ? l(RecentHome, { key: "home", profile: F }) : isProfiles ? l(ProfilesPage, { profile: F }) : u.path === "/cron"
                ? l(o, { key: `cron:${F}`, profile: F })
                : l(a, { key: `skills:${F}`, profile: F }),
            )
          : null,
      );
    };
  }
  function ar(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function $x(i) {
    (window.history.pushState(null, "", i),
      window.dispatchEvent(new PopStateEvent("popstate")));
  }
  function Tx(i) {
    return Cn("/chat", Ws(i).profile);
  }
  function rm(i) {
    return !(
      i.closest('[aria-hidden="true"], [inert]') ||
      (i.closest("#app-sidebar") &&
        document.documentElement.dataset.workbenchShell === "true")
    );
  }
  function Ex(i = document) {
    const e = i.querySelector("[data-dashboard-terminal-trigger]"),
      t = i.querySelector("#hti-sidebar-terminal-tab"),
      r = e && rm(e) ? e : null,
      n = t && rm(t) ? t : null,
      s = r || n;
    if (!s) return !1;
    try {
      s.focus({ preventScroll: !0 });
    } catch {
      s.focus();
    }
    return document.activeElement === s;
  }
  function Ax(i, e) {
    if (window.__HERMES_WORKBENCH_HEADER_TERMINAL__) return;
    window.__HERMES_WORKBENCH_HEADER_TERMINAL__ = !0;
    const t = i.React,
      { useEffect: r, useState: n } = i.hooks,
      {
        Dialog: s,
        DialogClose: o,
        DialogContent: a,
        DialogDescription: l,
        DialogTitle: c,
      } = i.components,
      u = Zp(i);
    function h() {
      const [d, f] = n(Tc()),
        [S, b] = n({});
      (r(() => {
        const _ = () => f(Tc());
        return (
          window.addEventListener("popstate", _),
          () => window.removeEventListener("popstate", _)
        );
      }, []),
        r(() => {
          if (!d) {
            b({});
            return;
          }
          const _ = () => {
            const v = document
                .querySelector('header[role="banner"]')
                ?.getBoundingClientRect() || { bottom: 0 },
              x =
                document.querySelector("#app-sidebar")?.getBoundingClientRect()
                  .right ?? 0,
              y = window.visualViewport;
            b(
              fx(
                { bottom: Tp() ? (y?.offsetTop ?? 0) : v.bottom },
                {
                  width: y?.width ?? window.innerWidth,
                  height: y?.height ?? window.innerHeight,
                  offsetLeft: y?.offsetLeft ?? 0,
                  offsetTop: y?.offsetTop ?? 0,
                },
                window.matchMedia("(max-width: 800px)").matches,
                x,
              ),
            );
          };
          return (
            _(),
            window.addEventListener("resize", _),
            window.visualViewport?.addEventListener("resize", _),
            window.visualViewport?.addEventListener("scroll", _),
            () => {
              (window.removeEventListener("resize", _),
                window.visualViewport?.removeEventListener("resize", _),
                window.visualViewport?.removeEventListener("scroll", _));
            }
          );
        }, [d]));
      const p = mx(d, S);
      r(() => {
        if (!p) return;
        const _ = document.getElementById("hti-dashboard-terminal-dialog");
        if (!_) return;
        _.closest('header[role="banner"]') && document.body.appendChild(_);
        const w = [];
        for (const v of Array.from(
          document.querySelectorAll('[data-slot="dialog-overlay"]'),
        ))
          v.parentElement === _.parentElement &&
            (v.style.setProperty("display", "none", "important"),
            (v.dataset.htiTerminalOverlay = "true"),
            w.push(v));
        return () => {
          for (const v of w)
            (v.style.removeProperty("display"),
              delete v.dataset.htiTerminalOverlay);
        };
      }, [p]);
      const m = () => {
          (f(!1),
            $x(Tx(window.location.href)),
            window.requestAnimationFrame(() => Ex()));
        },
        O = Ws(window.location.href).profile,
        g = O || ge("当前配置", "current profile");
      return ar(
        t,
        s,
        {
          open: d,
          modal: !1,
          onOpenChange: (_) => {
            _ || m();
          },
        },
        ar(t, "span", {
          className: "hti-terminal-slot-host",
          "aria-hidden": !0,
        }),
        p
          ? ar(
              t,
              a,
              {
                id: "hti-dashboard-terminal-dialog",
                className: "hti-terminal-workspace",
                showCloseButton: !1,
                style: px(S),
                onCloseAutoFocus: (_) => _.preventDefault(),
                onInteractOutside: (_) => _.preventDefault(),
                "aria-describedby": "hti-dashboard-terminal-description",
              },
              ar(
                t,
                "header",
                { className: "hti-terminal-workspace-header" },
                ar(
                  t,
                  "div",
                  { className: "hti-terminal-workspace-title" },
                  ar(
                    t,
                    c,
                    { id: "hti-dashboard-terminal-title" },
                    ge("终端", "Terminal"),
                  ),
                  ar(
                    t,
                    l,
                    { id: "hti-dashboard-terminal-description" },
                    ge(
                      `可自由输入命令 · /opt/data · ${g}`,
                      `Run commands freely · /opt/data · ${g}`,
                    ),
                  ),
                ),
                ar(
                  t,
                  o,
                  {
                    className: "hti-terminal-workspace-close",
                    onClick: m,
                    "aria-label": ge("关闭终端", "Close terminal"),
                    title: ge("关闭终端", "Close terminal"),
                  },
                  ar(t, "span", { "aria-hidden": !0 }, "×"),
                ),
              ),
              ar(t, u, {
                mode: "shell",
                profile: O,
                instanceId: "dashboard-raw-terminal",
                workspaceId: "dashboard-root",
                workspacePath: "/opt/data",
                active: d,
                visible: d,
                autoFocus: !0,
              }),
            )
          : null,
      );
    }
    e.registerSlot("workbench", "header-right", h);
  }
  function Rx(i) {
    for (const e of Array.from(i.querySelectorAll("details"))) {
      const t = e.querySelector("summary");
      /^advanced fields$/i.test(t?.textContent?.trim() || "") &&
        e.dataset.htiCronAdvancedInitialized !== "true" &&
        ((e.dataset.htiCronAdvancedInitialized = "true"), (e.open = !1));
    }
  }
  function Lx(i) {
    const e = i.firstElementChild;
    if (!e) return;
    const t = Array.from(e.children).find(
        (n) => n instanceof HTMLElement && n.tagName === "HEADER",
      ),
      r = Array.from(e.children).find((n) => n instanceof HTMLButtonElement);
    !t ||
      !r ||
      ((r.dataset.htiCronDialogClose = "true"),
      r.parentElement !== t && t.append(r),
      (e.dataset.htiCronDialogPanel = "true"));
  }
  function Mx() {
    if (window.__HERMES_WORKBENCH_CRON_EDIT_DIALOG_BRIDGE__) return;
    window.__HERMES_WORKBENCH_CRON_EDIT_DIALOG_BRIDGE__ = !0;
    let i = !1;
    const e = () => {
      i ||
        ((i = !0),
        window.requestAnimationFrame(() => {
          i = !1;
          for (const t of Array.from(
            document.querySelectorAll(
              '[role="dialog"][aria-labelledby="create-cron-title"], [role="dialog"][aria-labelledby="edit-cron-title"]',
            ),
          ))
            (Lx(t), Rx(t));
        }));
    };
    (new MutationObserver(e).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
    }),
      e());
  }
  function lr(i) {
    return String(i ?? "").trim();
  }
  function nm(i, e) {
    return i.length <= e ? i : `${i.slice(0, Math.max(0, e - 1))}…`;
  }
  function fa(i) {
    return (
      lr(i.name) ||
      nm(lr(i.prompt), 60) ||
      nm(lr(i.script), 60) ||
      lr(i.id) ||
      "Cron job"
    );
  }
  function sm(i) {
    return lr(i.profile) || lr(i.profile_name) || "default";
  }
  function Dx(i) {
    return lr(i.id) || lr(i.session_id);
  }
  function Ix(i, e) {
    return `/chat?${new URLSearchParams({ profile: i, session: e }).toString()}`;
  }
  function Nx(i, e) {
    const t = i.last_active ?? i.ended_at ?? i.started_at,
      r = typeof t == "number" && t < 1e12 ? t * 1e3 : t,
      n = new Date(r);
    return Number.isFinite(n.getTime()) && n.getTime() > 0
      ? n.toLocaleString(e, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  }
  async function Bx(i = fetch) {
    const e = await i("/api/cron/jobs?profile=all", {
      credentials: "same-origin",
    });
    if (!e.ok) throw new Error(`Unable to load scheduled tasks (${e.status})`);
    const t = await e.json();
    return Array.isArray(t) ? t : [];
  }
  async function Xc(i, e, t = fetch) {
    const r = new URLSearchParams({ profile: e, limit: "100" }),
      n = await t(
        `/api/cron/jobs/${encodeURIComponent(i)}/runs?${r.toString()}`,
        { credentials: "same-origin" },
      );
    if (!n.ok) throw new Error(`Unable to load run history (${n.status})`);
    const s = await n.json();
    return Array.isArray(s.runs) ? s.runs : [];
  }
  function qs() {
    return document.documentElement.lang.toLowerCase().startsWith("zh");
  }
  function zx(i, e, t) {
    if ((i.replaceChildren(), !e.length)) {
      const n = document.createElement("p");
      ((n.dataset.htiCronRunsEmpty = "true"),
        (n.textContent = qs() ? "暂无会话记录" : "No session records"),
        i.append(n));
      return;
    }
    const r = document.createElement("ol");
    r.dataset.htiCronRunsList = "true";
    for (const n of e) {
      const s = Dx(n);
      if (!s) continue;
      const o = document.createElement("li"),
        a = document.createElement("a");
      ((a.href = Ix(t, s)), (a.dataset.htiCronRunLink = "true"));
      const l = lr(n.title) || s,
        c = document.createElement("span");
      c.textContent = l;
      const u = document.createElement("time");
      ((u.textContent = Nx(n, document.documentElement.lang || void 0)),
        a.append(c, u),
        o.append(a),
        r.append(o));
    }
    i.append(r);
  }
  function Xx(i, e, t = Xc) {
    const r = lr(e.id);
    if (!r) return;
    const n = sm(e);
    if (
      ((i.dataset.htiCronJobId = r),
      (i.dataset.htiCronProfile = n),
      i.querySelector('[data-hti-cron-runs="true"]'))
    )
      return;
    const s = i.querySelector('[data-hti-cron-card-body="true"]'),
      o = i.querySelector('[data-hti-cron-actions="true"]');
    if (!s || !o) return;
    const a = document.createElement("details");
    a.dataset.htiCronRuns = "true";
    const l = document.createElement("summary");
    ((l.textContent = qs() ? runtimeText("运行记录", "Run history") : "Run history"),
      l.setAttribute(
        "aria-label",
        qs() ? runtimeText(`查看${fa(e)}的运行记录`, `View ${fa(e)} run history`) : `View run history for ${fa(e)}`,
      ));
    const c = document.createElement("div");
    ((c.dataset.htiCronRunsContent = "true"),
      a.append(l, c),
      s.insertBefore(a, o),
      a.addEventListener("toggle", () => {
        !a.open ||
          a.dataset.htiCronRunsLoaded === "true" ||
          a.dataset.htiCronRunsLoading === "true" ||
          ((a.dataset.htiCronRunsLoading = "true"),
          (c.textContent = qs() ? runtimeText("加载中…", "Loading…") : "Loading…"),
          t(r, n)
            .then((u) => {
              a.isConnected &&
                (zx(c, u, n), (a.dataset.htiCronRunsLoaded = "true"));
            })
            .catch((u) => {
              a.isConnected &&
                (c.textContent = `${qs() ? "记录加载失败" : "Could not load history"}: ${String(u)}`);
            })
            .finally(() => {
              delete a.dataset.htiCronRunsLoading;
            }));
      }));
  }
  function om(i, e, t) {
    const r = [...e];
    for (const n of i) {
      if (n.dataset.htiCronJobId) continue;
      const s =
          n
            .querySelector('[data-hti-cron-title="true"]')
            ?.textContent?.trim() || "",
        o = Array.from(
          n.querySelectorAll('[data-hti-cron-auxiliary="true"]'),
        ).map((c) => c.textContent?.trim() || "");
      let a = r.findIndex((c) => fa(c) === s && o.includes(sm(c)));
      if ((a < 0 && (a = r.findIndex((c) => fa(c) === s)), a < 0)) continue;
      const [l] = r.splice(a, 1);
      Xx(n, l, t);
    }
  }
  function pa(i) {
    return i?.textContent?.replace(/\s+/g, " ").trim() || "";
  }
  function Wx(i) {
    return /paused|暂停/i.test(i)
      ? "paused"
      : /error|failed|异常|错误|失败/i.test(i)
        ? "error"
        : /completed|disabled|finished|已完成|已结束|已禁用/i.test(i)
          ? "inactive"
          : "active";
  }
  function am(i, e) {
    const t = document.documentElement.lang.toLowerCase().startsWith("zh");
    return e === 0
      ? {
          kind: "toggle",
          visible: /resume|恢复|继续/i.test(i)
            ? t
              ? runtimeText("恢复", "Restore")
              : "Resume"
            : t
              ? runtimeText("暂停", "Pause")
              : "Pause",
        }
      : e === 1
        ? { kind: "run", visible: t ? "立即运行" : "Run now" }
        : e === 2
          ? { kind: "edit", visible: t ? runtimeText("编辑", "Edit") : "Edit" }
          : { kind: "delete", visible: t ? "删除任务" : "Delete job" };
  }
  function qx(i, e) {
    let t = i.querySelector('[data-hti-cron-action-text="true"]');
    (t ||
      ((t = document.createElement("span")),
      (t.dataset.htiCronActionText = "true"),
      i.append(t)),
      (t.textContent = e));
  }
  function Zx(i, e, t) {
    if (
      ((e.dataset.htiCronNativeDelete = "true"),
      i.querySelector('[data-hti-cron-more="true"]'))
    )
      return;
    const r = document.createElement("details");
    r.dataset.htiCronMore = "true";
    const n = document.createElement("summary");
    ((n.textContent = "⋯"),
      n.setAttribute(
        "aria-label",
        document.documentElement.lang.toLowerCase().startsWith("zh")
          ? "更多操作"
          : "More actions",
      ));
    const s = document.createElement("button");
    ((s.type = "button"),
      (s.textContent = t),
      s.addEventListener("click", () => {
        ((r.open = !1), e.click());
      }),
      r.append(n, s),
      i.append(r));
  }
  function jx(i) {
    const e = i.firstElementChild;
    if (!e) return;
    const t = e.firstElementChild,
      r = e.lastElementChild,
      n = t?.firstElementChild,
      s = r
        ? Array.from(r.querySelectorAll("button[aria-label]")).filter(
            (h) => h.parentElement === r,
          )
        : [];
    if (!t || !n || !r || s.length < 4) return;
    ((i.dataset.htiCronCard = "true"),
      (e.dataset.htiCronCardBody = "true"),
      (t.dataset.htiCronCardMain = "true"),
      (n.dataset.htiCronTitleRow = "true"),
      (r.dataset.htiCronActions = "true"));
    const o = n.firstElementChild;
    (o && (o.dataset.htiCronTitle = "true"),
      Array.from(n.children)
        .slice(1)
        .forEach((h, d) => {
          const f = h;
          if (d === 0) {
            const S = pa(f);
            ((f.dataset.htiCronStatus = Wx(S)),
              f.setAttribute("role", "img"),
              f.setAttribute("aria-label", S),
              (f.title = S));
            return;
          }
          f.dataset.htiCronAuxiliary = "true";
        }));
    const a = n.querySelector("[data-hti-cron-status]");
    a &&
      t.querySelector(".text-destructive") &&
      (a.dataset.htiCronStatus = "error");
    const l = Array.from(t.children).find((h) => {
      const d = pa(h);
      return /repeat:|上次:|下次:|last:|next:/i.test(d);
    });
    if (l) {
      ((l.dataset.htiCronMetadata = "true"),
        Array.from(l.children).forEach((d, f) => {
          const S = d;
          ((S.dataset.htiCronMeta = String(f)),
            (/^repeat:/i.test(pa(S)) || /^(上次|last):/i.test(pa(S))) &&
              (S.dataset.htiCronAuxiliary = "true"));
        }));
      const h = Array.from(t.children).indexOf(l);
      Array.from(t.children)
        .slice(1, h)
        .forEach((d) => {
          d.dataset.htiCronAuxiliary = "true";
        });
    }
    s.slice(0, 3).forEach((h, d) => {
      const f = am(h.getAttribute("aria-label") || "", d);
      ((h.dataset.htiCronAction = f.kind), qx(h, f.visible));
    });
    const c = s[3],
      u = am(c.getAttribute("aria-label") || "", 3);
    Zx(r, c, u.visible);
  }
  function lm(i = document) {
    const e =
      i.querySelector("#cron-profile-filter") ||
      document.querySelector("#cron-profile-filter");
    if (!e) return [];
    let t = e.parentElement;
    for (
      ;
      t &&
      !Array.from(t.children).some(
        (n) => n.querySelectorAll?.("button[aria-label]").length >= 4,
      );

    )
      t = t.parentElement;
    if (!t) return [];
    const r = Array.from(t.children).filter(
      (n) => n.querySelectorAll?.("button[aria-label]").length >= 4,
    );
    return (r.forEach(jx), r);
  }
  function Fx() {
    if (window.__HERMES_WORKBENCH_CRON_PAGE_BRIDGE__) return;
    window.__HERMES_WORKBENCH_CRON_PAGE_BRIDGE__ = !0;
    let i = !1,
      e = null,
      t = null,
      r = 0;
    const n = () => {
      i ||
        ((i = !0),
        window.requestAnimationFrame(() => {
          i = !1;
          const s = lm();
          if (!s.length) return;
          if (e) {
            if ((om(s, e, Xc), s.every((a) => !!a.dataset.htiCronJobId)))
              return;
            e = null;
          }
          if (t) return;
          const o = ++r;
          ((t = Bx()),
            t
              .then((a) => {
                o === r && ((e = a), om(lm(), a, Xc));
              })
              .catch(() => {})
              .finally(() => {
                t = null;
              }));
        }));
    };
    (new MutationObserver(n).observe(document.documentElement, {
      childList: !0,
      subtree: !0,
    }),
      n());
  }
  const cm = 48 * 1024;
  function ma(i) {
    if (typeof i != "string") return "";
    if (!i.startsWith("\0json:")) return i;
    try {
      const e = JSON.parse(i.slice(6));
      return Array.isArray(e)
        ? e
            .map((t) =>
              typeof t == "string"
                ? t
                : t?.type === "text" && typeof t.text == "string"
                  ? t.text
                  : String(t?.type || "").match(/image|file|media/)
                    ? "[Hermes media omitted]"
                    : "",
            )
            .filter(Boolean).join(`
`)
        : "";
    } catch {
      return "[Invalid structured Hermes content]";
    }
  }
  function Oa(i, e) {
    if (typeof i != "string") return i ?? e;
    try {
      return JSON.parse(i);
    } catch {
      return e;
    }
  }
  function Wc(i, e) {
    if (!e || e.end_reason !== "compression" || i.source === "tool") return !1;
    const t = Oa(i.model_config, {});
    return !t?._delegate_from && !t?._branched_from;
  }
  function Hx(i, e, t) {
    if (i.role !== "user" || e.role !== "user") return !1;
    const r = t.indexOf(String(i.session_id)),
      n = t.indexOf(String(e.session_id));
    return (
      r >= 0 &&
      n === r + 1 &&
      !!ma(i.content).trim() &&
      ma(i.content).trim() === ma(e.content).trim()
    );
  }
  function hm(i, e) {
    const t = typeof i == "string" ? i : String(i ?? ""),
      r = new TextEncoder().encode(t).byteLength;
    return r <= cm ? t : `[Hermes ${e} truncated: ${r} UTF-8 bytes]`;
  }
  function qc(i, e) {
    let t;
    try {
      t = JSON.stringify(i);
    } catch {
      t = String(i ?? "");
    }
    const r = new TextEncoder().encode(t).byteLength;
    return r <= cm
      ? i
      : { truncated: !0, message: `[Hermes ${e} truncated: ${r} UTF-8 bytes]` };
  }
  function ga(i, e = new Set()) {
    if (typeof i == "string") {
      const r = Oa(i, i);
      return r === i ? (i.trim() ? [i] : []) : ga(r, e);
    }
    if (!i || typeof i != "object" || e.has(i)) return [];
    if ((e.add(i), Array.isArray(i))) return i.flatMap((r) => ga(r, e));
    const t = i;
    return /redacted/i.test(String(t.type || ""))
      ? []
      : ["thinking", "text", "summary", "content", "reasoning"].flatMap((r) =>
          ga(t[r], e),
        );
  }
  function Vx(i) {
    const e = [i.reasoning, i.reasoning_content].filter(
      (t) => typeof t == "string" && !!t.trim(),
    );
    return (
      e.push(...ga(i.reasoning_details)),
      e.filter((t, r, n) => n.indexOf(t) === r)
    );
  }
  function um(i, e) {
    if (
      i.error === !0 ||
      i.is_error === !0 ||
      i.effect_disposition === "unknown" ||
      /^(?:error executing tool|\[?tool execution cancelled|\[orphan recovery:)/i.test(
        e.trim(),
      )
    )
      return !0;
    const t = Oa(e, null);
    return !t || typeof t != "object" || Array.isArray(t)
      ? !1
      : !!t.error || t.success === !1 || t.ok === !1;
  }
  function Ux(i) {
    const e = i?.function?.arguments ?? i?.arguments ?? {};
    if (typeof e != "string") return qc(e, "tool input");
    try {
      return qc(JSON.parse(e), "tool input");
    } catch {
      return qc(e, "tool input");
    }
  }
  function Zc(i) {
    return typeof i.timestamp == "string" ||
      (typeof i.timestamp == "number" && Number.isFinite(i.timestamp))
      ? i.timestamp
      : void 0;
  }
  function jc(i, e) {
    const t = String(i.session_id || "session"),
      r = i.id ?? `index-${e}`;
    return `${t}-${String(r)}`;
  }
  function dm(i, e) {
    return typeof i.id == "string" || typeof i.id == "number"
      ? i.id
      : `index-${e}`;
  }
  function fm(i, e = "", t = 0) {
    return {
      key: `hermes-turn-${jc(i, t)}`,
      user: e,
      timestamp: Zc(i),
      events: [],
      raw: [],
    };
  }
  function Yx(i, e) {
    const t = new Map(e.map((r, n) => [String(r), n]));
    return i
      .map((r, n) => ({ row: r, inputIndex: n }))
      .sort((r, n) => {
        const s = t.get(String(r.row.session_id)) ?? e.length,
          o = t.get(String(n.row.session_id)) ?? e.length;
        if (s !== o) return s - o;
        const a = Number(r.row.id),
          l = Number(n.row.id);
        return Number.isFinite(a) && Number.isFinite(l) && a !== l
          ? a - l
          : r.inputIndex - n.inputIndex;
      });
  }
  function pm(i, e) {
    return `${String(i.session_id || "session")}\0${e}`;
  }
  function mm(i, e) {
    const t = Yx(i, e),
      r = [],
      n = new Map();
    let s, o;
    for (const { row: a, inputIndex: l } of t) {
      const c = hm(ma(a.content), `${String(a.role || "message")} content`);
      if (a.role === "user") {
        if (o && Hx(o, a, e)) {
          (s?.raw.push(a), (o = a));
          continue;
        }
        ((s = fm(a, c, l)), n.clear(), s.raw.push(a), r.push(s));
      } else if (
        (s || ((s = fm(a, "", l)), r.push(s)),
        s.raw.push(a),
        a.role === "assistant")
      ) {
        const u = Vx(a),
          h = jc(a, l),
          d = dm(a, l),
          f = Zc(a);
        for (let p = 0; p < u.length; p += 1) {
          const m = u[p],
            O = hm(m, "reasoning");
          s.events.push({
            kind: "reasoning",
            key: `hermes-event-${h}-reasoning-${p}`,
            content: O,
            rowId: d,
            timestamp: f,
            raw: [a],
          });
        }
        const S = Oa(a.tool_calls, []),
          b = Array.isArray(S) ? S : [];
        if (b.length > 0)
          for (let p = 0; p < b.length; p += 1) {
            const m = b[p],
              O = String(m?.id || `missing-call-${h}-${p}`),
              g = {
                kind: "tool",
                key: `hermes-event-${h}-tool-${p}`,
                callId: O,
                name: String(m?.function?.name || m?.name || ""),
                input: Ux(m),
                error: !1,
                unmatched: !1,
                rowId: d,
                timestamp: f,
                raw: [a],
              };
            s.events.push(g);
            const _ = pm(a, O);
            n.set(_, [...(n.get(_) || []), g]);
          }
        c &&
          s.events.push({
            kind: "assistant",
            key: `hermes-event-${h}-assistant`,
            content: c,
            phase:
              b.length > 0 || a.finish_reason === "tool_calls"
                ? "commentary"
                : "final",
            rowId: d,
            timestamp: f,
            raw: [a],
          });
      } else if (a.role === "tool") {
        const u = jc(a, l),
          h = dm(a, l),
          d = Zc(a),
          f = String(a.tool_call_id || ""),
          S = f || `unmatched-${u}`,
          b = pm(a, S),
          p = f ? n.get(b) : void 0,
          m = p?.shift();
        m
          ? ((m.result = c),
            (m.error = um(a, c)),
            (m.resultRowId = h),
            (m.resultTimestamp = d),
            m.raw.push(a),
            p?.length === 0 && n.delete(b))
          : s.events.push({
              kind: "tool",
              key: `hermes-event-${u}-unmatched-tool-result`,
              callId: S,
              name: String(a.tool_name || ""),
              input: {},
              result: c,
              error: um(a, c),
              unmatched: !0,
              rowId: h,
              timestamp: d,
              resultRowId: h,
              resultTimestamp: d,
              raw: [a],
            });
      }
      o = a;
    }
    return r;
  }
  const Gx = /\b404\b.*session not found|session not found.*\b404\b/i,
    Fc = 100,
    Om = 500;
  function Hc(i) {
    const e = String(i);
    return Gx.test(e)
      ? runtimeText("会话不存在或已删除，聊天未恢复。请选择其他会话或新建会话。 / Session unavailable; chat was not resumed.", "Session unavailable; chat was not resumed.")
      : e;
  }
  function ci(i) {
    return encodeURIComponent(i);
  }
  async function gm(i, e, t) {
    return await i(
      `/api/profiles/sessions?limit=${Fc}&offset=${t}&archived=include&order=recent&profile=${ci(e)}&exclude_sources=cron`,
    );
  }
  function Kx(i) {
    return String(i.id ?? i.session_id ?? "");
  }
  async function Sm(i, e) {
    const t = await gm(i, e, 0),
      r = Array.isArray(t.sessions) ? t.sessions : [],
      n = Number.isFinite(Number(t.total))
        ? Math.max(0, Number(t.total))
        : r.length,
      s = Math.min(n, Om),
      o = [];
    for (let u = Fc; u < s; u += Fc) o.push(u);
    const a = await Promise.all(o.map((u) => gm(i, e, u))),
      l = new Set(),
      c = [t, ...a]
        .flatMap((u) => (Array.isArray(u.sessions) ? u.sessions : []))
        .filter((u) => {
          const h = Kx(u);
          return !h || l.has(h) ? !1 : (l.add(h), !0);
        });
    return { sessions: c, total: n, complete: n <= Om && c.length >= n };
  }
  async function Jx(i, e, t) {
    const r = await i(
      `/api/sessions/search?q=${ci(t)}&limit=100&profile=${ci(e)}&exclude_sources=cron`,
    );
    return Array.isArray(r.results) ? r.results : [];
  }
  async function Zs(i, e, t) {
    return await i(`/api/sessions/${ci(t)}?profile=${ci(e)}`);
  }
  async function eC(i, e, t) {
    await Zs(i, e, t);
  }
  async function bm(i, e, t) {
    const r = [],
      n = new Set();
    let s = await Zs(i, e, t);
    for (
      ;
      !n.has(String(s.id)) &&
      (n.add(String(s.id)), r.unshift(s), !!s.parent_session_id);

    ) {
      const o = await Zs(i, e, String(s.parent_session_id));
      if (!Wc(s, o)) break;
      s = o;
    }
    return r;
  }
  async function tC(i, e, t) {
    try {
      const r = await i(
          `/api/sessions/search?q=${ci(t)}&limit=1&profile=${ci(e)}`,
        ),
        n = Array.isArray(r.results) ? r.results[0] : void 0,
        s = String(n?.session_id || n?.id || "");
      if (!s || s === t) return null;
      const o = await bm(i, e, s);
      return String(o[0]?.id || "") === t ? String(o.at(-1)?.id || s) : null;
    } catch {
      return null;
    }
  }
  async function iC(i, e, t) {
    const r = await i(
        `/api/sessions/${ci(t)}/latest-descendant?profile=${ci(e)}`,
      ),
      n = Array.isArray(r.path)
        ? r.path.map((c) => String(c)).filter(Boolean)
        : [];
    n[0] !== t && n.unshift(t);
    let s = await Zs(i, e, t);
    const o = s,
      a = String(o.id || t);
    let l = a;
    for (const c of n.slice(1)) {
      const u = await Zs(i, e, c);
      if (!Wc(u, s)) break;
      ((l = String(u.id || c)), (s = u));
    }
    return (
      (l === a && o.end_reason === "compression" && (await tC(i, e, a))) || l
    );
  }
  async function rC(i, e, t) {
    const r = [];
    let n = 0;
    for (;;) {
      const s = await i(
        `/api/sessions/${ci(t)}/messages?profile=${ci(e)}&limit=500&offset=${n}`,
      );
      if (s.session_id && String(s.session_id) !== t) {
        const a = await i(`/api/sessions/${ci(t)}/export?profile=${ci(e)}`);
        return Array.isArray(a.messages) ? a.messages : [];
      }
      const o = Array.isArray(s.messages) ? s.messages : [];
      if ((r.push(...o), o.length < 500)) return r;
      n += o.length;
    }
  }
  async function nC(i, e, t, r = 160) {
    const n = await i(
        `/api/sessions/${ci(t)}/messages?profile=${ci(e)}&limit=${r}&order=latest`,
      ),
      s = String(n.session_id || t),
      o = (Array.isArray(n.messages) ? n.messages : []).map((l) => ({
        ...l,
        session_id: l.session_id || s,
      }));
    return {
      profile: e,
      sessionId: s,
      lineage: [{ id: s }],
      rows: o,
      turns: mm(o, [s]),
    };
  }
  async function _m(i, e, t) {
    const r = await iC(i, e, t),
      n = await bm(i, e, r),
      o = (await Promise.all(n.map((l) => rC(i, e, String(l.id))))).flatMap(
        (l, c) =>
          l.map((u) => ({ ...u, session_id: u.session_id || String(n[c].id) })),
      ),
      a = n.map((l) => String(l.id));
    return { profile: e, sessionId: r, lineage: n, rows: o, turns: mm(o, a) };
  }
  const vm = "hermes-workbench-transcripts-v1",
    ym = 1440 * 60 * 1e3,
    sC = 8,
    Kn = new Map();
  function wm(i, e) {
    return `${i}\0${e}`;
  }
  function km(i, e) {
    const t = new URL(
      "/__hermes-workbench-cache__/transcript",
      window.location.origin,
    );
    return (
      t.searchParams.set("profile", i),
      t.searchParams.set("session", e),
      new Request(t.toString(), { method: "GET" })
    );
  }
  function Vc(i, e) {
    for (Kn.delete(i), Kn.set(i, e); Kn.size > sC; )
      Kn.delete(Kn.keys().next().value);
  }
  async function oC(i, e) {
    const t = wm(i, e),
      r = Kn.get(t);
    if (r && Date.now() - r.cachedAt <= ym) return (Vc(t, r), r.transcript);
    if (typeof caches > "u") return null;
    try {
      const n = await (await caches.open(vm)).match(km(i, e));
      if (!n) return null;
      const s = await n.json();
      if (!s.transcript || Date.now() - Number(s.cachedAt || 0) > ym)
        return null;
      const o = { cachedAt: Number(s.cachedAt), transcript: s.transcript };
      return (Vc(t, o), o.transcript);
    } catch {
      return null;
    }
  }
  async function aC(i, e, t) {
    const r = { cachedAt: Date.now(), transcript: t };
    if ((Vc(wm(i, e), r), !(typeof caches > "u")))
      try {
        await (
          await caches.open(vm)
        ).put(
          km(i, e),
          new Response(JSON.stringify(r), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      } catch {}
  }
  function xm(i) {
    return i === "conversations";
  }
  function Cm(i) {
    return encodeURIComponent(i);
  }
  async function lC(i, e, t) {
    await i(`/api/sessions/${Cm(t)}?profile=${Cm(e)}`, { method: "DELETE" });
  }
  function cC(i, e = document) {
    return ge(
      `永久删除会话“${i}”？此操作无法撤销。`,
      `Permanently delete session “${i}”? This action cannot be undone.`,
      e,
    );
  }
  async function hC(i) {
    if (!xm(i.view)) return "unavailable";
    if (!i.confirm(cC(i.title, i.localeRoot))) return "cancelled";
    try {
      return (
        await lC(i.fetchJSON, i.profile, i.sessionId),
        i.currentSessionId === i.sessionId && i.onCurrentDeleted(),
        i.onRefresh(),
        "deleted"
      );
    } catch (e) {
      return (
        i.onError(
          ge(
            `删除会话失败：${String(e)}`,
            `Failed to delete session: ${String(e)}`,
            i.localeRoot,
          ),
        ),
        "failed"
      );
    }
  }
  let m2 = 0;
  function g2(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function Db(i) {
    return i.replace(
      /\r\n?/g,
      `
`,
    );
  }
  function Ib(i) {
    return Db(i).replace(/\n$/, "");
  }
  function b2(i) {
    return i.trim().split(/\s+/)[0]?.toLowerCase() || "";
  }
  function _2(i, e) {
    const t = i.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    return !!(t && t[1][0] === e.marker && t[1].length >= e.length);
  }
  function v2(i, e) {
    let t = null;
    for (const r of Db(i).split(`
`)) {
      if (!t) {
        const n = r.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        n &&
          (t = { marker: n[1][0], length: n[1].length, info: n[2], body: [] });
        continue;
      }
      if (_2(r, t)) {
        if (
          (b2(t.info) === "mermaid" || isPlantUMLLanguage(b2(t.info))) &&
          Ib(
            t.body.join(`
`),
          ) === Ib(e)
        )
          return !0;
        t = null;
        continue;
      }
      t.body.push(r);
    }
    return !1;
  }
  function Nb(i) {
    const e = Array.from(i.classList).find((t) =>
      /^(?:language|lang)-/.test(t),
    );
    return e ? e.replace(/^(?:language|lang)-/, "").toLowerCase() : "";
  }
  function y2(i) {
    return (
      {
        bash: "Shell",
        sh: "Shell",
        shell: "Shell",
        css: "CSS",
        html: "HTML",
        htm: "HTML",
        javascript: "JavaScript",
        js: "JavaScript",
        jsx: "JSX",
        json: "JSON",
        markdown: "Markdown",
        md: "Markdown",
        mermaid: "Mermaid",
        python: "Python",
        py: "Python",
        sql: "SQL",
        typescript: "TypeScript",
        ts: "TypeScript",
        tsx: "TSX",
        text: "Text",
        plaintext: "Text",
      }[i] ||
      i ||
      "Text"
    );
  }
  async function k2(i) {
    try {
      if (typeof navigator < "u" && navigator.clipboard?.writeText)
        return (await navigator.clipboard.writeText(i), !0);
    } catch {}
    if (typeof document > "u" || !document.body) return !1;
    const e = document.createElement("textarea");
    ((e.value = i),
      e.setAttribute("readonly", "true"),
      (e.style.position = "fixed"),
      (e.style.opacity = "0"),
      document.body.appendChild(e),
      e.select());
    let t = !1;
    try {
      t = document.execCommand("copy");
    } catch {
      t = !1;
    }
    return (e.remove(), t);
  }
  function Bb(i, e = runtimeText("复制", "Copy")) {
    const t = document.createElement("button");
    return (
      (t.type = "button"),
      (t.className = "hti-rich-code-copy"),
      (t.textContent = e),
      t.setAttribute("aria-label", runtimeText(`${e}代码`, `${e} code`)),
      t.addEventListener("click", () => {
        k2(i).then((r) => {
          t.isConnected &&
            ((t.textContent = r ? runtimeText("已复制", "Copied") : runtimeText("复制失败", "Copy failed")),
            r &&
              window.setTimeout(() => {
                t.isConnected && (t.textContent = e);
              }, 1600));
        });
      }),
      t
    );
  }
  function x2(i, e, t) {
    if (i.dataset.htiCodeEnhanced === "true") return;
    ((i.dataset.htiCodeEnhanced = "true"), i.classList.add("hti-rich-code"));
    const r = document.createElement("div");
    r.className = "hti-rich-code-header";
    const n = document.createElement("span");
    ((n.className = "hti-rich-code-language"), (n.textContent = y2(e)));
    const s = Bb(t);
    (r.append(n, s), i.insertBefore(r, i.firstChild));
  }
  function C2(i, e) {
    const t = Array.from(i.children).find(
      (l) => l.tagName.toLowerCase() === "code",
    );
    if (!t) return;
    const r = t.textContent || "",
      n = Nb(t);
    if ((x2(i, n, r), (n === "mermaid" || isPlantUMLLanguage(n)))) return;
    const s = w2(n);
    if (!s) return;
    const o = document.createElement("div");
    ((o.className = "hti-rich-code-editor"),
      i.replaceChildren(i.firstElementChild, o));
    const a = new Te({
      doc: r,
      parent: o,
      extensions: [
        Te.editable.of(!1),
        Su(O2, { fallback: !0 }),
        s,
        Te.theme({
          "&": { backgroundColor: "transparent", color: "inherit" },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--theme-font-mono, ui-monospace, monospace)",
          },
          ".cm-content": { minWidth: "max-content", padding: "0.75rem 0.9rem" },
          ".cm-line": { minHeight: "1.45em" },
        }),
      ],
    });
    e(() => a.destroy());
  }
  function Q2() {
    const i = document.documentElement;
    if (sr(i.getAttribute(bc)) === "dark") return !0;
    const e = i.getAttribute("data-theme") || "";
    return i.classList.contains("dark") || e.toLowerCase().includes("dark");
  }
  function P2() {
    const i = document.documentElement,
      e = document.body;
    return (
      getComputedStyle(i).getPropertyValue("--theme-font-sans").trim() ||
      (e
        ? getComputedStyle(e).getPropertyValue("--theme-font-sans").trim()
        : "") ||
      '"Workbench Sans SC", ui-sans-serif, system-ui, sans-serif'
    );
  }
  function $2(i) {
    return runtimeText(`Mermaid 渲染失败：${(i instanceof Error ? i.message : String(i)) || runtimeText("未知错误", "Unknown error")}`, `Mermaid rendering failed: ${(i instanceof Error ? i.message : String(i)) || runtimeText("未知错误", "Unknown error")}`);
  }
  function T2(i) {
    const e = document.createElement("section");
    ((e.className = "hti-rich-mermaid"),
      e.setAttribute("data-mermaid-source", i),
      e.setAttribute("aria-label", runtimeText("Mermaid 图表", "Mermaid diagram")));
    const t = document.createElement("div");
    t.className = "hti-rich-mermaid-header";
    const r = document.createElement("span");
    r.textContent = "Mermaid";
    const n = document.createElement("details");
    n.className = "hti-rich-mermaid-source";
    const s = document.createElement("summary");
    s.textContent = runtimeText("查看源码", "View source");
    const o = document.createElement("pre"),
      a = document.createElement("code");
    ((a.textContent = i), o.append(a), n.append(s, o));
    const l = document.createElement("div");
    ((l.className = "hti-rich-mermaid-controls"),
      l.append(n, Bb(i)),
      t.append(r, l));
    const c = document.createElement("div");
    return (
      (c.className = "hti-rich-mermaid-svg"),
      c.setAttribute("role", "img"),
      e.append(t, c),
      { host: e, svg: c }
    );
  }
  function yl(i, e) {
    if (
      (i.classList.add("hti-rich-mermaid-error"),
      i.querySelector(".hti-rich-mermaid-error-note"))
    )
      return;
    const t = document.createElement("small");
    ((t.className = "hti-rich-mermaid-error-note"),
      (t.textContent = $2(e)),
      i.appendChild(t));
  }
  function zb(i) {
    i.initialize({
      startOnLoad: !1,
      securityLevel: "strict",
      suppressErrorRendering: !0,
      layout: "dagre",
      look: "classic",
      theme: Q2() ? "dark" : "default",
      themeVariables: { fontFamily: P2() },
    });
  }
  async function Xb(i, e, t, r = () => !0) {
    const n = e.querySelector(".hti-rich-mermaid-svg");
    if (!n) return;
    const s = await i.render(`hti-rich-mermaid-${Date.now()}-${m2++}`, t);
    r() &&
      ((n.innerHTML = s.svg),
      s.bindFunctions?.(n),
      e.classList.remove("hti-rich-mermaid-error"),
      e.querySelector(".hti-rich-mermaid-error-note")?.remove());
  }
  async function wl(i, e, t) {
    await renderPlantUMLBlocks(i, t, source => v2(e, source));
    const n = Array.from(i.querySelectorAll("pre > code"))
      .filter((o) => Nb(o) === "mermaid")
      .filter((o) => v2(e, o.textContent || ""));
    if (!n.length || !t()) return;
    let s;
    try {
      if (((s = await kc()), !t())) return;
      zb(s);
    } catch (o) {
      for (const a of n) {
        const l = a.parentElement;
        l && t() && yl(l, o);
      }
      return;
    }
    for (const o of n) {
      if (!t()) return;
      const a = o.parentElement;
      if (!a || !i.contains(a)) continue;
      const l = o.textContent || "",
        { host: c } = T2(l);
      try {
        if ((await Xb(s, c, l, t), !t() || !i.contains(a))) return;
        a.replaceWith(c);
      } catch (u) {
        t() && i.contains(a) && yl(a, u);
      }
    }
  }
  async function E2(i, e) {
    await renderPlantUMLBlocks(i, e);
    const t = Array.from(
      i.querySelectorAll(".hti-rich-mermaid[data-mermaid-source]"),
    );
    if (!(!t.length || !e()))
      try {
        const r = await kc();
        if (!e()) return;
        zb(r);
        for (const n of t) {
          if (!e() || !i.contains(n)) return;
          try {
            await Xb(r, n, n.dataset.mermaidSource || "", e);
          } catch (s) {
            e() && yl(n, s);
          }
        }
      } catch (r) {
        for (const n of t) e() && yl(n, r);
      }
  }
  function A2(i) {
    const e = i.React,
      t = i.hooks || i.React,
      { useEffect: r, useRef: n, useState: s } = t;
    return function ({ content: incomingContent, streaming: incomingStreaming = !1 }) {
      const c = n(null),
        { content: a, streaming: l } = useSelectableMarkdown(t, c, incomingContent, incomingStreaming),
        markdownHtml = t.useMemo(() => ({ __html: S2(a) }), [a]),
        renderedContent = n(""),
        u = n(null),
        h = n(null),
        d = n(0),
        f = n([]),
        [S, b] = s(0);
      return (
        r(() => {
          if (typeof MutationObserver > "u") return;
          let p = !1;
          const m = () => {
              p ||
                ((p = !0),
                queueMicrotask(() => {
                  ((p = !1), b((g) => g + 1));
                }));
            },
            O = new MutationObserver(m);
          return (
            O.observe(document.documentElement, {
              attributes: !0,
              attributeFilter: [
                "class",
                "data-theme",
                "data-color-mode",
                bc,
                "style",
              ],
            }),
            window.addEventListener(zs, m),
            () => {
              (O.disconnect(), window.removeEventListener(zs, m));
            }
          );
        }, []),
        r(
          () => () => {
            d.current += 1;
            for (const p of f.current.splice(0)) p();
          },
          [],
        ),
        r(() => {
          const p = c.current;
          if (!p) return;
          // Streaming updates can leave the parsed HTML behind the message
          // snapshot, truncating the last fenced block. Reconcile the DOM
          // before enhancement so PlantUML and Mermaid see the full source.
          reconcileMarkdownHtml(p, a, renderedContent);
          const m = u.current !== a,
            O = h.current !== l;
          ((u.current = a), (h.current = l));
          const g = ++d.current,
            _ = () => d.current === g && c.current === p,
            w = () => {
              const P = Array.from(p.querySelectorAll("pre")).filter(
                (D) => !D.closest(".hti-rich-mermaid"),
              );
              if (!P.some((D) => D.dataset.htiCodeEnhanced !== "true"))
                return !1;
              for (const D of f.current.splice(0)) D();
              const E = (D) => f.current.push(D);
              for (const D of P) C2(D, E);
              return (l || wl(p, a, _), !0);
            },
            v = w(),
            x = !!p.querySelector(
              "pre > code.language-mermaid, pre > code.lang-mermaid, pre > code.language-plantuml, pre > code.language-puml, pre > code.language-uml",
            );
          m || v || ((O && !l) || (x && !l) ? wl(p, a, _) : E2(p, _));
          let y = !1;
          const C = new MutationObserver(() => {
            y ||
              ((y = !0),
              queueMicrotask(() => {
                if (((y = !1), !_())) return;
                !w() &&
                  !l &&
                  p.querySelector(
                    "pre > code.language-mermaid, pre > code.lang-mermaid, pre > code.language-plantuml, pre > code.language-puml, pre > code.language-uml",
                  ) &&
                  wl(p, a, _);
              }));
          });
          return (
            C.observe(p, { childList: !0, subtree: !0 }),
            () => C.disconnect()
          );
        }, [a, l, S]),
        g2(e, "div", {
          ref: c,
          className: "hti-rich-markdown hti-rich-text",
          dangerouslySetInnerHTML: markdownHtml,
        })
      );
    };
  }
  function Wb(i) {
    if (i == null) return null;
    const e =
      i instanceof Date
        ? i.getTime()
        : typeof i == "number"
          ? i
          : Date.parse(i);
    return Number.isFinite(e) ? e : null;
  }
  function R2(i) {
    for (let e = i.length - 1; e >= 0; e -= 1) {
      const t = i[e].messages;
      if (t.length > 0) return t[t.length - 1].timestamp;
    }
  }
  function L2(i, e) {
    return String(i.messageKey || i.toolCallId || i.toolId || `message-${e}`);
  }
  function qb(i) {
    const e = String(i.phase || "").toLowerCase();
    return (
      i.type === "assistant" &&
      !i.isToolUse &&
      !i.isTaskNotification &&
      (!i.isThinking || e === "commentary" || e === "final")
    );
  }
  function Zb(i) {
    return qb(i)
      ? null
      : i.isThinking ||
          i.type === "thinking" ||
          i.type === "reasoning" ||
          (i.isTaskNotification &&
            i.taskKind !== "goal_complete" &&
            i.taskStatus !== "completed")
        ? "thinking-group"
        : i.isToolUse ||
            i.isSubagentContainer ||
            i.type === "tool_use" ||
            i.type === "tool_result" ||
            i.type === "command_execution"
          ? "tool-group"
          : null;
  }
  function Uu(i) {
    const e = String(i.source || "");
    return (
      i.isStreaming === !0 || e.endsWith("-live") || e.endsWith("-realtime")
    );
  }
  function jb(i) {
    return qb(i);
  }
  function M2(i, e) {
    for (let t = e + 1; t < i.length; t += 1) {
      if (i[t].type === "user") return !1;
      if (jb(i[t])) return !0;
    }
    return !1;
  }
  function D2(i, e) {
    for (let t = e + 1; t < i.length; t += 1) {
      if (i[t].type === "user") return !1;
      if (Zb(i[t])) return !0;
    }
    return !1;
  }
  function Fb(i) {
    return i.type === "tool_result" && !i.toolInput ? 0 : 1;
  }
  function Hb(i, e, t, r, n) {
    const s = String(
        t === "tool-group"
          ? e.toolCallId || e.toolId || e.messageKey || `tool-${n}`
          : e.messageKey || `thinking-${n}`,
      ),
      o = i[i.length - 1];
    if (o && o.kind === t && (t === "tool-group" || o.groupKey === s)) {
      (o.messages.push(e), (o.commandCount += t === "tool-group" ? Fb(e) : 0));
      return;
    }
    i.push({
      kind: t,
      groupKey: s,
      defaultOpen: r,
      commandCount: t === "tool-group" ? Fb(e) : 0,
      messages: [e],
    });
  }
  function I2(i, e = {}) {
    const t = [];
    let r = "turn-start",
      n,
      s = [];
    const o = (a, l = !1, c, u) => {
      if (s.length === 0) return;
      const h = s.some((m) => m.messages.some(Uu)),
        d = a && s.some((m) => l || m.messages.some(Uu)),
        f = n ?? s[0]?.messages[0]?.timestamp,
        S = Wb(f),
        b = Wb(c ?? R2(s)),
        p = d && (l || h);
      (t.push({
        kind: "turn-non-body-group",
        turnKey: r,
        defaultOpen: d,
        isProcessing: p,
        processingStartedAt: f,
        processedDurationMs:
          S !== null && b !== null ? Math.max(0, b - S) : void 0,
        model: u?.model,
        tokenUsage: u?.tokenUsage,
        items: s.map((m) => ({ ...m, defaultOpen: d })),
      }),
        (s = []));
    };
    return (
      i.forEach((a, l) => {
        if (a.type === "user") {
          (o(!0),
            (r = L2(a, l)),
            (n = a.timestamp),
            t.push({ kind: "message", message: a }));
          return;
        }
        const c = Zb(a);
        if (c) {
          Hb(s, a, c, !0, l);
          return;
        }
        if (jb(a)) {
          if (M2(i, l) && (s.length > 0 || D2(i, l))) {
            Hb(s, a, "thinking-group", !0, l);
            return;
          }
          const u = e.activeTailDefaultOpen === !0 && l === i.length - 1;
          (o(Uu(a) || u, u, a.timestamp, a),
            t.push({ kind: "assistant-body", message: a }));
          return;
        }
        (o(!0, !1, a.timestamp), t.push({ kind: "message", message: a }));
      }),
      o(!0, e.activeTailDefaultOpen === !0),
      t
    );
  }
  function N2(i) {
    const e = Math.max(0, Math.floor(i / 1e3));
    if (e < 60) return runtimeText(`${e}秒`, `${e}s`);
    const t = Math.floor(e / 3600),
      r = Math.floor((e % 3600) / 60),
      n = e % 60;
    return t === 0
      ? runtimeText(`${String(r).padStart(2, "0")}分钟${String(n).padStart(2, "0")}秒`, `${String(r).padStart(2, "0")}m ${String(n).padStart(2, "0")}s`)
      : runtimeText(`${String(t).padStart(2, "0")}时${String(r).padStart(2, "0")}分${String(n).padStart(2, "0")}秒`, `${String(t).padStart(2, "0")}h ${String(r).padStart(2, "0")}m ${String(n).padStart(2, "0")}s`);
  }
  const B2 = 256 * 1024,
    z2 = 12,
    X2 = 20,
    Vb = new Set([
      "bash",
      "exec",
      "exec_command",
      "functions.exec",
      "functions.exec_command",
      "terminal",
    ]);
  function K(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function un({ React: i }) {
    return K(
      i,
      "svg",
      {
        className: "hti-detail-chevron",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": !0,
      },
      K(i, "path", { d: "M9 5l7 7-7 7" }),
    );
  }
  function W2({ React: i }) {
    return K(
      i,
      "svg",
      {
        className: "hti-thinking-bulb",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": !0,
      },
      K(i, "path", {
        d: "M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547Z",
      }),
    );
  }
  function Ub(i) {
    if (typeof i == "string") return i.trim();
    try {
      const e = JSON.stringify(i, null, 2),
        t = new TextEncoder().encode(e).byteLength;
      return t <= B2 ? e : `[Hermes value truncated: ${t} UTF-8 bytes]`;
    } catch {
      return String(i ?? "");
    }
  }
  function To(i) {
    if (typeof i != "string") return i;
    try {
      return JSON.parse(i);
    } catch {
      return i;
    }
  }
  function zr(i) {
    if (i instanceof Date)
      return Number.isFinite(i.getTime()) ? i.getTime() : null;
    if (typeof i == "number") {
      const e = i < 1e12 ? i * 1e3 : i;
      return Number.isFinite(e) ? e : null;
    }
    if (typeof i == "string" && i) {
      const e = Number(i);
      if (Number.isFinite(e)) return zr(e);
      const t = Date.parse(i);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  }
  function Yu(i, e = 0) {
    const t = i.events[Math.max(0, e - 1)]?.timestamp,
      r = i.raw[Math.min(e, Math.max(0, i.raw.length - 1))]?.timestamp;
    return e === 0
      ? (zr(i.timestamp) ?? zr(r) ?? zr(t) ?? 0)
      : (zr(t) ?? zr(r) ?? zr(i.timestamp) ?? 0);
  }
  function q2(i) {
    const e = i.raw.find((r) => r.role === "user"),
      t = zr(e?.timestamp) ?? Yu(i);
    return t > 0 ? new Date(t).toLocaleTimeString() : "";
  }
  const Yb = new WeakMap();
  function Ki({ React: i, content: e, streaming: t = !1 }) {
    let r = Yb.get(i);
    return (
      r || ((r = A2({ React: i, hooks: i })), Yb.set(i, r)),
      K(i, r, { content: e, streaming: t })
    );
  }
  function Z2(i) {
    const e = Yu(i),
      t = i.user
        ? [
            {
              type: "user",
              content: i.user,
              timestamp: e,
              messageKey: `${i.key}:user`,
            },
          ]
        : [];
    return (
      i.events.forEach((r, n) => {
        const s =
            zr(
              r.kind === "tool"
                ? (r.resultTimestamp ?? r.timestamp)
                : r.timestamp,
            ) ?? Yu(i, n + 1),
          o = String(r.key || `${i.key}:event:${n}`);
        if (
          r.kind === "reasoning" ||
          (r.kind === "assistant" && r.phase === "commentary")
        ) {
          t.push({
            type: "reasoning",
            content: String(r.content || ""),
            timestamp: s,
            messageKey: o,
            isThinking: !0,
            phase: "commentary",
          });
          return;
        }
        if (r.kind === "tool") {
          t.push({
            type: "command_execution",
            timestamp: s,
            messageKey: o,
            isToolUse: !0,
            toolName: String(r.name || ""),
            toolInput: r.input ?? {},
            toolResult:
              r.result === void 0
                ? null
                : { content: Ub(r.result), isError: !!r.error },
            toolCallId: String(r.callId || o),
            unmatched: !!r.unmatched,
          });
          return;
        }
        r.kind === "assistant" &&
          t.push({
            type: "assistant",
            content: String(r.content || ""),
            timestamp: s,
            messageKey: o,
            phase: "final",
          });
      }),
      t
    );
  }
  function j2(i) {
    const e = To(i);
    if (typeof e == "string") return e;
    if (!e || typeof e != "object") return "";
    const t = e;
    return String(t.command ?? t.cmd ?? t.code ?? "");
  }
  function kl(i) {
    const e = To(i);
    if (typeof e == "string") return e.trim();
    if (Array.isArray(e))
      return e.map(kl).filter(Boolean).join(`
`);
    if (!e || typeof e != "object")
      return typeof e == "number" || typeof e == "boolean" ? String(e) : "";
    const t = e,
      r = [];
    for (const n of [
      "output",
      "stdout",
      "stderr",
      "error",
      "message",
      "content",
      "text",
    ])
      if (t[n] !== void 0 && t[n] !== e) {
        const s = kl(t[n]);
        s && !r.includes(s) && r.push(s);
      }
    return r.join(`
`);
  }
  function F2(i) {
    const e = To(i);
    if (typeof e == "string")
      return (
        e.split(`
`)[0] || ""
      );
    if (!e || typeof e != "object") return "";
    const t = e,
      r =
        t.file_path ??
        t.path ??
        t.pattern ??
        t.query ??
        t.url ??
        t.command ??
        t.cmd;
    return r
      ? String(r).split(`
`)[0]
      : "";
  }
  function H2(i) {
    const e = i.toLowerCase();
    return Vb.has(e)
      ? "bash"
      : /edit|write|patch/.test(e)
        ? "edit"
        : /grep|glob|search/.test(e)
          ? "search"
          : /agent|task/.test(e)
            ? "agent"
            : /plan/.test(e)
              ? "plan"
              : /question|ask/.test(e)
                ? "question"
                : "default";
  }
  function V2({ React: i, hooks: e, tool: t }) {
    const [r, n] = e.useState(!1),
      s = kl(t.toolResult?.content);
    return s
      ? K(
          i,
          "details",
          {
            className: `hti-command-output${t.toolResult?.isError ? " is-error" : ""}`,
            id: `tool-result-${String(t.toolCallId || t.messageKey).replace(/[^A-Za-z0-9_-]/g, "-")}`,
            open: r,
            onToggle: (o) => n(o.currentTarget.open),
          },
          K(
            i,
            "summary",
            {
              "aria-label": r ? "Hide output" : "Show output",
              "aria-expanded": r,
            },
            K(i, "span", { "aria-hidden": !0 }, r ? "▾" : "▸"),
          ),
          r ? K(i, "pre", null, s) : null,
        )
      : null;
  }
  function U2({ React: i, hooks: e, tool: t }) {
    const [r, n] = e.useState(!1),
      s = j2(t.toolInput),
      o = async () => {
        let a = !1;
        try {
          navigator.clipboard?.writeText &&
            (await navigator.clipboard.writeText(s), (a = !0));
        } catch {
          a = !1;
        }
        if (!a) {
          const l = document.createElement("textarea");
          ((l.value = s),
            (l.style.position = "fixed"),
            (l.style.opacity = "0"),
            document.body.appendChild(l),
            l.select(),
            (a = document.execCommand("copy")),
            l.remove());
        }
        (n(a), a && window.setTimeout(() => n(!1), 2e3));
      };
    return K(
      i,
      "div",
      {
        className: "hti-command-card",
        "data-component": "ToolCallCard",
        "data-tool-name": t.toolName,
        "data-tool-status": t.toolResult?.isError
          ? runtimeText("错误", "Error")
          : t.toolResult
            ? runtimeText("完成", "Completed")
            : runtimeText("无结果", "No result"),
      },
      K(i, "pre", { className: "hti-command-code" }, displayCommand(s)),
      K(
        i,
        "button",
        {
          type: "button",
          className: "hti-command-copy",
          onClick: o,
          "aria-label": r ? "Command copied" : "Copy command",
          title: r ? "Copied" : "Copy command",
        },
        r ? "✓" : "⧉",
      ),
      K(i, V2, { React: i, hooks: e, tool: t }),
    );
  }
  function Gb(i) {
    const e = String(i || "").toLowerCase();
    return (e.split(/[.:/]/).at(-1) || e)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }
  function Eo(i) {
    const e = To(i);
    return e && typeof e == "object" && !Array.isArray(e) ? e : {};
  }
  function dn(i, e) {
    for (const t of e) {
      const r = i[t];
      if (typeof r == "string" && r.trim()) return r.trim();
    }
    return "";
  }
  function Ao(i) {
    const e = To(i);
    if (typeof e == "string") return e.trim();
    if (Array.isArray(e))
      return e.map(Ao).filter(Boolean).join(`
`);
    if (!e || typeof e != "object") return String(e ?? "");
    const t = e;
    for (const r of [
      "output",
      "stdout",
      "stderr",
      "error",
      "message",
      "content",
      "text",
      "result",
      "files",
      "filenames",
      "changes",
    ])
      if (t[r] !== void 0 && t[r] !== e) {
        const n = Ao(t[r]);
        if (n) return n;
      }
    return Object.entries(t)
      .filter(([, r]) => ["string", "number", "boolean"].includes(typeof r))
      .map(([r, n]) => `${r}: ${String(n)}`).join(`
`);
  }
  function Ss({ React: i, tool: e }) {
    const t = Ao(e.toolResult?.content);
    return t
      ? K(
          i,
          "details",
          {
            className: `hti-semantic-output${e.toolResult?.isError ? " is-error" : ""}`,
            id: `tool-result-${String(e.toolCallId || e.messageKey).replace(/[^A-Za-z0-9_-]/g, "-")}`,
          },
          K(i, "summary", null, "Output"),
          K(
            i,
            "div",
            { className: "hti-semantic-output-body" },
            e.toolResult?.isError
              ? K(i, "div", { className: "hti-error-label" }, "× Error")
              : null,
            K(i, "pre", null, t),
          ),
        )
      : null;
  }
  function Y2({ React: i, tool: e }) {
    const t = Eo(e.toolInput),
      r = dn(t, ["file_path", "path", "filename"]),
      n = Ao(e.toolResult?.content);
    return K(
      i,
      "div",
      {
        className: "hti-semantic-tool hti-tool-read-card",
        "data-component": "ToolCallCard",
        "data-tool-renderer": "read",
        "data-tool-name": e.toolName,
      },
      K(
        i,
        "details",
        { className: "hti-tool-input" },
        K(
          i,
          "summary",
          null,
          K(i, un, { React: i }),
          K(
            i,
            "span",
            { className: "hti-tool-name" },
            String(e.toolName || ""),
          ),
          r ? K(i, "span", { className: "hti-tool-separator" }, "/") : null,
          r ? K(i, "span", { className: "hti-tool-title" }, r) : null,
        ),
        !e.toolResult?.isError && n
          ? K(i, "pre", { className: "hti-semantic-content" }, n)
          : null,
      ),
      e.toolResult?.isError ? K(i, Ss, { React: i, tool: e }) : null,
    );
  }
  function G2({ React: i, tool: e, family: t }) {
    const r = Eo(e.toolInput),
      n = dn(r, ["file_path", "path", "filename"]),
      s =
        t === "write"
          ? "Write"
          : Gb(e.toolName).includes("patch")
            ? "Patch"
            : "Edit";
    return K(
      i,
      "div",
      {
        className: `hti-semantic-tool hti-tool-mutation-card hti-tool-${t}`,
        "data-component": "ToolCallCard",
        "data-tool-renderer": t,
        "data-tool-name": e.toolName,
      },
      K(
        i,
        "div",
        { className: "hti-file-action" },
        K(i, "span", { className: "hti-tool-name" }, s),
        n ? K(i, "span", { className: "hti-tool-separator" }, "/") : null,
        n ? K(i, "code", null, n) : null,
      ),
      e.toolResult?.isError ? K(i, Ss, { React: i, tool: e }) : null,
    );
  }
  function K2({ React: i, tool: e }) {
    const t = Eo(e.toolInput),
      r = dn(t, ["pattern", "query", "search_term", "url"]),
      n = dn(t, ["path", "directory", "cwd"]),
      s = Ao(e.toolResult?.content);
    return K(
      i,
      "div",
      {
        className: "hti-semantic-tool hti-tool-search-card",
        "data-component": "ToolCallCard",
        "data-tool-renderer": "search",
        "data-tool-name": e.toolName,
      },
      K(
        i,
        "details",
        { className: "hti-tool-input" },
        K(
          i,
          "summary",
          null,
          K(i, un, { React: i }),
          K(
            i,
            "span",
            { className: "hti-tool-name" },
            String(e.toolName || ""),
          ),
          r || n
            ? K(i, "span", { className: "hti-tool-separator" }, "/")
            : null,
          r || n
            ? K(
                i,
                "span",
                { className: "hti-tool-title" },
                n ? `${r}${r ? " in " : ""}${n}` : r,
              )
            : null,
        ),
        !e.toolResult?.isError && s
          ? K(i, "pre", { className: "hti-semantic-content" }, s)
          : null,
      ),
      e.toolResult?.isError ? K(i, Ss, { React: i, tool: e }) : null,
    );
  }
  function J2({ React: i, tool: e }) {
    const t = Eo(e.toolInput),
      r = dn(t, ["explanation", "plan", "description"]),
      s = (
        Array.isArray(t.plan) ? t.plan : Array.isArray(t.steps) ? t.steps : []
      ).map((a, l) =>
        K(
          i,
          "li",
          { key: `${String(a?.step || a?.content || l)}-${l}` },
          K(
            i,
            "span",
            {
              className: `hti-plan-state is-${String(a?.status || "pending")}`,
              "aria-hidden": !0,
            },
            a?.status === "completed" ? "✓" : "○",
          ),
          K(i, "span", null, String(a?.step || a?.content || a)),
        ),
      ),
      o = `${s.length} steps`;
    return K(
      i,
      "section",
      {
        className: "hti-semantic-tool hti-tool-plan-card",
        "data-component": "ToolCallCard",
        "data-tool-renderer": "plan",
        "data-tool-name": e.toolName,
      },
      K(
        i,
        "details",
        { className: "hti-tool-input" },
        K(
          i,
          "summary",
          null,
          K(i, un, { React: i }),
          K(
            i,
            "span",
            { className: "hti-tool-name" },
            String(e.toolName || ""),
          ),
          s.length
            ? K(i, "span", { className: "hti-tool-separator" }, "/")
            : null,
          s.length ? K(i, "span", { className: "hti-tool-title" }, o) : null,
        ),
        K(
          i,
          "div",
          { className: "hti-plan-body" },
          r ? K(i, Ki, { React: i, content: r }) : null,
          s.length > 0
            ? K(i, "ol", { className: "hti-plan-steps" }, ...s)
            : null,
        ),
      ),
      e.toolResult?.isError ? K(i, Ss, { React: i, tool: e }) : null,
    );
  }
  function eR({ React: i, tool: e }) {
    const t = [
      String(e.toolName || "").trim(),
      String(e.toolCallId || "").trim(),
    ]
      .filter(Boolean)
      .join(" · ");
    return K(
      i,
      "div",
      {
        className: "hti-unmatched-tool",
        "data-tool-unmatched": "true",
        "data-tool-name": e.toolName,
      },
      K(
        i,
        "details",
        { className: "hti-unmatched-boundary" },
        K(
          i,
          "summary",
          null,
          K(i, un, { React: i }),
          K(i, "span", { className: "hti-boundary-label" }, runtimeText("未匹配", "Unmatched")),
          t ? K(i, "span", { className: "hti-tool-separator" }, "/") : null,
          t ? K(i, "span", { className: "hti-tool-title" }, t) : null,
        ),
        K(
          i,
          "div",
          { className: "hti-boundary-warning", role: "status" },
          K(i, "span", { "aria-hidden": !0 }, "⚠"),
          K(i, "span", null, runtimeText("未找到对应 tool call；结果保留在原始事件位置。", "No matching tool call. The result remains at its original event position.")),
        ),
      ),
      K(i, Ss, { React: i, tool: e }),
    );
  }
  function tR({ React: i, tool: e }) {
    const t = Eo(e.toolInput),
      r = dn(t, ["agent_type", "subagent_type", "type", "name"]),
      n = dn(t, ["description", "task", "task_name", "title"]),
      s = dn(t, ["prompt", "message", "instructions"]),
      o = [r, n].filter(Boolean).join(": ");
    return K(
      i,
      "div",
      {
        className: "hti-semantic-tool hti-tool-subagent-card",
        "data-component": "ToolCallCard",
        "data-tool-renderer": "subagent",
        "data-tool-name": e.toolName,
      },
      K(
        i,
        "details",
        { className: "hti-tool-input" },
        K(
          i,
          "summary",
          null,
          K(i, un, { React: i }),
          K(
            i,
            "span",
            { className: "hti-tool-name" },
            String(e.toolName || ""),
          ),
          o ? K(i, "span", { className: "hti-tool-separator" }, "/") : null,
          o ? K(i, "span", { className: "hti-tool-title" }, o) : null,
        ),
        s
          ? K(
              i,
              "div",
              { className: "hti-subagent-prompt" },
              K(i, Ki, { React: i, content: s }),
            )
          : null,
      ),
      K(i, Ss, { React: i, tool: e }),
    );
  }
  function iR({ React: i, tool: e }) {
    const t = kl(e.toolResult?.content),
      r = F2(e.toolInput),
      n = H2(String(e.toolName || ""));
    return K(
      i,
      "div",
      {
        className: `hti-generic-tool hti-tool-${n}`,
        "data-component": "ToolCallCard",
        "data-tool-name": e.toolName,
        "data-tool-status": e.toolResult?.isError
          ? runtimeText("错误", "Error")
          : e.toolResult
            ? runtimeText("完成", "Completed")
            : runtimeText("无结果", "No result"),
      },
      K(
        i,
        "details",
        { className: "hti-tool-input" },
        K(
          i,
          "summary",
          null,
          K(i, un, { React: i }),
          K(i, "span", { className: "hti-tool-name" }, e.toolName || ""),
          r ? K(i, "span", { className: "hti-tool-separator" }, "/") : null,
          r ? K(i, "span", { className: "hti-tool-title" }, r) : null,
        ),
        r ? K(i, "div", { className: "hti-tool-value" }, r) : null,
      ),
      t
        ? K(
            i,
            "details",
            {
              className: `hti-generic-output${e.toolResult?.isError ? " is-error" : ""}`,
              id: `tool-result-${String(e.toolCallId || e.messageKey).replace(/[^A-Za-z0-9_-]/g, "-")}`,
            },
            K(i, "summary", null, "Output"),
            K(
              i,
              "div",
              { className: "hti-generic-output-body" },
              e.toolResult?.isError
                ? K(i, "div", { className: "hti-error-label" }, "× Error")
                : null,
              K(i, "pre", null, t),
            ),
          )
        : null,
    );
  }
  function rR(i) {
    const e = Gb(i);
    return Vb.has(e)
      ? "command"
      : ["read", "read_file", "view_image"].includes(e)
        ? "read"
        : ["write", "write_file"].includes(e)
          ? "write"
          : ["edit", "edit_file", "apply_patch", "applypatch"].includes(e)
            ? "edit"
            : ["grep", "glob", "search", "web_search", "websearch"].includes(e)
              ? "search"
              : [
                    "update_plan",
                    "exit_plan_mode",
                    "exitplanmode",
                    "plan",
                  ].includes(e)
                ? "plan"
                : [
                      "agent",
                      "task",
                      "subagent",
                      "spawn_agent",
                      "spawn_subagent",
                      "delegate_to_agent",
                    ].includes(e)
                  ? "subagent"
                  : null;
  }
  function Kb({ React: i, hooks: e, message: t }) {
    if (t.unmatched) return K(i, eR, { React: i, tool: t });
    const r = rR(t.toolName);
    return r === "command"
      ? K(i, U2, { React: i, hooks: e, tool: t })
      : r === "read"
        ? K(i, Y2, { React: i, tool: t })
        : r === "write" || r === "edit"
          ? K(i, G2, { React: i, tool: t, family: r })
          : r === "search"
            ? K(i, K2, { React: i, tool: t })
            : r === "plan"
              ? K(i, J2, { React: i, tool: t })
              : r === "subagent"
                ? K(i, tR, { React: i, tool: t })
                : K(i, iR, { React: i, tool: t });
  }
  function nR({ React: i, hooks: e, message: t }) {
    const r = String(t.content || ""),
      n = r
        .split(
          `
`,
        )
        .filter((l) => l.trim()),
      s = n[n.length - 1] || "",
      [o, a] = e.useState(!1);
    return n.length === 0
      ? null
      : n.length === 1
        ? K(
            i,
            "div",
            {
              className: "hti-thinking-single",
              "data-component": "ReasoningCard",
            },
            K(i, W2, { React: i }),
            K(i, Ki, { React: i, content: s }),
          )
        : K(
            i,
            "details",
            {
              className: "hti-thinking-details",
              open: o,
              onToggle: (l) => a(l.currentTarget.open),
              "data-component": "ReasoningCard",
            },
            K(
              i,
              "summary",
              null,
              K(i, un, { React: i }),
              K(i, "span", { className: "hti-thinking-label" }, "Thinking"),
              K(i, "span", { className: "hti-tool-separator" }, "/"),
              K(i, "span", { className: "hti-thinking-preview" }, s),
            ),
            o
              ? K(
                  i,
                  "div",
                  { className: "hti-thinking-body" },
                  K(i, Ki, { React: i, content: r }),
                )
              : null,
          );
  }
  function sR({ React: i, hooks: e, block: t }) {
    const [r, n] = e.useState(t.defaultOpen);
    e.useEffect(() => n(t.defaultOpen), [t.defaultOpen, t.turnKey]);
    const s =
        t.processedDurationMs === void 0 ? null : N2(t.processedDurationMs),
      o = t.items.every((u) => u.kind === "tool-group"),
      a = t.items.reduce(
        (u, h) => u + (h.kind === "tool-group" ? h.commandCount : 0),
        0,
      ),
      l = a === 1 ? runtimeText("一次工具调用", "One tool call") : runtimeText(`${a}次工具调用`, `${a} tool calls`),
      c = o
        ? [
            K(
              i,
              "details",
              {
                className: "hti-tool-group",
                "data-testid": "turn-tool-list",
                key: "tool-list",
              },
              K(i, "summary", null, l),
              K(
                i,
                "div",
                { className: "hti-tool-list" },
                ...t.items
                  .flatMap((u) => u.messages)
                  .map((u, h) =>
                    K(i, Kb, {
                      React: i,
                      hooks: e,
                      message: u,
                      key: String(u.toolCallId || u.messageKey || h),
                    }),
                  ),
              ),
            ),
          ]
        : t.items.map((u) => {
            if (u.kind === "thinking-group")
              return K(
                i,
                "div",
                { className: "hti-thinking-group", key: u.groupKey },
                ...u.messages.map((d, f) =>
                  K(i, nR, {
                    React: i,
                    hooks: e,
                    message: d,
                    key: String(d.messageKey || f),
                  }),
                ),
              );
            const h =
              u.commandCount === 1
                ? runtimeText("一次工具调用", "One tool call")
                : runtimeText(`${u.commandCount}次工具调用`, `${u.commandCount} tool calls`);
            return K(
              i,
              "details",
              {
                className: "hti-tool-group",
                "data-testid": "turn-tool-group",
                key: u.groupKey,
              },
              K(i, "summary", null, h),
              K(
                i,
                "div",
                { className: "hti-tool-list" },
                ...u.messages.map((d, f) =>
                  K(i, Kb, {
                    React: i,
                    hooks: e,
                    message: d,
                    key: String(d.toolCallId || d.messageKey || f),
                  }),
                ),
              ),
            );
          });
    return K(
      i,
      "details",
      {
        className: `hti-process-group${o ? " hti-tool-only-group" : ""}`,
        open: r,
        "data-testid": o ? "turn-tool-list-group" : "turn-non-body-group",
      },
      K(
        i,
        "summary",
        {
          "data-testid": o ? "turn-tool-list-toggle" : "turn-non-body-toggle",
          "aria-expanded": r,
          onClick: (u) => {
            (u.preventDefault(), n((h) => !h));
          },
        },
        K(i, un, { React: i }),
        s ? K(i, "span", null, runtimeText(`耗时 ${s}`, `Duration ${s}`)) : null,
      ),
      r ? K(i, "div", { className: "hti-process-body" }, ...c) : null,
    );
  }
  function oR({ React: i, turn: e }) {
    return K(
      i,
      "section",
      {
        className: "hti-user-row",
        "data-component": "MessageBubble",
        "data-role": "user",
      },
      K(
        i,
        "div",
        { className: "hti-user-bubble" },
        K(i, "div", { className: "hti-user-content" }, e.user),
        K(i, "time", null, q2(e)),
      ),
      K(i, "div", { className: "hti-user-avatar", "aria-hidden": !0 }, "U"),
    );
  }
  function aR({ React: i, message: e }) {
    return K(
      i,
      "section",
      {
        className: "hti-assistant-message",
        "data-component": "MessageBubble",
        "data-role": "assistant",
      },
      K(i, Ki, { React: i, content: String(e.content || "") }),
    );
  }
  function lR({ React: i, hooks: e, turn: t, rawOpen: r, index: n }) {
    const s = t,
      o = e.useMemo(() => I2(Z2(s)), [t]);
    return K(
      i,
      "article",
      {
        className: "hti-turn",
        "data-component": "TranscriptTurn",
        "data-turn-index": n,
      },
      s.user ? K(i, oR, { React: i, turn: s }) : null,
      ...o.flatMap((a, l) =>
        a.kind === "turn-non-body-group"
          ? [
              K(i, sR, {
                React: i,
                hooks: e,
                block: a,
                key: `${a.turnKey}:process`,
              }),
            ]
          : a.kind === "assistant-body"
            ? [
                K(i, aR, {
                  React: i,
                  message: a.message,
                  key: a.message.messageKey || l,
                }),
              ]
            : [],
      ),
      r
        ? K(
            i,
            "details",
            {
              className: "hti-raw-panel",
              open: !0,
              "data-component": "RawRecordPanel",
            },
            K(i, "summary", null, runtimeText("原始记录", "Raw events")),
            K(i, "pre", null, Ub(s.raw)),
          )
        : null,
    );
  }
  function Jb(i) {
    const e = i.React,
      t = i.hooks;
    function r({ turns: n, rawOpen: s }) {
      const [o, a] = t.useState(z2),
        l = Math.max(0, n.length - o),
        c = n.slice(l);
      return K(
        e,
        "div",
        {
          className: "hti-timeline",
          "data-testid": "hermes-workbench-timeline",
          "data-component": "TranscriptTimeline",
        },
        l > 0
          ? K(
              e,
              "button",
              {
                type: "button",
                className: "hti-load-earlier",
                "data-testid": "load-earlier-turns",
                onClick: () => a((u) => Math.min(n.length, u + X2)),
              },
              runtimeText("加载更早 / Load earlier", "Load earlier"),
            )
          : null,
        ...c.map((u, h) =>
          K(e, lR, {
            React: e,
            hooks: t,
            turn: u,
            rawOpen: s,
            index: l + h,
            key: u.key,
          }),
        ),
      );
    }
    return { TranscriptTimeline: r };
  }
  function cR(i) {
    i && (i.scrollTop = i.scrollHeight);
  }
  function hR(i, e) {
    const t = Number.isFinite(e.offsetTop) ? Number(e.offsetTop) : 0,
      r = t + Math.max(0, e.height);
    return Math.max(0, Math.floor(r - Math.max(i, t)));
  }
  function bs(i, e, t) {
    return Math.min(t, Math.max(e, Math.round(i)));
  }
  const Ro = "/api/plugins/workbench",
    uR = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i,
    e_ = new Map();
  function _s(i) {
    return encodeURIComponent(i);
  }
  function dR(i) {
    const e = i?.workspace ?? i;
    if (!e || typeof e != "object") return null;
    const t = String(e.id ?? e.workspace_id ?? e.path ?? ""),
      r = String(e.path ?? e.root ?? e.root_path ?? "");
    return !t && !r
      ? null
      : {
          id: t || r,
          name: String(
            e.name ?? e.label ?? r.split("/").filter(Boolean).at(-1) ?? t,
          ),
          path: r,
          profile: String(e.profile ?? ""),
          sessionId: String(e.session_id ?? e.sessionId ?? ""),
        };
  }
  async function fR(i, e, t) {
    const r = e_.get(e);
    if (r) return { ...r, profile: e, sessionId: t };
    const n = await i(`${Ro}/workspace?profile=${_s(e)}&session=${_s(t)}`),
      s = dR(n);
    if (!s) return null;
    const o = { ...s, profile: e, sessionId: "" };
    return (e_.set(e, o), { ...o, sessionId: t });
  }
  function pR(i, e, t) {
    return i?.profile === e && i.sessionId === t ? i : null;
  }
  function mR(i, e) {
    return i?.profile === e ? { ...i, sessionId: "" } : null;
  }
  function OR(i, e) {
    const t = Array.isArray(i)
      ? i
      : (i?.files ?? i?.entries ?? i?.children ?? []);
    return Array.isArray(t)
      ? t
          .flatMap((r) => {
            if (typeof r == "string") {
              const c = r.split("/").filter(Boolean).at(-1) || r,
                u = e && !r.includes("/") ? `${e}/${r}` : r;
              return [
                {
                  name: c,
                  path: u,
                  type: r.endsWith("/") ? "directory" : "file",
                },
              ];
            }
            if (!r || typeof r != "object") return [];
            const n = String(r.path ?? r.relative_path ?? r.name ?? "");
            if (!n) return [];
            const s = r.path !== void 0 || r.relative_path !== void 0,
              o = e && !s ? `${e}/${n}` : n,
              a = String(r.type ?? r.kind ?? ""),
              l =
                r.is_directory === !0 ||
                r.directory === !0 ||
                a === "directory" ||
                a === "dir";
            return [
              {
                name: String(
                  r.name ?? o.split("/").filter(Boolean).at(-1) ?? o,
                ),
                path: o,
                type: l ? "directory" : "file",
                size: Number.isFinite(Number(r.size)) ? Number(r.size) : void 0,
              },
            ];
          })
          .sort((r, n) =>
            r.type !== n.type
              ? r.type === "directory"
                ? -1
                : 1
              : r.name.localeCompare(n.name),
          )
      : [];
  }
  async function t_(i, e) {
    const t = await i(`${Ro}/files?path=${_s(e)}`);
    return uniqueWorkspaceEntries(OR(t, e));
  }
  async function gR(i, e) {
    const t = await i(`${Ro}/file?path=${_s(e)}`);
    return {
      content: String(t?.content ?? ""),
      version: String(t?.version ?? ""),
      path: String(t?.path ?? e),
      size: Number(t?.size ?? 0),
    };
  }
  async function SR(i, e, t, r) {
    return await i(`${Ro}/file?path=${_s(e)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: t, version: r }),
    });
  }
  function bR(i) {
    return `${Ro}/asset?path=${_s(i)}`;
  }
  function Gu(i) {
    return uR.test(i);
  }
  function Lo(i) {
    return /(?:^|\/)readme(?:\.[^/]*)?$|\.(?:md|mdown|markdown)$/i.test(i);
  }
  const _R = ["today", "week", "month", "older"];
  function i_() {
    return new Set(["today", "week"]);
  }
  function Ci(i) {
    return String(i.id ?? i.session_id ?? "");
  }
  function Ku(i) {
    return String(
      i.title ||
        i.summary ||
        i.name ||
        i.id ||
        i.session_id ||
        runtimeText("未命名会话 / Untitled", "Untitled"),
    );
  }
  function r_(i, e) {
    return e?.displayName || Ku(i);
  }
  function Ju(i, e) {
    return {
      profile: i,
      sessionId: e,
      displayName: "",
      collection: "",
      tags: [],
      pinned: !1,
      summary: "",
      updatedAt: 0,
    };
  }
  function n_(i) {
    if (!i || typeof i != "object") return null;
    const e = String(i.session_id ?? i.sessionId ?? "").trim();
    if (!e) return null;
    const t = new Set(),
      r = (Array.isArray(i.tags) ? i.tags : []).flatMap((n) => {
        const s = String(n ?? "").trim(),
          o = s.toLocaleLowerCase();
        return !s || t.has(o) ? [] : (t.add(o), [s]);
      });
    return {
      profile: String(i.profile ?? "default").trim() || "default",
      sessionId: e,
      displayName: String(i.display_name ?? i.displayName ?? "").trim(),
      collection: String(i.collection ?? "").trim(),
      tags: r,
      pinned: i.pinned === !0,
      summary: String(i.summary ?? "").trim(),
      updatedAt: Number.isFinite(Number(i.updated_at ?? i.updatedAt))
        ? Number(i.updated_at ?? i.updatedAt)
        : 0,
    };
  }
  function vR(i) {
    const e = Array.isArray(i) ? i : [],
      t = {};
    for (const r of e) {
      const n = n_(r);
      n && (t[n.sessionId] = n);
    }
    return t;
  }
  function yR(i) {
    const e = new Set();
    for (const t of Object.values(i)) t.collection && e.add(t.collection);
    return [...e].sort((t, r) => t.localeCompare(r));
  }
  function ed(i, e) {
    const t =
      String(i.source ?? "")
        .trim()
        .toLocaleLowerCase() === "cron";
    return e === "cron" ? t : !t;
  }
  function wR(i) {
    return i.some((e) => ed(e, "cron")) ? "cron" : "conversations";
  }
  function kR(...i) {
    const e = new Set(),
      t = [];
    for (const r of i)
      for (const n of r) {
        const s = Ci(n);
        !s || e.has(s) || (e.add(s), t.push(n));
      }
    return t;
  }
  function xR(i, e, t, r = new Set()) {
    const n = t.trim().toLocaleLowerCase();
    return i
      .map((s, o) => ({ row: s, index: o, id: Ci(s), meta: e[Ci(s)] }))
      .filter(({ id: s, meta: o }) =>
        s
          ? !n || r.has(s)
            ? !0
            : [o?.displayName, o?.collection, ...(o?.tags ?? []), o?.summary]
                .filter(Boolean)
                .join(
                  `
`,
                )
                .toLocaleLowerCase()
                .includes(n)
          : !1,
      )
      .sort((s, o) => {
        const a = +!!o.meta?.pinned - +!!s.meta?.pinned;
        return a !== 0 ? a : s.index - o.index;
      })
      .map(({ row: s }) => s);
  }
  function CR(i, e = Date.now()) {
    const t = i.updated_at ?? i.last_active ?? i.created_at ?? i.timestamp,
      r = typeof t == "number" && t < 1e12 ? t * 1e3 : Number(t);
    if (!Number.isFinite(r) || r <= 0) return "older";
    const n = new Date(e),
      s = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    if (r >= s) return "today";
    const o = 1440 * 60 * 1e3;
    return r >= e - 7 * o ? "week" : r >= e - 30 * o ? "month" : "older";
  }
  function QR(i, e = Date.now()) {
    const t = new Map();
    for (const r of i) {
      const n = CR(r, e),
        s = t.get(n) || [];
      (s.push(r), t.set(n, s));
    }
    return _R.flatMap((r) => {
      const n = t.get(r);
      return n?.length ? [{ collection: r, rows: n }] : [];
    });
  }
  const s_ = "/api/plugins/workbench/session-organization";
  function PR(i) {
    return encodeURIComponent(i);
  }
  async function $R(i, e) {
    const t = await i(`${s_}?profile=${PR(e)}`);
    return vR(t?.items);
  }
  async function o_(i, e) {
    const t = await i(s_, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: e.profile,
        session_id: e.sessionId,
        display_name: e.displayName,
        collection: e.collection,
        tags: e.tags,
        pinned: e.pinned,
        summary: e.summary,
      }),
    });
    return t?.deleted === !0 ? null : n_(t);
  }
  function nt(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function TR(i) {
    const e = new Set();
    return i
      .split(/[,，]/)
      .flatMap((t) => {
        const r = t.trim(),
          n = r.toLocaleLowerCase();
        return !r || e.has(n) ? [] : (e.add(n), [r]);
      })
      .slice(0, 8);
  }
  function ER(i) {
    const e = i.React,
      { useState: t } = i.hooks;
    return function ({
      nativeSessionTitle: n,
      value: s,
      collections: o,
      onClose: a,
      onSaved: l,
    }) {
      const [c, u] = t(s.displayName),
        [h, d] = t(s.collection),
        [f, S] = t(s.tags.join(", ")),
        [b, p] = t(s.pinned),
        [m, O] = t(s.summary),
        [g, _] = t(!1),
        [w, v] = t(""),
        x = async () => {
          (_(!0), v(""));
          try {
            const y = await o_(i.fetchJSON, {
              ...s,
              displayName: String(c || "").trim(),
              collection: String(h || "").trim(),
              tags: TR(String(f || "")),
              pinned: !!b,
              summary: String(m || "").trim(),
            });
            (l(y, s.sessionId), a());
          } catch (y) {
            v(String(y));
          } finally {
            _(!1);
          }
        };
      return nt(
        e,
        "div",
        {
          className: "hti-organizer-backdrop",
          role: "presentation",
          onMouseDown: (y) => {
            y.target === y.currentTarget && !g && a();
          },
        },
        nt(
          e,
          "section",
          {
            className: "hti-organizer-dialog",
            role: "dialog",
            "aria-modal": !0,
            "aria-labelledby": "hti-organizer-title",
          },
          nt(
            e,
            "header",
            { className: "hti-organizer-header" },
            nt(
              e,
              "div",
              null,
              nt(e, "span", null, runtimeText("会话组织 / ORGANIZE SESSION", "ORGANIZE SESSION")),
              nt(e, "strong", { id: "hti-organizer-title" }, c || n),
            ),
            nt(
              e,
              "button",
              {
                type: "button",
                onClick: a,
                disabled: g,
                "aria-label": runtimeText("关闭 / Close", "Close"),
              },
              "×",
            ),
          ),
          nt(
            e,
            "div",
            { className: "hti-organizer-fields" },
            nt(
              e,
              "label",
              { htmlFor: "hti-organizer-display-name" },
              runtimeText("显示名称（左侧标题） / Display name", "Display name"),
            ),
            nt(e, "input", {
              id: "hti-organizer-display-name",
              value: c,
              maxLength: 120,
              placeholder: runtimeText(`留空则显示：${n}`, `Leave empty to display: ${n}`),
              onChange: (y) => u(y.target.value),
            }),
            nt(
              e,
              "label",
              { htmlFor: "hti-organizer-collection" },
              runtimeText("项目集合 / Collection", "Collection"),
            ),
            nt(e, "input", {
              id: "hti-organizer-collection",
              list: "hti-organizer-collection-options",
              value: h,
              maxLength: 80,
              placeholder: runtimeText("例如：Hermes Workbench", "For example: Hermes Workbench"),
              onChange: (y) => d(y.target.value),
            }),
            nt(
              e,
              "datalist",
              { id: "hti-organizer-collection-options" },
              ...o.map((y) => nt(e, "option", { key: y, value: y })),
            ),
            nt(e, "label", { htmlFor: "hti-organizer-tags" }, runtimeText("标签 / Tags", "Tags")),
            nt(e, "input", {
              id: "hti-organizer-tags",
              value: f,
              maxLength: 272,
              placeholder: runtimeText("插件, UI, 部署（最多 8 个）", "plugins, UI, deployment (up to 8)"),
              onChange: (y) => S(y.target.value),
            }),
            nt(
              e,
              "label",
              { htmlFor: "hti-organizer-summary" },
              runtimeText("会话摘要 / Summary", "Summary"),
            ),
            nt(e, "textarea", {
              id: "hti-organizer-summary",
              value: m,
              maxLength: 2e3,
              rows: 5,
              placeholder: runtimeText("记录关键结论、已完成事项和下一步。", "Record key conclusions, completed work and next steps."),
              onChange: (y) => O(y.target.value),
            }),
            nt(
              e,
              "label",
              { className: "hti-organizer-pin" },
              nt(e, "input", {
                type: "checkbox",
                checked: b,
                onChange: (y) => p(y.target.checked),
              }),
              nt(e, "span", null, runtimeText("固定到列表顶部 / Pin to top", "Pin to top")),
            ),
            w
              ? nt(
                  e,
                  "div",
                  { className: "hti-organizer-error", role: "alert" },
                  w,
                )
              : null,
          ),
          nt(
            e,
            "footer",
            { className: "hti-organizer-actions" },
            nt(
              e,
              "span",
              null,
              runtimeText("显示名称留空时恢复 Hermes 原始标题；全部留空并取消固定后清除组织信息。", "Leave the display name empty to restore the original Hermes title. Clear all fields and unpin to remove organization metadata."),
            ),
            nt(
              e,
              "div",
              null,
              nt(
                e,
                "button",
                { type: "button", onClick: a, disabled: g },
                runtimeText("取消 / Cancel", "Cancel"),
              ),
              nt(
                e,
                "button",
                {
                  type: "button",
                  className: "is-primary",
                  onClick: x,
                  disabled: g,
                },
                g ? runtimeText("保存中…", "Saving…") : runtimeText("保存 / Save", "Save"),
              ),
            ),
          ),
        ),
      );
    };
  }
  const a_ = { sessions: "hermes-workbench.sessions-collapsed" },
    vs = {
      hostSidebar: "hermes-workbench.host-sidebar-width",
      sessions: "hermes-workbench.session-sidebar-width",
    };
  function AR(i, e, t, r) {
    if (typeof window > "u") return e;
    try {
      const n = Number(window.localStorage.getItem(i));
      return Number.isFinite(n) && n > 0 ? bs(n, t, r) : e;
    } catch {
      return e;
    }
  }
  function td(i, e) {
    try {
      window.localStorage.setItem(i, String(e));
    } catch {}
  }
  function id(i) {
    return i ? "render" : "chat";
  }
  function RR(i) {
    if (typeof window > "u") return !1;
    try {
      return window.localStorage.getItem(i) === "true";
    } catch {
      return !1;
    }
  }
  function LR(i, e) {
    if (!(typeof window > "u"))
      try {
        window.localStorage.setItem(i, String(e));
      } catch {}
  }
  function Oe(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  async function MR(i, e, t, r, n = () => !0) {
    const s = await oC(e, t);
    if (!n()) return;
    if (s) r(s);
    else
      try {
        const a = await nC(i, e, t);
        if (!n()) return;
        r(a);
      } catch {}
    if (!n()) return;
    const o = await _m(i, e, t);
    n() && (r(o), await aC(e, t, o));
  }
  function DR(i) {
    const e = i.updated_at ?? i.last_active ?? i.created_at ?? i.timestamp,
      t = typeof e == "number" && e < 1e12 ? e * 1e3 : e,
      r = new Date(t ?? 0);
    return Number.isFinite(r.getTime()) && r.getTime() > 0
      ? r.toLocaleString(void 0, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  }
  function IR(i) {
    return i === "today"
      ? ge("今天", "Today")
      : i === "week"
        ? ge("近 7 天", "Previous 7 days")
        : i === "month"
          ? ge("近 30 天", "Previous 30 days")
          : ge("更早", "Older");
  }
  function NR({ React: i, value: e, onChange: t, items: r }) {
    return Oe(
      i,
      "div",
      { className: "hti-segmented", role: "tablist" },
      ...r.map((n) =>
        Oe(
          i,
          "button",
          {
            key: n.value,
            type: "button",
            role: "tab",
            "aria-selected": e === n.value,
            className: e === n.value ? "active" : "",
            onClick: () => t(n.value),
          },
          n.label,
        ),
      ),
    );
  }
  function BR(i) {
    const e = i.React,
      { useEffect: t, useMemo: r, useRef: n, useState: s } = i.hooks,
      { TranscriptTimeline: o } = Jb(i),
      a = Zp(i),
      l = ER(i);
    return function ({ profile: routeProfile } = {}) {
      const u = new URLSearchParams(window.location.search),
        h = u.get("session") || "",
        d = routeProfile || u.get("profile") || currentProfile() || "default",
        [f, S] = s(() => ({
          taskId: u.get("kanban_task") || "",
          board: u.get("kanban_board") || "",
        })),
        b = f.taskId,
        p = f.board,
        [m, O] = s(h.startsWith("cron_")),
        [g, _] = s(i_),
        [w, v] = s(h),
        x =
          !w && b
            ? runtimeText(`我从看板打开了任务 ${b}${p ? runtimeText(`（看板：${p}）`, ` (board: ${p})`) : ""}。请先读取这张卡的详情、评论和运行记录，再与我讨论下一步。在我明确确认前，不要派发或推进子任务；当我说“定稿/回写工单”时，将确认后的目标、范围、约束和验收标准改写进该任务正文，并用评论记录关键决策。`, `I opened task ${b}${p ? runtimeText(`（看板：${p}）`, ` (board: ${p})`) : ""} from the board. Read the card details, comments, and run history, then discuss next steps with me. Do not dispatch or advance subtasks until I explicitly confirm. When I ask to finalize or write back, update the task body with the agreed goals, scope, constraints, and acceptance criteria, and record key decisions in a comment.`)
            : "",
        y = n(h),
        [C, P] = s(() => h || `new-${Date.now()}`),
        [E, D] = s(h),
        A = n(""),
        R = n(0),
        [M, H] = s(0),
        [F, j] = s(0),
        [Q, k] = s(""),
        [N, B] = s([]),
        [T, Y] = s(0),
        [te, X] = s(!0),
        [q, $] = s([]),
        [Z, V] = s({}),
        [z, G] = s(""),
        [ae, Ce] = s(""),
        [Qe, Xe] = s(""),
        [be, We] = s(null),
        wt = n(null),
        [lt, Ue] = s(null),
        kt = id(h),
        [J, le] = s(kt),
        we = n(null),
        [Re, Ye] = s(!1),
        [ct, Dt] = s(null),
        [ot, Zt] = s(() => RR(a_.sessions)),
        [Ne, ut] = s(() => AR(vs.sessions, 208, 160, 480)),
        [br, Ni] = s(!1),
        [_r, bi] = s(!1),
        [vr, Tt] = s(!1),
        [xt, Ti] = s(!0),
        [Bi, Ct] = s(""),
        Et = n(null);
      ((y.current = w),
        t(() => {
          const ie = Et.current;
          if (!ie) return;
          let re = ie.parentElement;
          for (
            ;
            re?.parentElement &&
            !Array.from(re.parentElement.children).some(
              (Qt) => Qt.id === "app-sidebar",
            );

          )
            re = re.parentElement;
          if (!re?.parentElement) return;
          let me = ie;
          for (; me.parentElement && me.parentElement !== re; )
            me = me.parentElement;
          return (
            re.classList.add("hti-workbench-host-shell"),
            me.classList.add("hti-workbench-host-content"),
            () => {
              (re?.classList.remove("hti-workbench-host-shell"),
                me.classList.remove("hti-workbench-host-content"));
            }
          );
        }, []),
        t(() => {
          let ie = null;
          try {
            ie = window.localStorage.getItem(vs.hostSidebar);
          } catch {}
          const re = Number(ie);
          ie && Number.isFinite(re) && re > 0
            ? document.documentElement.style.setProperty(
                "--hti-host-sidebar-width",
                `${bs(re, 184, 420)}px`,
              )
            : document.documentElement.style.removeProperty(
                "--hti-host-sidebar-width",
              );
        }, []));
      const ce = (ie) => {
          const re = bs(ie, 184, 420);
          return (
            document.documentElement.style.setProperty(
              "--hti-host-sidebar-width",
              `${re}px`,
            ),
            re
          );
        },
        ve = (ie, re, me, ye, Qt, qi) => {
          if (
            ie.button !== 0 ||
            window.matchMedia("(max-width: 800px)").matches
          )
            return;
          ie.preventDefault();
          const Bd = Number(ie.clientX);
          let bn = bs(re, me, ye);
          const Fo = (Hn) => {
              ((bn = bs(re + Hn.clientX - Bd, me, ye)), Qt(bn));
            },
            As = () => {
              (document.removeEventListener("pointermove", Fo),
                document.removeEventListener("pointerup", As),
                document.documentElement.classList.remove("hti-is-resizing"),
                td(qi, bn));
            };
          (document.documentElement.classList.add("hti-is-resizing"),
            document.addEventListener("pointermove", Fo),
            document.addEventListener("pointerup", As, { once: !0 }));
        },
        vt = (ie) => {
          const re = document.getElementById("app-sidebar");
          re &&
            ve(
              ie,
              re.getBoundingClientRect().width,
              184,
              420,
              (me) => {
                ce(me);
              },
              vs.hostSidebar,
            );
        },
        Kt = (ie) => {
          ve(ie, Ne, 160, 480, ut, vs.sessions);
        },
        It = (ie, re) => {
          if (ie.key !== "ArrowLeft" && ie.key !== "ArrowRight") return;
          ie.preventDefault();
          const me = ie.key === "ArrowLeft" ? -16 : 16;
          if (re === "host") {
            const ye =
                document.getElementById("app-sidebar")?.getBoundingClientRect()
                  .width ?? 224,
              Qt = ce(ye + me);
            td(vs.hostSidebar, Qt);
          } else {
            const ye = bs(Ne + me, 160, 480);
            (ut(ye), td(vs.sessions, ye));
          }
        };
      t(() => {
        let ie = 0;
        const re = () => {
            ie = 0;
            const ye = Et.current;
            if (!ye) return;
            if (!window.matchMedia("(max-width: 800px)").matches) {
              ye.style.removeProperty("--hti-mobile-viewport-height");
              return;
            }
            const Qt = window.visualViewport,
              qi = hR(ye.getBoundingClientRect().top, {
                height: Qt?.height ?? window.innerHeight,
                offsetTop: Qt?.offsetTop ?? 0,
              });
            ye.style.setProperty("--hti-mobile-viewport-height", `${qi}px`);
          },
          me = () => {
            (ie && window.cancelAnimationFrame(ie),
              (ie = window.requestAnimationFrame(re)));
          };
        return (
          me(),
          window.addEventListener("resize", me),
          window.visualViewport?.addEventListener("resize", me),
          window.visualViewport?.addEventListener("scroll", me),
          () => {
            (ie && window.cancelAnimationFrame(ie),
              window.removeEventListener("resize", me),
              window.visualViewport?.removeEventListener("resize", me),
              window.visualViewport?.removeEventListener("scroll", me));
          }
        );
      }, []);
      const ht = (ie, re = !0, me = d) => {
          const ye = new URL(window.location.href);
          (ye.searchParams.set("profile", me),
            ie
              ? ye.searchParams.set("session", ie)
              : ye.searchParams.delete("session"),
            re ||
              (ye.searchParams.delete("kanban_task"),
              ye.searchParams.delete("kanban_board")),
            window.history.replaceState(null, "", ye));
        },
        Jt = () => {
          S({ taskId: "", board: "" });
        },
        zi = (ie) => {
          ((A.current = ""),
            (y.current = ie),
            v(ie),
            ht(ie),
            b &&
              W1(i.fetchJSON, {
                board: p,
                task_id: b,
                profile: d,
                session_id: ie,
              })
                .then((re) => {
                  y.current === ie &&
                    re.session_id !== ie &&
                    ((y.current = re.session_id),
                    v(re.session_id),
                    le("render"),
                    P(re.session_id),
                    D(re.session_id),
                    ht(re.session_id));
                })
                .catch((re) => {
                  y.current === ie &&
                    Ct(
                      runtimeText(`看板会话关联保存失败 / Could not save task link: ${String(re)}`, `Could not save task link: ${String(re)}`),
                    );
                }));
        };
      (t(() => {
        let ie = !0;
        return (
          bi(!0),
          Ct(""),
          Promise.all([
            Sm(i.fetchJSON, d),
            $R(i.fetchJSON, d).catch(
              (re) => (
                ie &&
                  Ct(
                    runtimeText(`会话组织信息不可用 / Organization unavailable: ${String(re)}`, `Organization unavailable: ${String(re)}`),
                  ),
                {}
              ),
            ),
          ])
            .then(([re, me]) => {
              if (!ie) return;
              (B(re.sessions), Y(re.total), X(re.complete), V(me));
              const ye = A.current;
              !y.current &&
                ye &&
                re.sessions.some((Qt) => Ci(Qt) === ye) &&
                zi(ye);
            })
            .catch((re) => ie && Ct(String(re)))
            .finally(() => ie && bi(!1)),
          () => {
            ie = !1;
          }
        );
      }, [d, M]),
        t(() => {
          const ie = Q.trim();
          if (!ie) {
            ($([]), Tt(!1));
            return;
          }
          let re = !0;
          Tt(!0);
          const me = window.setTimeout(() => {
            Jx(i.fetchJSON, d, ie)
              .then((ye) => re && $(ye))
              .catch((ye) => re && Ct(String(ye)))
              .finally(() => re && Tt(!1));
          }, 180);
          return () => {
            ((re = !1), window.clearTimeout(me));
          };
        }, [d, Q, M]));
      const Ei = r(() => yR(Z), [Z]),
        Ot = r(() => q.filter((ie) => ed(ie, "conversations")), [q]),
        se = r(() => new Set(Ot.map((ie) => Ci(ie))), [Ot]),
        _e = r(
          () => kR(N, Ot).filter((ie) => ed(ie, "conversations")),
          [N, Ot],
        ),
        Le = r(() => {
          const ie = new Map();
          for (const re of _e) ie.set(Ci(re), re);
          return ie;
        }, [_e]),
        gt = r(() => xR(_e, Z, Q, se), [_e, Z, Q, se]),
        Xi = r(() => QR(gt), [gt]),
        _i = pR(lt, d, w);
      (t(() => {
        if ((We(null), Ni(!1), !w)) return;
        let ie = !0;
        return (
          Ct(""),
          MR(
            i.fetchJSON,
            d,
            w,
            (re) => {
              if ((We(re), y.current === w)) {
                const me = wR(re.lineage) === "cron";
                (O(me), me && (le("render"), D(""), Ue(null)));
              }
            },
            () => ie,
          ).catch((re) => ie && Ct(Hc(re))),
          () => {
            ie = !1;
          }
        );
      }, [d, w, F]),
        t(() => {
          if (J !== "render" || !be) return;
          const ie = window.requestAnimationFrame(() => cR(wt.current));
          return () => window.cancelAnimationFrame(ie);
        }, [J, be]),
        t(() => {
          if (m) {
            (Ue(null), Ti(!1));
            return;
          }
          let ie = !0;
          return (
            Ue(null),
            Ti(!0),
            Ct(""),
            fR(i.fetchJSON, d, w)
              .then((re) => {
                ie && Ue(re);
              })
              .catch((re) => {
                ie && (Ue(null), D(""), Ct(Hc(re)));
              })
              .finally(() => ie && Ti(!1)),
            w &&
              eC(i.fetchJSON, d, w).catch((re) => {
                ie && (D(""), Ct(Hc(re)));
              }),
            () => {
              ie = !1;
            }
          );
        }, [d, w, m]));
      const yr = (ie) => {
          const re = id(ie);
          ((A.current = ""),
            (y.current = ie),
            v(ie),
            O(!1),
            le(re),
            P(ie),
            D(ie),
            Dt(null),
            Jt(),
            ht(ie, !1));
        },
        Nt = () => {
          const ie = mR(lt, d);
          ((A.current = ""),
            (R.current = 0),
            (y.current = ""),
            v(""),
            We(null),
            Ni(!1),
            Ue(ie),
            Ti(!ie),
            O(!1),
            _(i_()));
          const re = id("");
          (le(re),
            P(`new-${Date.now()}`),
            D(""),
            Dt(null),
            Jt(),
            ht("", !1, d));
        },
        Fn = (ie) => {
          const re = String(ie || "").trim();
          if (Fk(y.current, re)) {
            j((ye) => ye + 1);
            return;
          }
          const me = Hk(y.current, re, Le.has(re));
          if (me === "adopt") zi(re);
          else if (me === "probe") {
            A.current = re;
            const ye = Date.now();
            ye - R.current >= 2e3 && ((R.current = ye), H((Qt) => Qt + 1));
          }
        },
        Wr = (ie) => {
          const re = m || ie === "render" ? "render" : "chat";
          (le(re), re === "render" && j((me) => me + 1));
        },
        Zo = (ie, re) => {
          V((me) => {
            const ye = { ...me };
            return (ie ? (ye[re] = ie) : delete ye[re], ye);
          });
        },
        Xl = async (ie) => {
          const re = Z[ie] || Ju(d, ie);
          (Ce(ie), Ct(""));
          try {
            const me = await o_(i.fetchJSON, { ...re, pinned: !re.pinned });
            Zo(me, ie);
          } catch (me) {
            Ct(String(me));
          } finally {
            Ce("");
          }
        },
        jo = async (ie, re, me) => {
          (ie.preventDefault(), ie.stopPropagation());
          const ye = Ci(re),
            Qt = String(re.profile || d);
          (Xe(ye), Ct(""));
          try {
            await hC({
              fetchJSON: i.fetchJSON,
              profile: Qt,
              sessionId: ye,
              title: me,
              currentSessionId: y.current,
              view: "conversations",
              confirm: (qi) => window.confirm(qi),
              onCurrentDeleted: Nt,
              onRefresh: () => H((qi) => qi + 1),
              onError: Ct,
            });
          } finally {
            Xe("");
          }
        },
        qr = (ie) => {
          _((re) => {
            const me = new Set(re);
            return (me.has(ie) ? me.delete(ie) : me.add(ie), me);
          });
        },
        Wi = () => {
          const ie = !ot;
          (Zt(ie), LR(a_.sessions, ie));
        },
        Ts = ot
          ? runtimeText("展开会话栏 / Expand sessions sidebar", "Expand sessions sidebar")
          : runtimeText("折叠会话栏 / Collapse sessions sidebar", "Collapse sessions sidebar"),
        Es = (ie) => {
          const re = Ci(ie),
            me = Z[re] || Ju(d, re),
            ye = r_(ie, me);
          return Oe(
            e,
            "div",
            {
              key: re,
              className: `hti-session-row${re === w ? " active" : ""}${me.pinned ? " is-pinned" : ""}`,
              "data-session-id": re,
            },
            Oe(
              e,
              "button",
              {
                type: "button",
                className: "hti-session-open",
                "aria-current": re === w ? "page" : void 0,
                onClick: () => yr(re),
              },
              Oe(
                e,
                "span",
                { className: "hti-session-title-line" },
                Oe(e, "span", { className: "hti-session-title" }, ye),
                ie._lineage_root_id
                  ? Oe(
                      e,
                      "span",
                      {
                        className: "hti-lineage-chip",
                        title:
                          runtimeText("较早记录已合并到当前压缩续写链 / Earlier transcript is merged", "Earlier transcript is merged"),
                      },
                      ge("续写", "Continued"),
                    )
                  : null,
                ie.archived
                  ? Oe(
                      e,
                      "span",
                      {
                        className: "hti-archived-chip",
                        title: runtimeText("已归档会话 / Archived conversation", "Archived conversation"),
                      },
                      ge("归档", "Archived"),
                    )
                  : null,
              ),
              me.tags.length > 0
                ? Oe(
                    e,
                    "span",
                    { className: "hti-tag-list" },
                    ...me.tags.map((Qt) => Oe(e, "span", { key: Qt }, Qt)),
                  )
                : null,
              me.summary
                ? Oe(
                    e,
                    "span",
                    { className: "hti-session-summary" },
                    me.summary,
                  )
                : null,
              Oe(
                e,
                "span",
                { className: "hti-session-subtitle" },
                Oe(e, "code", null, re),
                Oe(e, "time", null, DR(ie)),
              ),
            ),
            Oe(
              e,
              "div",
              { className: "hti-session-row-actions" },
              Oe(
                e,
                "button",
                {
                  type: "button",
                  className: "hti-session-pin",
                  disabled: ae === re,
                  "aria-label": me.pinned
                    ? runtimeText("取消固定 / Unpin session", "Unpin session")
                    : runtimeText("固定会话 / Pin session", "Pin session"),
                  "aria-pressed": me.pinned,
                  title: me.pinned
                    ? runtimeText("取消固定 / Unpin session", "Unpin session")
                    : runtimeText("固定会话 / Pin session", "Pin session"),
                  onClick: () => Xl(re),
                },
                ae === re ? "…" : me.pinned ? "★" : "☆",
              ),
              Oe(
                e,
                "button",
                {
                  type: "button",
                  className: "hti-session-organize",
                  "aria-label": ge(`整理会话 ${ye}`, `Organize session ${ye}`),
                  title: ge(
                    "显示名称、集合、标签与摘要",
                    "Display name, collection, tags and summary",
                  ),
                  onClick: () => G(re),
                },
                "✎",
              ),
              xm("conversations")
                ? Oe(
                    e,
                    "button",
                    {
                      type: "button",
                      className: "hti-session-delete",
                      disabled: Qe === re,
                      "aria-label": ge(
                        `删除会话 ${ye}`,
                        `Delete session ${ye}`,
                      ),
                      "aria-busy": Qe === re,
                      title: ge("删除会话", "Delete session"),
                      onClick: (Qt) => {
                        jo(Qt, ie, ye);
                      },
                    },
                    Qe === re ? "…" : "🗑",
                  )
                : null,
            ),
          );
        },
        Wl = Oe(
          e,
          "aside",
          {
            id: "hti-session-sidebar",
            className: `hti-session-sidebar${ct === "sessions" ? " is-mobile-open" : ""}`,
            "aria-label": runtimeText("会话 / Sessions", "Sessions"),
          },
          Oe(
            e,
            "header",
            { className: "hti-pane-header hti-session-heading" },
            Oe(
              e,
              "div",
              { className: "hti-pane-title" },
              Oe(
                e,
                "button",
                {
                  type: "button",
                  className: "hti-header-new-session",
                  onClick: Nt,
                },
                ge("＋ 新会话", "＋ New chat"),
              ),
            ),
            Oe(
              e,
              "div",
              { className: "hti-pane-header-actions" },
              Oe(
                e,
                "button",
                {
                  type: "button",
                  className: "hti-pane-collapse",
                  onClick: Wi,
                  "aria-label": Ts,
                  "aria-controls": "hti-session-sidebar-body",
                  "aria-expanded": !ot,
                  title: Ts,
                },
                Oe(e, "span", { "aria-hidden": !0 }, ot ? "›" : "‹"),
              ),
              Oe(
                e,
                "button",
                {
                  type: "button",
                  className: "hti-drawer-close",
                  onClick: () => Dt(null),
                  "aria-label": runtimeText("关闭会话栏 / Close sessions sidebar", "Close sessions sidebar"),
                  title: runtimeText("关闭会话栏 / Close sessions sidebar", "Close sessions sidebar"),
                },
                "×",
              ),
            ),
          ),
          Oe(
            e,
            "div",
            {
              id: "hti-session-sidebar-body",
              className: "hti-session-sidebar-body",
            },
            Oe(
              e,
              "div",
              { className: "hti-session-controls" },
              Oe(
                e,
                "label",
                { className: "hti-visually-hidden", htmlFor: "hti-search" },
                runtimeText("搜索 / Search", "Search"),
              ),
              Oe(e, "input", {
                id: "hti-search",
                value: Q,
                placeholder: runtimeText("搜索会话 / Search sessions", "Search sessions"),
                onChange: (ie) => k(ie.target.value),
              }),
            ),
            Oe(
              e,
              "div",
              { className: "hti-session-meta" },
              _r || vr
                ? runtimeText("加载中… / Loading…", "Loading…")
                : Q.trim()
                  ? ge(`${gt.length} 个匹配对话`, `${gt.length} matches`)
                  : te
                    ? ge(`${T} 个对话`, `${T} conversations`)
                    : ge(
                        `${N.length}/${T} 个对话`,
                        `${N.length}/${T} conversations`,
                      ),
            ),
            Oe(
              e,
              "nav",
              { className: "hti-session-list" },
              gt.length === 0 && !_r && !vr
                ? Oe(
                    e,
                    "div",
                    { className: "hti-session-list-empty" },
                    ge("暂无对话", "No conversations"),
                  )
                : null,
              ...Xi.map((ie) => {
                const re = ie.collection,
                  me = !Q.trim() && !g.has(re),
                  ye = IR(ie.collection);
                return Oe(
                  e,
                  "section",
                  {
                    key: re,
                    className: "hti-session-group",
                    "data-time-group": ie.collection,
                  },
                  Oe(
                    e,
                    "button",
                    {
                      type: "button",
                      className: "hti-session-group-toggle",
                      "aria-expanded": !me,
                      onClick: () => qr(re),
                    },
                    Oe(
                      e,
                      "span",
                      {
                        className: "hti-session-group-chevron",
                        "aria-hidden": !0,
                      },
                      me ? "›" : "⌄",
                    ),
                    Oe(
                      e,
                      "span",
                      {
                        className: "hti-session-group-folder",
                        "aria-hidden": !0,
                      },
                      "▰",
                    ),
                    Oe(e, "span", { className: "hti-session-group-name" }, ye),
                    Oe(
                      e,
                      "span",
                      { className: "hti-session-group-count" },
                      String(ie.rows.length),
                    ),
                  ),
                  me
                    ? null
                    : Oe(
                        e,
                        "div",
                        { className: "hti-session-group-rows" },
                        ...ie.rows.map(Es),
                      ),
                );
              }),
            ),
          ),
        ),
        Zr = Oe(
          e,
          "section",
          { className: "hti-center-pane" },
          Oe(
            e,
            "header",
            { className: "hti-pane-header hti-chat-header" },
            Oe(
              e,
              "button",
              {
                type: "button",
                className: "hti-mobile-action is-left",
                onClick: () => Dt("sessions"),
                "aria-label": runtimeText("打开会话 / Open sessions", "Open sessions"),
                "aria-controls": "hti-session-sidebar",
                "aria-expanded": ct === "sessions",
                title: runtimeText("打开会话 / Open sessions", "Open sessions"),
              },
              "☰",
            ),
            Oe(
              e,
              "div",
              { className: "hti-active-session" },
              Oe(
                e,
                "strong",
                null,
                w ? r_(Le.get(w) || { id: w }, Z[w]) : runtimeText("新会话 / New chat", "New chat"),
              ),
              Oe(
                e,
                "span",
                null,
                _i
                  ? _i.path
                  : xt
                    ? ge("正在加载工作区…", "Loading workspace…")
                    : ge("工作区不可用", "Workspace unavailable"),
              ),
            ),
            Oe(e, NR, {
              React: e,
              value: J,
              onChange: Wr,
              items: m
                ? [{ value: "render", label: runtimeText("记录 / Transcript", "Transcript") }]
                : [
                    { value: "chat", label: runtimeText("聊天 / Chat", "Chat") },
                    { value: "render", label: runtimeText("记录 / Transcript", "Transcript") },
                  ],
            }),
            Oe(
              e,
              "button",
              {
                type: "button",
                className: "hti-chat-upload",
                disabled: !_i || Re,
                "aria-label": Re
                  ? ge("文件上传中", "Uploading file")
                  : ge("上传图片或文件", "Upload image or file"),
                "aria-busy": Re,
                title: Re
                  ? ge("上传中…", "Uploading…")
                  : ge("上传图片或文件", "Upload image or file"),
                onClick: () => we.current?.click(),
              },
              Re ? "…" : "📎",
            ),
          ),
          Bi
            ? Oe(e, "div", { className: "hti-page-error", role: "alert" }, Bi)
            : null,
          _i && !m
            ? Oe(e, a, {
                mode: "chat",
                profile: d,
                instanceId: C,
                resumeSessionId: E,
                initialInput: x,
                onSessionActivity: Fn,
                workspaceId: _i.id,
                workspacePath: _i.path,
                attachmentInputRef: we,
                onAttachmentUploadState: Ye,
                visible: J === "chat",
              })
            : J === "chat"
              ? Oe(
                  e,
                  "div",
                  { className: "hti-panel-empty" },
                  Oe(
                    e,
                    "strong",
                    null,
                    xt
                      ? runtimeText("正在加载… / Loading…", "Loading…")
                      : runtimeText("工作区不可用 / Workspace unavailable", "Workspace unavailable"),
                  ),
                  Oe(
                    e,
                    "span",
                    null,
                    xt
                      ? ge(
                          "正在准备当前 Profile 的工作区。",
                          "Preparing this profile workspace.",
                        )
                      : ge(
                          "请刷新页面；若仍失败，请检查 Workbench sidecar。",
                          "Reload the page; if this persists, check the Workbench sidecar.",
                        ),
                  ),
                )
              : null,
          J === "render"
            ? w
              ? be
                ? Oe(
                    e,
                    "div",
                    { className: "hti-transcript-pane", ref: wt },
                    Oe(
                      e,
                      "div",
                      { className: "hti-transcript-toolbar" },
                      Oe(
                        e,
                        "div",
                        { className: "hti-lineage" },
                        Oe(e, "span", null, runtimeText("压缩链 / Compression lineage", "Compression lineage")),
                        Oe(
                          e,
                          "code",
                          null,
                          be.lineage.map((ie) => ie.id).join(" → "),
                        ),
                      ),
                      Oe(
                        e,
                        "button",
                        { type: "button", onClick: () => Ni((ie) => !ie) },
                        br ? runtimeText("隐藏原始记录 / Hide raw", "Hide raw") : runtimeText("原始记录 / Raw", "Raw"),
                      ),
                    ),
                    Oe(e, o, {
                      key: `${d}:${w}`,
                      turns: be.turns,
                      rawOpen: br,
                    }),
                  )
                : Oe(
                    e,
                    "div",
                    { className: "hti-panel-empty" },
                    Oe(
                      e,
                      "strong",
                      null,
                      runtimeText("正在合并记录… / Loading transcript…", "Loading transcript…"),
                    ),
                    Oe(
                      e,
                      "span",
                      null,
                      runtimeText("正在读取 compression lineage。 / Reading compression lineage.", "Reading compression lineage."),
                    ),
                  )
              : Oe(
                  e,
                  "div",
                  { className: "hti-panel-empty" },
                  Oe(
                    e,
                    "strong",
                    null,
                    ge("新会话尚无记录", "No transcript yet"),
                  ),
                  Oe(
                    e,
                    "span",
                    null,
                    ge(
                      "先在聊天视图发送消息。",
                      "Send a message in Chat first.",
                    ),
                  ),
                )
            : null,
        ),
        wr = z ? Le.get(z) : null,
        ql = z
          ? Oe(e, l, {
              key: z,
              nativeSessionTitle: Ku(wr || { id: z }),
              value: Z[z] || Ju(d, z),
              collections: Ei,
              onClose: () => G(""),
              onSaved: Zo,
            })
          : null;
      return Oe(
        e,
        "main",
        {
          ref: Et,
          className: "hti-root hti-workbench",
          style: { "--hti-session-column-expanded": `${Ne}px` },
          "data-component": "HermesWorkbench",
          "data-session-layout": "compact",
          "data-left-collapsed": String(ot),
        },
        Oe(e, "div", {
          className: "hti-host-sidebar-resizer",
          role: "separator",
          tabIndex: 0,
          "aria-label": ge("调整左侧导航栏宽度", "Resize navigation sidebar"),
          "aria-orientation": "vertical",
          onPointerDown: vt,
          onKeyDown: (ie) => It(ie, "host"),
        }),
        Wl,
        Oe(e, "div", {
          className: "hti-session-sidebar-resizer",
          role: "separator",
          tabIndex: 0,
          "aria-label": ge("调整会话栏宽度", "Resize sessions sidebar"),
          "aria-orientation": "vertical",
          onPointerDown: Kt,
          onKeyDown: (ie) => It(ie, "sessions"),
        }),
        Zr,
        ql,
        ct
          ? Oe(e, "button", {
              type: "button",
              className: "hti-drawer-backdrop",
              onClick: () => Dt(null),
              "aria-label": runtimeText("关闭抽屉 / Close drawer", "Close drawer"),
            })
          : null,
      );
    };
  }
  function l_(i) {
    return (
      String(i.source ?? "")
        .trim()
        .toLocaleLowerCase() === "codex"
    );
  }
  function c_(i) {
    return !!Ci(i) && !l_(i);
  }
  function zR(i) {
    const e = Ci(i).trim();
    return !e || !c_(i)
      ? null
      : {
          id: e,
          title: Ku(i),
          updatedAt: XR(i),
          source: String(i.source ?? ""),
          raw: i,
        };
  }
  function Mo(i) {
    const e =
      i.last_active ??
      i.updated_at ??
      i.last_activity_at ??
      i.created_at ??
      i.started_at;
    if (typeof e == "number") return e < 1e12 ? e * 1e3 : e;
    const t = Number(e);
    if (Number.isFinite(t) && t > 0) return t < 1e12 ? t * 1e3 : t;
    const r = Date.parse(String(e ?? ""));
    return Number.isFinite(r) ? r : 0;
  }
  function XR(i) {
    const e = Mo(i);
    if (e > 0) return new Date(e).toLocaleString();
    const t =
      i.updated_at ??
      i.last_active ??
      i.last_activity_at ??
      i.created_at ??
      i.started_at;
    return typeof t == "string" ? t : "";
  }
  function WR(i, e) {
    const t = i._lineage_root_id ?? i.lineage_root_id;
    if (t) return String(t);
    let r = i;
    const n = new Set();
    for (;;) {
      const s = Ci(r);
      if (!s || n.has(s)) return s || Ci(i);
      n.add(s);
      const o = String(r.parent_session_id ?? ""),
        a = o ? e.get(o) : void 0;
      if (!a || !Wc(r, a)) return s;
      r = a;
    }
  }
  function qR(i) {
    const e = new Map();
    for (const r of i) {
      const n = Ci(r);
      n && e.set(n, r);
    }
    const t = new Map();
    return (
      i.forEach((r, n) => {
        if (!c_(r)) return;
        const s = WR(r, e);
        if (!s) return;
        const o = t.get(s);
        (!o || Mo(r) > Mo(o.row) || (Mo(r) === Mo(o.row) && n < o.index)) &&
          t.set(s, { row: r, index: n });
      }),
      [...t.values()].sort((r, n) => r.index - n.index).map((r) => r.row)
    );
  }
  function ZR(i) {
    const e = qR(i),
      t = new Set(),
      r = [];
    for (const n of e) {
      const s = zR(n);
      !s || t.has(s.id) || (t.add(s.id), r.push(s));
    }
    return r;
  }
  async function jR(i, e) {
    const t = await Sm(i, e),
      r = ZR(t.sessions);
    return {
      sessions: r,
      total: r.length,
      complete: t.complete,
      listedTotal: t.total,
    };
  }
  function FR(i) {
    if (i.lineage.some(l_))
      throw new Error(
        runtimeText("该记录属于 Codex 投影，已从 Hermes 历史中隐藏；请在 Codex 会话中打开。", "This record is a Codex projection hidden from Hermes history. Open it in Codex sessions."),
      );
    return i;
  }
  async function h_(i, e, t) {
    const r = await _m(i, e, t);
    return FR(r);
  }
  function u_(i) {
    const e = i.React,
      { TranscriptTimeline: t } = Jb(i);
    function r({ transcript: n }) {
      return e.createElement(
        "div",
        {
          className: "codex-hermes-history-transcript",
          "data-testid": "hermes-history-transcript",
          "data-session-id": n.sessionId,
        },
        e.createElement(t, { turns: n.turns, rawOpen: !1 }),
      );
    }
    return { HermesHistoryTimeline: r };
  }
  const EL = {
      imageLoading: runtimeText("图片加载中… / Loading image…", "Loading image…"),
      imageError: runtimeText("图片加载失败 / Unable to load image", "Unable to load image"),
      openOriginal: runtimeText("打开原图 / Open original", "Open original"),
      loading: runtimeText("加载中… / Loading…", "Loading…"),
      discardUnsaved:
        runtimeText("当前文件尚未保存，仍要切换吗？ / Discard unsaved changes?", "Discard unsaved changes?"),
      saving: runtimeText("保存中… / Saving…", "Saving…"),
      saved: runtimeText("已保存 / Saved", "Saved"),
      unbound: runtimeText("未绑定工作区 / No workspace", "No workspace"),
      bind: runtimeText("每个会话需要绑定一个工作区。 / Bind one workspace to this session.", "Bind one workspace to this session."),
      source: runtimeText("源码 / Source", "Source"),
      preview: runtimeText("预览 / Preview", "Preview"),
      save: runtimeText("保存 / Save", "Save"),
      close: runtimeText("关闭 / Close", "Close"),
      selectFile: runtimeText("选择文件 / Select a file", "Select a file"),
      openFromTree: runtimeText("从左侧文件树打开文件。 / Open a file from the tree.", "Open a file from the tree."),
    };
  function pe(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function bd(i, e, t = !1) {
    const r = e.type === "directory";
    return pe(
      i,
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 24,
        height: 24,
        fill: r ? "#3996ff" : "none",
        stroke: r ? "#2583ee" : "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": !0,
      },
      pe(i, "path", {
        d: r
          ? "M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
          : "M5 3h9l5 5v13H5zM14 3v6h5M9 13h6M9 17h4",
      }),
      r && t
        ? pe(i, "path", {
            d: "m4 12 16-1-2 8H5z",
            fill: "#62b0ff",
            stroke: "#3996ff",
          })
        : null,
    );
  }
  function RL(i) {
    const e = i.React,
      { useEffect: t, useRef: r } = i.hooks;
    return function ({ path: s, value: o, onChange: a }) {
      const l = r(null),
        c = r(a);
      return (
        (c.current = a),
        t(() => {
          if (!l.current) return;
          const u = new Te({
            doc: o,
            parent: l.current,
            extensions: [
              aS(),
              iS(),
              cS(),
              Su(mS, { fallback: !0 }),
              ...AL(s),
              Te.lineWrapping,
              Te.updateListener.of((h) => {
                h.docChanged && c.current(h.state.doc.toString());
              }),
              Te.theme({
                "&": { height: "100%", backgroundColor: "transparent" },
                ".cm-scroller": {
                  overflow: "auto",
                  fontFamily: "var(--theme-font-mono, ui-monospace, monospace)",
                },
                ".cm-content": { minHeight: "100%", padding: "12px 4px" },
                ".cm-gutters": {
                  backgroundColor: "transparent",
                  border: "none",
                },
                "&.cm-focused": { outline: "none" },
              }),
            ],
          });
          return () => u.destroy();
        }, []),
        pe(e, "div", { ref: l, className: "hti-codemirror" })
      );
    };
  }
  function LL(i, e = {}) {
    const t = i.React,
      { useCallback: r, useEffect: n, useRef: s, useState: o } = i.hooks,
      a = RL(i),
      l = { ...EL, ...e };
    function c({ path: h, assetUrl: d, modal: f = !1 }) {
      const [S, b] = o("loading"),
        p = d(h),
        m = h.split("/").filter(Boolean).at(-1) || h,
        O = f ? "hti-codex-file-modal-image-preview" : "hti-image-preview",
        g = f ? "hti-codex-file-modal-image" : "hti-image-preview-image",
        _ = f
          ? "hti-codex-file-modal-open-original"
          : "hti-image-open-original";
      return pe(
        t,
        "div",
        { className: `${O} is-${S}`, "aria-busy": S === "loading" },
        S === "loading"
          ? pe(
              t,
              "div",
              { className: "hti-image-preview-status", role: "status" },
              l.imageLoading,
            )
          : null,
        S === "error"
          ? pe(
              t,
              "div",
              { className: "hti-image-preview-error", role: "alert" },
              l.imageError,
            )
          : null,
        pe(t, "img", {
          className: g,
          src: p,
          alt: m,
          hidden: S === "error",
          onLoad: () => b("loaded"),
          onError: () => b("error"),
        }),
        pe(
          t,
          "a",
          { className: _, href: p, target: "_blank", rel: "noreferrer" },
          l.openOriginal,
        ),
      );
    }
    function u({ entry: h, workspaceId: d, fetchJSON: f, copy: S, onOpen: b }) {
      const [p, m] = o(!1),
        [O, g] = o([]),
        [_, w] = o(!1),
        [v, x] = o("");
      return pe(
        t,
        "li",
        { className: "hti-tree-branch" },
        pe(
          t,
          "button",
          {
            type: "button",
            className: "hti-tree-row is-directory",
            onClick: async () => {
              if (p) {
                m(!1);
                return;
              }
              if ((m(!0), !(O.length > 0))) {
                (w(!0), x(""));
                try {
                  g(await t_(f, h.path));
                } catch (C) {
                  x(String(C));
                } finally {
                  w(!1);
                }
              }
            },
            "aria-expanded": p,
            title: h.path,
          },
          pe(
            t,
            "span",
            { className: "hti-file-icon", "aria-hidden": !0 },
            bd(t, h, p),
          ),
          pe(t, "span", null, h.name),
        ),
        p
          ? pe(
              t,
              "ul",
              { className: "hti-tree-children" },
              _
                ? pe(t, "li", { className: "hti-tree-loading" }, S.loading)
                : null,
              v
                ? pe(t, "li", { className: "hti-tree-error", role: "alert" }, v)
                : null,
              ...O.map((C) =>
                C.type === "directory"
                  ? pe(t, u, {
                      key: workspaceEntryKey(C),
                      entry: C,
                      workspaceId: d,
                      fetchJSON: f,
                      copy: S,
                      onOpen: b,
                    })
                  : pe(
                      t,
                      "li",
                      { key: workspaceEntryKey(C) },
                      pe(
                        t,
                        "button",
                        {
                          type: "button",
                          className: "hti-tree-row",
                          onClick: (P) => b(C, P.currentTarget),
                          title: C.path,
                        },
                        pe(
                          t,
                          "span",
                          { className: "hti-file-icon", "aria-hidden": !0 },
                          bd(t, C),
                        ),
                        pe(t, "span", null, C.name),
                      ),
                    ),
              ),
            )
          : null,
      );
    }
    return function ({
      workspace: d,
      fetchJSON: f = i.fetchJSON,
      assetUrl: S = bR,
      presentation: b = "inline",
    }) {
      const [p, m] = o([]),
        [O, g] = o(""),
        [_, w] = o(""),
        [v, x] = o(""),
        [y, C] = o(""),
        [P, E] = o("edit"),
        [D, A] = o(!1),
        [R, M] = o(""),
        [H, F] = o(""),
        j = s(0),
        Q = s(null),
        k = s(null);
      (n(() => {
        if (
          ((j.current += 1),
          m([]),
          g(""),
          w(""),
          x(""),
          C(""),
          E("edit"),
          F(""),
          !d)
        )
          return;
        let Z = !0;
        return (
          A(!0),
          t_(f, "")
            .then((V) => Z && m(V))
            .catch((V) => Z && M(String(V)))
            .finally(() => Z && A(!1)),
          () => {
            ((Z = !1), (j.current += 1));
          }
        );
      }, [f, d?.id]),
        n(() => {
          const Z = Q.current;
          if (Z) {
            if (b !== "modal" || !O) {
              Z.open && Z.close();
              return;
            }
            Z.open || Z.showModal();
          }
        }, [b, O]),
        n(
          () => () => {
            const Z = Q.current;
            Z?.open && Z.close();
          },
          [],
        ));
      const N = r(
          async (Z, V) => {
            if (!d || (_ !== v && !window.confirm(l.discardUnsaved))) return;
            V && (k.current = V);
            const z = ++j.current;
            if ((g(Z.path), M(""), F(""), Gu(Z.path))) {
              (A(!1), w(""), x(""), C(""), E("image"));
              return;
            }
            (E(Lo(Z.path) ? "preview" : "edit"), A(!0));
            try {
              const G = await gR(f, Z.path);
              if (j.current !== z) return;
              (w(G.content),
                x(G.content),
                C(G.version),
                E(Lo(Z.path) ? "preview" : "edit"));
            } catch (G) {
              if (j.current !== z) return;
              if (/415|binary|UTF-8/i.test(String(G))) {
                try {
                  const file = await readManagedFile(workspaceAbsolutePath(d.path, Z.path));
                  if (j.current !== z) return;
                  g("");
                  await openFilePreview(file.name, file.blob, file.mime);
                  return;
                } catch (error) { G = error; }
              }
              const ae = String(G);
              (F(ae), M(ae));
            } finally {
              j.current === z && A(!1);
            }
          },
          [_, f, v, d?.id],
        ),
        B = r(async () => {
          if (!d || !O || _ === v) return;
          const Z = j.current;
          M(l.saving);
          try {
            const V = await SR(f, O, _, y);
            if (j.current !== Z) return;
            (x(_), C(V.version), M(l.saved));
          } catch (V) {
            if (j.current !== Z) return;
            M(String(V));
          }
        }, [_, f, v, O, y, d?.id]),
        T = r(() => {
          if (_ !== v && !window.confirm(l.discardUnsaved)) return;
          j.current += 1;
          const Z = Q.current;
          (Z?.open && Z.close(),
            g(""),
            w(""),
            x(""),
            C(""),
            E("edit"),
            A(!1),
            M(""),
            F(""));
          const V = k.current;
          V &&
            (V.focus(),
            window.setTimeout(() => {
              V.isConnected && V.focus();
            }, 0));
        }, [_, v]);
      n(() => {
        if (_ === v) return;
        const Z = (V) => {
          (V.preventDefault(), (V.returnValue = ""));
        };
        return (
          window.addEventListener("beforeunload", Z),
          () => window.removeEventListener("beforeunload", Z)
        );
      }, [_, v]);
      const Y = (Z) => {
          (Z.metaKey || Z.ctrlKey) &&
            Z.key.toLowerCase() === "s" &&
            (Z.preventDefault(), B());
        },
        te = (Z) =>
          pe(
            t,
            "header",
            { className: "hti-codex-file-modal-header" },
            pe(
              t,
              "div",
              { className: "hti-codex-file-modal-path", title: O },
              pe(
                t,
                "strong",
                { id: "hti-codex-file-modal-title" },
                O.split("/").at(-1),
              ),
              pe(t, "span", null, O),
            ),
            pe(
              t,
              "div",
              { className: "hti-codex-file-modal-actions" },
              pe(t, "button", {
                type: "button", className: "hti-workspace-download",
                onClick: async () => {
                  M(runtimeText("正在下载…", "Downloading…"));
                  try { await downloadWorkspaceFile(d.path, O); M(runtimeText("已开始下载", "Download started")); }
                  catch (error) { M(runtimeText(`下载失败：${String(error)}`, `Download failed: ${String(error)}`)); }
                },
              }, runtimeText("下载文件", "Download file")),
              pe(t, "button", {
                type: "button", className: "hti-workspace-copy-path",
                onClick: async () => {
                  try { await navigator.clipboard.writeText(workspaceAbsolutePath(d.path, O)); M(runtimeText("路径已复制", "Path copied")); }
                  catch (error) { M(runtimeText(`复制失败：${String(error)}`, `Copy failed: ${String(error)}`)); }
                },
              }, runtimeText("复制路径", "Copy path")),
              Lo(O)
                ? pe(
                    t,
                    "div",
                    { className: "hti-codex-file-modal-tabs", role: "tablist" },
                    pe(
                      t,
                      "button",
                      {
                        type: "button",
                        className: P === "edit" ? "active" : "",
                        onClick: () => E("edit"),
                        "aria-selected": P === "edit",
                        role: "tab",
                      },
                      l.source,
                    ),
                    pe(
                      t,
                      "button",
                      {
                        type: "button",
                        className: P === "preview" ? "active" : "",
                        onClick: () => E("preview"),
                        "aria-selected": P === "preview",
                        role: "tab",
                      },
                      l.preview,
                    ),
                  )
                : null,
              Gu(O)
                ? null
                : pe(
                    t,
                    "button",
                    {
                      type: "button",
                      className: "hti-codex-file-modal-save",
                      disabled: _ === v,
                      onClick: B,
                    },
                    _ === v ? l.saved : l.save,
                  ),
              pe(
                t,
                "button",
                {
                  type: "button",
                  className: "hti-codex-file-modal-close",
                  onClick: T,
                  "aria-label": l.close,
                },
                l.close,
              ),
            ),
          ),
        X = (Z) => {
          if (D)
            return pe(
              t,
              "div",
              {
                className: "hti-codex-file-modal-loading",
                role: "status",
                "aria-busy": !0,
              },
              l.loading,
            );
          if (H)
            return pe(
              t,
              "div",
              { className: "hti-codex-file-modal-error", role: "alert" },
              H,
            );
          if (P === "image")
            return pe(t, c, { key: O, path: O, assetUrl: S, modal: Z });
          if (P === "preview")
            return pe(
              t,
              "article",
              { className: "hti-codex-file-modal-markdown hti-rich-text" },
              pe(t, Ki, { React: t, content: _ }),
            );
          const V = pe(t, a, { key: O, path: O, value: _, onChange: w });
          return Z
            ? pe(t, "div", { className: "hti-codex-file-modal-editor" }, V)
            : V;
        },
        q = (Z) =>
          R && !(Z && H)
            ? pe(
                t,
                "div",
                { className: "hti-codex-file-modal-message", role: "status" },
                R,
              )
            : null;
      n(() => d && b === "modal" ? installChatFileLinks(d.path, (path, anchor) => { void N({ path, name: path.split("/").at(-1), type: "file" }, anchor); }) : undefined, [d?.path, b, N]);
      if (!d)
        return pe(
          t,
          "div",
          { className: "hti-panel-empty" },
          pe(t, "strong", null, l.unbound),
          pe(t, "span", null, l.bind),
        );
      const { common, other } = groupWorkspaceEntries(p, d.path);
      const renderRootEntry = (Z) => Z.type === "directory"
                ? pe(t, u, {
                    key: workspaceEntryKey(Z),
                    entry: Z,
                    workspaceId: d.id,
                    fetchJSON: f,
                    copy: l,
                    onOpen: N,
                  })
                : pe(
                    t,
                    "li",
                    { key: workspaceEntryKey(Z) },
                    pe(
                      t,
                      "button",
                      {
                        type: "button",
                        className: `hti-tree-row${Z.path === O ? " is-active" : ""}`,
                        onClick: (V) => N(Z, V.currentTarget),
                        title: Z.path,
                      },
                      pe(
                        t,
                        "span",
                        { className: "hti-file-icon", "aria-hidden": !0 },
                        bd(t, Z),
                      ),
                      pe(t, "span", null, Z.name),
                    ),
                  );
      const $ =
        b === "modal"
          ? pe(
              t,
              "dialog",
              {
                ref: Q,
                className: "hti-codex-file-modal",
                "aria-labelledby": "hti-codex-file-modal-title",
                onCancel: (Z) => {
                  (Z.preventDefault(), T());
                },
              },
              O ? te() : null,
              O ? q(!0) : null,
              O
                ? pe(
                    t,
                    "div",
                    { className: "hti-codex-file-modal-content" },
                    X(!0),
                  )
                : null,
            )
          : null;
      return pe(
        t,
        "div",
        {
          className: `hti-workspace-panel${b === "modal" ? " is-modal" : ""}`,
          onKeyDown: Y,
        },
        pe(
          t,
          "aside",
          { className: "hti-file-tree" },
          pe(
            t,
            "div",
            { className: "hti-file-tree-heading", title: d.path },
            pe(t, "strong", null, runtimeText(`工作区 / ${d.name}`, `Workspace / ${d.name}`)),
            pe(t, "span", null, d.path),
          ),
          pe(
            t,
            "ul",
            { className: "hti-tree-root" },
            D && p.length === 0
              ? pe(t, "li", { className: "hti-tree-loading" }, l.loading)
              : null,
            ...common.map(renderRootEntry),
            other.length ? pe(t, "li", { key: "other-entries", className: "hti-tree-other" },
              pe(t, "details", null,
                pe(t, "summary", null, runtimeText(`其他目录与文件（${other.length}）`, `Other directories and files (${other.length})`)),
                pe(t, "ul", { className: "hti-tree-children" }, ...other.map(renderRootEntry)),
              ),
            ) : null,
          ),
        ),
        b === "modal"
          ? $
          : pe(
              t,
              "section",
              { className: "hti-editor-pane" },
              O
                ? pe(
                    t,
                    t.Fragment,
                    null,
                    pe(
                      t,
                      "header",
                      { className: "hti-editor-header" },
                      pe(
                        t,
                        "div",
                        { className: "hti-editor-path", title: O },
                        pe(t, "strong", null, O.split("/").at(-1)),
                        pe(t, "span", null, O),
                      ),
                      pe(
                        t,
                        "div",
                        { className: "hti-editor-actions" },
              pe(t, "button", {
                type: "button", className: "hti-workspace-download",
                onClick: async () => {
                  M(runtimeText("正在下载…", "Downloading…"));
                  try { await downloadWorkspaceFile(d.path, O); M(runtimeText("已开始下载", "Download started")); }
                  catch (error) { M(runtimeText(`下载失败：${String(error)}`, `Download failed: ${String(error)}`)); }
                },
              }, runtimeText("下载文件", "Download file")),
              pe(t, "button", {
                type: "button", className: "hti-workspace-copy-path",
                onClick: async () => {
                  try { await navigator.clipboard.writeText(workspaceAbsolutePath(d.path, O)); M(runtimeText("路径已复制", "Path copied")); }
                  catch (error) { M(runtimeText(`复制失败：${String(error)}`, `Copy failed: ${String(error)}`)); }
                },
              }, runtimeText("复制路径", "Copy path")),
                        Lo(O)
                          ? pe(
                              t,
                              "div",
                              { className: "hti-segmented" },
                              pe(
                                t,
                                "button",
                                {
                                  type: "button",
                                  className: P === "edit" ? "active" : "",
                                  onClick: () => E("edit"),
                                },
                                l.source,
                              ),
                              pe(
                                t,
                                "button",
                                {
                                  type: "button",
                                  className: P === "preview" ? "active" : "",
                                  onClick: () => E("preview"),
                                },
                                l.preview,
                              ),
                            )
                          : null,
                        Gu(O)
                          ? null
                          : pe(
                              t,
                              "button",
                              {
                                type: "button",
                                className: "hti-save-button",
                                disabled: _ === v,
                                onClick: B,
                              },
                              _ === v ? l.saved : l.save,
                            ),
                      ),
                    ),
                    R
                      ? pe(
                          t,
                          "div",
                          { className: "hti-editor-message", role: "status" },
                          R,
                        )
                      : null,
                    P === "image"
                      ? pe(t, c, { key: O, path: O, assetUrl: S })
                      : P === "preview"
                        ? pe(
                            t,
                            "article",
                            { className: "hti-markdown-preview hti-rich-text" },
                            pe(t, Ki, { React: t, content: _ }),
                          )
                        : pe(t, a, { key: O, path: O, value: _, onChange: w }),
                  )
                : pe(
                    t,
                    "div",
                    { className: "hti-panel-empty" },
                    pe(t, "strong", null, l.selectFile),
                    pe(t, "span", null, l.openFromTree),
                  ),
            ),
      );
    };
  }
  const Lt = "/api/plugins/workbench/codex";
  // PURPOSE: Keep a compact per-session snapshot so Tab/session switches paint
  // immediately while the authoritative Codex snapshot refreshes in background.
  const codexSnapshotCache = new Map();
  const CODEX_SNAPSHOT_CACHE_LIMIT = 3;
  function compactCodexSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return snapshot;
    const messages = Array.isArray(snapshot.messages)
      ? snapshot.messages.slice(-48).map((message) => {
          if (!message || typeof message !== "object") return message;
          const compact = { ...message };
          const kind = String(compact.type ?? compact.role ?? "").toLowerCase();
          if (kind.includes("tool") || kind.includes("command") || kind === "reasoning") {
            delete compact.result;
            delete compact.output;
            delete compact.aggregatedOutput;
            if (typeof compact.content === "string" && compact.content.length > 4096) {
              compact.content = `${compact.content.slice(0, 4096)}…`;
            }
          }
          return compact;
        })
      : [];
    return { ...snapshot, messages };
  }
  function rememberCodexSnapshot(key, snapshot) {
    if (!key) return;
    codexSnapshotCache.delete(key);
    codexSnapshotCache.set(key, compactCodexSnapshot(snapshot));
    while (codexSnapshotCache.size > CODEX_SNAPSHOT_CACHE_LIMIT) {
      codexSnapshotCache.delete(codexSnapshotCache.keys().next().value);
    }
  }
  function tt(i) {
    return encodeURIComponent(i);
  }
  async function wd(i, e, t) {
    const r = await i(
      `${Lt}/session?profile=${tt(e)}&session_id=${tt(t)}&after=0&limit=200&defer_persistence=true`,
    );
    if (!Array.isArray(r.turns)) throw new Error(runtimeText("服务端未返回完整会话快照", "The server returned an incomplete session snapshot"));
    return s0(r, t);
  }
  async function previewCodexSession(i, e, t) {
    const r = await i(
      `${Lt}/session/preview?profile=${tt(e)}&session_id=${tt(t)}&turns=8`,
    );
    if (r.cached === false) return null;
    if (!Array.isArray(r.turns)) throw new Error(runtimeText("服务端未返回会话预览", "The server returned no session preview"));
    return s0(r, t);
  }
  function s0(i, e) {
    const t = mt(i),
      r = Array.isArray(t.turns) ? t.turns : [];
    let n = GL(r, e);
    const s = Array.isArray(t.snapshotEvents) ? t.snapshotEvents : [];
    for (const l of s) {
      const c = mt(l);
      n = c0(n, { ...c, type: "event" });
    }
    n = n.map((l) =>
      l.status === "running" ? { ...l, suppressDeltas: !0 } : l,
    );
    for (const l of Array.isArray(t.pendingRequests) ? t.pendingRequests : []) {
      const c = mt(l);
      let u = mt(c.payload);
      if (typeof c.payload == "string")
        try {
          u = mt(JSON.parse(c.payload));
        } catch {
          u = {};
        }
      const h = Ae(c.client_request_id);
      h &&
        !n.some((d) => sameMessage(d, { id: h })) &&
        (n = insertRequest(n, {
          id: h,
          role: "user",
          content: Wn(u.input) || runtimeText("待确认的消息", "Message awaiting confirmation"),
          status: c.status === "failed" ? "failed" : "pending",
          submissionError: runtimeErrorText(c.result),
          turnStartedAt: El(c.updated_at),
          observedAt: El(c.updated_at),
        }));
    }
    const o = Ll(t.session),
      a = r
        .map(mt)
        .reverse()
        .find((l) => l.status === "inProgress");
    return {
      messages: n,
      next: Number(t.snapshotSeq ?? t.next ?? 0),
      readSeq: Number(t.readSeq ?? o?.readSeq ?? 0),
      lastCompletedSeq: o?.lastCompletedSeq || 0,
      session: o,
      turnId: o?.status === "running" ? Ae(a?.id) : "",
      pendingApprovals: Array.isArray(t.pendingApprovals)
        ? t.pendingApprovals.map(mt)
        : [],
    };
  }
  function ws(i) {
    return visibleChatText(i);
  }
  function s5(i) {
    return Ae(i.sessionId ?? i.data?.sessionId);
  }
  function h0() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }
  const Ml = Lt;
  function Dl(i) {
    return i.status === "running" || i.status === "waiting";
  }
  const ks = { title: 1300, id: 1050, group: 950, source: 650 },
    f0 = { session: 0, hermes: 1, archived: 2 },
    xd = 80;
  function qn(i) {
    return String(i ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/gu, "");
  }
  function Cd(i) {
    return `codex-session-search-result-${i.kind}-${i.id.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
  }
  function a5(i, e) {
    const t = Array.from(qn(i)),
      r = Array.from(qn(e));
    if (!t.length) return null;
    const n = [];
    let s = 0;
    for (const b of t) {
      const p = r.indexOf(b, s);
      if (p < 0) return null;
      (n.push(p), (s = p + 1));
    }
    const o = n[0],
      l = n[n.length - 1] - o + 1,
      c = l - t.length,
      u = n.slice(1).filter((b, p) => b === n[p] + 1).length,
      h = t.length / l;
    return {
      score:
        (t.length === r.length ? 1e4 : 0) +
        (o === 0 ? 1100 : 0) +
        u * 85 +
        Math.round(h * 500) -
        o * 4 -
        c * 8,
      positions: n,
    };
  }
  function p0(i) {
    const e = Date.parse(i);
    if (Number.isFinite(e)) return e;
    const t = Number(i);
    return Number.isFinite(t) ? t : 0;
  }
  function m0(i, e) {
    if (!qn(i)) return null;
    let t = null;
    for (const r of e) {
      const n = a5(i, r.value);
      if (!n) continue;
      const s = n.score + r.weight;
      (!t || s > t.score) && (t = { score: s, field: r.field });
    }
    return t;
  }
  function O0(i, e, t, r, n, s) {
    const o = `${r}:${t.id}`;
    if (!t.id || e.has(o)) return;
    const a = m0(s, [
      { field: "title", value: t.title, weight: ks.title },
      { field: "id", value: t.id, weight: ks.id },
      { field: "group", value: n, weight: ks.group },
    ]);
    (qn(s) && !a) ||
      (e.add(o),
      i.push({
        kind: r,
        id: t.id,
        title: t.title || t.id,
        updatedAt: t.updatedAt,
        groupName: n || runtimeText("未整理", "Unorganized"),
        score: a?.score || 0,
        matchedField: a?.field || null,
        session: t,
      }));
  }
  function l5(i, e, t, r) {
    const n = `hermes:${t.id}`;
    if (!t.id || e.has(n)) return;
    const s = m0(r, [
      { field: "title", value: t.title, weight: ks.title },
      { field: "id", value: t.id, weight: ks.id },
      { field: "source", value: runtimeText("Hermes 历史", "Hermes history"), weight: ks.source },
    ]);
    (qn(r) && !s) ||
      (e.add(n),
      i.push({
        kind: "hermes",
        id: t.id,
        title: t.title || t.id,
        updatedAt: t.updatedAt,
        groupName: runtimeText("Hermes 历史", "Hermes history"),
        score: s?.score || 0,
        matchedField: s?.field || null,
        history: t,
      }));
  }
  function c5(i) {
    const e = i.query,
      t = !!qn(e),
      r = new Map(i.groups.map((o) => [o.id, o.name])),
      n = [],
      s = new Set();
    for (const o of i.sessions)
      o.deleted ||
        O0(n, s, o, "session", (o.groupId && r.get(o.groupId)) || runtimeText("未整理", "Unorganized"), e);
    for (const o of i.hermesSessions) l5(n, s, o, e);
    if (i.includeArchived ?? t)
      for (const o of i.archivedSessions)
        o.deleted &&
          O0(
            n,
            s,
            o,
            "archived",
            (o.groupId && r.get(o.groupId)) || runtimeText("未整理", "Unorganized"),
            e,
          );
    return n.sort((o, a) => {
      if (t && a.score !== o.score) return a.score - o.score;
      const l = p0(a.updatedAt) - p0(o.updatedAt);
      return (
        l ||
        (o.kind !== a.kind
          ? f0[o.kind] - f0[a.kind]
          : o.title.localeCompare(a.title, "zh-Hans"))
      );
    });
  }
  function Mt(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function h5(i) {
    const e = i.React,
      { useEffect: t, useMemo: r, useRef: n, useState: s } = i.hooks;
    return function (a) {
      const l = n(null),
        c = n(null),
        u = n(new Map()),
        h = n(a.open),
        d = n(0);
      h.current = a.open;
      const [f, S] = s(""),
        [b, p] = s(0),
        [m, O] = s(""),
        [g, _] = s(""),
        w = r(
          () =>
            c5({
              query: f,
              sessions: a.sessions,
              archivedSessions: a.archivedSessions,
              groups: a.groups,
              hermesSessions: a.hermesSessions,
            }),
          [a.archivedSessions, a.groups, a.hermesSessions, a.sessions, f],
        ),
        v = w.slice(0, xd),
        x = w.length > v.length;
      if (
        (t(() => {
          if (!a.open) {
            d.current += 1;
            return;
          }
          (++d.current, S(""), p(0), O(""), _(""));
          const R = l.current;
          if (!R) return;
          R.open ||
            (typeof R.showModal == "function"
              ? R.showModal()
              : R.setAttribute("open", ""));
          const M = () => c.current?.focus();
          return (
            typeof window.requestAnimationFrame == "function"
              ? window.requestAnimationFrame(M)
              : window.setTimeout(M, 0),
            () => {
              ((d.current += 1),
                R.open &&
                  (typeof R.close == "function"
                    ? R.close()
                    : R.removeAttribute("open")));
            }
          );
        }, [a.open]),
        t(() => {
          p((R) => Math.min(R, Math.max(v.length - 1, 0)));
        }, [v.length]),
        t(() => {
          const R = v[b];
          R && u.current.get(Cd(R))?.scrollIntoView?.({ block: "nearest" });
        }, [v, b]),
        !a.open)
      )
        return null;
      const y = (R) => {
          if (R.kind === "archived") {
            if (!R.session || m) return;
            const M = d.current;
            (O(R.session.id),
              _(""),
              a
                .onRestoreArchived(R.session)
                .then((H) => {
                  if (!H) {
                    h.current && d.current === M && _(runtimeText("恢复失败，请稍后重试。", "Restore failed. Please retry later."));
                    return;
                  }
                  !h.current ||
                    d.current !== M ||
                    (a.onClose(), a.onSelectSession(R.session.id));
                })
                .catch(() => {
                  h.current && d.current === M && _(runtimeText("恢复失败，请稍后重试。", "Restore failed. Please retry later."));
                })
                .finally(() => {
                  h.current && d.current === M && O("");
                }));
            return;
          }
          (a.onClose(),
            R.kind === "hermes"
              ? a.onSelectHermes(R.id)
              : a.onSelectSession(R.id));
        },
        C = (R) => {
          R.isComposing ||
            R.nativeEvent?.isComposing ||
            R.keyCode === 229 ||
            (R.key === "ArrowDown" && v.length
              ? (R.preventDefault(), p((M) => (M + 1) % v.length))
              : R.key === "ArrowUp" && v.length
                ? (R.preventDefault(), p((M) => (M - 1 + v.length) % v.length))
                : R.key === "Enter" && v[b]
                  ? (R.preventDefault(), y(v[b]))
                  : R.key === "Escape" && (R.preventDefault(), a.onClose()));
        },
        P = (R) => {
          R.target === R.currentTarget && a.onClose();
        },
        E = (R) =>
          R.kind === "archived"
            ? runtimeText(`已归档 · ${R.groupName} · ${R.id}`, `Archived · ${R.groupName} · ${R.id}`)
            : R.kind === "hermes"
              ? runtimeText(`Hermes 历史 · ${R.id}`, `Hermes history · ${R.id}`)
              : `${R.groupName} · ${R.id}`,
        D = v.map((R, M) => {
          const H = M === b,
            F = R.title || R.id,
            j = Cd(R);
          return R.kind === "archived"
            ? Mt(
                e,
                "div",
                {
                  key: `${R.kind}:${R.id}`,
                  className: `codex-session-search-result codex-session-search-result-archived${H ? " is-selected" : ""}`,
                  role: "option",
                  "aria-selected": H,
                  id: j,
                  ref: (Q) => {
                    Q ? u.current.set(j, Q) : u.current.delete(j);
                  },
                  "data-result-id": R.id,
                  "data-result-kind": R.kind,
                },
                Mt(
                  e,
                  "div",
                  { className: "codex-session-search-result-copy" },
                  Mt(
                    e,
                    "strong",
                    {
                      className: "codex-session-search-result-title",
                      title: F,
                    },
                    F,
                  ),
                  Mt(
                    e,
                    "span",
                    { className: "codex-session-search-result-meta" },
                    E(R),
                  ),
                ),
                Mt(
                  e,
                  "button",
                  {
                    type: "button",
                    className: "codex-session-search-result-action",
                    disabled: m !== "" && m !== R.id,
                    onClick: () => y(R),
                    "aria-label": runtimeText(`恢复并打开：${F}`, `Restore and open: ${F}`),
                    title: runtimeText("恢复后打开会话", "Restore and open the session"),
                  },
                  m === R.id ? runtimeText("恢复中…", "Restoring…") : runtimeText("恢复并打开", "Restore and open"),
                ),
              )
            : Mt(
                e,
                "button",
                {
                  key: `${R.kind}:${R.id}`,
                  type: "button",
                  className: `codex-session-search-result${H ? " is-selected" : ""}`,
                  role: "option",
                  "aria-selected": H,
                  id: j,
                  ref: (Q) => {
                    Q ? u.current.set(j, Q) : u.current.delete(j);
                  },
                  "data-result-id": R.id,
                  "data-result-kind": R.kind,
                  onClick: () => y(R),
                  title: F,
                },
                Mt(
                  e,
                  "strong",
                  { className: "codex-session-search-result-title" },
                  F,
                ),
                Mt(
                  e,
                  "span",
                  { className: "codex-session-search-result-meta" },
                  E(R),
                ),
              );
        }),
        A = w.length
          ? null
          : Mt(
              e,
              "div",
              { className: "codex-session-search-empty", role: "status" },
              a.hermesHistoryLoading
                ? runtimeText("正在读取 Hermes 历史…", "Loading Hermes history…")
                : f.trim()
                  ? runtimeText("没有匹配的已加载会话", "No matching loaded sessions")
                  : runtimeText("暂无最近会话", "No recent sessions"),
            );
      return Mt(
        e,
        "dialog",
        {
          ref: l,
          className: "codex-session-search-dialog-backdrop",
          "aria-label": runtimeText("搜索会话", "Search sessions"),
          onCancel: (R) => {
            (R.preventDefault(), a.onClose());
          },
          onClick: P,
        },
        Mt(
          e,
          "section",
          { className: "codex-session-search-dialog" },
          Mt(
            e,
            "header",
            { className: "codex-session-search-header" },
            Mt(e, "h2", null, runtimeText("搜索会话", "Search sessions")),
            Mt(
              e,
              "button",
              {
                type: "button",
                className: "codex-session-search-close",
                onClick: a.onClose,
                "aria-label": runtimeText("关闭搜索", "Close search"),
                title: runtimeText("关闭搜索", "Close search"),
              },
              "×",
            ),
          ),
          Mt(e, "input", {
            ref: c,
            className: "codex-session-search-input",
            name: "session-search",
            value: f,
            onChange: (R) => {
              (S(R.target.value), p(0));
            },
            onKeyDown: C,
            placeholder: runtimeText("搜索标题、会话 ID 或项目", "Search titles, session IDs or projects"),
            "aria-label": runtimeText("搜索会话", "Search sessions"),
            "aria-activedescendant": v[b] ? Cd(v[b]) : void 0,
            autoComplete: "off",
          }),
          a.hermesHistoryComplete
            ? null
            : Mt(
                e,
                "div",
                { className: "codex-session-search-notice", role: "status" },
                runtimeText("仅搜索已加载的 Hermes 历史记录", "Searches loaded Hermes history only"),
              ),
          x
            ? Mt(
                e,
                "div",
                { className: "codex-session-search-limit", role: "status" },
                qn(f)
                  ? runtimeText(`仅显示相关度最高的 ${xd} 条，请继续输入以缩小范围`, `Showing the top ${xd} results. Keep typing to narrow the search.`)
                  : runtimeText(`仅显示最近的 ${xd} 条，可输入关键词查找其他会话`, `Showing the latest ${xd} sessions. Enter keywords to find others.`),
              )
            : null,
          g
            ? Mt(
                e,
                "div",
                { className: "codex-session-search-error", role: "alert" },
                g,
              )
            : null,
          Mt(
            e,
            "div",
            {
              className: "codex-session-search-results",
              role: "listbox",
              "aria-label": runtimeText("搜索结果", "Search results"),
            },
            D,
            A,
          ),
        ),
      );
    };
  }
  function Fe(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  const u5 = {
    active: runtimeText("已启用", "Enabled"),
    paused: runtimeText("已暂停", "Paused"),
    blocked: runtimeText("已阻塞", "Blocked"),
    usageLimited: runtimeText("已达用量上限", "Usage limit reached"),
    budgetLimited: runtimeText("已达预算上限", "Budget limit reached"),
    complete: runtimeText("已完成", "Completed"),
  };
  function Il(i) {
    return i instanceof Error ? i.message : String(i);
  }
  function d5(i) {
    const e = i.React,
      { useEffect: t, useRef: r, useState: n } = i.hooks;
    return function (o) {
      const a = r(null),
        l = r(null),
        c = r(o.open),
        u = r(""),
        h = r(0),
        [d, f] = n(null),
        [S, b] = n(""),
        [p, m] = n(""),
        [O, g] = n(!1),
        [_, w] = n(!1),
        [v, x] = n(!1),
        [y, C] = n(!1),
        [P, E] = n(!1),
        [D, A] = n(""),
        [R, M] = n("");
      c.current = o.open;
      const H = `${o.profile}\0${o.sessionId}`;
      if (
        (t(() => {
          u.current = H;
        }, [H]),
        t(() => {
          const te = ++h.current;
          ((u.current = H),
            A(""),
            M(""),
            x(!1),
            C(!1),
            E(!1),
            w(!1),
            f(null),
            b(o.prefillObjective),
            m(""),
            g(!1));
          const X = a.current;
          if (!o.open) {
            X?.open &&
              (typeof X.close == "function"
                ? X.close()
                : X.removeAttribute("open"));
            return;
          }
          if (X && !X.open)
            try {
              typeof X.showModal == "function"
                ? X.showModal()
                : X.setAttribute("open", "");
            } catch {
              X.setAttribute("open", "");
            }
          const q = () => l.current?.focus();
          return (
            typeof window.requestAnimationFrame == "function"
              ? window.requestAnimationFrame(q)
              : window.setTimeout(q, 0),
            o.sessionId
              ? (w(!0),
                HL(o.fetchJSON, o.profile, o.sessionId)
                  .then(($) => {
                    !c.current ||
                      h.current !== te ||
                      u.current !== H ||
                      (f($),
                      b(o.prefillObjective.trim() || $?.objective || ""),
                      m($?.tokenBudget == null ? "" : String($.tokenBudget)),
                      g(!1));
                  })
                  .catch(($) => {
                    c.current &&
                      h.current === te &&
                      u.current === H &&
                      A(Il($));
                  })
                  .finally(() => {
                    c.current && h.current === te && u.current === H && w(!1);
                  }),
                () => {
                  (++h.current,
                    X?.open &&
                      (typeof X.close == "function"
                        ? X.close()
                        : X.removeAttribute("open")));
                })
              : () => {
                  ++h.current;
                }
          );
        }, [
          H,
          o.fetchJSON,
          o.open,
          o.prefillObjective,
          o.profile,
          o.sessionId,
        ]),
        !o.open)
      )
        return null;
      const F = (te, X) =>
          c.current && h.current === te && u.current === X && X === H,
        j = () => {
          const te = p.trim();
          if (!te) return;
          if (!/^\d+$/.test(te)) return null;
          const X = Number(te);
          return Number.isSafeInteger(X) && X > 0 ? X : null;
        },
        Q = () => {
          if (!o.sessionId) {
            A(runtimeText("请先开始对话。", "Start a conversation first."));
            return;
          }
          const te = S.trim();
          if (!te) {
            A(runtimeText("请输入目标。", "Enter a goal."));
            return;
          }
          const X = j();
          if (X === null) {
            A(runtimeText("令牌预算必须是正整数。", "Token budget must be a positive integer."));
            return;
          }
          const q = { objective: te },
            $ = O;
          $ ? (q.tokenBudget = null) : X !== void 0 && (q.tokenBudget = X);
          const Z = h.current,
            V = H;
          (A(""),
            M(""),
            x(!0),
            n0(o.fetchJSON, o.profile, o.sessionId, q)
              .then((z) => {
                F(Z, V) &&
                  (f(z),
                  b(z?.objective || te),
                  m(z?.tokenBudget == null ? p.trim() : String(z.tokenBudget)),
                  g(!1),
                  M(
                    $
                      ? runtimeText("目标已保存，预算已清除。后续对话可按此目标推进。", "Goal saved and budget cleared. Future conversation can follow this goal.")
                      : runtimeText("目标已保存，后续对话可按此目标推进。", "Goal saved. Future conversation can follow this goal."),
                  ));
              })
              .catch((z) => {
                F(Z, V) && A(Il(z));
              })
              .finally(() => {
                F(Z, V) && x(!1);
              }));
        },
        k = () => {
          if (
            !o.sessionId ||
            !d ||
            (d.status !== "active" && d.status !== "paused")
          )
            return;
          const te = d.status === "active" ? "paused" : "active",
            X = h.current,
            q = H;
          (A(""),
            M(""),
            C(!0),
            n0(o.fetchJSON, o.profile, o.sessionId, { status: te })
              .then(($) => {
                F(X, q) &&
                  (f($), M(te === "paused" ? runtimeText("目标已暂停。", "Goal paused.") : runtimeText("目标已启用。", "Goal enabled.")));
              })
              .catch(($) => {
                F(X, q) && A(Il($));
              })
              .finally(() => {
                F(X, q) && C(!1);
              }));
        },
        N = () => {
          if (!o.sessionId || !d) return;
          const te = h.current,
            X = H;
          (A(""),
            M(""),
            E(!0),
            VL(o.fetchJSON, o.profile, o.sessionId)
              .then(() => {
                F(te, X) && (f(null), b(""), m(""), g(!1), M(runtimeText("目标已清除。", "Goal cleared.")));
              })
              .catch((q) => {
                F(te, X) && A(Il(q));
              })
              .finally(() => {
                F(te, X) && E(!1);
              }));
        },
        B = _ || v || y || P,
        T = d?.status ? u5[d.status] || runtimeText("目标状态未知", "Unknown goal status") : "",
        Y = !!(
          d &&
          (d.tokensUsed != null ||
            d.timeUsedSeconds != null ||
            d.tokenBudget != null)
        );
      return Fe(
        e,
        "dialog",
        {
          ref: a,
          className:
            "codex-navigation-dialog-backdrop codex-goal-dialog-backdrop",
          "aria-label": runtimeText("会话目标", "Session goal"),
          onCancel: (te) => {
            (te.preventDefault(), o.onClose());
          },
          onMouseDown: (te) => {
            te.target === te.currentTarget && o.onClose();
          },
        },
        Fe(
          e,
          "section",
          { className: "codex-navigation-dialog codex-goal-dialog" },
          Fe(
            e,
            "header",
            { className: "codex-goal-header" },
            Fe(e, "h2", null, runtimeText("会话目标", "Session goal")),
            Fe(
              e,
              "button",
              {
                type: "button",
                className: "codex-goal-close",
                onClick: o.onClose,
                "aria-label": runtimeText("关闭目标设置", "Close goal settings"),
                title: runtimeText("关闭目标设置", "Close goal settings"),
              },
              "×",
            ),
          ),
          o.sessionId
            ? null
            : Fe(
                e,
                "p",
                { className: "codex-goal-empty", role: "status" },
                runtimeText("请先开始对话。", "Start a conversation first."),
              ),
          Fe(
            e,
            "label",
            { className: "codex-goal-field" },
            Fe(e, "span", null, runtimeText("目标", "Goal")),
            Fe(e, "textarea", {
              ref: l,
              value: S,
              disabled: B || !o.sessionId,
              rows: 4,
              maxLength: 4e3,
              "aria-label": runtimeText("目标", "Goal"),
              placeholder: runtimeText("描述这次会话要完成的目标", "Describe the goal for this session"),
              onChange: (te) => b(te.target.value),
            }),
          ),
          Fe(
            e,
            "label",
            { className: "codex-goal-field" },
            Fe(e, "span", null, runtimeText("令牌预算（可选）", "Token budget (optional)")),
            Fe(e, "input", {
              type: "number",
              min: 1,
              step: 1,
              inputMode: "numeric",
              value: p,
              disabled: B || !o.sessionId,
              "aria-label": runtimeText("令牌预算（可选）", "Token budget (optional)"),
              placeholder:
                d?.tokenBudget != null
                  ? runtimeText("留空表示保留当前预算", "Leave empty to keep the current budget")
                  : runtimeText("留空表示不设置", "Leave empty for no limit"),
              onChange: (te) => {
                (m(te.target.value), g(!1));
              },
            }),
            d?.tokenBudget != null
              ? Fe(
                  e,
                  "button",
                  {
                    type: "button",
                    className: "codex-goal-clear-budget",
                    onClick: () => {
                      (m(""), g(!0));
                    },
                    disabled: B || !o.sessionId,
                    "aria-label": runtimeText("清除令牌预算", "Clear token budget"),
                  },
                  runtimeText("清除预算", "Clear budget"),
                )
              : null,
          ),
          _
            ? Fe(
                e,
                "p",
                { className: "codex-goal-status", role: "status" },
                runtimeText("正在读取目标…", "Loading goal…"),
              )
            : null,
          d
            ? Fe(
                e,
                "div",
                { className: "codex-goal-details" },
                T
                  ? Fe(
                      e,
                      "p",
                      { className: "codex-goal-status", role: "status" },
                      runtimeText(`状态：${T}`, `Status: ${T}`),
                    )
                  : null,
                Y
                  ? Fe(
                      e,
                      "dl",
                      { className: "codex-goal-usage" },
                      d.tokenBudget != null
                        ? Fe(
                            e,
                            "div",
                            null,
                            Fe(e, "dt", null, runtimeText("令牌预算", "Token budget")),
                            Fe(e, "dd", null, String(d.tokenBudget)),
                          )
                        : null,
                      d.tokensUsed != null
                        ? Fe(
                            e,
                            "div",
                            null,
                            Fe(e, "dt", null, runtimeText("已用令牌", "Tokens used")),
                            Fe(e, "dd", null, String(d.tokensUsed)),
                          )
                        : null,
                      d.timeUsedSeconds != null
                        ? Fe(
                            e,
                            "div",
                            null,
                            Fe(e, "dt", null, runtimeText("已用时间（秒）", "Elapsed time (seconds)")),
                            Fe(e, "dd", null, String(d.timeUsedSeconds)),
                          )
                        : null,
                    )
                  : null,
              )
            : null,
          D
            ? Fe(e, "div", { className: "codex-goal-error", role: "alert" }, D)
            : null,
          R
            ? Fe(
                e,
                "div",
                { className: "codex-goal-notice", role: "status" },
                R,
              )
            : null,
          Fe(
            e,
            "div",
            { className: "codex-navigation-dialog-actions codex-goal-actions" },
            d?.status === "active" || d?.status === "paused"
              ? Fe(
                  e,
                  "button",
                  { type: "button", onClick: k, disabled: B || !o.sessionId },
                  d.status === "active" ? runtimeText("暂停目标", "Pause goal") : runtimeText("启用目标", "Enable goal"),
                )
              : null,
            d
              ? Fe(
                  e,
                  "button",
                  { type: "button", onClick: N, disabled: B || !o.sessionId },
                  P ? runtimeText("清除中…", "Clearing…") : runtimeText("清除目标", "Clear goal"),
                )
              : null,
            Fe(
              e,
              "button",
              {
                type: "button",
                className: "is-primary",
                onClick: Q,
                disabled: B || !o.sessionId,
              },
              v ? runtimeText("保存中…", "Saving…") : runtimeText("保存目标", "Save goal"),
            ),
          ),
        ),
      );
    };
  }
  const f5 = 3;
  // Drafts and attachments are keyed by pane ID; never reuse a closed pane's ID.
  let nextPaneId = 2;
  function p5(i) {
    const ids = new Set(i.map(pane => pane.id));
    let id;
    do { id = `pane-${nextPaneId++}`; } while (ids.has(id));
    return id;
  }
  function m5(i = "", e = "") {
    return [{ id: "pane-1", initialSessionId: i, initialHermesSessionId: e }];
  }
  function Xo(i) {
    return i.length < f5;
  }
  function O5(i, e, t) {
    if (!Xo(i)) return [...i];
    const r = i.findIndex((n) => n.id === t);
    return r < 0 ? [...i, e] : [...i.slice(0, r + 1), e, ...i.slice(r + 1)];
  }
  function g5(i, e, t) {
    if (i.length <= 1) return { panes: [...i], activePaneId: t };
    const r = i.findIndex((o) => o.id === e);
    if (r < 0) return { panes: [...i], activePaneId: t };
    const n = i.filter((o) => o.id !== e);
    if (t !== e) return { panes: n, activePaneId: t };
    const s = i[r + 1] || i[r - 1];
    return { panes: n, activePaneId: s.id };
  }
  const S5 = runtimeText("请查看附件。", "Please review the attachment.");
  function On(i, e) {
    return `${i}:${e}`;
  }
  function g0(i, e, t, r, n, s, o) {
    if (n) return;
    const a = On(t, r);
    (i.set(a, s), e.set(a, o));
  }
  function b5(i) {
    return !Number.isFinite(i) || i < 0
      ? runtimeText("大小未知", "Unknown size")
      : i < 1024
        ? `${i} B`
        : i < 1024 * 1024
          ? `${(i / 1024).toFixed(i < 10 * 1024 ? 1 : 0)} KB`
          : i < 1024 * 1024 * 1024
            ? `${(i / (1024 * 1024)).toFixed(i < 10 * 1024 * 1024 ? 1 : 0)} MB`
            : `${(i / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  function S0(i) {
    return `${i.name}\0${i.type}\0${i.size}\0${i.lastModified}`;
  }
  function _5(i) {
    return { localId: h0(), file: i, status: "pending", progress: 0 };
  }
  function Qd(i) {
    return i instanceof t0 && i.status >= 400 && i.status < 500;
  }
  function v5(i) {
    const e = String(i).toLowerCase();
    return e.includes("503") ||
      e.includes("temporarily unavailable") ||
      e.includes("暂时不可用")
      ? runtimeText("历史记录暂时不可用，请稍后重试。", "History is temporarily unavailable. Please retry later.")
      : runtimeText("历史记录读取失败，请稍后重试。", "Could not load history. Please retry later.");
  }
  function y5(i, e, t, r) {
    return i === e && r <= t;
  }
  function Wo(i) {
    if (!i) return null;
    const e = i.params && typeof i.params == "object" ? i.params : {},
      t = String(i.method || "").toLowerCase(),
      r = [
        "item/commandexecution/requestapproval",
        "item/filechange/requestapproval",
      ].includes(t),
      n = Array.isArray(e.command)
        ? e.command.join(" ")
        : String(e.command || "");
    if (t === "item/tool/requestuserinput" && Array.isArray(e.questions) && e.questions.length) {
      return { id: String(e.approvalId ?? i.requestId ?? i.id ?? ""), kind: "user-input", questions: e.questions };
    }
    return {
      id: String(e.approvalId ?? i.requestId ?? i.id ?? ""),
      kind: r ? "approval" : "terminal",
      text: r
        ? [String(e.reason || runtimeText("需要批准以下操作", "Approval required for the following operation")), n].filter(Boolean).join(`
`)
        : runtimeText("此交互尚未接入网页，请到 Dashboard 的终端中打开当前 Codex 会话处理。", "This interaction is not available on the web. Open the current Codex session in the Dashboard terminal."),
    };
  }
  function W(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function b0() {
    return (
      typeof document < "u" &&
      !!document.getElementById("dashboard-workbench-sessions")
    );
  }
  function Pd() {
    return (
      document.visibilityState === "visible" &&
      window.location.pathname === "/chat" &&
      new URLSearchParams(window.location.search).get("workbench") !==
        "terminal"
    );
  }
  function $d(i = "", e = "") {
    const t = new URL(window.location.href);
    if (
      t.pathname === "/chat" &&
      t.searchParams.get("workbench") !== "terminal"
    )
      return !0;
    const r = new URLSearchParams();
    return (
      i && r.set("session", i),
      e && r.set("hermesSession", e),
      Kp(`/chat${r.size ? `?${r}` : ""}`, "default"),
      window.location.pathname === "/chat" &&
        new URLSearchParams(window.location.search).get("workbench") !==
          "terminal"
    );
  }
  function Nl() {
    typeof window > "u" ||
      window.dispatchEvent(
        new CustomEvent("workbench:session-navigation-select"),
      );
  }
  function w5() {
    typeof window > "u" ||
      window.dispatchEvent(
        new CustomEvent("workbench:session-navigation-open"),
      );
  }
  function _0(i) {
    if (!i || i.closest("[hidden]")) return !1;
    const e = typeof window < "u" ? window.getComputedStyle(i) : null;
    if (e?.display === "none" || e?.visibility === "hidden") return !1;
    const t = i.getBoundingClientRect();
    return typeof window < "u" &&
      t.width > 0 &&
      t.height > 0 &&
      (t.right <= 0 ||
        t.bottom <= 0 ||
        t.left >= window.innerWidth ||
        t.top >= window.innerHeight)
      ? !1
      : (i.focus(), document.activeElement === i);
  }
  function st(i, e, t = "") {
    const r = {
      compose: "M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7 M16 3l5 5 M10 14l-1 4 4-1L22 8l-5-5z",
      plus: "M12 5v14M5 12h14",
      search: "m20 20-4.5-4.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
      close: "m6 6 12 12M6 18 18 6",
      menu: "M4 6h16M4 12h16M4 18h16",
      collapse: "M5 4v16m13-15-7 7 7 7",
      expand: "M19 4v16M6 5l7 7-7 7",
      chevron: "m6 14 6-6 6 6",
      options: "M4 6h5m4 0h7M4 12h9m4 0h3M4 18h2m4 0h10M9 3v6m4 0v6m-7 0v6",
      paperclip: "m9 17 8-8a3 3 0 0 0-4-4L4 14a5 5 0 0 0 7 7L21 11M7 15l8-8",
      folder: "M3 7V5h6l2 2h10v13H3z",
      chat: "M4 5h16v11H8l-4 4V5z",
      copy: "M9 9h11v12H9zM15 9V3H3v12h6",
      cube: "m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5m-9 5v9M7 5.8l9 5",
      reasoning:
        "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
      bolt: "m13 2-8 12h6l-1 8 9-13h-7z",
      goal: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
      right: "m9 5 7 7-7 7",
      back: "m15 5-7 7 7 7",
      slash: "m15 4-6 16",
      stop: "M5 5h14v14H5z",
      writeback: "M12 3v12m-4-4 4 4 4-4M5 15v6h14v-6",
      send: "m4 12 16-8-8 16-1-7-7-1Zm7 1 9-9",
      list: "M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01",
      check: "m5 12 4 4L19 6",
    };
    return W(
      i,
      "svg",
      {
        className: `codex-ui-icon ${t}`,
        viewBox: "0 0 24 24",
        width: 22,
        height: 22,
        fill: e === "stop" ? "currentColor" : "none",
        stroke: "currentColor",
        strokeWidth: 1.7,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": !0,
      },
      W(i, "path", { d: r[e] || r.list }),
    );
  }
  function Zn(i) {
    if (i == null) return "";
    if (typeof i == "string") return i;
    if (typeof i == "number" || typeof i == "boolean") return String(i);
    if (Array.isArray(i))
      return i.map(Zn).filter(Boolean).join(`
`);
    if (typeof i == "object") {
      const e = i;
      if (e.stdout !== void 0 && e.stderr !== void 0)
        return [Zn(e.stdout), Zn(e.stderr)].filter(Boolean).join(`
`);
      for (const t of [
        "aggregatedOutput",
        "output",
        "stdout",
        "stderr",
        "content",
        "text",
        "result",
      ])
        if (e[t] !== void 0 && e[t] !== i) {
          const r = Zn(e[t]);
          if (r) return r;
        }
      try {
        return JSON.stringify(i, null, 2);
      } catch {
        return String(i);
      }
    }
    return String(i);
  }
  function v0(i) {
    if (typeof i.input == "string") return i.input;
    if (i.input && typeof i.input == "object" && !Array.isArray(i.input)) {
      const e = i.input,
        t = e.command ?? e.cmd;
      if (t !== void 0) return Zn(t);
    }
    return "";
  }
  function k5(i) {
    const e = Zn(i.result);
    if (e) return e;
    const t = v0(i);
    return i.content && i.content !== t ? i.content : "";
  }
  function subagentStatusLabel(i) {
    return i === "running"
      ? runtimeText("进行中", "In progress")
      : i === "failed"
        ? runtimeText("失败", "Failed")
        : i === "completed"
          ? runtimeText("已完成", "Completed")
          : i === "pending"
            ? runtimeText("等待中", "Pending")
            : runtimeText("未知", "Unknown");
  }
  function subagentStateFor(i, e) {
    const t = i?.agentsStates;
    if (Array.isArray(t)) return t.find(r => String(r?.threadId ?? r?.thread_id ?? r?.id ?? "") === e);
    if (t && typeof t === "object") return t[e] ?? t[e.replace(/-/g, "_")];
    return void 0;
  }
  function SubagentProgressCard({ React: i, message: e }) {
    const t = e.subagent || { tool: e.toolName || "collaboration", prompt: e.content, receiverThreadIds: [], receiverAgents: [] };
    const r = e.status || "pending";
    const n = Array.isArray(t.receiverAgents) ? t.receiverAgents : [];
    const s = Array.isArray(t.receiverThreadIds) ? t.receiverThreadIds : [];
    const o = Math.max(n.length, s.length);
    const a = Array.from({ length: o }, (_, l) => {
      const c = n[l], u = typeof c === "string" ? c : c?.name ?? c?.role ?? c?.nickname;
      const h = s[l] || (typeof c === "object" ? c?.threadId ?? c?.thread_id : "");
      const d = subagentStateFor(t, String(h || ""));
      const f = typeof d === "string" ? d : d?.status;
      const S = (f && (Rl(f) || "pending")) || (r === "completed" ? "completed" : r === "failed" ? "failed" : "running");
      const b = typeof d === "string" ? "" : d?.message ?? d?.detail ?? d?.error ?? "";
      return W(i, "li", { key: `${h || u || l}`, className: `codex-subagent-row is-${S}`, "data-subagent-thread": h || void 0 },
        W(i, "span", { className: "codex-subagent-agent" }, u || h || runtimeText(`子代理 ${l + 1}`, `Subagent ${l + 1}`)),
        W(i, "span", { className: "codex-subagent-status", "data-subagent-status": S }, subagentStatusLabel(S)),
        b ? W(i, "span", { className: "codex-subagent-detail" }, String(b)) : null);
    });
    return W(i, "section", { className: `codex-subagent-card is-${r}`, "data-testid": "subagent-progress", "data-subagent-status": r },
      W(i, "header", { className: "codex-subagent-heading" },
        W(i, "strong", null, runtimeText("子代理任务", "Subagent task")),
        W(i, "span", { className: "codex-subagent-tool" }, String(t.tool || "collaboration")),
        W(i, "span", { className: "codex-subagent-status", "data-subagent-status": r }, subagentStatusLabel(r))),
      t.prompt ? W(i, "div", { className: "codex-subagent-prompt" }, W(i, Ki, { React: i, content: String(t.prompt) })) : null,
      o ? W(i, "ul", { className: "codex-subagent-list" }, ...a) : W(i, "p", { className: "codex-subagent-empty" }, runtimeText("等待子代理状态…", "Waiting for subagent status…")));
  }
  function x5(i) {
    const e = Math.max(0, Math.floor(i / 1e3));
    if (e < 60) return runtimeText(`${e}秒`, `${e}s`);
    const t = Math.floor(e / 3600),
      r = Math.floor((e % 3600) / 60),
      n = e % 60;
    return t
      ? runtimeText(`${String(t).padStart(2, "0")}时${String(r).padStart(2, "0")}分${String(n).padStart(2, "0")}秒`, `${String(t).padStart(2, "0")}h ${String(r).padStart(2, "0")}m ${String(n).padStart(2, "0")}s`)
      : runtimeText(`${String(r).padStart(2, "0")}分钟${String(n).padStart(2, "0")}秒`, `${String(r).padStart(2, "0")}m ${String(n).padStart(2, "0")}s`);
  }
  function y0(i) {
    return typeof i == "number" && Number.isFinite(i) && i >= 0 ? i : void 0;
  }
  function C5({ React: i, message: e }) {
    if (e.subagent) return W(i, SubagentProgressCard, { React: i, message: e });
    const [t, r] = i.useState(""),
      [outputExpanded, setOutputExpanded] = i.useState(false),
      n = e.error === !0 || e.status === "failed",
      s = v0(e) || Zn(e.input),
      o = ws({ ...e, content: k5(e) }).trim(),
      a = y0(e.durationMs),
      l = [
        a !== void 0
          ? `${a < 1e3 ? runtimeText(`${a}毫秒`, `${a}ms`) : runtimeText(`${(a / 1e3).toFixed(1)}秒`, `${(a / 1e3).toFixed(1)}s`)}`
          : "",
        e.exitCode != null ? runtimeText(`退出码 ${e.exitCode}`, `Exit code ${e.exitCode}`) : "",
      ]
        .filter(Boolean)
        .join(" · ");
    return W(
      i,
      "div",
      {
        className: `codex-command-card${n ? " is-error" : ""}`,
        "data-testid": "codex-tool-card",
        "data-status": n
          ? "failed"
          : e.status === "running"
            ? "running"
            : "completed",
        "data-duration-ms": a,
        "data-exit-code": e.exitCode ?? void 0,
      },
      W(
        i,
        "pre",
        { className: "codex-command-input", "data-testid": "codex-tool-input" },
        displayCommand(s) || e.toolName || runtimeText("工具", "Tool"),
      ),
      W(
        i,
        "div",
        { className: "codex-command-controls" },
        l ? W(i, "span", { className: "codex-command-metadata" }, l) : null,
        s
          ? W(
              i,
              "button",
              {
                type: "button",
                className: "codex-command-copy",
                "aria-label": runtimeText("复制命令", "Copy command"),
                title:
                  t === "copied"
                    ? runtimeText("已复制", "Copied")
                    : t === "failed"
                      ? runtimeText("复制失败，请选择文本复制", "Copy failed. Select the text to copy it.")
                      : runtimeText("复制命令", "Copy command"),
                onClick: () => {
                  navigator.clipboard.writeText(s).then(
                    () => r("copied"),
                    () => r("failed"),
                  );
                },
              },
              st(i, t === "copied" ? "check" : "copy"),
            )
          : null,
      ),
      o
        ? W(
            i,
            "details",
            {
              className: "codex-command-output",
              open: outputExpanded,
              onToggle: event => setOutputExpanded(event.currentTarget.open),
              "data-testid": "codex-tool-output",
            },
            W(
              i,
              "summary",
              { "aria-label": runtimeText("展开或收起输出", "Expand or collapse output"), title: runtimeText("展开或收起输出", "Expand or collapse output") },
              st(i, "right"),
            ),
            outputExpanded ? W(i, "pre", { "data-testid": "codex-tool-output-text" }, o) : null,
          )
        : null,
    );
  }
  function LazyToolRun({ React: i, messages, active, superseded }) {
    const [expanded, setExpanded] = i.useState(active && !superseded);
    i.useEffect(() => { if (superseded) setExpanded(false); }, [superseded]);
    return W(i, "details", {
      className: "codex-tool-list", "data-testid": "turn-tool-list",
      open: expanded,
      onToggle: event => setExpanded(event.currentTarget.open),
    }, W(i, "summary", null, messages.some(message => message.subagent)
      ? runtimeText("子代理任务", "Subagent task")
      : messages.length === 1 ? runtimeText("一次工具调用", "One tool call") : runtimeText(`${messages.length}次工具调用`, `${messages.length} tool calls`)),
    expanded ? W(i, "div", { className: "codex-tool-rows" },
      ...messages.map(message => W(i, C5, { key: message.id, React: i, message }))) : null);
  }
  function Q5({ React: i, messages: e, hasFollowingBody = false, timing }) {
    const r = timing?.running ?? false,
      [expanded, setExpanded] = i.useState(r && !hasFollowingBody);
    i.useEffect(() => {
      if (hasFollowingBody) setExpanded(false);
      else if (r) setExpanded(true);
    }, [r, hasFollowingBody]);
    const u = [];
    for (let h = 0; expanded && h < e.length; ) {
      const d = e[h];
      if (d.role !== "tool") {
        (u.push(
          W(
            i,
            "div",
            { key: d.id, className: "codex-process-text" },
            W(i, Ki, {
              React: i,
              content: ws(d),
              streaming: d.status === "running",
            }),
          ),
        ),
          (h += 1));
        continue;
      }
      const f = [];
      for (; h < e.length && e[h].role === "tool"; ) f.push(e[h++]);
      u.push(W(i, LazyToolRun, { key: d.id, React: i, messages: f, active: r, superseded: h < e.length || hasFollowingBody }));
    }

    return W(
      i,
      "details",
      {
        className: "codex-tool-group",
        open: expanded,
        onToggle: event => setExpanded(event.currentTarget.open),
        "data-testid": "turn-tool-list-group",
        "data-single-tool-list": String(e.every((h) => h.role === "tool")),
      },
      W(
        i,
        "summary",
        { className: "codex-tool-heading" },
        st(i, "right"),
        W(i, ProcessSummary, { React: i, timing: timing || { running: false } }),
      ),
      W(i, "div", { className: "codex-process-content" }, ...u),
    );
  }
  function P5(i, e, Process = Q5, Message = T5) {
    return processBlocks(e).map(block => block.kind === "message"
      ? W(i, Message, { key: block.message.id, React: i, message: block.message })
      : W(i, Process, { key: block.key, React: i, messages: block.messages, hasFollowingBody: block.hasFollowingBody, timing: block.timing }));
  }

  function w0(i) {
    return i.title === i.id ? runtimeText("未命名会话", "Untitled session") : i.title;
  }
  function $5(i) {
    return i.status === "running"
      ? { className: "is-running", label: runtimeText("正在响应", "Responding") }
      : i.status === "waiting"
        ? { className: "is-waiting", label: runtimeText("等待审批或回复", "Awaiting approval or reply") }
        : i.unread
          ? { className: "is-unread", label: runtimeText("有未读回复", "Unread reply") }
          : null;
  }
  function T5({ React: i, message: e }) {
    if (e.role === "tool") {
      const t =
          e.result == null
            ? e.content
            : typeof e.result == "string"
              ? e.result
              : JSON.stringify(e.result, null, 2),
        r = ws({ ...e, content: t });
      return W(
        i,
        "article",
        { className: `codex-message is-tool${e.error ? " is-error" : ""}` },
        W(i, "div", null, e.toolName || runtimeText("工具过程", "Tool activity")),
        r ? W(i, "pre", null, r) : null,
      );
    }
    if (e.runtimeError) return W(i, "article", {
      className: "codex-message is-assistant is-error", role: "alert", "data-message-id": e.id,
    }, W(i, "div", null, runtimeText("回复失败", "Response failed")), W(i, "pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, e.runtimeError));
    return e.role === "reasoning"
      ? W(
          i,
          "article",
          { className: "codex-message is-reasoning" },
          W(i, Ki, {
            React: i,
            content: ws(e),
            streaming: e.status === "running",
          }),
        )
      : e.role === "system"
        ? null
        : e.role === "user"
          ? W(
              i,
              "article",
              { className: "codex-message is-user", "data-message-id": e.id },
              W(i, "div", { className: "codex-message-body" }, e.content),
              e.status === "pending"
                ? W(i, "div", { className: "codex-message-status" }, runtimeText("待确认", "Awaiting confirmation"))
                : null,
              e.status === "failed"
                ? W(
                    i,
                    "div",
                    { className: "codex-message-status is-error" },
                    e.submissionError ? runtimeText(`发送失败：${e.submissionError}`, `Send failed: ${e.submissionError}`) : runtimeText("发送失败：运行时未提供错误详情", "Send failed: the runtime supplied no error details"),
                  )
                : null,
            )
          : W(
              i,
              "article",
              {
                className: "codex-message is-assistant",
                "data-message-id": e.id,
              },
              W(
                i,
                "div",
                { className: "codex-message-body" },
                W(i, Ki, {
                  React: i,
                  content: ws(e),
                  streaming: e.status === "running",
                }),
              ),
              e.status === "failed"
                ? W(i, "div", { className: "codex-message-status" }, runtimeText("回复失败", "Response failed"))
                : null,
            );
  }
  function E5(i, e) {
    return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${Ml}/events?profile=${encodeURIComponent(i)}&session_id=${encodeURIComponent(e)}&defer_persistence=true`;
  }
  function A5(i) {
    const e = i.React,
      {
        useCallback: t,
        useEffect: r,
        useMemo: n,
        useRef: s,
        useState: o,
      } = i.hooks,
      { HermesHistoryTimeline: a } = u_(i),
      l = h5(i),
      c = d5(i),
      ProjectNavigation = createProjectNavigation(i),
      ChatComposerInput = createChatComposerInput(i),
      CodexUserInput = createCodexUserInput(i),
      KanbanDiscussionPreview = createKanbanDiscussionPreview(i),
      MemoMessage = e.memo(T5),
      MemoProcess = e.memo(Q5, (before, after) => before.showDuration === after.showDuration
        && before.hasFollowingBody === after.hasFollowingBody
        && before.messages.length === after.messages.length
        && before.messages.every((message, index) => message === after.messages[index])),
      Transcript = e.memo(({ messages }) => W(e, e.Fragment, null, ...P5(e, messages, MemoProcess, MemoMessage))),
      u = LL(i, {
        imageLoading: runtimeText("图片加载中…", "Loading image…"),
        imageError: runtimeText("图片加载失败", "Could not load image"),
        openOriginal: runtimeText("打开原图", "Open original"),
        loading: runtimeText("加载中…", "Loading…"),
        discardUnsaved: runtimeText("当前文件尚未保存，仍要切换吗？", "Discard unsaved changes and switch files?"),
        saving: runtimeText("保存中…", "Saving…"),
        saved: runtimeText("已保存", "Saved"),
        unbound: runtimeText("未绑定工作区", "No workspace"),
        bind: runtimeText("每个会话需要绑定一个工作区。", "Bind a workspace to this session."),
        source: runtimeText("源码", "Source"),
        preview: runtimeText("预览", "Preview"),
        save: runtimeText("保存", "Save"),
        close: runtimeText("关闭", "Close"),
        selectFile: runtimeText("选择文件", "Select a file"),
        openFromTree: runtimeText("从左侧文件树打开文件。", "Open a file from the tree."),
      });
    function GlobalFileBrowser({ profile }) {
      const [workspace, setWorkspace] = o(null);
      const [error, setError] = o("");
      r(() => {
        let active = true;
        setWorkspace(null);
        setError("");
        fR(i.fetchJSON, profile, "")
          .then(value => { if (active) setWorkspace(value); })
          .catch(reason => { if (active) setError(String(reason)); });
        return () => { active = false; };
      }, [profile]);
      if (error) return W(e, "div", { role: "alert" }, error);
      return workspace
        ? W(e, u, { key: `${profile}:${workspace.path}`, workspace,
            presentation: "modal", fetchJSON: i.fetchJSON, assetUrl: bR })
        : W(e, "div", { role: "status" }, runtimeText("正在加载文件浏览…", "Loading file browser…"));
    }
    function h({
      dialog: f,
      dialogRef: S,
      inputRef: b,
      name: p,
      error: m,
      saving: O,
      onCancel: g,
      onChange: _,
      onSubmit: w,
    }) {
      return (
        r(() => {
          const v = S.current;
          if (v)
            return (
              v.open || v.showModal(),
              window.requestAnimationFrame(() => b.current?.focus()),
              () => {
                v.open && v.close();
              }
            );
        }, [f, S, b]),
        W(
          e,
          "dialog",
          {
            ref: S,
            className: "codex-navigation-dialog-backdrop",
            "aria-labelledby": "codex-group-dialog-title",
            onCancel: g,
            onMouseDown: (v) => {
              v.target === v.currentTarget && g(v);
            },
          },
          W(
            e,
            "section",
            { className: "codex-navigation-dialog" },
            W(
              e,
              "h2",
              { id: "codex-group-dialog-title" },
              f.mode === "new" ? runtimeText("新建项目", "New project") : runtimeText("重命名项目", "Rename project"),
            ),
            W(e, "input", {
              ref: b,
              value: p,
              maxLength: 60,
              name: "project-name",
              placeholder: runtimeText("项目名称", "Project name"),
              "aria-label": runtimeText("项目名称", "Project name"),
              onChange: _,
              onKeyDown: (v) => {
                v.key === "Enter" && (v.preventDefault(), w());
              },
            }),
            m
              ? W(
                  e,
                  "div",
                  { className: "codex-navigation-dialog-error", role: "alert" },
                  m,
                )
              : null,
            W(
              e,
              "div",
              { className: "codex-navigation-dialog-actions" },
              W(
                e,
                "button",
                { type: "button", onClick: g, disabled: O },
                runtimeText("取消", "Cancel"),
              ),
              W(
                e,
                "button",
                {
                  type: "button",
                  className: "is-primary",
                  onClick: w,
                  disabled: O,
                },
                O ? runtimeText("保存中…", "Saving…") : runtimeText("保存", "Save"),
              ),
            ),
          ),
        )
      );
    }
    function d({
      paneId: f,
      initialSessionId: S,
      initialHermesSessionId: b,
      navigationOwner: p,
      onActivate: m,
      onClose: O,
      onNewNearby: g,
      canClose: _,
      onRegister: w,
      onNavigationSelect: v,
      onNavigationHermesSelect: x,
      onNavigationNew: y,
      onNavigationNewTemporary,
      onNavigationOpenNearby: C,
      onNavigationNewNearby: P,
      onNavigationDragStart,
      onNavigationDragEnd,
      navigationActiveSessionId: E,
      navigationActiveHermesSessionId: D,
      onTargetChange: A,
      profile,
    }) {
      const sendShortcut = useSendShortcut(i);
      const R = new URLSearchParams(window.location.search),
        M = profile || s(currentProfile()).current,
        H = R.get("hermesSession") || "",
        F = R.get("session") || "",
        j = S ?? F,
        Q = b ?? H,
        [k, N] = o(Q ? "" : j),
        [B, T] = o(Q),
        kanbanChatContext = s(null),
        Y = s(k),
        te = s(B),
        X = s(0),
        [q, $] = o([]),
        [Z, V] = o([]),
        [z, G] = o([]),
        [ae, Ce] = o(""),
        [Qe, Xe] = o({ top: 8, right: 8, maxHeight: 240, maxWidth: 288 }),
        [be, We] = o(null),
        [wt, lt] = o(""),
        [Ue, kt] = o(""),
        [J, le] = o(!1),
        [we, Re] = o(""),
        [Ye, ct] = o([]),
        [Dt, ot] = o(0),
        [Zt, Ne] = o(0),
        [ut, br] = o(!0),
        [Ni, _r] = o(!1),
        [bi, vr] = o(""),
        [Tt, xt] = o(0),
        [Ti, Bi] = o(null),
        [Ct, Et] = o(!1),
        [ce, ve] = o(""),
        [vt, Kt] = o(0),
        [It, ht] = o([]),
        [Jt, zi] = o(null),
        [draftState, setDraftState] = o(() => ({ value: Q ? "" : profileDrafts(M, f).get(On(M, j)) || "", revision: 0 })),
        Ei = draftState.value,
        [hasDraft, setHasDraft] = o(!!Ei.trim()),
        [submitting, setSubmitting] = o(false),
        submittingRef = s(false),
        Ot = t((next) => {
          const value = typeof next === "function" ? next(Ji.current) : next;
          Ji.current = value;
          setHasDraft(!!value.trim());
          setDraftState(previous => ({ value, revision: previous.revision + 1 }));
        }, []),
        [se, _e] = o(() => Q ? [] : profileAttachments(M, f).get(On(M, j)) || []),
        [Le, gt] = o(!1),
        [Xi, _i] = o(!1),
        [yr, Nt] = o(!1),
        [Fn, Wr] = o(!1),
        [Zo, Xl] = o(!1),
        jo = s(!1),
        [qr, Wi] = o(""),
        [Ts, Es] = o(!0),
        [Wl, Zr] = o(!1),
        [wr, ql] = o(() => p && b0()),
        [ie, re] = o(!1),
        [me, ye] = o("main"),
        [Qt, qi] = o(!1),
        [Bd, bn] = o(""),
        [Fo, As] = o(""),
        Hn = s(null),
        F0 = s(null),
        jr = s(profileDrafts(M, f)),
        Ji = s(Ei);
      const pi = s(profileAttachments(M, f)),
        Zi = s(se);
      Zi.current = se;
      const H0 = s(null),
        ji = s(new Map()),
        Ho = s(null),
        Vo = s(!0),
        Zl = s(""),
        V0 = s(null),
        jl = s(null),
        [Bt, bM] = o(""),
        [modelChoices, setModelChoices] = o({ profile: M, items: [] }),
        ai = modelChoices.profile === M ? modelChoices.items : [],
        [Fi, zd] = o("medium"),
        [_n, Xd] = o(!1),
        [vn, U0] = o([]),
        [Uo, Wd] = o(""),
        [Yo, qd] = o(!0),
        [Rs, Fl] = o(""),
        [yn, Fr] = o(null),
        [Y0, Pt] = o(""),
        [G0, Hl] = o(""),
        [vM, yM] = o(0),
        [Ls, Ms] = o(!1),
        er = s(null),
        Vn = s(0),
        K0 = s(0),
        Go = s(0),
        J0 = s("");
      s(0);
      const Vl = s(""),
        tr = s(0),
        Ai = s(0),
        wM = s(null),
        Zd = s(null),
        jd = s(null),
        Fd = s(null),
        Ul = s(new Map()),
        Hi = s(!0),
        kr = s(M);
      ((kr.current = M),
        (Y.current = k),
        (te.current = B),
        r(() => {
          A?.(f, { sessionId: k, hermesSessionId: B });
        }, [B, A, f, k]),
        r(
          () => (
            (Hi.current = !0),
            () => {
              Hi.current = !1;
              X.current += 1;
              g0(jr.current, pi.current, M, Y.current, te.current, Ji.current, Zi.current);
            }
          ),
          [],
        ),
        r(() => {
          if (!p) {
            ql(!1);
            return;
          }
          let L = !0;
          const U = () => {
            L && ql(b0());
          };
          U();
          const ee =
            typeof MutationObserver > "u" ? null : new MutationObserver(U);
          return (
            ee?.observe(document.body, { childList: !0, subtree: !0 }),
            () => {
              ((L = !1), ee?.disconnect());
            }
          );
        }, [p]));
      const Hd = t(() => {
        const L = Zd.current;
        (L?.open && L.close(), We(null), kt(""));
        const U = jd.current;
        U &&
          (U.focus(),
          window.setTimeout(() => {
            U.isConnected && U.focus();
          }, 0));
      }, []);
      (r(
        () => () => {
          const L = Zd.current;
          L?.open && L.close();
        },
        [],
      ),
        r(() => {
          if (!ie) return;
          ie &&
            F0.current
              ?.querySelector(".codex-options-popover button:not(:disabled)")
              ?.focus({ preventScroll: true });
          const L = (ee) => {
              ee.target instanceof Element &&
                !ee.target.closest(
                  ".codex-options-popover, .codex-option-toggle",
                ) &&
                re(!1);
            },
            U = (ee) => {
              if (ee.key === "Escape") {
                if ((ee.preventDefault(), ie && me !== "main")) {
                  ye("main");
                  return;
                }
                (re(!1), jl.current?.focus());
              }
            };
          return (
            document.addEventListener("pointerdown", L),
            document.addEventListener("keydown", U),
            () => {
              (document.removeEventListener("pointerdown", L),
                document.removeEventListener("keydown", U));
            }
          );
        }, [ie, me]),
        r(() => {
          if (!ae) return;
          const L = (ne) => {
              ae &&
                ne.target instanceof Element &&
                !ne.target.closest(
                  ".codex-session-row-menu, .codex-session-row-menu-toggle",
                ) &&
                Ce("");
            },
            U = (ne) => {
              if (ne.key !== "Escape") return;
              ne.preventDefault();
              const xe = ae;
              (Ce(""),
                xe &&
                  window.requestAnimationFrame(() =>
                    Ul.current.get(xe)?.focus(),
                  ));
            };
          (document.addEventListener("pointerdown", L),
            document.addEventListener("keydown", U));
          const ee = (ne) => {
            (ne.target instanceof Element &&
              ne.target.closest(".codex-session-row-menu")) ||
              Ce("");
          };
          return (
            document.addEventListener("scroll", ee, !0),
            window.addEventListener("resize", ee),
            () => {
              (document.removeEventListener("pointerdown", L),
                document.removeEventListener("keydown", U),
                document.removeEventListener("scroll", ee, !0),
                window.removeEventListener("resize", ee));
            }
          );
        }, [ae]),
        r(
          () => () => {
            Hn.current && clearTimeout(Hn.current);
          },
          [],
        ));
      if (!kanbanChatContext.current) kanbanChatContext.current = createKanbanChatContext(window.location.search, j, !!p);
      const xr = t(
        (L) => {
          ((X.current += 1),
            g0(
              jr.current,
              pi.current,
              M,
              Y.current,
              te.current,
              Ji.current,
              Zi.current,
            ));
          const U = On(M, L),
            ee = jr.current.get(U) || "";
          ((Ji.current = ee), Ot(ee));
          const ne = pi.current.get(U) || [];
          ((Zi.current = ne),
            _e(ne),
            (Vo.current = !0),
            (Y.current = L),
            (J0.current = `${M}\0${L}\0`),
            ht([]), Fr(null),
            (te.current = ""),
            er.current?.close(),
            (er.current = null),
            Nt(!1),
            Ms(!1),
            Wr(!1),
            Wi(""),
            N(L),
            T(""),
            Bi(null),
            ve(""),
            Zr(!1),
            re(!1),
            ye("main"),
            qi(!1),
            bn(""),
            As(""));
          const xe = new URL(window.location.href);
          if (!kanbanChatContext.current.matches(L)) {
            kanbanChatContext.current.clear();
            xe.searchParams.delete("kanban_task");
            xe.searchParams.delete("kanban_board");
          }
          (L
            ? xe.searchParams.set("session", L)
            : xe.searchParams.delete("session"),
            xe.searchParams.delete("hermesSession"),
            xe.searchParams.set("profile", M),
            window.history.replaceState(null, "", xe));
        },
        [M],
      );
      r(() => {
        const L = Ho.current;
        L && Vo.current && (L.scrollTop = L.scrollHeight);
      }, [It, k]);
      const Yl = t((workspaceId) => {
          if (typeof workspaceId === "string") Wd(workspaceId);
          (xr(""),
            window.requestAnimationFrame(() =>
              V0.current?.focus({ preventScroll: !0 }),
            ));
        }, [xr]),
        Gl = t(
          (L) => {
            const U = L.trim();
            if (!U) return;
            ((X.current += 1),
              g0(
                jr.current,
                pi.current,
                M,
                Y.current,
                te.current,
                Ji.current,
                Zi.current,
              ),
              (Ji.current = ""),
              (Zi.current = []),
              (Y.current = ""),
              (te.current = U),
              er.current?.close(),
              (er.current = null),
              N(""),
              T(U),
              Ot(""),
              _e([]),
              ht([]),
              zi(null),
              _i(!1),
              Nt(!1),
              Ms(!1),
              Wr(!1),
              Wi(""),
              Fr(null),
              Pt(""),
              Zr(!1),
              re(!1),
              ye("main"),
              qi(!1),
              bn(""));
            const ee = new URL(window.location.href);
            (ee.searchParams.delete("session"),
              ee.searchParams.set("hermesSession", U),
              ee.searchParams.set("profile", M),
              window.history.replaceState(null, "", ee));
          },
          [M],
        ),
        ev = t(
          (L) => {
            if ($d(L)) {
              if ((Nl(), v)) {
                v(L);
                return;
              }
              xr(L);
            }
          },
          [v, xr],
        ),
        tv = t(
          (L) => {
            if ($d("", L)) {
              if ((Nl(), x)) {
                x(L);
                return;
              }
              Gl(L);
            }
          },
          [x, Gl],
        ),
        kM = t(() => {
          (Zr(!1), Nl(), gt(!0));
        }, []),
        xM = t(() => {
          (gt(!1),
            window.setTimeout(() => {
              if (_0(Fd.current)) return;
              const L = document.querySelectorAll(
                '[aria-label="Open navigation"], [aria-label="Open sessions"], [aria-label="打开全局导航"], [aria-label="打开会话列表"]',
              );
              for (const U of L) if (_0(U)) break;
            }, 0));
        }, []),
        Vd = t((L = "") => {
          (re(!1), ye("main"), bn(L.trim()), qi(!0));
        }, []),
        CM = t(() => {
          (qi(!1), bn(""), window.setTimeout(() => jl.current?.focus(), 0));
        }, []),
        iv = t(
          () => ({ sessionId: Y.current, hermesSessionId: te.current }),
          [],
        );
      r(() => {
        if (w)
          return w(f, {
            selectSession: xr,
            selectHermesHistory: Gl,
            startNewSession: Yl,
            openWorkspace: () => { Zr(false); Es(value => !value); },
            getTarget: iv,
          });
      }, [iv, w, f, Gl, xr, Yl]);
      const Kl = t((L) => {
        ((X.current += 1),
          er.current?.close(),
          (er.current = null),
          (Y.current = ""),
          N(""),
          ht([]),
          zi(null),
          Fr(null),
          Nt(!1),
          Ms(!1),
          Wr(!1),
          Wi(""),
          Ot(""),
          (Ji.current = ""),
          Re(L));
        const U = new URL(window.location.href);
        (U.searchParams.delete("session"),
          window.history.replaceState(null, "", U));
      }, []);
      (r(() => {
        Pt("");
        return subscribeChatLists(i.fetchJSON, M, () => Promise.all([
          i0(i.fetchJSON, M), XL(i.fetchJSON, M), i0(i.fetchJSON, M, { deleted: !0 }),
        ]), {
          begin: () => {
            if (Ai.current > 0) return;
            const revision = tr.current;
            return ([$e, ze, Ge]) => {
              if (revision !== tr.current || Ai.current > 0) return;
              $((Ke) => stableChatList(Ke, $e.map((Me) => {
                const At = Ke.find((jt) => jt.id === Me.id);
                return At && At.title !== At.id && Me.title === Me.id
                  ? { ...Me, title: At.title } : Me;
              })));
              V(previous => stableChatList(previous, ze));
              G(previous => stableChatList(previous, Ge));
              const zt = Y.current;
              if (zt && Ge.some((Ke) => Ke.id === zt))
                Kl(runtimeText("当前会话已归档，已停止发送；可在“已归档”中恢复。", "This session is archived and sending is disabled. Restore it from Archived."));
            };
          },
          error: error => Pt(String(error)),
        });
      }, [Kl, M]),
        r(() => {
          let L = !0,
            U = !1;
          const ee = () => {
            U ||
              ((U = !0),
              _r(!0),
              jR(i.fetchJSON, M)
                .then((xe) => {
                  L &&
                    (ct(xe.sessions),
                    ot(xe.total),
                    Ne(xe.listedTotal),
                    br(xe.complete),
                    vr(""));
                })
                .catch((xe) => {
                  L && vr(runtimeText(`Hermes 历史读取失败：${String(xe)}`, `Could not load Hermes history: ${String(xe)}`));
                })
                .finally(() => {
                  ((U = !1), L && _r(!1));
                }));
          };
          ee();
          const ne = () => {
            document.visibilityState === "visible" && ee();
          };
          return (
            window.addEventListener("focus", ee),
            document.addEventListener("visibilitychange", ne),
            () => {
              ((L = !1),
                window.removeEventListener("focus", ee),
                document.removeEventListener("visibilitychange", ne));
            }
          );
        }, [M, Tt]),
        r(() => {
          const L =
            ai.find((U) => U.id === Bt) ||
            (Bt ? void 0 : ai.find((U) => U.isDefault));
          L?.efforts.length &&
            !L.efforts.includes(Fi) &&
            zd(L.defaultEffort || L.efforts[0]);
        }, [Fi, Bt, ai]),
        r(() => {
          let L = !0;
          bM("");
          setModelChoices({ profile: M, items: [] });
          if (B) {
            (qd(!1), Fl(""));
            return;
          }
          return (
            qd(!0),
            Fl(""),
            UL(i.fetchJSON, M)
              .then((U) => {
                L &&
                  (U0(U),
                  Wd((ee) =>
                    U.some((ne) => ne.id === ee) ? ee : U[0]?.id || "",
                  ),
                  Fl(""));
              })
              .catch((U) => {
                L && (U0([]), Wd(""), Fl(runtimeText(`工作区读取失败：${String(U)}`, `Could not load workspace: ${String(U)}`)));
              })
              .finally(() => {
                L && qd(!1);
              }),
            YL(i.fetchJSON, M)
              .then((U) => {
                if (L) {
                  const defaults = U.find(model => model.isDefault);
                  zd(defaults?.defaultEffort || "medium");
                  Xd(!!defaults?.defaultFast);
                  setModelChoices({ profile: M, items: U });
                }
              })
              .catch((U) => {
                L && Pt(runtimeText(`模型列表读取失败：${String(U)}`, `Could not load models: ${String(U)}`));
              }),
            () => {
              L = !1;
            }
          );
        }, [B, M]),
        r(() => {
          const L = `${M}\0${k}\0${B}`;
          const $t = k && !B ? `${M}\0${k}` : "";
          const Pt = $t ? codexSnapshotCache.get($t) : null;
          J0.current !== L &&
            ((J0.current = L),
            (X.current += 1),
            Pt ? (ht(Pt.messages), Wi(Pt.turnId), Nt(!!Pt.turnId)) : (ht([]), Wi("")),
            Fr(null));
          const U = X.current,
            ee = ++K0.current;
          if ((Hl(""), (Go.current = Vn.current), !k || B)) {
            (zi(null), _i(!1));
            return;
          }
          let ne = !0;
          const xe = Vn.current;
          return (
            _i(!Pt),
            !Pt &&
              previewCodexSession(i.fetchJSON, M, k)
                .then((ue) => {
                  if (!ue || !ne || U !== X.current || Y.current !== k || Vn.current !== xe) return;
                  rememberCodexSnapshot($t, ue);
                  ht(ue.messages);
                  Wi(ue.turnId);
                  Nt(!!ue.turnId);
                  Fr(Wo(ue.pendingApprovals.at(-1)));
                  _i(!1);
                })
                .catch(() => {}),
            wd(i.fetchJSON, M, k)
              .then((ue) => {
                rememberCodexSnapshot($t, ue);
                if (!ne || U !== X.current || Y.current !== k) return;
                if (
                  ((Go.current = Math.max(Go.current, Vn.current)),
                  Hl(""),
                  Vn.current === xe)
                ) {
                  (ht(ue.messages), Wi(ue.turnId), Nt(!!ue.turnId));
                  const $e = ue.pendingApprovals.at(-1);
                  Fr(Wo($e));
                }
                zi({
                  id: ue.session?.workspacePath || ue.session?.workspace || k,
                  name: ue.session?.workspace || runtimeText("工作区", "Workspace"),
                  path: ue.session?.workspacePath || "",
                  profile: M,
                  sessionId: k,
                });
                const Ie = ue.messages.find(($e) => $e.role === "user");
                (Ie?.content &&
                  $(($e) =>
                    $e.map((ze) =>
                      ze.id === k
                        ? {
                            ...ze,
                            title: resolveSessionTitle(ze, ue.session, Ie.content),
                          }
                        : ze,
                    ),
                  ),
                  ue.lastCompletedSeq > ue.readSeq &&
                    Pd() &&
                    Vo.current &&
                    (kd(i.fetchJSON, M, k, ue.lastCompletedSeq).catch(() => {}),
                    $(($e) =>
                      $e.map((ze) =>
                        ze.id === k
                          ? { ...ze, unread: !1, readSeq: ue.lastCompletedSeq }
                          : ze,
                      ),
                    )));
              })
              .catch((ue) => {
                !ne ||
                  U !== X.current ||
                  Y.current !== k ||
                  (y5(ee, K0.current, xe, Go.current) && Hl(v5(ue)));
              })
              .finally(() => {
                ne && U === X.current && _i(!1);
              }),
            () => {
              ne = !1;
            }
          );
        }, [B, vM, M, k]),
        r(() => {
          if ((Bi(null), ve(""), !B)) {
            Et(!1);
            return;
          }
          const L = ++X.current,
            U = B;
          let ee = !0;
          return (
            Et(!0),
            h_(i.fetchJSON, M, U)
              .then((ne) => {
                !ee || L !== X.current || te.current !== U || Bi(ne);
              })
              .catch((ne) => {
                ee &&
                  L === X.current &&
                  te.current === U &&
                  ve(runtimeText(`Hermes 历史读取失败：${String(ne)}`, `Could not load Hermes history: ${String(ne)}`));
              })
              .finally(() => {
                ee && L === X.current && te.current === U && Et(!1);
              }),
            () => {
              ee = !1;
            }
          );
        }, [vt, B, M]),
        r(() => {
          const L = X.current;
          if (!k || B) return;
          let U = !1;
          const updates = createChatEventBatch(events => {
            if (L === X.current && Y.current === k)
              ht(messages => events.reduce((current, event) => c0(current, event), messages));
          });
          const ee = (Ge) => {
            if (Ge.type === "heartbeat" || L !== X.current || Y.current !== k)
              return;
            if (Ge.type === "snapshot") {
              updates.clear();
              ((Vn.current += 1), (Go.current = Vn.current), Hl(""), _i(!1));
              Pt(previous => previous === runtimeText("实时连接失败", "Realtime connection failed") ? "" : previous);
              const ft = s0(Ge, k);
              ((U = !0),
                (ne = ft.next),
                ht((Xt) => {
                  const ti = new Set(ft.messages.map((mi) => mi.id)),
                    St = Xt.filter(
                      (mi) =>
                        mi.role === "user" &&
                        (mi.status === "pending" || mi.status === "accepted") &&
                        !ft.messages.some(message => sameMessage(message, mi)),
                    );
                  return [...ft.messages, ...St];
                }),
                Wi(ft.turnId),
                Nt(!!ft.turnId),
                ft.turnId || Wr(!1));
              const Ft = ft.pendingApprovals.at(-1);
              (Fr(Wo(Ft)),
                ft.session &&
                  $((Xt) =>
                    Xt.map((ti) =>
                      ti.id === k ? { ...ti, ...ft.session } : ti,
                    ),
                  ));
              return;
            }
            const zt = Number(Ge.seq || 0);
            if (zt && zt <= ne) return;
            (zt && (ne = zt), (Vn.current += 1));
            const Ke =
                Ge.type === "event" &&
                Ge.payload &&
                typeof Ge.payload == "object"
                  ? Ge.payload
                  : Ge,
              Me = Ke.data && typeof Ke.data == "object" ? Ke.data : Ke,
              At = s5(Me);
            if (At && At !== Y.current) return;
            const jt = String(Me.method || "").toLowerCase();
            if (U && jt.startsWith("history/")) return;
            const Ri =
                Me.params && typeof Me.params == "object" ? Me.params : {},
              Un = Ri.turn && typeof Ri.turn == "object" ? Ri.turn : null;
            if (
              (jt.includes("turn/started") &&
                Un?.id &&
                (Wi(String(Un.id)),
                Nt(!0),
                $((ft) =>
                  ft.map((Ft) =>
                    Ft.id === k ? { ...Ft, status: "running" } : Ft,
                  ),
                )),
              jt.includes("turn/completed") || jt.includes("turn/failed"))
            ) {
              (Fr(null), Wr(!1), Wi(""), Nt(!1));
              const ft = Pd() && Vo.current,
                Ft = Number(Ge.seq || Me.seq || 0);
              ($((Xt) =>
                Xt.map((ti) =>
                  ti.id === k
                    ? {
                        ...ti,
                        status: jt.includes("failed") || Un?.status === "failed" ? "failed" : "completed",
                        unread: !ft,
                        lastCompletedSeq: Math.max(
                          ti.lastCompletedSeq || 0,
                          Ft,
                        ),
                      }
                    : ti,
                ),
              ),
                ft && Ft && kd(i.fetchJSON, M, k, Ft).catch(() => {}));
            }
            if (jt === "serverrequest/resolved") {
              wd(i.fetchJSON, M, k)
                .then((ft) => {
                  L === X.current &&
                    Y.current === k &&
                    Fr(Wo(ft.pendingApprovals.at(-1)));
                })
                .catch(() => {});
              return;
            }
            if (Me.id != null && Ri.approvalId) {
              (Nt(!0),
                Ri.turnId && Wi(String(Ri.turnId)),
                $((ft) =>
                  ft.map((Ft) =>
                    Ft.id === k ? { ...Ft, status: "waiting" } : Ft,
                  ),
                ),
                Fr(Wo({ ...Me, params: Ri })));
              return;
            }
            ((Me.type === "turn_complete" || Me.type === "complete") && Nt(!1),
              (Me.type === "turn_failed" || Me.type === "error") && Nt(!1));
            const Hr = Ge.type === "event" ? Ge : Me;
            updates.push({ ...Hr, type: Hr.type || "event" });
            if (jt.includes("turn/completed") || jt.includes("turn/failed") || Me.type === "error")
              updates.flush();
          };
          let ne = 0;
          const disconnect = connectRealtime(E5(M, k), {
            socket: socket => { er.current = socket; },
            message: event => {
              if (L !== X.current || Y.current !== k) return;
              let message;
              try { message = JSON.parse(String(event.data)); } catch { return; }
              ee(message);
            },
            error: () => {
              if (L === X.current && Y.current === k) Pt(runtimeText("实时连接失败", "Realtime connection failed"));
            },
            open: () => {
              if (L === X.current && Y.current === k)
                Pt(previous => previous === runtimeText("实时连接失败", "Realtime connection failed") ? "" : previous);
            },
          });
          return () => { disconnect(); updates.clear(); };
        }, [B, M, k]));
      const Jl = q,
        ec = z,
        sv = Ye,
        ei = q.find((L) => L.id === k),
        PM = Ye.find((L) => L.id === B);
      r(() => {
        if (!ei || !k) return;
        const L = k,
          U = X.current,
          ee = ei.lastCompletedSeq || 0,
          ne = () => {
            const ue = Ho.current;
            if (
              !Pd() ||
              !ue ||
              ue.scrollHeight - ue.scrollTop - ue.clientHeight >= 64 ||
              !ee ||
              ee <= (ei.readSeq || 0)
            )
              return;
            const Ie = `${M}:${L}:${ee}`;
            Zl.current !== Ie &&
              ((Zl.current = Ie),
              kd(i.fetchJSON, M, L, ee)
                .then(() => {
                  U === X.current &&
                    $(($e) =>
                      $e.map((ze) =>
                        ze.id === L
                          ? {
                              ...ze,
                              unread: !1,
                              readSeq: Math.max(ze.readSeq || 0, ee),
                            }
                          : ze,
                      ),
                    );
                })
                .catch(() => {})
                .finally(() => {
                  Zl.current === Ie && (Zl.current = "");
                }));
          },
          xe = Ho.current;
        return (
          document.addEventListener("visibilitychange", ne),
          window.addEventListener("popstate", ne),
          xe?.addEventListener("scroll", ne),
          ne(),
          () => {
            (document.removeEventListener("visibilitychange", ne),
              window.removeEventListener("popstate", ne),
              xe?.removeEventListener("scroll", ne));
          }
        );
      }, [M, k, ei?.lastCompletedSeq, ei?.readSeq]);
      const Yd = n(() => {
          const L = i.authedFetch;
          return typeof L == "function" && L !== globalThis.fetch
            ? (U, ee) => L(U, ee)
            : (U, ee) =>
                globalThis.fetch(U, { ...ee, credentials: "same-origin" });
        }, [i]),
        Ko = t((L, U, ee, ne, xe) => {
          const Ie = (pi.current.get(L) || []).map(($e) =>
            $e.localId === U ? ee($e) : $e,
          );
          (pi.current.set(L, Ie),
            L === On(kr.current, Y.current) && !te.current &&
              ((Zi.current = Ie), _e(Ie)));
        }, []),
        ov = t(
          (L) => {
            if (!L.length) return;
            const U = On(M, Y.current);
            _e((ee) => {
              const ne = new Set(ee.map((Ie) => S0(Ie.file))),
                xe = L.filter((Ie) => {
                  const $e = S0(Ie);
                  return ne.has($e) ? !1 : (ne.add($e), !0);
                }).map(_5),
                ue = [...ee, ...xe];
              return (pi.current.set(U, ue), (Zi.current = ue), ue);
            });
          },
          [M],
        ),
        $M = t(
          (L) => {
            const U = On(M, Y.current);
            _e((ee) => {
              const ne = ee.map((xe) =>
                xe.localId === L
                  ? { ...xe, status: "pending", progress: 0, error: void 0 }
                  : xe,
              );
              return (pi.current.set(U, ne), (Zi.current = ne), ne);
            });
          },
          [M],
        ),
        TM = t(
          (L) => {
            const U = On(M, Y.current);
            _e((ee) => {
              const ne = ee.filter((xe) => xe.localId !== L);
              return (pi.current.set(U, ne), (Zi.current = ne), ne);
            });
          },
          [M],
        ),
        EM = t((L, U, ee, ne, xe) => {
          const ue = ji.current.get(L);
          if (!ue || ue.requestId !== U) return;
          const Ie = jr.current.get(L);
          (ne === X.current && Y.current === xe
            ? Ji.current || (jr.current.set(L, ee), (Ji.current = ee), Ot(ee))
            : Ie || jr.current.set(L, ee),
            ji.current.delete(L));
        }, []),
        av = t((L, U, ee, ne, xe, ue) => {
          const Ie = pi.current.get(L) || [],
            $e = new Set(ee.map((Ke) => Ke.localId)),
            ze = [...ee, ...Ie.filter((Ke) => !$e.has(Ke.localId))];
          (pi.current.set(L, ze),
            xe === X.current && Y.current === ue
              ? ((Zi.current = ze),
                _e(ze),
                Ji.current ||
                  (jr.current.set(L, ne), (Ji.current = ne), Ot(ne)))
              : jr.current.get(L) || jr.current.set(L, ne),
            ji.current.get(L)?.requestId === U && ji.current.delete(L));
        }, []),
        lv = t(
          async (L, U, ee, ne) => {
            const xe = [];
            for (const ue of ne) {
              if (ue.attachment?.id) {
                xe.push(ue.attachment.id);
                continue;
              }
              Ko(
                U,
                ue.localId,
                (Ie) => ({
                  ...Ie,
                  status: "uploading",
                  progress: 0,
                  error: void 0,
                }),
                ee,
                L,
              );
              try {
                const Ie = await e5(Yd, M, L, ue.file, ($e) =>
                  Ko(U, ue.localId, (ze) => ({ ...ze, progress: $e }), ee, L),
                );
                (xe.push(Ie.id),
                  Ko(
                    U,
                    ue.localId,
                    ($e) => ({
                      ...$e,
                      status: "uploaded",
                      progress: 1,
                      attachment: Ie,
                      error: void 0,
                    }),
                    ee,
                    L,
                  ));
              } catch (Ie) {
                throw (
                  Ko(
                    U,
                    ue.localId,
                    ($e) => ({ ...$e, status: "failed", error: String(Ie) }),
                    ee,
                    L,
                  ),
                  Ie
                );
              }
            }
            return xe;
          },
          [Yd, M, Ko],
        ),
        AM = async () => {
          const L = ei?.threadId;
          if (L)
            try {
              (await navigator.clipboard.writeText(L),
                As(L),
                Hn.current && clearTimeout(Hn.current),
                (Hn.current = setTimeout(() => As(""), 1600)));
            } catch {
              Pt(runtimeText("复制失败，请选中会话 ID 手动复制。", "Copy failed. Select and copy the session ID manually."));
            }
        },
        cv = t(
          async (L) => {
            const U = L.trim().match(/^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
            if (!U) return !1;
            const ee = U[1].toLowerCase(),
              ne = U[2]?.trim() || "",
              xe =
                ai.find((ue) => ue.id === Bt) || ai.find((ue) => ue.isDefault);
            return (
              Pt(""),
              ee === "goal"
                ? (Ot((ue) => (ue.startsWith("/") ? "" : ue)),
                  ne === "clear"
                    ? (Y.current
                        ? VL(i.fetchJSON, M, Y.current)
                            .then(() => Pt(runtimeText("目标已清除。", "Goal cleared.")))
                            .catch((ue) => Pt(String(ue)))
                        : Pt(runtimeText("请先开始对话。", "Start a conversation first.")))
                    : ["status", "show"].includes(ne.toLowerCase())
                      ? Vd()
                      : ["pause", "resume"].includes(ne.toLowerCase())
                        ? (Y.current
                            ? HL(i.fetchJSON, M, Y.current)
                                .then((ue) => {
                                  if (!ue) return Pt(runtimeText("当前会话没有目标。", "This session has no goal."));
                                  const xe = ne.toLowerCase() === "pause" ? "paused" : "active";
                                  return n0(i.fetchJSON, M, Y.current, { status: xe }).then(() => Pt(runtimeText(xe === "paused" ? "目标已暂停。" : "目标已启用。", xe === "paused" ? "Goal paused." : "Goal enabled.")));
                                })
                                .catch((ue) => Pt(String(ue)))
                            : Pt(runtimeText("请先开始对话。", "Start a conversation first.")))
                        : Vd(ne.replace(/^set\s+/i, "")))
                : ee === "new"
                  ? (Ot((ue) => (ue.startsWith("/") ? "" : ue)), xr(""))
                  : ee === "model" || ee === "reasoning"
                    ? (Ot((ue) => (ue.startsWith("/") ? "" : ue)),
                      ye(ee === "model" ? "model" : "effort"),
                      re(!0))
                    : ee === "fast" && xe?.fastServiceTier
                      ? (Ot((ue) => (ue.startsWith("/") ? "" : ue)),
                        Xd((ue) => !ue))
                      : ee === "status" || ee === "help"
                        ? (Ot((ue) => (ue.startsWith("/") ? "" : ue)),
                          ye("main"),
                          re(!0))
                        : ee === "stop" && Y.current && qr
                          ? (Ot((ue) => (ue.startsWith("/") ? "" : ue)),
                            o0(i.fetchJSON, M, Y.current, qr).catch((ue) =>
                              Pt(String(ue)),
                            ))
                          : Pt(
                              runtimeText(`/${ee} 尚未接入网页，请在 Dashboard 的终端中使用 Codex CLI。命令没有发送给模型。`, `/${ee} is not available on the web. Use Codex CLI in the Dashboard terminal. The command was not sent to the model.`),
                            ),
              !0
            );
          },
          [Bt, ai, Vd, M, xr, qr, i.fetchJSON],
        ),
        hv = t(async (action = "message", answerText = "") => {
          const questionAnswer = action === "question-answer";
          const writeback = action === "kanban-writeback";
          const kickoff = action === "kanban-start";
          const cardShortcut = writeback || kickoff || questionAnswer;
          if (kickoff && (!kanbanChatContext.current.matches(Y.current) || yr)) return;
          if (writeback && (!Y.current || !kanbanChatContext.current.matches(Y.current) || yr)) return;
          const L = questionAnswer ? answerText : writeback ? kanbanChatContext.current.writebackRequest(Y.current, M) : kickoff ? kanbanChatContext.current.startRequest(Y.current) : Ji.current.trim(),
            U = cardShortcut ? [] : [...Zi.current],
            ee = L || (U.length ? S5 : "");
          if (!ee || submittingRef.current || Ls || (yr && !qr) || yn) return;
          if (!(await shouldSubmitComposerMessage(L, cv))) return;
          const steeringTurnId = yr ? qr : "";
          if (!ai.length) {
            Pt(runtimeText("模型配置尚未读取成功，请稍候或刷新后重试。", "Model settings have not loaded. Wait or refresh to retry."));
            return;
          }
          if (!Y.current && (!vn.length || !Uo || Yo || Rs)) {
            Pt(
              Rs ||
                (Yo
                  ? runtimeText("正在读取可用工作区，请稍候。", "Loading available workspaces. Please wait.")
                  : runtimeText("没有可用工作区，无法开始会话。", "No available workspace. Cannot start a session.")),
            );
            return;
          }
          submittingRef.current = true;
          setSubmitting(true);
          const ne = h0(),
            xe = X.current,
            ue = Y.current;
          let Ie = xe,
            $e = ue,
            ze = On(M, ue),
            Ge = !1,
            zt = [];
          ji.current.set(ze, { requestId: ne, content: L });
          const Ke = () => Hi.current && Ie === X.current && Y.current === $e;
          (!cardShortcut && ((Ji.current = ""), Ot("")),
            Nt(!0),
            Pt(""),
            ht((Me) => [
              ...Me,
              {
                id: ne,
                role: "user",
                observedAt: Date.now(),
                content: ee,
                status: "pending",
                paragraphs: [ee],
              },
            ]));
          try {
            const messageWithCard = questionAnswer ? ee : await kanbanChatContext.current.message(i.fetchJSON, ue, ee, { profile: M });
            let Me = ue;
            if (!Me) {
              const St = vn.find((ir) => ir.id === Uo) || vn[0],
                mi = Vl.current || (Vl.current = `session-${ne}`),
                tf =
                  ai.find((ir) => ir.id === Bt) ||
                  (Bt ? void 0 : ai.find((ir) => ir.isDefault)),
                pD = _n ? tf?.fastServiceTier : "default";
              ((Ai.current += 1), (tr.current += 1));
              let sc;
              try {
                sc = await KL(i.fetchJSON, M, {
                  model: Bt || tf?.id,
                  effort: Fi,
                  serviceTier: pD,
                  fast: _n,
                  cwd: St?.path,
                  workspaceId: St?.id,
                  sessionId: mi,
                });
              } finally {
                ((Ai.current = Math.max(0, Ai.current - 1)), (tr.current += 1));
              }
              (Vl.current === mi && (Vl.current = ""),
                (tr.current += 1),
                (Me = sc.id));
              await kanbanChatContext.current.bind(i.fetchJSON, M, ue, Me);
              const rf = ze,
                oc = On(M, Me),
                xv = ji.current.get(ze);
              (xv?.requestId === ne && ji.current.set(oc, xv),
                pi.current.set(oc, cardShortcut ? (pi.current.get(rf) || []) : U),
                cardShortcut && Ke() && jr.current.set(oc, Ji.current),
                Ke() &&
                  (xr(Me),
                  (Ie = X.current),
                  ($e = Me),
                  (ze = oc),
                  Nt(!0),
                  $((ir) => [sc, ...ir.filter((gD) => gD.id !== sc.id)])));
              const mD = new Set(U.map((ir) => ir.localId)),
                OD = pi.current.get(rf) || [];
              (pi.current.set(
                rf,
                cardShortcut ? [] : OD.filter((ir) => !mD.has(ir.localId)),
              ),
                ji.current.delete(rf),
                Ke() && (ze = oc));
            }
            const At = On(M, Me);
            ze = At;
            let jt = [];
            if (U.length) {
              Ke() && Ms(!0);
              try {
                jt = await lv(Me, At, Ie, U);
              } finally {
                Ke() && Ms(!1);
              }
            }
            Ke() && Nt(!0);
            const Ri = new Set(U.map((St) => St.localId)),
              Un = pi.current.get(At) || [];
            zt = Un.filter((St) => Ri.has(St.localId));
            const Hr = Un.filter((St) => !Ri.has(St.localId));
            (pi.current.set(At, Hr),
              At === On(kr.current, Y.current) && !te.current && ((Zi.current = Hr), _e(Hr)),
              (Ge = !0));
            const ft =
                ai.find((St) => St.id === Bt) ||
                (Bt ? void 0 : ai.find((St) => St.isDefault)),
              Ft = _n ? ft?.fastServiceTier : "default",
              Xt = await JL(
                i.fetchJSON,
                M,
                Me,
                messageWithCard,
                ne,
                {
                  model: Bt || ft?.id,
                  effort: Fi,
                  serviceTier: Ft,
                  fast: _n,
                  attachmentIds: jt,
                  expectedTurnId: steeringTurnId || undefined,
                },
                Yd,
              );
            if (Xt.accepted || Xt.status === "accepted" || Xt.status === "completed")
              kanbanChatContext.current.acknowledge(Me, messageWithCard);
            if (
              (Xt.status === "failed" && !cardShortcut && av(At, ne, zt, L, Ie, $e),
              ji.current.get(At)?.requestId === ne && ji.current.delete(At),
              !Ke())
            )
              return;
            (Xt.turnId && Wi(Xt.turnId),
              ht((St) =>
                St.map((mi) =>
                  mi.id === ne
                    ? {
                        ...mi,
                        submissionError: Xt.error,
                        status:
                          Xt.status === "failed"
                            ? "failed"
                            : Xt.status === "accepted"
                              ? "accepted"
                              : "pending",
                      }
                    : mi,
                ),
              ),
              Xt.status === "failed" && (!steeringTurnId && Nt(!1), Pt(Xt.error || (steeringTurnId ? runtimeText("追加指令未被接受", "The steering instruction was not accepted") : runtimeText("发送失败", "Send failed")))),
              !Xt.accepted &&
                Xt.status === "pending" &&
                Pt(runtimeText("已提交，等待接入层确认", "Submitted; awaiting confirmation")),
              !Xt.accepted &&
                Xt.status === "unknown" &&
                Pt(runtimeText("请求状态未知，等待确认；为避免重复发送，请等待会话恢复", "Request status is unknown. Wait for recovery to avoid sending twice.")));
          } catch (Me) {
            if (
              (cardShortcut
                ? (ji.current.get(ze)?.requestId === ne && ji.current.delete(ze))
                : Ge
                ? Qd(Me)
                  ? av(ze, ne, zt, L, Ie, $e)
                  : ji.current.get(ze)?.requestId === ne &&
                    ji.current.delete(ze)
                : EM(ze, ne, L, Ie, $e),
              !Ke())
            )
              return;
            if (
              (ht((At) =>
                At.map((jt) =>
                  jt.id === ne
                    ? { ...jt, submissionError: String(Me), status: Ge && !Qd(Me) ? "pending" : "failed" }
                    : jt,
                ),
              ),
              Ge)
            ) {
              if (Qd(Me)) {
                (!steeringTurnId && Nt(!1), Pt(String(Me)));
                return;
              }
              Pt(runtimeText("请求状态未知，等待确认；为避免重复发送，请等待会话恢复", "Request status is unknown. Wait for recovery to avoid sending twice."));
              return;
            }
            (!steeringTurnId && Nt(!1), Ms(!1), Pt(String(Me)));
          } finally {
            submittingRef.current = false;
            if (Hi.current) setSubmitting(false);
          }
        }, [Ls, Fi, cv, _n, Bt, ai, M, xr, yr, qr, yn, lv, Uo, Rs, Yo, vn]),
        RM = t(async () => {
          if (!Y.current || Fn) return;
          const L = Y.current,
            U = X.current;
          Wr(!0);
          try {
            await o0(i.fetchJSON, M, L, qr);
          } catch (ee) {
            U === X.current && (Wr(!1), Pt(String(ee)));
          }
        }, [M, Fn, qr]),
        uv = t(
          async (L) => {
            if (!yn || !Y.current || jo.current) return;
            ((jo.current = !0), Xl(!0));
            const U = Y.current,
              ee = X.current;
            try {
              await t5(i.fetchJSON, M, U, yn.id, L);
              if (ee === X.current && Y.current === U) Fr(null);
              const ne = await wd(i.fetchJSON, M, U);
              ee === X.current &&
                Y.current === U &&
                Fr(Wo(ne.pendingApprovals.at(-1)));
            } catch (ne) {
              if (ee === X.current) {
                if (ne.requestDeliveryUnknown) Fr(null);
                Pt(String(ne));
              }
            } finally {
              ((jo.current = !1), Xl(!1));
            }
          },
          [yn, M],
        ),
        wn = t(
          async (L, U, ee) => {
            ((Ai.current += 1), (tr.current += 1));
            try {
              const ne = await jL(i.fetchJSON, M, L.id, U);
              if (!ne) throw new Error(runtimeText("服务端未返回会话组织状态", "The server returned no session organization state"));
              return !Hi.current || kr.current !== M
                ? null
                : ($((xe) =>
                    xe.map((ue) => (ue.id === ne.id ? { ...ue, ...ne } : ue)),
                  ),
                  G((xe) =>
                    U.deleted === !0
                      ? [ne, ...xe.filter((ue) => ue.id !== ne.id)]
                      : xe.filter((ue) => ue.id !== ne.id),
                  ),
                  Re(ee),
                  ne);
            } catch (ne) {
              return (Hi.current && kr.current === M && Pt(String(ne)), null);
            } finally {
              ((Ai.current = Math.max(0, Ai.current - 1)), (tr.current += 1));
            }
          },
          [M, i.fetchJSON],
        ),
        LM = t(
          (L) => {
            (Ce(""),
              wn(
                L,
                { favorite: !L.favorite },
                L.favorite ? runtimeText("已取消收藏", "Removed from favorites") : runtimeText("已加入收藏", "Added to favorites"),
              ));
          },
          [wn],
        ),
        dv = t(
          (L, U) => {
            Ce("");
            return wn(L, { groupId: U }, U ? runtimeText("已移入项目", "Moved into project") : runtimeText("已移出项目", "Removed from project"));
          },
          [wn],
        ),
        MM = t(
          (L) => {
            (Ce(""),
              !Dl(L) &&
                wn(L, { deleted: !0 }, runtimeText("会话已归档，可在“已归档”中恢复。", "Session archived. Restore it from Archived.")).then(
                  (U) => {
                    !U ||
                      !Hi.current ||
                      kr.current !== M ||
                      ($((ee) => ee.filter((ne) => ne.id !== L.id)),
                      L.id === Y.current &&
                        Kl(runtimeText("当前会话已归档，已停止发送；可在“已归档”中恢复。", "This session is archived and sending is disabled. Restore it from Archived.")));
                  },
                ));
          },
          [Kl, wn, M],
        ),
        Gd = t(
          (L) =>
            wn(L, { deleted: !1 }, runtimeText("会话已恢复", "Session restored")).then((U) =>
              !U || !Hi.current || kr.current !== M
                ? null
                : (G((ee) => ee.filter((ne) => ne.id !== L.id)),
                  $((ee) => [U, ...ee.filter((ne) => ne.id !== U.id)]),
                  U),
            ),
          [wn, M],
        ),
        DM = t(async (L) => !!(await Gd(L)), [Gd]),
        fv = t((L) => {
          (Ce(""),
            (jd.current = L || null),
            We({ mode: "new" }),
            lt(""),
            kt(""));
        }, []),
        IM = t(
          (L) => {
            fv(L);
          },
          [fv],
        ),
        NM = t((L, U) => {
          (Ce(""),
            (jd.current = U || null),
            We({ mode: "rename", group: L }),
            lt(L.name),
            kt(""));
        }, []),
        BM = t(async () => {
          if (J) return;
          const L = wt.trim();
          if (!L) {
            kt(runtimeText("请输入项目名称", "Enter a project name"));
            return;
          }
          if (be) {
            (kt(""), le(!0), (Ai.current += 1), (tr.current += 1));
            try {
              if (be.mode === "new") {
                const U = await WL(i.fetchJSON, M, L);
                if (!Hi.current || kr.current !== M) return;
                (V((ee) => [...ee.filter((ne) => ne.id !== U.id), U]),
                  Re(runtimeText(`已新建项目“${U.name}”`, `Created project “${U.name}”`)));
              } else {
                const U = await qL(i.fetchJSON, M, be.group.id, L);
                if (!Hi.current || kr.current !== M) return;
                (V((ee) => ee.map((ne) => (ne.id === U.id ? U : ne))),
                  Re(runtimeText("项目名称已更新", "Project name updated")));
              }
              Hd();
            } catch (U) {
              Hi.current && kr.current === M && kt(String(U));
            } finally {
              ((Ai.current = Math.max(0, Ai.current - 1)),
                (tr.current += 1),
                Hi.current && le(!1));
            }
          }
        }, [Hd, be, J, wt, M, i.fetchJSON]),
        zM = t(
          (L) => {
            window.confirm(runtimeText(`删除项目“${L.name}”？其中的会话会保留为临时会话。`, `Delete project “${L.name}”? Its sessions will remain as temporary sessions.`)) &&
              ((Ai.current += 1),
              (tr.current += 1),
              ZL(i.fetchJSON, M, L.id)
                .then(() => {
                  !Hi.current ||
                    kr.current !== M ||
                    (V((U) => U.filter((ee) => ee.id !== L.id)),
                    $((U) =>
                      U.map((ee) =>
                        ee.groupId === L.id ? { ...ee, groupId: null } : ee,
                      ),
                    ),
                    Re(runtimeText("项目已删除，会话已移至临时会话。", "Project deleted. Its sessions are now temporary sessions.")));
                })
                .catch((U) => {
                  Hi.current && kr.current === M && Pt(String(U));
                })
                .finally(() => {
                  ((Ai.current = Math.max(0, Ai.current - 1)),
                    (tr.current += 1));
                }));
          },
          [M, i.fetchJSON],
        ),
        tc =
          ai.find((L) => L.id === Bt) ||
          (Bt ? void 0 : ai.find((L) => L.isDefault)),
        XM = tc?.efforts.length ? tc.efforts : ["low", "medium", "high"],
        pv = !!(tc?.supportsFast && tc.fastServiceTier),
        Kd = {
          none: runtimeText("无", "None"),
          minimal: runtimeText("最低", "Minimal"),
          low: runtimeText("低", "Low"),
          medium: runtimeText("中", "Medium"),
          high: runtimeText("高", "High"),
          xhigh: runtimeText("极高", "Extra high"),
        },
        modelLabel = tc?.label || Bt || runtimeText("正在读取模型…", "Loading models…"),
        defaultModelLabel = ai.find((L) => L.isDefault)?.label,
        mv = [modelLabel, Kd[Fi] || Fi, _n ? "Fast" : runtimeText("标准", "Standard")].join(" · "),
        Ov = k
          ? Jt ||
            (ei?.workspacePath
              ? {
                  id: ei.workspacePath,
                  name: ei.workspace,
                  path: ei.workspacePath,
                  profile: M,
                  sessionId: k,
                }
              : null)
          : null,
        gv = n(() => {
          if (k)
            return async (L, U) => {
              const ee = L.replace(
                  "/api/plugins/workbench/files",
                  `${Ml}/files`,
                ).replace("/api/plugins/workbench/file", `${Ml}/file`),
                ne = ee.includes("?") ? "&" : "?",
                xe = i.fetchJSON;
              return xe(
                `${ee}${ne}profile=${encodeURIComponent(M)}&session_id=${encodeURIComponent(k)}`,
                U,
              );
            };
        }, [M, i.fetchJSON, k]),
        WM = n(
          () =>
            k
              ? (L) =>
                  `${Ml}/asset?profile=${encodeURIComponent(M)}&session_id=${encodeURIComponent(k)}&path=${encodeURIComponent(L)}`
              : void 0,
          [M, k],
        ),
        Sv = E ?? k,
        bv = D ?? B,
        qM = sv.map((L) =>
          W(
            e,
            "button",
            {
              key: L.id,
              type: "button",
              className: `codex-session-row codex-hermes-history-row${L.id === bv ? " is-active" : ""}`,
              onClick: () => tv(L.id),
              title: [L.title, L.updatedAt].filter(Boolean).join(`
`),
              "aria-label": runtimeText(`${L.title} · Hermes 历史`, `${L.title} · Hermes history`),
              "aria-current": L.id === bv ? "page" : void 0,
              "data-source": "hermes",
              "data-session-id": L.id,
            },
            W(e, "span", { className: "codex-session-title" }, L.title),
            L.updatedAt
              ? W(e, "time", { className: "codex-session-time" }, L.updatedAt)
              : null,
          ),
        ),
        ZM = bi
          ? W(
              e,
              "div",
              { className: "codex-hermes-history-status", role: "alert" },
              W(e, "span", null, bi),
              W(
                e,
                "button",
                { type: "button", onClick: () => xt((L) => L + 1) },
                runtimeText("重试", "Retry"),
              ),
            )
          : Ni && Ye.length === 0
            ? W(
                e,
                "div",
                { className: "codex-hermes-history-status", role: "status" },
                runtimeText("正在读取 Hermes 历史…", "Loading Hermes history…"),
              )
            : null,
        jM =
          !bi && !Ni && sv.length === 0
            ? W(
                e,
                "div",
                {
                  className: "codex-empty codex-hermes-history-status",
                  role: "status",
                },
                runtimeText("暂无 Hermes 历史", "No Hermes history"),
              )
            : null,
        FM =
          !bi && !ut
            ? W(
                e,
                "div",
                { className: "codex-hermes-history-status", role: "status" },
                runtimeText(`仅显示前 500 条 Hermes 历史记录（API 共报告 ${Zt} 条）`, `Showing the first 500 Hermes history records (API reported ${Zt} records)`),
              )
            : null,
        HM = W(
          e,
          "details",
          {
            open: !!B,
            className: "codex-workspace-group codex-hermes-history-group",
            "data-source": "hermes",
            "data-testid": "hermes-history-group",
          },
          W(
            e,
            "summary",
            { className: "codex-workspace-title codex-hermes-history-title" },
            W(e, "span", { title: runtimeText("Hermes 历史", "Hermes history") }, runtimeText("Hermes 历史", "Hermes history")),
            W(e, "span", null, Dt),
          ),
          ZM,
          jM,
          qM,
          FM,
        ),
        ic = (L, U = !1) => {
          const ee = $5(L),
            ne = w0(L),
            xe = ae === L.id;
          return W(
            e,
            "div",
            { className: "codex-session-row-wrap", key: L.id },
            W(
              e,
              "button",
              {
                type: "button",
                className: `codex-session-row${L.id === Sv ? " is-active" : ""}${U ? " is-archived" : ""}${L.favorite ? " is-favorite" : ""}${ee ? ` ${ee.className}` : ""}`,
                onClick: U ? void 0 : () => ev(L.id),
                title: [ne, ee?.label, L.updatedAt].filter(Boolean).join(`
`),
                "aria-label": `${ne}${ee ? `，${ee.label}` : ""}${L.favorite ? runtimeText("，已收藏", ", favorite") : ""}${U ? runtimeText("，已归档", ", archived") : ""}`,
                "aria-current": !U && L.id === Sv ? "page" : void 0,
                "aria-disabled": U ? !0 : void 0,
                disabled: U,
              },
            L.favorite
              ? W(e, "span", { className: "codex-session-favorite", 'aria-label': runtimeText("已收藏", "Favorite"), title: runtimeText("已收藏", "Favorite") }, "★")
              : null,
            W(e, "span", { className: "codex-session-title" }, ne),
              L.updatedAt
                ? W(e, "time", { className: "codex-session-time" }, L.updatedAt)
                : null,
            ),
            U
              ? W(
                  e,
                  "button",
                  {
                    type: "button",
                    className: "codex-session-row-menu-toggle",
                    onClick: () => Gd(L),
                    "aria-label": runtimeText(`恢复会话：${ne}`, `Restore session: ${ne}`),
                    title: runtimeText("恢复会话", "Restore session"),
                  },
                  runtimeText("恢复", "Restore"),
                )
              : W(
                  e,
                  e.Fragment,
                  null,
                  W(
                    e,
                    "button",
                    {
                      type: "button",
                      className: "codex-session-row-menu-toggle",
                      ref: ($e) => {
                        $e ? Ul.current.set(L.id, $e) : Ul.current.delete(L.id);
                      },
                      onClick: () => {
                        if (xe) {
                          Ce("");
                          return;
                        }
                        const $e = Ul.current.get(L.id),
                          ze = $e?.getBoundingClientRect();
                        let Ge = null;
                        for (
                          let ti = $e?.parentElement;
                          ti;
                          ti = ti.parentElement
                        ) {
                          const St = getComputedStyle(ti),
                            mi = St.willChange
                              .split(",")
                              .some((tf) => tf.trim() === "transform");
                          if (
                            St.transform !== "none" ||
                            St.perspective !== "none" ||
                            St.filter !== "none" ||
                            St.backdropFilter !== "none" ||
                            St.contain.includes("paint") ||
                            mi
                          ) {
                            Ge = ti;
                            break;
                          }
                        }
                        const zt = Ge?.getBoundingClientRect(),
                          Ke = 8,
                          Me = zt?.top || 0,
                          At = zt?.bottom || window.innerHeight,
                          jt = zt?.right || window.innerWidth,
                          Ri = ze?.top || Me + Ke,
                          Un = Ri - Me,
                          Hr = ze?.right || jt - Ke,
                          ft = Math.max(96, At - Ri - Ke),
                          Ft = Math.min(250, ft),
                          Xt = Math.max(Ke, Math.min(Un, At - Me - Ft - Ke));
                        (Xe({
                          top: Xt,
                          right: Math.max(Ke, jt - Hr),
                          maxHeight: Ft,
                          maxWidth: Math.max(160, Math.min(288, Hr - Ke)),
                        }),
                          Ce(L.id));
                      },
                      "aria-expanded": xe,
                      "aria-haspopup": "menu",
                      "aria-label": runtimeText(`会话操作：${ne}`, `Session actions: ${ne}`),
                      title: runtimeText("会话操作", "Session actions"),
                    },
                    "⋯",
                  ),
                  xe
                    ? W(
                        e,
                        "div",
                        {
                          className: "codex-session-row-menu",
                          role: "menu",
                          "aria-label": runtimeText(`${ne} 会话操作菜单`, `${ne} session actions menu`),
                          style: {
                            top: `${Qe.top}px`,
                            right: `${Qe.right}px`,
                            maxHeight: `${Qe.maxHeight}px`,
                            maxWidth: `${Qe.maxWidth}px`,
                          },
                        },
                        W(
                          e,
                          "button",
                          {
                            type: "button",
                            role: "menuitem",
                            onClick: () => LM(L),
                          },
                          L.favorite ? runtimeText("取消收藏", "Remove favorite") : runtimeText("收藏", "Favorite"),
                        ),
                        W(
                          e,
                          "button",
                          {
                            type: "button",
                            role: "menuitem",
                            disabled: Dl(L),
                            title: Dl(L)
                              ? runtimeText("运行中的会话不能归档", "Running sessions cannot be archived")
                              : runtimeText("归档会话（可恢复）", "Archive session (restorable)"),
                            onClick: () => MM(L),
                          },
                          Dl(L) ? runtimeText("运行中不可归档", "Cannot archive while running") : runtimeText("归档", "Archive"),
                        ),
                      )
                    : null,
                ),
          );
        },
        KM = ec.length ? W(e, "details", { className: "codex-archived-group" },
          W(e, "summary", { className: "codex-workspace-title" }, runtimeText("已归档", "Archived"), W(e, "span", null, ec.length)),
          ...ec.map((session) => ic(session, true))) : null,
        JM = be
          ? W(e, h, {
              dialog: be,
              dialogRef: Zd,
              inputRef: wM,
              name: wt,
              error: Ue,
              saving: J,
              onCancel: (L) => {
                (L.preventDefault(), Hd());
              },
              onChange: (L) => lt(L.target.value),
              onSubmit: () => {
                BM();
              },
            })
          : null,
        eD = W(e, c, {
          open: Qt,
          profile: M,
          sessionId: B ? "" : k,
          prefillObjective: Bd,
          fetchJSON: i.fetchJSON,
          triggerRef: jl,
          onClose: CM,
        }),
        tD = p
          ? W(e, l, {
              open: Le,
              sessions: q,
              archivedSessions: z,
              groups: Z,
              hermesSessions: Ye,
              hermesHistoryLoading: Ni,
              hermesHistoryComplete: ut,
              triggerRef: Fd,
              onClose: xM,
              onSelectSession: ev,
              onSelectHermes: tv,
              onRestoreArchived: DM,
            })
          : null,
        Jd = W(
          e,
          "div",
          { className: "codex-navigation-create-actions" },
          W(
            e,
            "button",
            {
              type: "button",
              className: "codex-session-search-trigger",
              ref: Fd,
              onClick: kM,
              "aria-label": runtimeText("搜索", "Search"),
              title: runtimeText("搜索", "Search"),
            },
            craftingIcon(e, "search"),
            W(e, "span", null, runtimeText("搜索", "Search")),
          ),
        ),
        rc = p
          ? W(
              e,
              "aside",
              {
                className: `codex-sidebar${wr ? " codex-sidebar-unified" : ""}${Wl ? " is-open" : ""}`,
                "aria-label": runtimeText("会话导航", "Session navigation"),
              },
              wr
                ? null
                : W(
                    e,
                    "header",
                    { className: "codex-sidebar-header" },
                    W(e, "strong", null, runtimeText("会话", "Sessions")),
                    Jd,
                    wr
                      ? null
                      : W(
                          e,
                          "button",
                          {
                            type: "button",
                            className: "codex-icon-button codex-mobile-menu",
                            onClick: () => Zr(!1),
                            "aria-label": runtimeText("关闭会话列表", "Close sessions"),
                          },
                          st(e, "close"),
                        ),
                  ),
              we
                ? W(
                    e,
                    "div",
                    { className: "codex-navigation-notice", role: "status" },
                    we,
                  )
                : null,
              W(
                e,
                "nav",
                { className: "codex-session-list", "aria-label": runtimeText("项目与会话", "Projects and sessions") },
                W(e, ProjectNavigation, {
                  profile: M,
                  sessions: Jl,
                  projects: Z,
                  activeSessionId: Sv,
                  renderSession: ic,
                  onPaneDragStart: onNavigationDragStart,
                  onPaneDragEnd: onNavigationDragEnd,
                  onCreate: IM,
                  onNewSession: () => { if ($d()) { Nl(); onNavigationNewTemporary?.(); } },
                  onRename: NM,
                  onDelete: zM,
                  onMove: dv,
                  history: W(e, e.Fragment, null, HM, KM),
                }),
              ),
            )
          : null;
      r(() => {
        if (!p || !wr || !rc) {
          Fp(f);
          return;
        }
        return (gx({ element: rc, toolbar: Jd, ownerPaneId: f }), () => Fp(f));
      }, [p, Jd, f, rc, wr]);
      const asyncQuestions = pendingAsyncQuestions(It);
      const iD = wr ? null : rc,
        rD = !yn && asyncQuestions
          ? W(e, CodexUserInput, { key: `${M}:${k}:${asyncQuestions.id}`, questions: asyncQuestions.questions,
              busy: submitting || Ls || (yr && !qr),
              onSubmit: answers => hv("question-answer", formatQuestionAnswers(asyncQuestions.questions, answers)) })
          : yn?.kind === "user-input"
          ? W(e, CodexUserInput, { key: `${M}:${k}:${yn.id}`, questions: yn.questions, busy: Zo, onSubmit: uv })
          : yn ? W(
              e,
              "div",
              { className: "codex-request", role: "alert" },
              W(e, "p", null, yn.text),
              W(
                e,
                "div",
                { className: "codex-request-actions" },
                yn.kind === "approval"
                  ? W(
                      e,
                      "button",
                      {
                        type: "button",
                        disabled: Zo,
                        onClick: () => {
                          uv("approve");
                        },
                      },
                      runtimeText("批准", "Approve"),
                    )
                  : null,
                yn.kind === "approval"
                  ? W(
                      e,
                      "button",
                      {
                        type: "button",
                        disabled: Zo,
                        onClick: () => {
                          uv("reject");
                        },
                      },
                      runtimeText("拒绝", "Reject"),
                    )
                  : null,
              ),
            )
          : null,
        ef = !!(vn.length && Uo && !Yo && !Rs),
        nD =
          !B && !k
            ? Yo
              ? W(
                  e,
                  "div",
                  {
                    className: "codex-workspace-picker-status",
                    role: "status",
                  },
                  runtimeText("正在读取可用工作区…", "Loading available workspaces…"),
                )
              : Rs
                ? W(
                    e,
                    "div",
                    {
                      className: "codex-workspace-picker-status is-error",
                      role: "alert",
                    },
                    Rs,
                  )
                : vn.length
                  ? vn.length > 1
                    ? W(
                        e,
                        "label",
                        { className: "codex-workspace-picker" },
                        W(e, "span", null, runtimeText("工作区", "Workspace")),
                        W(
                          e,
                          "select",
                          {
                            value: Uo,
                            onChange: (L) => Wd(L.target.value),
                            "aria-label": runtimeText("选择工作区", "Select workspace"),
                          },
                          ...vn.map((L) =>
                            W(
                              e,
                              "option",
                              { key: L.id, value: L.id, title: L.path },
                              L.name,
                            ),
                          ),
                        ),
                      )
                    : null
                  : W(
                      e,
                      "div",
                      {
                        className: "codex-workspace-picker-status is-error",
                        role: "alert",
                      },
                      runtimeText("没有可用工作区，无法开始新会话。", "No available workspace. Cannot start a new session."),
                    )
            : null,
        sD = (L) => {
          const U =
            ai.find((ee) => ee.id === L) ||
            (L ? void 0 : ai.find((ee) => ee.isDefault));
          (bM(L),
            U &&
              !U.efforts.includes(Fi) &&
              zd(U.defaultEffort || U.efforts[0] || "medium"),
            (!U?.supportsFast || !U.fastServiceTier) && Xd(!1),
            ye("main"));
        },
        wv = `codex-options-${f}`,
        oD = ie
          ? W(
              e,
              "div",
              {
                id: wv,
                className: "codex-options-popover",
                role: "dialog",
                "aria-label": runtimeText("聊天选项", "Chat options"),
              },
              me === "main"
                ? W(
                    e,
                    e.Fragment,
                    null,
                    W(
                      e,
                      "button",
                      {
                        type: "button",
                        className: "codex-setting-row",
                        onClick: () => ye("model"),
                        "aria-label": runtimeText("选择模型", "Select model"),
                      },
                      st(e, "cube"),
                      W(
                        e,
                        "span",
                        { className: "codex-setting-label" },
                        runtimeText("模型", "Models"),
                      ),
                      W(
                        e,
                        "span",
                        {
                          className: "codex-setting-value",
                          title: modelLabel,
                        },
                        modelLabel,
                      ),
                      st(e, "right"),
                    ),
                    W(
                      e,
                      "button",
                      {
                        type: "button",
                        className: "codex-setting-row",
                        onClick: () => ye("effort"),
                        "aria-label": runtimeText("选择推理深度", "Select reasoning effort"),
                      },
                      st(e, "reasoning"),
                      W(
                        e,
                        "span",
                        { className: "codex-setting-label" },
                        runtimeText("推理深度", "Reasoning effort"),
                      ),
                      W(
                        e,
                        "span",
                        { className: "codex-setting-value" },
                        Kd[Fi] || Fi,
                      ),
                      st(e, "right"),
                    ),
                    W(
                      e,
                      "button",
                      {
                        type: "button",
                        className: "codex-setting-row",
                        role: "switch",
                        "aria-checked": _n,
                        "aria-label": runtimeText("Fast 快速模式", "Fast mode"),
                        disabled: !pv,
                        title: pv
                          ? runtimeText("设置用于后续消息", "Applies to subsequent messages")
                          : runtimeText("当前模型未声明 Fast 能力", "The current model does not declare Fast support"),
                        onClick: () => Xd((L) => !L),
                      },
                      st(e, "bolt"),
                      W(
                        e,
                        "span",
                        { className: "codex-setting-label" },
                        runtimeText("Fast 快速模式", "Fast mode"),
                      ),
                      W(
                        e,
                        "span",
                        {
                          className: `codex-toggle-track${_n ? " is-on" : ""}`,
                          "aria-hidden": !0,
                        },
                        W(e, "span", null),
                      ),
                    ),
                    W(
                      e,
                      "button",
                      {
                        type: "button",
                        className: "codex-setting-row codex-goal-setting-row",
                        onClick: () => Vd(),
                        "aria-label": runtimeText("设置目标", "Set goal"),
                        title: runtimeText("设置目标", "Set goal"),
                      },
                      st(e, "goal"),
                      W(
                        e,
                        "span",
                        { className: "codex-setting-label" },
                        "/goal",
                      ),
                      st(e, "right"),
                    ),
                    W(
                      e,
                      "p",
                      { className: "codex-options-note" },
                      runtimeText("设置用于后续消息；也可直接输入 /goal clear、/goal status、/goal pause", "Applies to subsequent messages; or type /goal clear, /goal status, /goal pause"),
                    ),
                  )
                : W(
                    e,
                    e.Fragment,
                    null,
                    W(
                      e,
                      "button",
                      {
                        type: "button",
                        className: "codex-submenu-back",
                        onClick: () => ye("main"),
                        "aria-label": runtimeText("返回对话选项", "Back to chat options"),
                      },
                      st(e, "back"),
                      me === "model" ? runtimeText("模型", "Models") : runtimeText("推理深度", "Reasoning effort"),
                    ),
                    W(
                      e,
                      "div",
                      {
                        className: "codex-setting-choices",
                        role: "group",
                        "aria-label": me === "model" ? runtimeText("模型", "Models") : runtimeText("推理深度", "Reasoning effort"),
                      },
                      ...(me === "model"
                        ? [{ id: "", label: defaultModelLabel ? runtimeText(`默认：${defaultModelLabel}`, `Default: ${defaultModelLabel}`) : runtimeText("正在读取默认模型…", "Loading default model…") }, ...ai]
                        : XM.map((L) => ({ id: L, label: Kd[L] || L }))
                      ).map((L) =>
                        W(
                          e,
                          "button",
                          {
                            key: L.id,
                            type: "button",
                            className: "codex-setting-choice",
                            "aria-pressed": (me === "model" ? Bt : Fi) === L.id,
                            onClick: () => {
                              me === "model"
                                ? sD(L.id)
                                : (zd(L.id), ye("main"));
                            },
                          },
                          W(e, "span", null, L.label),
                          (me === "model" ? Bt : Fi) === L.id
                            ? st(e, "check")
                            : null,
                        ),
                      ),
                    ),
                  ),
            )
          : null,
        aD = se.length
          ? W(
              e,
              "div",
              {
                className: "codex-attachment-list",
                role: "list",
                "aria-label": runtimeText("待发送附件", "Pending attachments"),
              },
              ...se.map((L) => {
                const U =
                  L.status === "uploading"
                    ? (L.progress >= 1 ? runtimeText("正在确认附件…", "Confirming attachment…") : runtimeText("上传中…", "Uploading…"))
                    : L.status === "uploaded"
                      ? runtimeText("已上传", "Uploaded")
                      : L.status === "failed"
                        ? runtimeText("上传失败", "Upload failed")
                        : runtimeText("待上传", "Pending upload");
                return W(
                  e,
                  "div",
                  {
                    className: `codex-attachment-chip is-${L.status}`,
                    key: L.localId,
                    role: "listitem",
                    title: L.error || L.file.name,
                  },
                  W(
                    e,
                    "span",
                    { className: "codex-attachment-chip-main" },
                    W(
                      e,
                      "span",
                      { className: "codex-attachment-name" },
                      L.file.name || runtimeText("附件", "Attachments"),
                    ),
                    W(
                      e,
                      "span",
                      { className: "codex-attachment-size" },
                      b5(L.file.size),
                    ),
                  ),
                  W(
                    e,
                    "span",
                    {
                      className: "codex-attachment-status",
                      role: L.status === "failed" ? "alert" : "status",
                    },
                    U,
                  ),
                  L.status === "uploading"
                    ? W(
                        e,
                        "span",
                        {
                          className: "codex-attachment-progress",
                          "aria-hidden": !0,
                        },
                        W(e, "span", { style: { width: "100%" } }),
                      )
                    : null,
                  L.status === "failed"
                    ? W(
                        e,
                        "button",
                        {
                          type: "button",
                          className: "codex-attachment-retry",
                          onClick: () => $M(L.localId),
                          disabled: submitting || Ls,
                          "aria-label": runtimeText(`重试上传 ${L.file.name}`, `Retry upload ${L.file.name}`),
                        },
                        runtimeText("重试", "Retry"),
                      )
                    : null,
                  W(
                    e,
                    "button",
                    {
                      type: "button",
                      className: "codex-attachment-remove",
                      onClick: () => TM(L.localId),
                      disabled: submitting || Ls,
                      "aria-label": runtimeText(`移除附件 ${L.file.name}`, `Remove attachment ${L.file.name}`),
                      title: runtimeText(`移除附件 ${L.file.name}`, `Remove attachment ${L.file.name}`),
                    },
                    st(e, "close"),
                  ),
                );
              }),
            )
          : null,
        lD = W(
          e,
          "div",
          { className: "codex-composer-wrap", ref: F0 },
          W(
            e,
            "div",
            { className: "codex-composer" },
            W(e, "input", {
              ref: H0,
              className: "codex-attachment-input",
              name: "attachments",
              type: "file",
              multiple: !0,
              onChange: (L) => {
                (ov(Array.from(L.target.files || [])), (L.target.value = ""));
              },
              "aria-label": runtimeText("添加附件", "Add attachment"),
            }),
            aD,
            W(e, ChatComposerInput, {
              inputRef: V0,
              rows: 2,
              value: Ei,
              revision: draftState.revision,
              onDraft: (value) => { Ji.current = value; setHasDraft(!!value.trim()); },
              onPaste: (L) => {
                const U = Nc(L.clipboardData);
                U.length && (L.preventDefault(), L.stopPropagation(), ov(U));
              },
              onKeyDown: (L) => {
                shouldSendMessage(L, sendShortcut) &&
                  (L.preventDefault(), hv());
              },
              placeholder: runtimeText("输入消息…", "Type a message…"),
              "aria-label": runtimeText("消息输入", "Message input"),
            }),
            W(
              e,
              "div",
              { className: "codex-composer-actions" },
              W(
                e,
                "div",
                { className: "codex-composer-leading" },
                W(
                  e,
                  "button",
                  {
                    type: "button",
                    className: "codex-icon-button",
                    disabled: submitting || Ls,
                    onClick: () => H0.current?.click(),
                    "aria-label": runtimeText("添加附件", "Add attachment"),
                    title: runtimeText("添加附件（可多选）", "Add attachments (multiple allowed)"),
                  },
                  st(e, "paperclip"),
                ),
                W(
                  e,
                  "span",
                  { className: "codex-option-anchor" },
                  W(
                    e,
                    "button",
                    {
                      type: "button",
                      className: "codex-option-toggle",
                      ref: jl,
                      onClick: () => {
                        (ye("main"), re((L) => !L));
                      },
                      "aria-expanded": ie,
                      "aria-label": runtimeText("聊天选项", "Chat options"),
                      title: runtimeText("聊天选项", "Chat options"),
                      "aria-haspopup": "dialog",
                      "aria-controls": wv,
                    },
                    st(e, "options"),
                  ),
                  oD,
                ),
                W(
                  e,
                  "span",
                  { className: "codex-model-summary", title: mv },
                  mv,
                ),
              ),
              W(
                e,
                "div",
                { className: "codex-submit-actions" },
                kanbanChatContext.current.matches(k) && !B
                  ? W(e, "button", {
                      key: "kanban-writeback",
                      type: "button",
                      className: "codex-writeback",
                      disabled: !k || submitting || yr || Ls || !!yn,
                      title: !k ? runtimeText("先讨论卡片，再整理回写预览", "Discuss the card before preparing a writeback preview") : yr ? runtimeText("等待当前回复完成后回写", "Wait for the current reply before writing back") : runtimeText("整理回写预览，确认后保存；保留未发送的输入和附件", "Prepare a writeback preview, then confirm to save. Unsent text and attachments are preserved."),
                      "aria-label": runtimeText("回写卡片", "Write back to card"),
                      onClick: () => { hv("kanban-writeback"); },
                    }, st(e, "writeback"))
                  : null,
                yr
                  ? W(
                      e,
                      "button",
                      {
                        key: "stop",
                        type: "button",
                        className: "codex-stop",
                        "aria-label": Fn ? runtimeText("停止中…", "Stopping…") : runtimeText("停止", "Stop"),
                        disabled: !qr || Fn,
                        title: Fn
                          ? runtimeText("正在等待停止确认", "Awaiting stop confirmation")
                          : qr
                            ? runtimeText("停止当前回复", "Stop current response")
                            : runtimeText("请求正在准备中", "Preparing request"),
                        onClick: () => {
                          RM();
                        },
                      },
                      st(e, "stop"),
                    )
                  : null,
                W(
                  e,
                  "button",
                  {
                    key: "send",
                    type: "button",
                    className: "codex-send",
                    "aria-label": submitting ? runtimeText("发送中…", "Sending…") : yr ? runtimeText("追加指令", "Steer") : runtimeText("发送", "Send"),
                    disabled:
                      submitting || (yr && !qr) ||
                      Ls ||
                      !!yn ||
                      (!hasDraft && !se.length) ||
                      (!k && !ef),
                    onClick: () => {
                      hv();
                    },
                    title: yr
                      ? runtimeText("追加指令到当前回复（Steer）", "Steer the current response")
                      : !k && !ef
                        ? runtimeText("等待可用工作区", "Waiting for an available workspace")
                        : sendShortcutHint(sendShortcut),
                  },
                  st(e, "send"),
                ),
              ),
            ),
          ),
        ),
        cD = ce
          ? W(
              e,
              "div",
              { className: "codex-hermes-history-status", role: "alert" },
              W(e, "span", null, ce),
              W(
                e,
                "button",
                { type: "button", onClick: () => Kt((L) => L + 1) },
                runtimeText("重试", "Retry"),
              ),
            )
          : Ct
            ? W(
                e,
                "div",
                {
                  className: "codex-empty codex-hermes-history-status",
                  role: "status",
                },
                runtimeText("正在读取 Hermes 历史正文…", "Loading Hermes transcript…"),
              )
            : Ti
              ? W(e, a, { transcript: Ti })
              : W(
                  e,
                  "div",
                  { className: "codex-empty" },
                  runtimeText("没有可显示的 Hermes 历史正文", "No Hermes transcript to display"),
                ),
        hD = W(
          e,
          "footer",
          {
            className: "codex-hermes-history-footer",
            "data-testid": "hermes-history-footer",
            role: "status",
          },
          W(e, "span", null, runtimeText("这是 Hermes 历史记录，暂不支持直接续聊。", "This is a Hermes history record. Direct continuation is not supported yet.")),
          W(e, "button", { type: "button", onClick: Yl }, runtimeText("新建", "New")),
        ),
        uD = G0
          ? W(
              e,
              "div",
              {
                className: "hti-page-error codex-history-error",
                role: "alert",
                "data-testid": "codex-history-error",
              },
              W(e, "span", null, G0),
              W(
                e,
                "button",
                {
                  type: "button",
                  disabled: Xi,
                  onClick: () => yM((L) => L + 1),
                },
                runtimeText("重试", "Retry"),
              ),
            )
          : null,
        kv = B ? PM?.title || B : ei ? w0(ei) : runtimeText("新会话", "New session"),
        nc = Ts || !!B,
        dD = W(
          e,
          "section",
          { className: "codex-center", "data-file-base": Ov?.path || ei?.workspacePath || "/opt/data/workspace" },
          W(
            e,
            "header",
            { className: "codex-center-header" },
            p
              ? W(
                  e,
                  "button",
                  {
                    type: "button",
                    className: "codex-icon-button codex-mobile-menu",
                    onClick: () => {
                      (Es(!0), wr ? w5() : Zr(!0));
                    },
                    "aria-label": runtimeText("打开会话列表", "Open sessions"),
                  },
                  st(e, "menu"),
                )
              : null,
            W(
              e,
              "div",
              null,
              W(
                e,
                "strong",
                { className: "codex-center-title", title: kv },
                kv,
              ),
              B
                ? W(
                    e,
                    "span",
                    {
                      className:
                        "codex-center-subtitle codex-hermes-history-read-only",
                      "data-testid": "hermes-history-read-only",
                    },
                    runtimeText("Hermes 历史 · 只读", "Hermes history · Read-only"),
                  )
                : ei?.threadId
                  ? W(
                      e,
                      "button",
                      {
                        type: "button",
                        className: "codex-session-id",
                        title: runtimeText(`点击复制会话 ID：${ei.threadId}`, `Click to copy session ID: ${ei.threadId}`),
                        "aria-label": runtimeText("复制会话 ID", "Copy session ID"),
                        onClick: () => {
                          AM();
                        },
                      },
                      W(e, "span", null, ei.threadId),
                      st(e, Fo === ei.threadId ? "check" : "copy"),
                      W(
                        e,
                        "span",
                        { className: "codex-copy-feedback", role: "status" },
                        Fo === ei.threadId ? runtimeText("已复制", "Copied") : "",
                      ),
                    )
                  : null,
            ),
            _
              ? W(
                  e,
                  "button",
                  {
                    type: "button",
                    className: "codex-icon-button codex-pane-close",
                    onClick: O,
                    "aria-label": runtimeText("关闭当前窗格", "Close current pane"),
                    title: runtimeText("关闭当前窗格", "Close current pane"),
                  },
                  st(e, "close"),
                )
              : null,
          ),
          uD,
          Y0
            ? W(e, "div", { className: "hti-page-error", role: "alert" }, Y0)
            : null,
          W(
            e,
            "div",
            {
              className: "codex-message-list",
              ref: Ho,
              onScroll: () => {
                const L = Ho.current;
                L &&
                  (Vo.current =
                    L.scrollHeight - L.scrollTop - L.clientHeight < 64);
              },
              "aria-busy": B ? Ct : Xi,
            },
            !B && kanbanChatContext.current.matches(k)
              ? W(e, KanbanDiscussionPreview, {
                  context: kanbanChatContext.current,
                  sessionId: k,
                  empty: !Xi && It.length === 0,
                  busy: submitting || yr || Ls || !!yn || (!k && !ef),
                  onStart: () => hv("kanban-start"),
                })
              : null,
            B
              ? cD
              : Xi
                ? W(e, "div", { className: "codex-empty" }, runtimeText("读取记录中…", "Loading transcript…"))
                : It.length === 0
                  ? kanbanChatContext.current.matches(k) ? null : W(
                      e,
                      "div",
                      { className: "codex-empty" },
                      runtimeText("开始一段新的对话", "Start a new conversation"),
                    )
                  : W(e, Transcript, { messages: It }),
            B ? null : rD,
          ),
          (yn?.kind === "user-input" || asyncQuestions) ? W(e, "button", {
            type: "button", className: "codex-user-input-open",
            onClick: () => {
              const form = Ho.current?.querySelector(".codex-user-input");
              form?.scrollIntoView({ block: "nearest" });
              form?.querySelector("input")?.focus({ preventScroll: true });
            },
          }, runtimeText("回答问题", "Answer questions")) : null,
          B ? hD : nD,
          B ? null : lD,
        ),
        fD = W(
          e,
          "aside",
          {
            id: `codex-files-panel-${f}`,
            className: `codex-files${nc ? " is-collapsed" : ""}`,
            "aria-hidden": nc,
          },
          W(
            e,
            "header",
            { className: "codex-files-header" },
            W(e, "strong", null, runtimeText("文件", "Files")),
            B
              ? null
              : W(
                  e,
                  "button",
                  {
                    type: "button",
                    className: "codex-icon-button",
                    onClick: () => Es(!0),
                    "aria-label": runtimeText("关闭文件管理器", "Close file manager"),
                    title: runtimeText("关闭文件管理器", "Close file manager"),
                  },
                  st(e, "close"),
                ),
          ),
          W(
            e,
            "div",
            { className: "codex-files-content" },
            W(e, GlobalFileBrowser, { profile: M }),
          ),
        );
      return W(
        e,
        "main",
        {
          className: `codex-workbench${nc ? " is-files-collapsed" : ""}${p ? "" : " is-pane-without-navigation"}${wr ? " is-unified-navigation" : ""}`,
          "data-pane-id": f,
          "data-navigation-owner": p ? "true" : "false",
          "data-session-id": k,
          "data-hermes-session-id": B,
          "data-profile": M,
          onFocusCapture: m,
          onClick: m,
        },
        iD,
        dD,
        fD,
        JM,
        eD,
        tD,
        Wl || !nc
          ? W(e, "button", {
              type: "button",
              className: "codex-drawer-backdrop",
              "aria-label": runtimeText("关闭侧栏", "Close sidebar"),
              onClick: () => {
                (Zr(!1), Es(!0));
              },
            })
          : null,
      );
    }
    return function () {
      const S = new URLSearchParams(window.location.search),
        paneProfile = currentProfile(S),
        b = S.get("hermesSession") ? "" : S.get("session") || "",
        p = S.get("hermesSession") || "",
        [m, O] = o(m5(b, p)),
        [g, _] = o("pane-1"),
        [w, v] = o({ "pane-1": { sessionId: b, hermesSessionId: p } }),
        x = s(g),
        y = s(new Map()),
        paneDrag = s(null),
        [draggingPane, setDraggingPane] = o(false),
        [paneDropNotice, setPaneDropNotice] = o("");
      x.current = g;
      r(() => {
        const openWorkspace = () => y.current.get(x.current)?.openWorkspace();
        window.addEventListener("workbench:open-workspace", openWorkspace);
        const openFromRoute = () => {
          if (new URLSearchParams(location.search).get("workbench") !== "files") return;
          const url = new URL(location.href); url.searchParams.delete("workbench"); history.replaceState(null, "", url);
          openWorkspace();
        };
        const timer = setTimeout(openFromRoute, 0);
        window.addEventListener("popstate", openFromRoute);
        return () => { clearTimeout(timer); window.removeEventListener("workbench:open-workspace", openWorkspace); window.removeEventListener("popstate", openFromRoute); };
      }, []);
      const startPaneDrag = t((payload) => { paneDrag.current = payload; setDraggingPane(true); setPaneDropNotice(""); }, []);
      const endPaneDrag = t(() => { paneDrag.current = null; setDraggingPane(false); }, []);
      r(() => {
        const cancel = () => endPaneDrag();
        window.addEventListener("dragend", cancel);
        window.addEventListener("drop", cancel);
        window.addEventListener("blur", cancel);
        return () => { window.removeEventListener("dragend", cancel); window.removeEventListener("drop", cancel); window.removeEventListener("blur", cancel); };
      }, [endPaneDrag]);
      const C = t(
          (F, j) => (
            y.current.set(F, j),
            () => {
              y.current.get(F) === j && y.current.delete(F);
            }
          ),
          [],
        ),
        P = t((F, j) => {
          v((Q) => {
            const k = Q[F];
            return k?.sessionId === j.sessionId &&
              k.hermesSessionId === j.hermesSessionId
              ? Q
              : { ...Q, [F]: j };
          });
        }, []),
        E = t((F, j) => {
          j?.target?.closest?.(".codex-sidebar") || ((x.current = F), _(F));
        }, []),
        D = t((F) => {
          for (const [j, Q] of y.current)
            if (Q.getTarget().sessionId === F) {
              ((x.current = j), _(j));
              return;
            }
          const current = y.current.get(x.current);
          if (current && !current.getTarget().sessionId && !current.getTarget().hermesSessionId) {
            current.selectSession(F);
            return;
          }
          if (!Xo(m)) {
            setPaneDropNotice(runtimeText("已打开三个会话，请先关闭一个窗格再打开历史会话。", "Three sessions are open. Close a pane before opening another history session."));
            return;
          }
          const pane = { id: p5(m), initialSessionId: F, initialHermesSessionId: "" };
          const panes = O5(m, pane, x.current);
          O(panes);
          v(currentState => ({ ...currentState, [pane.id]: { sessionId: F, hermesSessionId: "" } }));
          x.current = pane.id;
          _(pane.id);
        }, [m, O, v, _]),
        A = t((F) => {
          for (const [j, Q] of y.current)
            if (Q.getTarget().hermesSessionId === F) {
              ((x.current = j), _(j));
              return;
            }
          const current = y.current.get(x.current);
          if (current && !current.getTarget().sessionId && !current.getTarget().hermesSessionId) {
            current.selectHermesHistory(F);
            return;
          }
          if (!Xo(m)) {
            setPaneDropNotice(runtimeText("已打开三个会话，请先关闭一个窗格再打开历史会话。", "Three sessions are open. Close a pane before opening another history session."));
            return;
          }
          const pane = { id: p5(m), initialSessionId: "", initialHermesSessionId: F };
          const panes = O5(m, pane, x.current);
          O(panes);
          v(currentState => ({ ...currentState, [pane.id]: { sessionId: "", hermesSessionId: F } }));
          x.current = pane.id;
          _(pane.id);
        }, [m, O, v, _]),
        R = t((workspaceId) => {
          y.current.get(x.current)?.startNewSession(workspaceId);
        }, []),
        M = t(
          (F = "", j = x.current) => {
            if (!Xo(m)) return;
            const Q = {
                id: p5(m),
                initialSessionId: F,
                initialHermesSessionId: "",
              },
              k = O5(m, Q, j);
            k.length !== m.length &&
              (O(k),
              v((N) => ({
                ...N,
                [Q.id]: { sessionId: F, hermesSessionId: "" },
              })),
              (x.current = Q.id),
              _(Q.id));
          },
          [m],
        ),
        H = t(
          (F) => {
            const j = g5(m, F, x.current);
            j.panes.length !== m.length &&
              (O(j.panes),
              v((Q) => {
                const k = { ...Q };
                return (delete k[F], k);
              }),
              (x.current = j.activePaneId),
              _(j.activePaneId));
          },
          [m],
        );
      r(() => installHomeChatNavigation(currentProfile(), { codex: D, hermes: A }), [D, A]);
      const dropPaneSessions = (event) => {
        const payload = event.dataTransfer?.getData(PANE_DRAG_TYPE);
        if (!payload || payload !== paneDrag.current) return;
        event.preventDefault(); event.stopPropagation(); endPaneDrag();
        let ids;
        try { ids = [...new Set(JSON.parse(payload).sessionIds)]; } catch { return; }
        let panes = m, targets = {}, active = x.current, opened = 0, skipped = 0;
        for (const sessionId of ids) {
          const existing = [...y.current].find(([, controller]) => controller.getTarget().sessionId === sessionId);
          if (existing) { active = existing[0]; continue; }
          if (!Xo(panes)) { skipped++; continue; }
          const pane = { id: p5(panes), initialSessionId: sessionId, initialHermesSessionId: "" };
          panes = O5(panes, pane, panes.at(-1).id);
          targets[pane.id] = { sessionId, hermesSessionId: "" };
          active = pane.id; opened++;
        }
        if (opened) { O(panes); v(current => ({ ...current, ...targets })); }
        x.current = active; _(active);
        setPaneDropNotice(!ids.length ? runtimeText("此项目暂无会话", "No sessions in this project") : skipped
          ? runtimeText(`最多同时打开三个窗格，${skipped} 个会话未打开；关闭窗格后可继续拖入`, `Up to three panes can be open. ${skipped} sessions were not opened; close a pane to drag in more.`)
          : !opened ? runtimeText("会话已打开，已切换到对应窗格", "Session already open; switched to its pane") : "");
      };
      return W(
        e,
        "div",
        {
          className: "codex-multi-pane",
          "data-testid": "codex-multi-pane",
          "data-pane-count": m.length,
          "data-active-pane-id": g,
          role: "region",
          "aria-label": runtimeText("Codex 多窗格工作台", "Codex multi-pane workspace"),
        },
        ...m.map((F, j) =>
          W(
            e,
            "section",
            {
              key: F.id,
              className: `codex-pane-slot${F.id === g ? " is-active" : ""}`,
              "data-pane-id": F.id,
              "data-active": F.id === g ? "true" : "false",
              "data-navigation-owner": j === 0 ? "true" : "false",
              tabIndex: 0,
              role: "group",
              "aria-label": runtimeText(`聊天窗格 ${j + 1}`, `Chat pane ${j + 1}`),
              onFocusCapture: (Q) => E(F.id, Q),
              onClick: (Q) => E(F.id, Q),
            },
            W(e, d, {
              paneId: F.id,
              initialSessionId: F.initialSessionId,
              initialHermesSessionId: F.initialHermesSessionId,
              navigationOwner: j === 0,
              onActivate: (Q) => E(F.id, Q),
              onClose: () => H(F.id),
              canClose: m.length > 1,
              onNewNearby: Xo(m) ? () => M("", F.id) : void 0,
              onRegister: C,
              onNavigationSelect: j === 0 ? D : void 0,
              onNavigationHermesSelect: j === 0 ? A : void 0,
              onNavigationNew: j === 0 ? R : void 0,
              onNavigationNewTemporary: j === 0 ? () => {
                if (!Xo(m)) {
                  setPaneDropNotice(runtimeText("已打开三个会话，请先关闭一个窗格再新建。", "Three sessions are open. Close a pane before creating another."));
                  return;
                }
                setPaneDropNotice("");
                M("", m.at(-1).id);
              } : void 0,
              onNavigationOpenNearby:
                j === 0 && Xo(m) ? (Q) => M(Q, x.current) : void 0,
              onNavigationDragStart: j === 0 ? startPaneDrag : void 0,
              onNavigationDragEnd: j === 0 ? endPaneDrag : void 0,
              onNavigationNewNearby:
                j === 0 && Xo(m) ? () => M("", x.current) : void 0,
              navigationActiveSessionId:
                j === 0 ? w[g]?.sessionId || "" : void 0,
              navigationActiveHermesSessionId:
                j === 0 ? w[g]?.hermesSessionId || "" : void 0,
              onTargetChange: P,
              profile: paneProfile,
            }),
          ),
        ),
        draggingPane ? W(e, "div", {
          className: "codex-pane-drop-zone", "data-testid": "codex-pane-drop-zone",
          onDragOver: event => { if (event.dataTransfer?.types.includes(PANE_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } },
          onDrop: dropPaneSessions,
        }, W(e, "span", null, runtimeText("松开以在右侧并排打开", "Drop to open alongside on the right"))) : null,
        paneDropNotice ? W(e, "div", { className: "codex-pane-drop-notice", role: "status" },
          W(e, "span", null, paneDropNotice), W(e, "button", { type: "button", "aria-label": runtimeText("关闭拖拽提示", "Dismiss drag notice"), onClick: () => setPaneDropNotice("") }, "×")) : null,
      );
    };
  }
  const k0 = new WeakMap(),
    x0 = new WeakMap(),
    R5 = ["aria-label", "title", "placeholder"];
  function C0(i, e) {
    const t = i.match(/^(.*[\u3400-\u9fff].*?)\s+\/\s+([A-Za-z].*)$/s);
    return t ? (e ? t[1] : t[2]).trim() : i;
  }
  function L5(i, e) {
    const t = k0.get(i) || i.data,
      r = C0(t, e);
    r !== t && (k0.set(i, t), i.data !== r && (i.data = r));
  }
  function Q0(i, e) {
    let t = x0.get(i);
    for (const r of R5) {
      const n = i.getAttribute(r),
        s = t?.get(r) || n;
      if (!s) continue;
      const o = C0(s, e);
      o !== s &&
        (t || ((t = new Map()), x0.set(i, t)),
        t.set(r, s),
        n !== o && i.setAttribute(r, o));
    }
  }
  function M5(i = document) {
    const e = Hf();
    i instanceof Element && Q0(i, e);
    for (const n of Array.from(i.querySelectorAll("*"))) Q0(n, e);
    const t = document.createTreeWalker(i, NodeFilter.SHOW_TEXT);
    let r = t.nextNode();
    for (; r; ) (L5(r, e), (r = t.nextNode()));
  }
  function D5() {
    if (window.__HERMES_WORKBENCH_LOCALE_OVERLAY__) return;
    window.__HERMES_WORKBENCH_LOCALE_OVERLAY__ = !0;
    const pending = new Set();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const roots = [...pending].filter(node => node.isConnected);
        pending.clear();
        for (const node of roots) {
          if (roots.some(parent => parent !== node && parent.contains(node))) continue;
          if (node.nodeType === Node.TEXT_NODE) L5(node, Hf());
          else if (node instanceof Element) M5(node);
        }
      });
    };
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes") {
          pending.clear();
          pending.add(document.documentElement);
          break;
        }
        for (const node of record.addedNodes) pending.add(node);
      }
      if (pending.size) schedule();
    }).observe(document.documentElement, {
      childList: !0, subtree: !0, attributes: !0, attributeFilter: ["lang"],
    });
    pending.add(document.documentElement);
    schedule();
  }
  const G5 = [
    ["", runtimeText("跟随配置", "Follow settings")],
    ["none", runtimeText("关闭思考", "Disable reasoning")],
    ["minimal", runtimeText("最小", "Minimal")],
    ["low", runtimeText("低", "Low")],
    ["medium", runtimeText("中", "Medium")],
    ["high", runtimeText("高", "High")],
    ["xhigh", runtimeText("极高", "Extra high")],
    ["max", runtimeText("最大", "Maximum")],
    ["ultra", runtimeText("超高", "Ultra")],
  ];
  function Qs(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function Ps(i, e = runtimeText("暂无", "None")) {
    if (i == null || i === "") return e;
    let t;
    if (typeof i == "number") t = i < 1e12 ? i * 1e3 : i;
    else {
      const r = Number(i);
      t =
        Number.isFinite(r) && r > 0
          ? r < 1e12
            ? r * 1e3
            : r
          : Date.parse(String(i));
    }
    return !Number.isFinite(t) || t <= 0
      ? String(i)
      : new Date(t).toLocaleString();
  }
  function R0(i) {
    const e = String(i.state ?? "").toLowerCase();
    return e === "paused" || (i.enabled === !1 && e !== "completed")
      ? "paused"
      : e === "completed" || e === "terminal"
        ? "completed"
        : i.last_status === "error" ||
            i.last_status === "failed" ||
            i.last_error
          ? "error"
          : i.enabled === !1
            ? "inactive"
            : "active";
  }
  function Ed(i) {
    return {
      active: runtimeText("启用", "Enable"),
      paused: runtimeText("已暂停", "Paused"),
      error: runtimeText("有错误", "Error"),
      completed: runtimeText("已完成", "Completed"),
      inactive: runtimeText("未启用", "Inactive"),
    }[i];
  }
  function L0(i) {
    const e =
      i.schedule_display || (typeof i.schedule == "string" ? i.schedule : null);
    if (e) return String(e);
    if (i.schedule && typeof i.schedule == "object") {
      const t = i.schedule;
      return String(t.expr || t.run_at || t.display || runtimeText("未设置计划", "No schedule"));
    }
    return runtimeText("未设置计划", "No schedule");
  }
  function Ad(i) {
    const e = String(i?.status ?? "").trim();
    return e
      ? {
          claimed: runtimeText("已领取", "Claimed"),
          running: runtimeText("执行中", "Running"),
          completed: runtimeText("完成", "Completed"),
          failed: runtimeText("失败", "Failed"),
          unknown: runtimeText("未知", "Unknown"),
        }[e] || e
      : "";
  }
  function M0(i) {
    return String(i.title || T0(i));
  }
  function D0(i) {
    return String(i.id || "");
  }
  function Rd(i) {
    return i.kind === "session"
      ? i.run.started_at || i.run.last_active || i.run.ended_at
      : i.execution.finished_at ||
          i.execution.started_at ||
          i.execution.claimed_at;
  }
  function I0(i, e = runtimeText("未设置", "Not set")) {
    return Array.isArray(i) ? i.join("、") || e : String(i ?? "").trim() || e;
  }
  function $s(i) {
    return i instanceof Error && i.message.trim()
      ? i.message
      : String(i || runtimeText("保存失败，请稍后重试", "Save failed. Please retry later."));
  }
  function Gt(i, e, t, r) {
    return Qs(
      i,
      "label",
      { className: "dashboard-cron-field" },
      Qs(i, "span", { className: "dashboard-cron-field-label" }, e),
      t,
      r ? Qs(i, "span", { className: "dashboard-cron-field-hint" }, r) : null,
    );
  }
  function Pi(i, e, t, r, n = {}) {
    return Qs(i, "input", {
      ...n,
      value: String(e[r] ?? ""),
      onChange: (s) => t({ [r]: s.target.value }),
    });
  }
  function K5(i) {
    const e = i.React,
      t = (r, n, ...s) => Qs(e, r, n, ...s);
    return function (n) {
      const s = n.mode === "create" ? runtimeText("新建定时任务", "New scheduled job") : runtimeText("编辑定时任务", "Edit scheduled job"),
        o = n.draft,
        a = n.onChange;
      return t(
        "dialog",
        {
          className: "dashboard-cron-modal",
          "aria-labelledby": "dashboard-cron-dialog-title",
          ref: (l) => {
            l && !l.open && typeof l.showModal == "function" && l.showModal();
          },
          onCancel: (l) => {
            (l.preventDefault(), n.onCancel());
          },
          onClick: (l) => {
            l.target === l.currentTarget && n.onCancel();
          },
        },
        t(
          "header",
          { className: "dashboard-cron-modal-header" },
          t(
            "div",
            null,
            t("h2", { id: "dashboard-cron-dialog-title" }, s),
            t(
              "p",
              null,
              runtimeText("字段沿用 Hermes 原生调度语义，保存时只提交当前配置身份。", "Fields use Hermes native scheduling. Saving submits only the selected profile identity."),
            ),
          ),
          t(
            "button",
            {
              type: "button",
              className: "dashboard-cron-icon-button",
              "aria-label": runtimeText("关闭编辑", "Close editor"),
              onClick: n.onCancel,
            },
            "×",
          ),
        ),
        t(
          "form",
          {
            className: "dashboard-cron-form",
            onSubmit: (l) => {
              (l.preventDefault(), n.onSubmit());
            },
          },
          t(
            "div",
            { className: "dashboard-cron-form-basic" },
            Gt(
              e,
              runtimeText("名称", "Name"),
              Pi(e, o, a, "name", {
                required: !0,
                autoFocus: !0,
                placeholder: runtimeText("例如：每日资料整理", "For example: Daily research review"),
              }),
            ),
            Gt(
              e,
              runtimeText("执行指令", "Instructions"),
              t("textarea", {
                value: o.prompt,
                rows: 4,
                placeholder: runtimeText("描述本次定时任务要完成的工作", "Describe what this job should accomplish"),
                onChange: (l) => a({ prompt: l.target.value }),
              }),
            ),
            Gt(
              e,
              runtimeText("执行计划", "Schedule"),
              t("input", {
                required: !0,
                value: o.schedule,
                placeholder: runtimeText("例如：0 9 * * *", "For example: 0 9 * * *"),
                onChange: (l) => a({ schedule: l.target.value }),
              }),
              runtimeText(`调度器时区：${n.timezoneLabel}`, `Scheduler timezone: ${n.timezoneLabel}`),
            ),
          ),
          t(
            "details",
            { className: "dashboard-cron-advanced" },
            t(
              "summary",
              null,
              t(
                "span",
                {
                  className: "dashboard-cron-summary-chevron",
                  "aria-hidden": !0,
                },
                "›",
              ),
              runtimeText("高级设置", "Advanced settings"),
            ),
            t(
              "div",
              { className: "dashboard-cron-advanced-grid" },
              Gt(
                e,
                runtimeText("模型", "Models"),
                Pi(e, o, a, "model", { placeholder: runtimeText("留空使用配置", "Leave empty to use profile settings") }),
              ),
              Gt(
                e,
                runtimeText("提供方", "Provider"),
                Pi(e, o, a, "provider", { placeholder: runtimeText("留空使用配置", "Leave empty to use profile settings") }),
              ),
              Gt(
                e,
                runtimeText("思考深度", "Reasoning effort"),
                t(
                  "select",
                  {
                    value: o.reasoning_effort,
                    onChange: (l) => a({ reasoning_effort: l.target.value }),
                  },
                  G5.map(([l, c]) =>
                    t("option", { key: l || "default", value: l }, c),
                  ),
                ),
              ),
              Gt(
                e,
                runtimeText("技能", "Skills"),
                Pi(e, o, a, "skills", { placeholder: runtimeText("以逗号分隔", "Comma-separated") }),
                runtimeText("多个技能使用逗号分隔", "Separate skills with commas"),
              ),
              Gt(
                e,
                runtimeText("工具范围", "Tool scope"),
                Pi(e, o, a, "enabled_toolsets", { placeholder: runtimeText("以逗号分隔", "Comma-separated") }),
                runtimeText("多个工具集使用逗号分隔", "Separate toolsets with commas"),
              ),
              Gt(
                e,
                runtimeText("工作目录", "Working directory"),
                Pi(e, o, a, "workdir", { placeholder: "/workspace/project" }),
              ),
              Gt(
                e,
                runtimeText("脚本", "Script"),
                t("textarea", {
                  value: o.script,
                  rows: 3,
                  placeholder: runtimeText("可选：先执行脚本并把输出交给 Agent", "Optional: run a script first and pass its output to the agent"),
                  onChange: (l) => a({ script: l.target.value }),
                }),
              ),
              Gt(
                e,
                runtimeText("历史上下文", "History context"),
                Pi(e, o, a, "context_from", {
                  placeholder: runtimeText("任务 ID，以逗号分隔", "Comma-separated job IDs"),
                }),
              ),
              Gt(
                e,
                runtimeText("结果投递", "Result delivery"),
                Pi(e, o, a, "deliver", { placeholder: runtimeText("local 或平台名称", "local or a platform name") }),
              ),
              Gt(
                e,
                runtimeText("失败投递", "Failure delivery"),
                Pi(e, o, a, "failure_deliver", {
                  placeholder: runtimeText("留空跟随结果投递", "Leave empty to follow result delivery"),
                }),
              ),
              Gt(
                e,
                runtimeText("基础地址", "Base URL"),
                Pi(e, o, a, "base_url", { placeholder: runtimeText("可选 API 地址", "Optional API URL") }),
              ),
              Gt(
                e,
                runtimeText("重复次数", "Repeat count"),
                Pi(e, o, a, "repeat_times", {
                  type: "number",
                  min: 1,
                  placeholder: runtimeText("留空表示持续", "Leave empty to continue indefinitely"),
                }),
              ),
              Gt(
                e,
                runtimeText("监测脚本", "Monitor script"),
                Pi(e, o, a, "monitor_script", {
                  placeholder: runtimeText("与监测 URL 二选一", "Choose either this or a monitor URL"),
                }),
              ),
              Gt(
                e,
                runtimeText("监测 URL", "Monitor URL"),
                Pi(e, o, a, "monitor_url", { placeholder: runtimeText("与监测脚本二选一", "Choose either this or a monitor script") }),
              ),
              t(
                "label",
                { className: "dashboard-cron-checkbox" },
                t("input", {
                  type: "checkbox",
                  checked: o.no_agent,
                  onChange: (l) => a({ no_agent: l.target.checked }),
                }),
                t("span", null, runtimeText("只运行脚本，不启动 Agent", "Run only the script, without an agent")),
              ),
              t(
                "label",
                { className: "dashboard-cron-checkbox" },
                t("input", {
                  type: "checkbox",
                  checked: o.attach_to_session,
                  onChange: (l) => a({ attach_to_session: l.target.checked }),
                }),
                t("span", null, runtimeText("附着到来源会话", "Attach to the source session")),
              ),
              t(
                "label",
                { className: "dashboard-cron-checkbox" },
                t("input", {
                  type: "checkbox",
                  checked: o.continuity,
                  onChange: (l) => a({ continuity: l.target.checked }),
                }),
                t("span", null, runtimeText("延续本任务上一次运行的上下文", "Continue context from the previous run")),
              ),
            ),
          ),
          n.error
            ? t(
                "p",
                { className: "dashboard-cron-form-error", role: "alert" },
                n.error,
              )
            : null,
          t(
            "footer",
            { className: "dashboard-cron-modal-actions" },
            t(
              "button",
              {
                type: "button",
                className: "dashboard-cron-button secondary",
                onClick: n.onCancel,
                disabled: n.saving,
              },
              runtimeText("取消", "Cancel"),
            ),
            t(
              "button",
              {
                type: "submit",
                className: "dashboard-cron-button primary",
                disabled: n.saving,
              },
              n.saving ? runtimeText("保存中…", "Saving…") : runtimeText("保存", "Save"),
            ),
          ),
        ),
      );
    };
  }
  function J5(i) {
    const e = i.React,
      t = i.hooks,
      r = (u, h, ...d) => Qs(e, u, h, ...d),
      n = K5(i),
      { HermesHistoryTimeline: s } = u_(i);
    function o(u) {
      return r(
        "svg",
        {
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": !0,
        },
        r("path", { d: u }),
      );
    }
    function a({ job: u, selected: h, onSelect: d }) {
      const f = R0(u);
      return r(
        "button",
        {
          type: "button",
          className: `dashboard-cron-job-row${h ? " is-selected" : ""}`,
          "aria-current": h ? "true" : void 0,
          title: String(u.name || u.prompt || u.id),
          onClick: d,
        },
        r(
          "span",
          { className: "dashboard-cron-job-row-title" },
          String(u.name || u.prompt || u.id),
        ),
        r("span", { className: "dashboard-cron-job-row-meta" }, L0(u)),
        r("span", { className: "dashboard-cron-job-row-tags" }, `${u.profile || "default"} · ${u.no_agent ? runtimeText("仅脚本", "Script only") : "AI"} · ${Ed(f)}`),
        r("span", {
          className: `dashboard-cron-status-dot ${f}`,
          "aria-label": Ed(f),
          title: Ed(f),
        }),
      );
    }
    function l({ label: u, value: h }) {
      return r(
        "div",
        { className: "dashboard-cron-detail-item" },
        r("dt", null, u),
        r("dd", null, h),
      );
    }
    function c({ profile: u = "default" }) {
      const [scope, setScope] = t.useState("all"),
        [h, d] = t.useState([]),
        [mobileDetail, setMobileDetail] = t.useState(false),
        [sidebarPrefs, setSidebarPrefs] = t.useState(() => readCronSidebarPrefs(u)),
        listRef = t.useRef(null),
        detailRef = t.useRef(null),
        [f, S] = t.useState(""),
        [b, p] = t.useState([]),
        [m, O] = t.useState([]),
        [g, _] = t.useState(""),
        [w, v] = t.useState("task"),
        [x, y] = t.useState(null),
        [C, P] = t.useState(!0),
        [E, D] = t.useState(!1),
        [A, R] = t.useState(!1),
        [M, H] = t.useState(""),
        [F, j] = t.useState(""),
        [Q, k] = t.useState(""),
        [N, B] = t.useState(0),
        [T, Y] = t.useState(null),
        [te, X] = t.useState(null),
        [q, $] = t.useState(""),
        [Z, V] = t.useState(!1),
        z = h.find((J) => J.id === f) || h[0] || null,
        owner = z?.profile || u,
        G = E0(b, m),
        ae = G.find((J) => J.key === g) || G[0] || null,
        Ce = ae?.kind === "session" ? ae.run : null;
      t.useEffect(() => { setSidebarPrefs(readCronSidebarPrefs(u)); }, [u]);
      const changeSidebar = (patch) => setSidebarPrefs(previous => {
        const next = {...previous, ...patch};
        try { localStorage.setItem('workbench.cron.sidebar.'+u, JSON.stringify(next)); } catch {}
        return next;
      });
      (t.useEffect(() => {
        let J = !0;
        return (
          P(!0),
          H(""),
          q5(i.fetchJSON, scope === "all" ? "all" : u)
            .then((le) => {
              J &&
                (d(le),
                S((we) =>
                  le.some((Re) => Re.id === we) ? we : le[0]?.id || "",
                ));
            })
            .catch((le) => {
              J && H($s(le));
            })
            .finally(() => {
              J && P(!1);
            }),
          () => {
            J = !1;
          }
        );
      }, [u, scope, N]),
        t.useEffect(() => {
          if (!z) {
            (p([]), O([]), _(""));
            return;
          }
          let J = !0;
          return (
            D(!0),
            j(""),
            Promise.all([Z5(i.fetchJSON, owner, z.id), j5(i.fetchJSON, owner, z.id)])
              .then(([le, we]) => {
                if (!J) return;
                (p(le), O(we));
                const Re = E0(le, we);
                _((Ye) =>
                  Re.some((ct) => ct.key === Ye)
                    ? Ye
                    : (Re.find((ct) => ct.kind === "session") || Re[0])?.key ||
                      "",
                );
              })
              .catch((le) => {
                J && j($s(le));
              })
              .finally(() => {
                J && D(!1);
              }),
            () => {
              J = !1;
            }
          );
        }, [owner, z?.id, N]),
        t.useEffect(() => {
          if (!ae || ae.kind !== "session") {
            (y(null), R(!1));
            return;
          }
          const J = ae.sessionId;
          if (!J) {
            (y(null), R(!1));
            return;
          }
          let le = !0;
          return (
            R(!0),
            h_(i.fetchJSON, owner, J)
              .then((we) => {
                le && y(we);
              })
              .catch((we) => {
                le && j($s(we));
              })
              .finally(() => {
                le && R(!1);
              }),
            () => {
              le = !1;
            }
          );
        }, [owner, ae?.key]));
      const Qe = (J, le = null) => {
          ($(""), Y(J), X(N5(le)));
        },
        Xe = () => {
          Z || (Y(null), X(null), $(""));
        },
        be = async (J) => {
          if (z) {
            (k(J), j(""));
            try {
              const le = await U5(i.fetchJSON, owner, z.id, J);
              (d((we) => we.map((Re) => (Re.id === le.id ? le : Re))),
                S(le.id),
                B((we) => we + 1));
            } catch (le) {
              j($s(le));
            } finally {
              k("");
            }
          }
        },
        We = async () => {
          if (
            z &&
            !(
              typeof window < "u" &&
              !window.confirm(runtimeText(`删除“${String(z.name || z.id)}”？`, `Delete “${String(z.name || z.id)}”？`))
            )
          ) {
            (k("delete"), j(""));
            try {
              (await Y5(i.fetchJSON, owner, z.id), S(""), setMobileDetail(false), B((J) => J + 1));
            } catch (J) {
              j($s(J));
            } finally {
              k("");
            }
          }
        },
        wt = async () => {
          if (te) {
            (V(!0), $(""));
            try {
              const J =
                T === "create"
                  ? z5(te)
                    ? await H5(i.fetchJSON, u, te)
                    : await F5(i.fetchJSON, u, te)
                  : await V5(i.fetchJSON, owner, z?.id || "", te);
              (Y(null), X(null), S(J.id), setMobileDetail(true), B((le) => le + 1));
            } catch (J) {
              $($s(J));
            } finally {
              V(!1);
            }
          }
        },
        lt = z ? R0(z) : "inactive",
        Ue = m[0] || z?.latest_execution || null,
        kt = z
          ? r(
              "div",
              { className: "dashboard-cron-detail", ref: detailRef, tabIndex: -1, "aria-label": runtimeText("当前任务详情", "Current job details") },
              r(
                "header",
                { className: "dashboard-cron-detail-header" },
                r(
                  "div",
                  { className: "dashboard-cron-detail-heading" },
                  r("div", { className: "dashboard-cron-kicker" }, runtimeText("定时任务", "Scheduled jobs")),
                  r("h2", null, String(z.name || z.prompt || z.id)),
                  r(
                    "span",
                    { className: `dashboard-cron-status-badge ${lt}` },
                    r("span", { className: `dashboard-cron-status-dot ${lt}` }),
                    Ed(lt),
                  ),
                ),
                r(
                  "div",
                  { className: "dashboard-cron-detail-actions" },
                  r(
                    "button",
                    {
                      type: "button",
                      className: "dashboard-cron-button secondary",
                      onClick: () => Qe("edit", z),
                    },
                    o("M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"),
                    runtimeText("编辑", "Edit"),
                  ),
                  r(
                    "button",
                    {
                      type: "button",
                      className: "dashboard-cron-button secondary",
                      disabled: !!Q,
                      onClick: () => {
                        be("trigger");
                      },
                    },
                    o("M13 2 3 14h7l-1 8 11-14h-7l0-6Z"),
                    runtimeText("立即执行", "Run now"),
                  ),
                  lt === "paused"
                    ? r(
                        "button",
                        {
                          type: "button",
                          className: "dashboard-cron-button secondary",
                          disabled: !!Q,
                          onClick: () => {
                            be("resume");
                          },
                        },
                        o("M8 5v14l11-7Z"),
                        runtimeText("恢复", "Restore"),
                      )
                    : r(
                        "button",
                        {
                          type: "button",
                          className: "dashboard-cron-button secondary",
                          disabled: !!Q,
                          onClick: () => {
                            be("pause");
                          },
                        },
                        o("M7 5v14 M17 5v14"),
                        runtimeText("暂停", "Pause"),
                      ),
                  r(
                    "button",
                    {
                      type: "button",
                      className: "dashboard-cron-button danger-quiet",
                      disabled: !!Q,
                      onClick: () => {
                        We();
                      },
                    },
                    o("M5 7h14 M10 11v6 M14 11v6 M9 7V4h6v3 M6 7l1 13h10l1-13"),
                    runtimeText("删除", "Delete"),
                  ),
                ),
              ),
              F
                ? r(
                    "p",
                    { className: "dashboard-cron-inline-error", role: "alert" },
                    F,
                  )
                : null,
              r(
                "nav",
                {
                  className: "dashboard-cron-detail-tabs",
                  "aria-label": runtimeText("任务详情", "Job details"),
                },
                r(
                  "button",
                  {
                    type: "button",
                    className: w === "task" ? "is-active" : "",
                    onClick: () => v("task"),
                    "aria-selected": w === "task",
                  },
                  runtimeText("任务", "Job"),
                ),
                r(
                  "button",
                  {
                    type: "button",
                    className: w === "runs" ? "is-active" : "",
                    onClick: () => v("runs"),
                    "aria-selected": w === "runs",
                  },
                  runtimeText(`运行记录${G.length ? ` (${G.length})` : ""}`, `Run history${G.length ? ` (${G.length})` : ""}`),
                ),
              ),
              w === "task"
                ? r(
                    "div",
                    { className: "dashboard-cron-task-view" },
                    z.prompt
                      ? r(
                          "section",
                          { className: "dashboard-cron-command-card" },
                          r(
                            "span",
                            { className: "dashboard-cron-section-label" },
                            runtimeText("执行指令", "Instructions"),
                          ),
                          r("p", null, String(z.prompt)),
                        )
                      : null,
                    r(
                      "dl",
                      { className: "dashboard-cron-detail-grid" },
                      r(l, { label: runtimeText("所属 profile", "Owner profile"), value: owner }),
                      r(l, { label: runtimeText("执行计划", "Schedule"), value: L0(z) }),
                      r(l, { label: runtimeText("调度器时区", "Scheduler timezone"), value: $0(z) }),
                      r(l, { label: runtimeText("下次执行", "Next run"), value: Ps(z.next_run_at) }),
                      r(l, { label: runtimeText("上次执行", "Last run"), value: Ps(z.last_run_at) }),
                      r(l, {
                        label: runtimeText("重复次数", "Repeat count"),
                        value: z.repeat?.times
                          ? `${z.repeat.completed || 0}/${z.repeat.times}`
                          : runtimeText("持续执行", "Continue indefinitely"),
                      }),
                      r(l, {
                        label: runtimeText("结果投递", "Result delivery"),
                        value: I0(z.deliver, runtimeText("仅保存", "Save only")),
                      }),
                      r(l, { label: runtimeText("技能", "Skills"), value: I0(z.skills || z.skill) }),
                      r(l, {
                        label: runtimeText("模型", "Models"),
                        value: String(z.model || runtimeText("跟随配置", "Follow settings")),
                      }),
                    ),
                    Ue
                      ? r(
                          "section",
                          { className: "dashboard-cron-latest-execution" },
                          r(
                            "span",
                            { className: "dashboard-cron-section-label" },
                            runtimeText("最近执行", "Recent runs"),
                          ),
                          r(
                            "span",
                            { className: "dashboard-cron-execution-status" },
                            Ad(Ue),
                          ),
                          r(
                            "time",
                            null,
                            Ps(
                              Ue.finished_at || Ue.started_at || Ue.claimed_at,
                            ),
                          ),
                          Ue.error
                            ? r(
                                "p",
                                { className: "dashboard-cron-execution-error" },
                                String(Ue.error),
                              )
                            : null,
                        )
                      : null,
                  )
                : r(
                    "div",
                    { className: "dashboard-cron-runs-view" },
                    r(
                      "div",
                      { className: "dashboard-cron-run-list" },
                      r(
                        "div",
                        { className: "dashboard-cron-run-list-header" },
                        r("span", null, runtimeText("运行记录", "Run history")),
                        r("span", null, E ? runtimeText("读取中…", "Loading…") : runtimeText(`${G.length} 条`, `${G.length} records`)),
                      ),
                      G.length
                        ? G.map((J) => {
                            const le = J.kind === "session",
                              we = le ? M0(J.run) : D0(J.execution),
                              Re = le
                                ? J.run.ended_at
                                  ? "completed"
                                  : "running"
                                : String(J.execution.status || "unknown"),
                              Ye = le
                                ? J.run.ended_at
                                  ? runtimeText("完成", "Completed")
                                  : runtimeText("执行中", "Running")
                                : Ad(J.execution);
                            return r(
                              "button",
                              {
                                type: "button",
                                key: J.key,
                                className: `dashboard-cron-run-row${ae?.key === J.key ? " is-selected" : ""}`,
                                onClick: () => _(J.key),
                              },
                              r(
                                "span",
                                { className: "dashboard-cron-run-title" },
                                we,
                              ),
                              r(
                                "span",
                                { className: "dashboard-cron-run-time" },
                                Ps(Rd(J)),
                              ),
                              r(
                                "span",
                                { className: `dashboard-cron-run-state ${Re}` },
                                Ye,
                              ),
                            );
                          })
                        : r(
                            "p",
                            { className: "dashboard-cron-empty compact" },
                            E ? runtimeText("正在读取运行记录…", "Loading run history…") : runtimeText("暂无运行记录", "No runs yet"),
                          ),
                    ),
                    r(
                      "section",
                      { className: "dashboard-cron-transcript" },
                      ae?.kind === "session"
                        ? r(
                            "header",
                            { className: "dashboard-cron-transcript-header" },
                            r("span", null, M0(ae.run)),
                            r("time", null, Ps(Rd(ae))),
                          )
                        : null,
                      ae?.kind === "execution"
                        ? r(
                            "header",
                            { className: "dashboard-cron-transcript-header" },
                            r("span", null, D0(ae.execution)),
                            r("time", null, Ps(Rd(ae))),
                          )
                        : null,
                      ae?.kind === "execution"
                        ? r(
                            "div",
                            {
                              className:
                                "dashboard-cron-empty dashboard-cron-no-session",
                              role: "status",
                            },
                            r("strong", null, runtimeText("无会话记录", "No session record")),
                            r(
                              "span",
                              null,
                              runtimeText(`状态：${Ad(ae.execution) || runtimeText("未返回", "Not returned")}`, `Status: ${Ad(ae.execution) || runtimeText("未返回", "Not returned")}`),
                            ),
                            ae.execution.error
                              ? r("span", null, String(ae.execution.error))
                              : null,
                          )
                        : A
                          ? r(
                              "p",
                              {
                                className: "dashboard-cron-empty",
                                role: "status",
                              },
                              runtimeText("正在读取会话…", "Loading session…"),
                            )
                          : x
                            ? r(s, { transcript: x })
                            : r(
                                "p",
                                { className: "dashboard-cron-empty" },
                                Ce
                                  ? runtimeText("这次运行没有可展示的会话正文", "No transcript is available for this run")
                                  : runtimeText("选择左侧运行记录查看任务对话", "Select a run on the left to view its conversation"),
                              ),
                    ),
                  ),
            )
          : r(
              "div",
              { className: "dashboard-cron-empty-state" },
              r(
                "div",
                { className: "dashboard-cron-empty-icon" },
                o("M12 6v6l4 2 M21 12a9 9 0 1 1-18 0"),
              ),
              r("h2", null, C ? runtimeText("正在读取任务…", "Loading jobs…") : runtimeText("还没有定时任务", "No scheduled jobs yet")),
              r(
                "p",
                null,
                C ? runtimeText("请稍候", "Please wait") : runtimeText("创建一个任务，让 Hermes 按计划执行工作。", "Create a job for Hermes to run on a schedule."),
              ),
              C
                ? null
                : r(
                    "button",
                    {
                      type: "button",
                      className: "dashboard-cron-button primary",
                      onClick: () => Qe("create"),
                    },
                    runtimeText("新建定时任务", "New scheduled job"),
                  ),
            );
      return r(
        "section",
        {
          className: "dashboard-cron-page",
          "data-testid": "dashboard-cron-page",
          "data-profile": u,
          "data-mobile-view": mobileDetail && z ? "detail" : "list",
        },
        r(
          "header",
          { className: "dashboard-cron-page-header" },
          r("div", null, r("h1", null, runtimeText("定时任务", "Scheduled jobs"))),
          r("select", { "aria-label": runtimeText("任务范围", "Job scope"), value: scope, onChange: event => { setScope(event.target.value); setMobileDetail(false); } },
            r("option", { value: "all" }, runtimeText("全部 profile", "All profiles")),
            r("option", { value: "current" }, runtimeText("当前 profile", "Current profile"))),
          r(
            "button",
            {
              type: "button",
              className: "dashboard-cron-button primary",
              onClick: () => Qe("create"),
            },
            o("M12 5v14 M5 12h14"),
            runtimeText("新建任务", "New job"),
          ),
        ),
        M
          ? r(
              "div",
              { className: "dashboard-cron-page-error", role: "alert" },
              r("span", null, M),
              r(
                "button",
                { type: "button", onClick: () => B((J) => J + 1) },
                runtimeText("重试", "Retry"),
              ),
            )
          : null,
        r(
          "button",
          {
            type: "button",
            className: "dashboard-cron-button dashboard-cron-back",
            onClick: () => {
              setMobileDetail(false);
              requestAnimationFrame(() => listRef.current?.querySelector('[aria-current="true"]')?.focus({ preventScroll: true }));
            },
          },
          o("m14 6-6 6 6 6"),
          runtimeText(`全部任务（${h.length}）`, `All jobs (${h.length})`),
        ),
        r(
          "div",
          { className: "dashboard-cron-layout" },
          r(
            "aside",
            {
              className: "dashboard-cron-list-pane",
              "aria-label": runtimeText("定时任务列表", "Scheduled jobs"),
              ref: listRef,
            },
            r(
              "div",
              { className: "dashboard-cron-list-heading" },
              r("span", null, runtimeText("任务", "Job")),
              r("span", null, C ? "…" : `${h.length}`),
            ),
            r("div", {className:"dashboard-cron-list-controls"},
              r("label", null, runtimeText("排序", "Sort"), r("select", {"aria-label":runtimeText("任务排序", "Job order"), value:sidebarPrefs.order,
                onChange:event=>changeSidebar({order:event.target.value})},
                cronSortOptions.map(([value,label])=>r("option",{key:value,value},label)))),
              r("label", {className:"dashboard-cron-group-toggle"}, r("input", {type:"checkbox",checked:sidebarPrefs.grouped,
                onChange:event=>changeSidebar({grouped:event.target.checked})}), runtimeText("按用途分组", "Group by purpose")),
              r("span", {className:"dashboard-cron-sort-hint"}, sidebarPrefs.grouped ? runtimeText("排序应用于各组内", "Sort within each group") : runtimeText("排序应用于全部任务", "Sort all jobs"))),
            C ? r("p", {className:"dashboard-cron-empty compact"}, runtimeText("读取中…", "Loading…")) :
              cronSections(h,sidebarPrefs.order,sidebarPrefs.grouped).map(section=>r("section", {key:section.name,className:"dashboard-cron-group"},
                sidebarPrefs.grouped ? r("button", {type:"button", className:"dashboard-cron-group-heading",
                  "aria-expanded":!sidebarPrefs.collapsed[section.name],
                  onClick:()=>changeSidebar({collapsed:{...sidebarPrefs.collapsed,[section.name]:!sidebarPrefs.collapsed[section.name]}})},
                  r("span", {"aria-hidden":true}, sidebarPrefs.collapsed[section.name] ? "›" : "⌄"),
                  r("span",null,section.name),r("span",null,String(section.jobs.length))) : null,
                (!sidebarPrefs.grouped || !sidebarPrefs.collapsed[section.name]) ? r("div",{className:sidebarPrefs.grouped?"dashboard-cron-group-children":""},
                  section.jobs.map(J=>r(a,{key:J.id,job:J,selected:z?.id===J.id,onSelect:()=>{
                    S(J.id);v("task");setMobileDetail(true);
                    if(window.matchMedia('(max-width: 800px)').matches) requestAnimationFrame(()=>{
                      detailRef.current?.scrollTo(0,0);detailRef.current?.focus({preventScroll:true});
                    });
                  }}))) : null)),
            !C && !h.length ? r("p",{className:"dashboard-cron-empty compact"},runtimeText("暂无任务", "No jobs")) : null,
          ),
          kt,
        ),
        T && te
          ? r(n, {
              mode: T,
              draft: te,
              timezoneLabel: $0(T === "edit" ? z : null),
              error: q,
              saving: Z,
              onChange: (J) => X((le) => le && { ...le, ...J }),
              onCancel: Xe,
              onSubmit: () => {
                wt();
              },
            })
          : null,
      );
    }
    return c;
  }
  function oe(i, e, t, ...r) {
    return i.createElement(e, t, ...r);
  }
  function X0(i) {
    return i.split("/").filter(Boolean).at(-1) || i;
  }
  function uM(i) {
    const e = i.match(
      /^\uFEFF?---[ \t]*\r?\n[\s\S]*?^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m,
    );
    return e ? i.slice(e[0].length) : i;
  }
  function Id(i) {
    const e = i.split("/").filter(Boolean);
    return (e.pop(), e.join("/"));
  }
  function Nd(i, e) {
    const t = e.trim().replace(/^[/\\]+|[/\\]+$/g, "");
    return i ? `${i}/${t}` : t;
  }
  function dM(i) {
    if (!Number.isFinite(i)) return "";
    if (i === 0) return "0 B";
    const e = ["B", "KB", "MB", "GB"],
      t = Math.min(Math.floor(Math.log(i) / Math.log(1024)), e.length - 1);
    return `${(i / 1024 ** t).toFixed(t === 0 ? 0 : 1)} ${e[t]}`;
  }
  function pM(i) {
    const e = i.React,
      { useEffect: t, useRef: r } = i.hooks;
    return function ({ path: s, value: o, onChange: a }) {
      const l = r(null),
        c = r(null),
        u = r(a);
      return (
        (u.current = a),
        t(() => {
          if (!l.current) return;
          const h = new Te({
            doc: o,
            parent: l.current,
            extensions: [
              aS(),
              iS(),
              cS(),
              Su(mS, { fallback: !0 }),
              ...fM(s),
              Te.lineWrapping,
              Te.updateListener.of((d) => {
                d.docChanged && u.current(d.state.doc.toString());
              }),
              Te.theme({
                "&": { height: "100%", backgroundColor: "transparent" },
                ".cm-scroller": {
                  overflow: "auto",
                  fontFamily: "var(--theme-font-mono, ui-monospace, monospace)",
                },
                ".cm-content": { minHeight: "100%", padding: "14px 6px" },
                ".cm-gutters": {
                  backgroundColor: "transparent",
                  border: "none",
                },
                "&.cm-focused": { outline: "none" },
              }),
            ],
          });
          return (
            (c.current = h),
            () => {
              ((c.current = null), h.destroy());
            }
          );
        }, []),
        t(() => {
          const h = c.current;
          !h ||
            h.state.doc.toString() === o ||
            h.dispatch({
              changes: { from: 0, to: h.state.doc.length, insert: o },
            });
        }, [o]),
        oe(e, "div", { ref: l, className: "hti-skills-code-editor" })
      );
    };
  }
  function W0(i, e = !1) {
    return i.type === "directory" ? (e ? "⌄" : "›") : "·";
  }
  function mM(i) {
    const e = i.React,
      { useCallback: t, useEffect: r, useRef: n, useState: s } = i.hooks;
    return function ({
      profile: a,
      skillName: l,
      entry: c,
      selectedPath: u,
      selectedDirectory: h,
      refreshToken: d,
      onOpen: f,
      onDirectorySelect: S,
    }) {
      const [b, p] = s(!1),
        [m, O] = s([]),
        [g, _] = s(!1),
        [w, v] = s(""),
        x = n(0),
        y = t(async () => {
          const P = ++x.current;
          (_(!0), v(""));
          try {
            const E = await B0(i.fetchJSON, a, l, c.path);
            if (x.current !== P) return;
            O(E);
          } catch (E) {
            x.current === P && v(E instanceof Error ? E.message : String(E));
          } finally {
            x.current === P && _(!1);
          }
        }, [c.path, a, l, i.fetchJSON]);
      if (
        (r(() => {
          b && y();
        }, [b, y, d]),
        c.type !== "directory")
      )
        return oe(
          e,
          "li",
          { key: c.path },
          oe(
            e,
            "button",
            {
              type: "button",
              className: `hti-skills-tree-row${u === c.path ? " is-active" : ""}`,
              title: c.path,
              onClick: (P) => f(c, P.currentTarget),
            },
            oe(
              e,
              "span",
              { className: "hti-skills-tree-glyph", "aria-hidden": !0 },
              W0(c),
            ),
            oe(e, "span", { className: "hti-skills-tree-name" }, c.name),
            c.size !== void 0
              ? oe(e, "span", { className: "hti-skills-tree-size" }, dM(c.size))
              : null,
          ),
        );
      const C = h === c.path;
      return oe(
        e,
        "li",
        { key: c.path, className: "hti-skills-tree-branch" },
        oe(
          e,
          "button",
          {
            type: "button",
            className: `hti-skills-tree-row is-directory${C ? " is-active" : ""}`,
            title: c.path,
            "aria-expanded": b,
            onClick: () => {
              (S(c.path, c), p((P) => !P));
            },
          },
          oe(
            e,
            "span",
            { className: "hti-skills-tree-glyph", "aria-hidden": !0 },
            W0(c, b),
          ),
          oe(e, "span", { className: "hti-skills-tree-name" }, c.name),
        ),
        b
          ? oe(
              e,
              "ul",
              { className: "hti-skills-tree-children" },
              g
                ? oe(
                    e,
                    "li",
                    { className: "hti-skills-tree-status", role: "status" },
                    runtimeText("加载中…", "Loading…"),
                  )
                : null,
              w
                ? oe(
                    e,
                    "li",
                    { className: "hti-skills-tree-error", role: "alert" },
                    oe(e, "span", null, w),
                    oe(
                      e,
                      "button",
                      {
                        type: "button",
                        onClick: (P) => {
                          (P.stopPropagation(), y());
                        },
                      },
                      runtimeText("重试", "Retry"),
                    ),
                  )
                : null,
              ...m.map((P) =>
                oe(e, Z0(i), {
                  key: P.path,
                  sdk: i,
                  React: e,
                  profile: a,
                  skillName: l,
                  entry: P,
                  selectedPath: u,
                  selectedDirectory: h,
                  refreshToken: d,
                  onOpen: f,
                  onDirectorySelect: S,
                }),
              ),
            )
          : null,
      );
    };
  }
  const q0 = new WeakMap();
  function Z0(i) {
    const e = i,
      t = q0.get(e);
    if (t) return t;
    const r = mM(i);
    return (q0.set(e, r), r);
  }
  function OM(i) {
    const e = i.React,
      {
        useCallback: t,
        useEffect: r,
        useMemo: n,
        useRef: s,
        useState: o,
      } = i.hooks,
      a = pM(i),
      l = Z0(i),
      c =
        i.authedFetch ||
        ((u, h) => fetch(u, { ...h, credentials: "same-origin" }));
    return function ({ profile: h }) {
      const [d, f] = o([]),
        [S, b] = o(""),
        [p, m] = o(""),
        [O, g] = o("overview"),
        [_, w] = o(!0),
        [v, x] = o(""),
        [y, C] = o(0),
        [P, E] = o(""),
        [D, A] = o(!1),
        [R, M] = o(""),
        [H, F] = o(0),
        [j, Q] = o([]),
        [k, N] = o(!1),
        [B, T] = o(""),
        [Y, te] = o(0),
        [X, q] = o(null),
        [$, Z] = o(""),
        [V, z] = o({ content: "", savedContent: "", version: "" }),
        [G, ae] = o(!1),
        [Ce, Qe] = o(""),
        [Xe, be] = o(0),
        [We, wt] = o(null),
        [lt, Ue] = o(!1),
        [kt, J] = o(""),
        [le, we] = o(""),
        [Re, Ye] = o(0),
        [ct, Dt] = o(!1),
        ot = s(0),
        Zt = s(0),
        Ne = s(0),
        ut = s(0),
        br = s(null),
        Ni = s(null),
        _r = s(null),
        bi = n(() => d.find((se) => se.name === S) || null, [S, d]),
        vr = n(() => {
          const se = p.trim().toLocaleLowerCase();
          return se
            ? d.filter((_e) =>
                `${_e.name}
${_e.description}`
                  .toLocaleLowerCase()
                  .includes(se),
              )
            : d;
        }, [p, d]);
      (r(() => {
        const se = ++ot.current;
        let _e = !0;
        return (
          w(!0),
          x(""),
          f([]),
          b(""),
          q(null),
          Z(""),
          E(""),
          Q([]),
          Qe(""),
          we(""),
          ae(!1),
          ++Zt.current,
          ++Ne.current,
          ++ut.current,
          z({ content: "", savedContent: "", version: "" }),
          wt((Le) => (Le && URL.revokeObjectURL(Le.url), null)),
          iM(i.fetchJSON, h)
            .then((Le) => {
              !_e || ot.current !== se || (f(Le), b(Le[0]?.name || ""));
            })
            .catch((Le) => {
              _e &&
                ot.current === se &&
                x(Le instanceof Error ? Le.message : String(Le));
            })
            .finally(() => {
              _e && ot.current === se && w(!1);
            }),
          () => {
            _e = !1;
          }
        );
      }, [y, h, i.fetchJSON]),
        r(() => {
          if (!S) return;
          const se = ++Zt.current;
          let _e = !0;
          return (
            A(!0),
            M(""),
            E(""),
            rM(i.fetchJSON, h, S)
              .then((Le) => {
                _e && Zt.current === se && E(Le.content);
              })
              .catch((Le) => {
                _e &&
                  Zt.current === se &&
                  M(Le instanceof Error ? Le.message : String(Le));
              })
              .finally(() => {
                _e && Zt.current === se && A(!1);
              }),
            () => {
              _e = !1;
            }
          );
        }, [H, h, S, i.fetchJSON]),
        r(() => {
          if (!S) return;
          const se = ++Ne.current;
          let _e = !0;
          return (
            N(!0),
            T(""),
            Q([]),
            B0(i.fetchJSON, h, S)
              .then((Le) => {
                _e && Ne.current === se && Q(Le);
              })
              .catch((Le) => {
                _e &&
                  Ne.current === se &&
                  T(Le instanceof Error ? Le.message : String(Le));
              })
              .finally(() => {
                _e && Ne.current === se && N(!1);
              }),
            () => {
              _e = !1;
            }
          );
        }, [h, S, i.fetchJSON, Y]));
      const Tt = t(
          () =>
            V.content === V.savedContent ||
            window.confirm(runtimeText("当前文件有未保存更改，仍要切换吗？", "Discard unsaved changes and switch files?")),
          [V.content, V.savedContent],
        ),
        xt = t((se) => {
          wt((_e) => (_e && URL.revokeObjectURL(_e.url), se));
        }, []);
      r(
        () => () => {
          We && URL.revokeObjectURL(We.url);
        },
        [We],
      );
      const Ti = t(
        async (se) => {
          if (!Tt() || !S) return;
          const _e = ++ut.current;
          if (
            (q(se),
            Z(se.type === "directory" ? se.path : Id(se.path)),
            ae(!0),
            Qe(""),
            J(""),
            xt(null),
            z({ content: "", savedContent: "", version: "" }),
            se.type === "directory")
          ) {
            ae(!1);
            return;
          }
          try {
            if (z0(se.path) === "text") {
              const gt = await nM(i.fetchJSON, h, S, se.path);
              if (ut.current !== _e) return;
              z({
                content: gt.content,
                savedContent: gt.content,
                version: gt.version,
              });
            } else {
              const gt = await lM(c, h, S, se.path);
              if (ut.current !== _e) return;
              const Xi = z0(se.path, gt.contentType);
              if (Xi === "text") {
                const _i = await gt.blob.text();
                z({ content: _i, savedContent: _i, version: "" });
              } else
                wt({
                  kind: Xi,
                  url: URL.createObjectURL(gt.blob),
                  filename: X0(se.path),
                  contentType: gt.contentType,
                });
            }
          } catch (Le) {
            ut.current === _e &&
              Qe(Le instanceof Error ? Le.message : String(Le));
          } finally {
            ut.current === _e && ae(!1);
          }
        },
        [c, Tt, h, xt, i.fetchJSON, S],
      );
      (r(() => {
        if (!X || V.content === V.savedContent) return;
        const se = (_e) => {
          (_e.preventDefault(), (_e.returnValue = ""));
        };
        return (
          window.addEventListener("beforeunload", se),
          () => window.removeEventListener("beforeunload", se)
        );
      }, [V.content, V.savedContent, X]),
        r(() => {
          if (!X || V.content === V.savedContent) return;
          const se = (_e) => {
            window.confirm(runtimeText("当前文件有未保存更改，仍要离开吗？", "Discard unsaved changes and leave?")) ||
              _e.preventDefault();
          };
          return (
            window.addEventListener("workbench:before-navigate", se),
            () => window.removeEventListener("workbench:before-navigate", se)
          );
        }, [V.content, V.savedContent, X]));
      const Bi = t(async () => {
          if (
            !X ||
            X.type !== "file" ||
            V.content === V.savedContent ||
            lt ||
            !S
          )
            return;
          const se = ut.current;
          (Ue(!0), Qe(""));
          try {
            const _e = await sM(
              i.fetchJSON,
              h,
              S,
              X.path,
              V.content,
              V.version,
            );
            if (ut.current !== se) return;
            (z((Le) => ({
              ...Le,
              savedContent: Le.content,
              version: _e.version,
            })),
              J(runtimeText("已保存", "Saved")));
          } catch (_e) {
            ut.current === se &&
              Qe(_e instanceof Error ? _e.message : String(_e));
          } finally {
            ut.current === se && Ue(!1);
          }
        }, [V.content, V.savedContent, V.version, h, lt, i.fetchJSON, X, S]),
        Ct = t(() => {
          X && be((se) => se + 1);
        }, [X]);
      r(() => {
        !X || X.type === "directory" || Xe === 0 || Ti(X);
      }, [Xe]);
      const Et = t(async (se, _e) => {
          ((br.current = se), we(""), J(runtimeText("处理中…", "Processing…")));
          try {
            (await se(), J(_e), Ye((Le) => Le + 1), te((Le) => Le + 1));
          } catch (Le) {
            (J(""), we(Le instanceof Error ? Le.message : String(Le)));
          }
        }, []),
        ce = t(
          (se) => {
            if (!S) return;
            const _e = se ? runtimeText("目录名", "Directory name") : runtimeText("文件名", "File name"),
              Le = window
                .prompt(runtimeText(`请输入${_e}`, `Enter ${_e}`), se ? "new-directory" : "new-file.md")
                ?.trim();
            if (!Le) return;
            const gt = Nd($, Le),
              Xi = se
                ? { action: "create-directory", path: gt }
                : { action: "create-file", path: gt, content: "" };
            Et(
              () => Md(i.fetchJSON, h, S, Xi),
              se ? runtimeText("目录已创建", "Directory created") : runtimeText("文件已创建", "File created"),
            );
          },
          [h, Et, i.fetchJSON, $, S],
        ),
        ve = t(
          (se) => {
            if (
              !S ||
              !X ||
              !Tt() ||
              (se === "delete" && !window.confirm(runtimeText(`确定删除“${X.path}”？`, `Delete “${X.path}”？`)))
            )
              return;
            if (se === "delete") {
              Et(async () => {
                (await Md(i.fetchJSON, h, S, { action: se, path: X.path }),
                  q(null),
                  X.type === "directory" && Z(Id(X.path)),
                  z({ content: "", savedContent: "", version: "" }),
                  xt(null));
              }, runtimeText("已删除", "Deleted"));
              return;
            }
            const _e = se === "rename" ? runtimeText("新名称", "New name") : runtimeText("目标目录", "Target directory"),
              Le = window.prompt(_e, se === "rename" ? X.name : $)?.trim();
            if (!Le) return;
            const gt = se === "rename" ? Nd(Id(X.path), Le) : Nd(Le, X.name),
              Xi =
                se === "rename"
                  ? { action: se, path: X.path, newPath: gt }
                  : { action: se, path: X.path, destination: gt };
            Et(
              async () => {
                (await Md(i.fetchJSON, h, S, Xi),
                  q(null),
                  z({ content: "", savedContent: "", version: "" }),
                  xt(null));
              },
              se === "rename" ? runtimeText("已重命名", "Renamed") : runtimeText("已移动", "Moved"),
            );
          },
          [Tt, h, xt, Et, i.fetchJSON, $, X, S],
        ),
        vt = t(
          (se) => {
            const _e = se.target?.files?.[0];
            ((se.target.value = ""),
              !(!_e || !S) && Et(() => hM(c, h, S, $, _e), runtimeText("文件已上传", "File uploaded")));
          },
          [c, h, Et, $, S],
        ),
        Kt = t(
          (se) => {
            const _e = se.target?.files?.[0];
            ((se.target.value = ""),
              !(!_e || !S || !Tt()) &&
                (Dt(!0),
                Et(async () => {
                  (await cM(c, h, S, _e),
                    ++ut.current,
                    q(null),
                    Z(""),
                    ae(!1),
                    z({ content: "", savedContent: "", version: "" }),
                    xt(null));
                }, runtimeText("目录已导入", "Directory imported")).finally(() => Dt(!1))));
          },
          [c, Tt, h, xt, Et, S],
        ),
        It = t(
          (se) => {
            se === S ||
              !Tt() ||
              (++Zt.current,
              ++Ne.current,
              ++ut.current,
              b(se),
              q(null),
              Z(""),
              z({ content: "", savedContent: "", version: "" }),
              Qe(""),
              ae(!1),
              xt(null),
              g("overview"));
          },
          [Tt, xt, S],
        ),
        ht = t(() => {
          Tt() &&
            (++ut.current,
            q(null),
            ae(!1),
            z({ content: "", savedContent: "", version: "" }),
            xt(null),
            Qe(""));
        }, [Tt, xt]),
        Jt = t(
          (se) => {
            (se.ctrlKey || se.metaKey) &&
              String(se.key).toLowerCase() === "s" &&
              (se.preventDefault(), Bi());
          },
          [Bi],
        ),
        zi = t(
          (se, _e) => {
            Tt() &&
              ((ut.current += 1),
              Z(se),
              q(_e),
              ae(!1),
              z({ content: "", savedContent: "", version: "" }),
              Qe(""),
              xt(null));
          },
          [Tt, xt],
        ),
        Ei = B
          ? oe(
              e,
              "div",
              { className: "hti-skills-panel-error", role: "alert" },
              oe(e, "span", null, B),
              oe(
                e,
                "button",
                { type: "button", onClick: () => te((se) => se + 1) },
                runtimeText("重试", "Retry"),
              ),
            )
          : k && j.length === 0
            ? oe(
                e,
                "div",
                { className: "hti-skills-panel-status", role: "status" },
                runtimeText("加载文件…", "Loading files…"),
              )
            : j.length === 0
              ? oe(
                  e,
                  "div",
                  { className: "hti-skills-panel-status" },
                  runtimeText("此技能目录暂无文件", "No files in this skill directory"),
                )
              : oe(
                  e,
                  "ul",
                  { className: "hti-skills-tree-root" },
                  ...j.map((se) =>
                    oe(e, l, {
                      key: se.path,
                      React: e,
                      sdk: i,
                      profile: h,
                      skillName: S,
                      entry: se,
                      selectedPath: X?.path || "",
                      selectedDirectory: $,
                      refreshToken: Re,
                      onOpen: (_e) => {
                        Ti(_e);
                      },
                      onDirectorySelect: zi,
                    }),
                  ),
                ),
        Ot = G
          ? oe(
              e,
              "div",
              {
                className: "hti-skills-panel-status",
                role: "status",
                "aria-busy": !0,
              },
              runtimeText("加载文件…", "Loading files…"),
            )
          : Ce
            ? oe(
                e,
                "div",
                { className: "hti-skills-panel-error", role: "alert" },
                oe(e, "span", null, Ce),
                oe(e, "button", { type: "button", onClick: Ct }, runtimeText("重试", "Retry")),
              )
            : X?.type === "directory"
              ? oe(
                  e,
                  "div",
                  { className: "hti-skills-panel-status" },
                  runtimeText("请选择一个文件进行查看", "Select a file to view"),
                )
              : We
                ? oe(
                    e,
                    "div",
                    { className: `hti-skills-binary-preview is-${We.kind}` },
                    We.kind === "image"
                      ? oe(e, "img", { src: We.url, alt: We.filename })
                      : We.kind === "pdf"
                        ? oe(e, "iframe", { src: We.url, title: We.filename })
                        : null,
                    oe(
                      e,
                      "a",
                      {
                        href: We.url,
                        download: We.filename,
                        className: "hti-skills-download-link",
                      },
                      runtimeText("下载附件", "Download attachment"),
                    ),
                  )
                : X && zl(X.path)
                  ? oe(e, a, {
                      key: X.path,
                      path: X.path,
                      value: V.content,
                      onChange: (se) => z((_e) => ({ ..._e, content: se })),
                    })
                  : X
                    ? oe(
                        e,
                        "div",
                        { className: "hti-skills-panel-status" },
                        runtimeText("此附件无法直接编辑，请使用下载按钮", "This attachment cannot be edited here. Use Download."),
                      )
                    : oe(
                        e,
                        "div",
                        { className: "hti-skills-panel-status" },
                        runtimeText("从左侧文件树选择文件", "Select a file from the tree"),
                      );
      return oe(
        e,
        "main",
        { className: "hti-skills-page", onKeyDown: Jt },
        oe(
          e,
          "aside",
          { className: "hti-skills-sidebar" },
          oe(
            e,
            "header",
            { className: "hti-skills-sidebar-header" },
            oe(e, "div", null, oe(e, "h1", null, runtimeText("技能", "Skills"))),
            d.length > 0
              ? oe(
                  e,
                  "span",
                  { className: "hti-skills-count" },
                  String(d.length),
                )
              : null,
          ),
          oe(
            e,
            "label",
            { className: "hti-skills-search" },
            oe(
              e,
              "span",
              { className: "hti-skills-search-glyph", "aria-hidden": !0 },
              "⌕",
            ),
            oe(e, "input", {
              type: "search",
              value: p,
              placeholder: runtimeText("搜索技能", "Search skills"),
              "aria-label": runtimeText("搜索技能", "Search skills"),
              onChange: (se) => m(se.target.value),
            }),
          ),
          _
            ? oe(
                e,
                "div",
                { className: "hti-skills-panel-status", role: "status" },
                runtimeText("加载技能…", "Loading skills…"),
              )
            : v
              ? oe(
                  e,
                  "div",
                  { className: "hti-skills-panel-error", role: "alert" },
                  oe(e, "span", null, v),
                  oe(
                    e,
                    "button",
                    { type: "button", onClick: () => C((se) => se + 1) },
                    runtimeText("重试", "Retry"),
                  ),
                )
              : vr.length === 0
                ? oe(
                    e,
                    "div",
                    { className: "hti-skills-panel-status" },
                    p ? runtimeText("没有匹配的技能", "No matching skills") : runtimeText("没有可用技能", "No skills available"),
                  )
                : oe(
                    e,
                    "nav",
                    { className: "hti-skills-list", "aria-label": runtimeText("技能列表", "Skills") },
                    ...vr.map((se) =>
                      oe(
                        e,
                        "button",
                        {
                          key: se.name,
                          type: "button",
                          className: `hti-skills-list-row${S === se.name ? " is-active" : ""}`,
                          "aria-current": S === se.name ? "true" : void 0,
                          onClick: () => It(se.name),
                        },
                        oe(e, "strong", null, se.name),
                        se.description
                          ? oe(e, "span", null, se.description)
                          : null,
                      ),
                    ),
                  ),
        ),
        oe(
          e,
          "section",
          { className: "hti-skills-content" },
          bi
            ? oe(
                e,
                e.Fragment,
                null,
                oe(
                  e,
                  "header",
                  { className: "hti-skills-content-header" },
                  oe(
                    e,
                    "div",
                    { className: "hti-skills-title-block" },
                    oe(e, "h2", null, bi.name),
                    oe(e, "p", null, bi.description || runtimeText("暂无描述", "No description")),
                  ),
                  oe(
                    e,
                    "div",
                    { className: "hti-skills-tabs", role: "tablist" },
                    oe(
                      e,
                      "button",
                      {
                        type: "button",
                        role: "tab",
                        "aria-selected": O === "overview",
                        className: O === "overview" ? "is-active" : "",
                        onClick: () => g("overview"),
                      },
                      runtimeText("概览", "Overview"),
                    ),
                    oe(
                      e,
                      "button",
                      {
                        type: "button",
                        role: "tab",
                        "aria-selected": O === "files",
                        className: O === "files" ? "is-active" : "",
                        onClick: () => g("files"),
                      },
                      runtimeText("文件", "Files"),
                    ),
                  ),
                ),
                O === "overview"
                  ? oe(
                      e,
                      "article",
                      { className: "hti-skills-overview" },
                      D
                        ? oe(
                            e,
                            "div",
                            {
                              className: "hti-skills-panel-status",
                              role: "status",
                            },
                            runtimeText("加载概览…", "Loading overview…"),
                          )
                        : R
                          ? oe(
                              e,
                              "div",
                              {
                                className: "hti-skills-panel-error",
                                role: "alert",
                              },
                              oe(e, "span", null, R),
                              oe(
                                e,
                                "button",
                                {
                                  type: "button",
                                  onClick: () => F((se) => se + 1),
                                },
                                runtimeText("重试", "Retry"),
                              ),
                            )
                          : oe(
                              e,
                              "div",
                              {
                                className: "hti-skills-markdown hti-rich-text",
                              },
                              oe(e, Ki, {
                                React: e,
                                content: uM(P || bi.description || runtimeText("暂无描述", "No description")),
                              }),
                            ),
                    )
                  : oe(
                      e,
                      "section",
                      { className: "hti-skills-files" },
                      oe(
                        e,
                        "header",
                        { className: "hti-skills-files-toolbar" },
                        oe(
                          e,
                          "div",
                          { className: "hti-skills-file-context" },
                          oe(
                            e,
                            "strong",
                            null,
                            X ? X.path : $ ? `${$}/` : runtimeText("技能目录", "Skill directory"),
                          ),
                          kt ? oe(e, "span", { role: "status" }, kt) : null,
                        ),
                        oe(
                          e,
                          "div",
                          { className: "hti-skills-file-actions" },
                          oe(
                            e,
                            "button",
                            { type: "button", onClick: () => ce(!1) },
                            runtimeText("新建文件", "New file"),
                          ),
                          oe(
                            e,
                            "button",
                            { type: "button", onClick: () => ce(!0) },
                            runtimeText("新建目录", "New directory"),
                          ),
                          oe(
                            e,
                            "button",
                            {
                              type: "button",
                              onClick: () => Ni.current?.click(),
                            },
                            runtimeText("上传", "Upload"),
                          ),
                          oe(
                            e,
                            "button",
                            {
                              type: "button",
                              onClick: () => _r.current?.click(),
                              disabled: ct,
                            },
                            ct ? runtimeText("导入中…", "Importing…") : runtimeText("导入 ZIP", "Import ZIP"),
                          ),
                          oe(
                            e,
                            "a",
                            {
                              href: aM(h, S),
                              download: `${S}.zip`,
                              className: "hti-skills-toolbar-link",
                            },
                            runtimeText("导出 ZIP", "Export ZIP"),
                          ),
                        ),
                      ),
                      le
                        ? oe(
                            e,
                            "div",
                            {
                              className:
                                "hti-skills-panel-error hti-skills-operation-error",
                              role: "alert",
                            },
                            oe(e, "span", null, le),
                            br.current
                              ? oe(
                                  e,
                                  "button",
                                  {
                                    type: "button",
                                    onClick: () => {
                                      const se = br.current;
                                      se && Et(se, runtimeText("操作已完成", "Operation completed"));
                                    },
                                  },
                                  runtimeText("重试", "Retry"),
                                )
                              : null,
                          )
                        : null,
                      oe(
                        e,
                        "div",
                        { className: "hti-skills-files-layout" },
                        oe(
                          e,
                          "aside",
                          { className: "hti-skills-file-tree-pane" },
                          Ei,
                          X
                            ? oe(
                                e,
                                "div",
                                { className: "hti-skills-selection-actions" },
                                oe(
                                  e,
                                  "button",
                                  {
                                    type: "button",
                                    onClick: () => ve("rename"),
                                  },
                                  runtimeText("重命名", "Rename"),
                                ),
                                oe(
                                  e,
                                  "button",
                                  { type: "button", onClick: () => ve("move") },
                                  runtimeText("移动", "Move"),
                                ),
                                oe(
                                  e,
                                  "button",
                                  {
                                    type: "button",
                                    className: "is-danger",
                                    onClick: () => ve("delete"),
                                  },
                                  runtimeText("删除", "Delete"),
                                ),
                              )
                            : null,
                        ),
                        oe(
                          e,
                          "section",
                          { className: "hti-skills-editor-pane" },
                          X
                            ? oe(
                                e,
                                "header",
                                { className: "hti-skills-editor-header" },
                                oe(
                                  e,
                                  "div",
                                  { className: "hti-skills-editor-title" },
                                  oe(e, "strong", null, X0(X.path)),
                                  oe(e, "span", null, X.path),
                                ),
                                oe(
                                  e,
                                  "div",
                                  { className: "hti-skills-editor-actions" },
                                  We
                                    ? null
                                    : X.type === "file" && zl(X.path)
                                      ? oe(
                                          e,
                                          "button",
                                          {
                                            type: "button",
                                            onClick: () =>
                                              z((se) => ({
                                                ...se,
                                                content: se.savedContent,
                                              })),
                                            disabled:
                                              V.content === V.savedContent,
                                          },
                                          runtimeText("撤销更改", "Discard changes"),
                                        )
                                      : null,
                                  X.type === "file" && zl(X.path)
                                    ? oe(
                                        e,
                                        "button",
                                        {
                                          type: "button",
                                          onClick: () => {
                                            Bi();
                                          },
                                          disabled:
                                            lt || V.content === V.savedContent,
                                        },
                                        lt ? runtimeText("保存中…", "Saving…") : runtimeText("保存", "Save"),
                                      )
                                    : null,
                                  oe(
                                    e,
                                    "button",
                                    { type: "button", onClick: ht },
                                    runtimeText("关闭", "Close"),
                                  ),
                                ),
                              )
                            : null,
                          Ot,
                        ),
                      ),
                      oe(e, "input", {
                        ref: Ni,
                        type: "file",
                        className: "hti-skills-hidden-input",
                        onChange: vt,
                      }),
                      oe(e, "input", {
                        ref: _r,
                        type: "file",
                        accept:
                          ".zip,application/zip,application/x-zip-compressed",
                        className: "hti-skills-hidden-input",
                        onChange: Kt,
                      }),
                    ),
              )
            : oe(
                e,
                "div",
                { className: "hti-skills-empty" },
                _ ? runtimeText("加载技能…", "Loading skills…") : runtimeText("请选择一个技能", "Select a skill"),
              ),
        ),
      );
    };
  }
  const j0 = `workbench-${workbenchVersion}`;
  function gM(i) {
    const [e, t] = i.split(".").map(Number);
    return e > 1 || (e === 1 && t >= 1);
  }
  function SM() {
    const i = window.__HERMES_PLUGIN_SDK__,
      e = window.__HERMES_PLUGINS__;
    if (!i || !e || !gM(String(i.sdkVersion || "0.0.0"))) return;
    document.documentElement.dataset.workbenchBuild = j0;
    const t = BR(i),
      r = A5(i),
      { useEffect: n, useState: s } = i.hooks;
    function o() {
      const [u, h] = s("loading"),
        [d, f] = s(0);
      return (
        n(() => {
          let S = !0;
          return (
            h("loading"),
            (async () => {
              if (typeof i.authedFetch == "function") {
                const p = await i.authedFetch(
                  "/api/plugins/workbench/capabilities",
                );
                if (p.status === 404) return { codexChat: !1 };
                if (!p.ok) throw new Error(runtimeText(`能力状态请求失败（${p.status}）`, `Capabilities request failed (${p.status})`));
                return await p.json();
              }
              return await i.fetchJSON("/api/plugins/workbench/capabilities");
            })()
              .then((p) => S && h(p?.codexChat === !0 ? "enabled" : "disabled"))
              .catch(() => S && h("error")),
            () => {
              S = !1;
            }
          );
        }, [d]),
        u === "enabled"
          ? i.React.createElement(r)
          : u === "disabled"
            ? i.React.createElement(t)
            : u === "error"
              ? i.React.createElement(
                  "div",
                  { className: "hti-page-error", role: "alert" },
                  i.React.createElement("p", null, runtimeText("无法读取工作台能力状态", "Could not read Workbench capabilities")),
                  i.React.createElement(
                    "button",
                    { type: "button", onClick: () => f((S) => S + 1) },
                    runtimeText("重试", "Retry"),
                  ),
                )
              : i.React.createElement(
                  "div",
                  { className: "codex-capability-loading", role: "status" },
                  runtimeText("正在连接工作台…", "Connecting to Workbench…"),
                )
      );
    }
    const a = Px(i, { cron: J5, skills: OM });
    function l() {
      useWorkbenchLocale(i);
      const u = () =>
          window.location.pathname === "/chat" &&
          new URLSearchParams(window.location.search).get("workbench") !==
            "terminal",
        [h, d] = s(u),
        [profile, setProfile] = s(() => currentProfile());
      const tabTitle = profileTabName(profile);
      n(() => { document.title = tabTitle; }, [tabTitle]);
      return (
        n(() => {
          const f = () => {
            d(u());
            const selected = currentProfile();
            rememberProfile(selected); rememberChat();
            setProfile(selected);
          };
          window.addEventListener("popstate", f);
          const S = new MutationObserver(f);
          return (
            S.observe(document.body, { childList: !0, subtree: !0 }),
            () => {
              (window.removeEventListener("popstate", f), S.disconnect());
            }
          );
        }, []),
        i.React.createElement(
          i.React.Fragment,
          null,
          i.React.createElement(a),
          i.React.createElement(
            "div",
            {
              className: "dashboard-persistent-workbench",
              "data-chat-visible": h,
            },
            i.React.createElement(o, { key: profile, profile }),
          ),
        )
      );
    }
    (e.register("workbench", () => null),
      e.registerSlot("workbench", "overlay", l),
      Ax(i, e),
      Mx(),
      Fx(),
      Av(),
      P1(),
      N1(),
      J1(),
      hk(),
      wk(),
      mk(),
      zk(),
      D5());
    const c = window.__HERMES_WORKBENCH_SIDECAR__;
    c && typeof c == "object" && ((c.status = "loaded"), (c.build = j0));
  }
  SM();
})();
