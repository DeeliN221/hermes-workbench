// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error Host React is deliberately untyped.
import React from 'react';
// @ts-expect-error Host React DOM is deliberately untyped.
import { createRoot } from 'react-dom/client';
import { createStandaloneTaskContext, fleetPrompt } from '../dashboard/src/standalone-task-context';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: any, host: HTMLElement;
afterEach(async () => { if (root) await React.act(async () => root.unmount()); host?.remove(); });
it('verifies the DSH source before linking and displays only the current attempt notification', async () => {
  const task = { id: 'task', attempt_id: 'new', epoch: 2, origin: { runtime: 'dsh', user_id: 'owner', profile_id: 'p', project_id: 'j', session_id: 's' } };
  let valid = false;
  const read = vi.fn(async () => ({ session: { id: valid ? 's' : 'wrong', profile_id: 'p', project_id: 'j' }, deliveries: [{ source: 'fleet', task_id: 'task', attempt_id: 'old', epoch: 1, content: 'Old result' }, { source: 'fleet', task_id: 'task', attempt_id: 'new', epoch: 2, content: 'Current result' }] }));
  const View = createStandaloneTaskContext({ React, hooks: React, fetchJSON: read as any });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const navigate = vi.fn();
  await React.act(async () => root.render(React.createElement(View, { task, navigate })));
  expect(host.querySelector('button')!.disabled).toBe(true);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('not confirmed');
  valid = true;
  await React.act(async () => root.render(React.createElement(View, { task: { ...task, id: 'another' }, navigate })));
  await React.act(async () => root.render(React.createElement(View, { task, navigate })));
  expect(host.textContent).toContain('Current result');
  expect(host.textContent).not.toContain('Old result');
  expect(host.querySelector('button')!.disabled).toBe(false);
  await React.act(async () => host.querySelector('button')!.click());
  expect(navigate).toHaveBeenCalledWith('/chat?profile=p&session=s', 'p');
});
it('shows the actual prompt from a Fleet execution envelope without hiding user text', () => {
  expect(fleetPrompt('{"model":"runtime-model","prompt":"User request","reasoning_effort":"high"}')).toBe('User request');
  expect(fleetPrompt('Plain user request')).toBe('Plain user request');
  expect(fleetPrompt('{"prompt":"User JSON","custom":true}')).toBe('{"prompt":"User JSON","custom":true}');
});
