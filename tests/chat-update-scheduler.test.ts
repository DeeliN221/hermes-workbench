// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { subscribeChatLists, createChatEventBatch, stableChatList } from '../dashboard/src/chat-update-scheduler';

let hidden = false;
let stops: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers(); hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => { stops.forEach(stop => stop()); stops = []; vi.useRealTimers(); });

test('three panes share a poll, pause when hidden, and keep remaining panes alive', async () => {
  const identity = {}, load = vi.fn(async () => [1]), accept = [vi.fn(), vi.fn(), vi.fn()];
  for (const callback of accept) stops.push(subscribeChatLists(identity, 'default', load, {
    begin: () => callback, error: vi.fn(),
  }));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  accept.forEach(callback => expect(callback).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(2);
  stops[0](); hidden = true;
  await vi.advanceTimersByTimeAsync(6000);
  expect(load).toHaveBeenCalledTimes(2);
  hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(3);
  expect(accept[0]).toHaveBeenCalledTimes(2);
  expect(accept[1]).toHaveBeenCalledTimes(3);
});

test('does not overlap slow requests, cross identities, or deliver to retired panes', async () => {
  let resolve!: (value: number[]) => void;
  const load = vi.fn(() => new Promise<number[]>(r => { resolve = r; }));
  const accept = vi.fn(), listener = { begin: () => accept, error: vi.fn() }, identity = {};
  stops.push(subscribeChatLists(identity, 'default', load, listener));
  await vi.advanceTimersByTimeAsync(6000);
  expect(load).toHaveBeenCalledTimes(1);
  stops[0](); resolve([1]); await vi.advanceTimersByTimeAsync(0);
  expect(accept).not.toHaveBeenCalled();
  const nextLoad = vi.fn(async () => [2]);
  stops.push(subscribeChatLists(identity, 'other', nextLoad, listener));
  stops.push(subscribeChatLists({}, 'other', nextLoad, listener));
  await vi.advanceTimersByTimeAsync(0);
  expect(nextLoad).toHaveBeenCalledTimes(2);
});

test('mutation fences reject stale results and failed polls can recover', async () => {
  let revision = 0, resolve!: (value: number[]) => void;
  const accept = vi.fn(), error = vi.fn();
  const load = vi.fn(() => new Promise<number[]>(r => { resolve = r; }));
  stops.push(subscribeChatLists({}, 'default', load, {
    begin: () => { const started = revision; return value => { if (started === revision) accept(value); }; }, error,
  }));
  await vi.advanceTimersByTimeAsync(0);
  revision++; resolve([1]); await vi.advanceTimersByTimeAsync(0);
  expect(accept).not.toHaveBeenCalled();
  load.mockRejectedValueOnce(new Error('offline'));
  await vi.advanceTimersByTimeAsync(2000); expect(error).toHaveBeenCalledTimes(1);
  load.mockResolvedValueOnce([2]);
  await vi.advanceTimersByTimeAsync(2000); expect(accept).toHaveBeenCalledWith([2]);
});

test('stream batches preserve order, flush terminal events and discard retired-session work', () => {
  const apply = vi.fn(), batch = createChatEventBatch<number>(apply);
  for (let n = 0; n < 100; n++) batch.push(n);
  vi.advanceTimersByTime(49); expect(apply).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(apply).toHaveBeenCalledExactlyOnceWith(Array.from({ length: 100 }, (_, n) => n));
  batch.push(100); batch.push(101); batch.flush();
  expect(apply).toHaveBeenLastCalledWith([100, 101]);
  batch.push(102); batch.clear(); vi.advanceTimersByTime(1000);
  expect(apply).toHaveBeenCalledTimes(2);
  for (let n = 0; n < 256; n++) batch.push(n);
  expect(apply).toHaveBeenCalledTimes(3);
});

test('unchanged lists reuse state but metadata changes are delivered', () => {
  const previous = [{ id: 'session', unread: false }];
  expect(stableChatList(previous, [{ ...previous[0] }])).toBe(previous);
  expect(stableChatList(previous, [{ id: 'session', unread: true }])).not.toBe(previous);
});
