import type { Task } from "./task-control-model";
export type Lane = "all" | "fast" | "slow";
export type CardDelta = { tasks: Task[]; removed: string[]; cursors: Partial<Record<"fast" | "slow", string>>; full: boolean };
export const CARD_INTERVALS = { fast: 7500, slow: 30000 };

/** Preserve references (and ordering) for unchanged cards, including terminal cards. */
export function mergeCards(previous: Task[], delta: CardDelta): Task[] {
  const updates = new Map(delta.tasks.map(task => [task.id, task]));
  const removed = new Set(delta.removed);
  const result: Task[] = [];
  for (const task of previous) {
    const next = updates.get(task.id);
    updates.delete(task.id);
    if (removed.has(task.id) || (delta.full && !next)) continue;
    result.push(!next || JSON.stringify(task) === JSON.stringify(next) ? task : next);
  }
  result.push(...updates.values());
  return result.length === previous.length && result.every((task, i) => task === previous[i]) ? previous : result;
}

/** One request at a time, visibility cancellation, coalesced explicit sync and shared backoff. */
export function cardRefresh(options: {
  fetch: (lane: Lane, cursor: string, signal: AbortSignal) => Promise<CardDelta>;
  apply: (delta: CardDelta) => void;
  error: (error: unknown) => void;
  visible?: () => boolean;
}) {
  const visible = options.visible || (() => !document.hidden);
  let stopped = false, pending = true, failures = 0, retryAt = 0;
  let active: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const waiters: (() => void)[] = [];
  const due = { fast: 0, slow: 0 };
  const cursors = { fast: "", slow: "" };
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || active || !visible()) return;
    timer = setTimeout(() => void tick(), Math.max(0, Math.max(retryAt, pending ? 0 : Math.min(due.fast, due.slow)) - Date.now()));
  };
  const tick = async () => {
    if (stopped || active || !visible()) return;
    if (Date.now() < retryAt) { schedule(); return; }
    const lane: Lane = pending ? "all" : due.fast <= due.slow ? "fast" : "slow";
    if (lane !== "all" && Date.now() < due[lane]) { schedule(); return; }
    pending = false;
    const completed = lane === "all" ? waiters.splice(0) : [];
    const controller = new AbortController(); active = controller;
    try {
      const delta = await options.fetch(lane, lane === "all" ? "" : cursors[lane], controller.signal);
      if (stopped || controller.signal.aborted) return;
      options.apply(delta);
      Object.assign(cursors, delta.cursors);
      failures = 0; retryAt = 0;
      if (lane === "all") {
        due.fast = Date.now() + CARD_INTERVALS.fast;
        due.slow = Date.now() + CARD_INTERVALS.slow;
      } else due[lane] = Date.now() + CARD_INTERVALS[lane];
    } catch (error) {
      if (!stopped && !controller.signal.aborted) {
        if (lane === "all") pending = true;
        retryAt = Date.now() + Math.min(120000, CARD_INTERVALS.fast * 2 ** ++failures);
        options.error(error);
      }
    } finally { active = undefined; completed.forEach(resolve => resolve()); schedule(); }
  };
  return {
    start: () => { void tick(); },
    refresh: () => new Promise<void>(resolve => {
      if (stopped) { resolve(); return; }
      waiters.push(resolve); pending = true; schedule();
    }),
    focus: () => { if (!active && visible()) { pending = true; schedule(); } },
    visibility: () => {
      clearTimeout(timer);
      if (!visible()) active?.abort();
      else { pending = true; schedule(); }
    },
    stop: () => { stopped = true; clearTimeout(timer); active?.abort(); waiters.splice(0).forEach(resolve => resolve()); },
  };
}
