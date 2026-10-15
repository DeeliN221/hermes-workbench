/** One list poll per SDK identity/profile, regardless of the number of panes. */
type Listener<T> = {
  begin: () => ((value: T) => void) | undefined;
  error: (error: unknown) => void;
};
type Poll<T> = { listeners: Set<Listener<T>>; stop: () => void };
const polls = new WeakMap<object, Map<string, Poll<any>>>();

export function subscribeChatLists<T>(identity: object, profile: string,
  load: () => Promise<T>, listener: Listener<T>): () => void {
  let scoped = polls.get(identity);
  if (!scoped) { scoped = new Map(); polls.set(identity, scoped); }
  let poll = scoped.get(profile) as Poll<T> | undefined;
  if (!poll) {
    const listeners = new Set<Listener<T>>();
    let busy = false, disposed = false;
    const refresh = async () => {
      if (disposed || busy || document.hidden) return;
      const pending = [...listeners].map(item => ({ item, accept: item.begin() }));
      if (!pending.some(item => item.accept)) return;
      busy = true;
      try {
        const value = await load();
        if (!disposed) for (const { item, accept } of pending) {
          if (listeners.has(item)) accept?.(value);
        }
      } catch (error) {
        if (!disposed) for (const { item, accept } of pending) {
          if (accept && listeners.has(item)) item.error(error);
        }
      } finally { busy = false; }
    };
    const timer = setInterval(refresh, 2000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    poll = { listeners, stop: () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    } };
    scoped.set(profile, poll);
    // Allow panes mounting in the same commit to join the first request.
    queueMicrotask(refresh);
  }
  poll.listeners.add(listener);
  const current = poll;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) {
      current.stop();
      if (scoped!.get(profile) === current) scoped!.delete(profile);
    }
  };
}

/** Keep unchanged list references so quiet polls do not rerender chat trees. */
export function stableChatList<T>(previous: T[], next: T[]): T[] {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

/** Preserve event order while committing at most once per 50 ms of streaming. */
export function createChatEventBatch<T>(apply: (events: T[]) => void) {
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; pending = []; };
  const flush = () => {
    const events = pending;
    clear();
    if (events.length) apply(events);
  };
  return {
    push(event: T) {
      pending.push(event);
      if (pending.length >= 256) flush();
      else if (timer === undefined) timer = setTimeout(flush, 50);
    },
    flush, clear,
  };
}
