// @vitest-environment happy-dom
// @ts-expect-error Host React is deliberately untyped in this repository.
import React from 'react';
// @ts-expect-error Host React DOM is deliberately untyped.
import { createRoot } from 'react-dom/client';
// @ts-expect-error Host testing dependency is deliberately untyped.
import { act } from 'react-dom/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { createRuntimeTaskReceipts } from '../dashboard/src/runtime-task-receipts';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: any, host: HTMLElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });
it('binds follow-up to its actual task and retains terminal-conflict text without fake success', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const read = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'POST') throw Object.assign(new Error('Fleet rejected the request: task_terminal'), { status: 409 });
    return { tasks: [{ message: 'Run task', receipt: { task_id: 'task-owned', status: 'running', origin: { session_id: 'session-owned' } }, current: { status: 'running', revision: 2 } }] };
  });
  const View = createRuntimeTaskReceipts({ React, hooks: React, fetchJSON: read as any });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(React.createElement(View, { profile: 'profile-owned', session: 'session-owned' })); });
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep this follow-up');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // React's happy-dom input tracking can depend on the host event facade.
  const propsKey = Object.keys(textarea).find(key => key.startsWith('__reactProps'))!;
  await act(async () => { (textarea as any)[propsKey].onChange({ target: { value: 'Keep this follow-up' } }); });
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const write = calls.find(call => call.init?.method === 'POST')!;
  expect(write.url).toBe('/api/plugins/workbench/fleet/tasks/task-owned/messages?profile_id=profile-owned&session_id=session-owned');
  expect(JSON.parse(String(write.init!.body))).toMatchObject({ text: 'Keep this follow-up', message_id: expect.any(String) });
  expect(textarea.value).toBe('Keep this follow-up');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('task_terminal');
  expect(host.textContent).not.toContain('Follow-up accepted');
});
