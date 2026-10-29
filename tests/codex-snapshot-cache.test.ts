import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { loadCodexPreview, loadCodexSnapshot, saveCodexSnapshot } from '../dashboard/src/codex-snapshot-cache';

let window: Window;

beforeEach(() => {
  window = new Window({ url: 'http://localhost/' });
  vi.stubGlobal('window', window);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('keeps the latest Codex messages for a synchronous reload', () => {
  saveCodexSnapshot('default\0session-1', {
    turnId: 'turn-1',
    messages: Array.from({ length: 60 }, (_, index) => ({ id: `message-${index}`, content: `answer-${index}` })),
  });

  const loaded = loadCodexSnapshot('default\0session-1');

  expect(loaded?.turnId).toBe('turn-1');
  expect(loaded?.messages).toHaveLength(48);
  expect(loaded?.messages[0].id).toBe('message-12');
  expect(loaded?.messages.at(-1)?.id).toBe('message-59');
});

it('extracts the latest user and assistant text for the thin loader', () => {
  saveCodexSnapshot('default\u0000session-1', {
    turnId: 'turn-1',
    messages: [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: [{ type: 'text', text: 'latest answer' }] },
      { role: 'reasoning', content: 'hidden' },
    ],
  });

  expect(loadCodexPreview('default\u0000session-1')).toEqual([
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'latest answer' },
  ]);
});

it('ignores expired, malformed, and other-session snapshots', () => {
  saveCodexSnapshot('default\0session-1', { messages: [{ id: 'one' }] });
  const storageKey = 'hermes-workbench.codex-snapshot.v1:default%00session-1';
  expect(window.localStorage.getItem(storageKey)).toBeTruthy();

  const value = JSON.parse(window.localStorage.getItem(storageKey)!);
  window.localStorage.setItem(storageKey, JSON.stringify({ ...value, cachedAt: 0 }));
  expect(loadCodexSnapshot('default\0session-1')).toBeNull();

  window.localStorage.setItem(storageKey, '{bad');
  expect(loadCodexSnapshot('default\0session-1')).toBeNull();
  expect(loadCodexSnapshot('default\0session-2')).toBeNull();
});
