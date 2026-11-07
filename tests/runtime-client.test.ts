// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeProjection, projectSnapshot, projectInteraction, runtimeInteractionResponse, subscribeRuntime, type RuntimeEvent, type RuntimeSnapshot } from '../dashboard/src/runtime-client';
import type { FetchJSON } from '../dashboard/src/workbench-api';

const snapshot = (status = 'running'): RuntimeSnapshot => ({ session: { id: 's1', runtime: 'dsh', profile_id: 'p1', project_id: 'a' }, messages: [], cursor: '0', interactions: [], inbox: [], status });
const event = (type: string, sequence: number, data: Record<string, unknown>, attempt_id = 'one'): RuntimeEvent => ({ type, session_id: 's1', cursor: String(sequence), sequence, attempt_id, data });
const initialized = () => { const state = new RuntimeProjection('s1'); state.apply(event('snapshot', 0, snapshot() as unknown as Record<string, unknown>)); return state; };
afterEach(() => vi.useRealTimers());

describe('neutral DSH presentation', () => {
  it('applies model changes from another device and ignores older selection revisions', () => {
    const state = initialized();
    state.apply({ type: 'model.changed', session_id: 's1', data: { session: { id: 's1', model: 'selected', model_revision: 2, reasoning_effort: 'high' } } });
    expect(state.value?.session).toMatchObject({ model: 'selected', modelRevision: 2, reasoningEffort: 'high' });
    state.apply({ type: 'model.changed', session_id: 's1', data: { session: { id: 's1', model: 'stale', model_revision: 1 } } });
    expect(state.value?.session?.model).toBe('selected');
  });
  it('projects tool call/result cards while tool-only states preserve active execution', () => {
    const state = initialized();
    state.apply(event('state', 1, { status: 'running', tool: { type: 'tool/call', call_id: 'call-1', name: 'read_file', arguments: { path: 'notes.txt' } } }));
    expect(state.value?.messages[0]).toMatchObject({ role: 'tool', toolName: 'read_file', status: 'running', input: { path: 'notes.txt' } });
    state.apply(event('state', 2, { tool: { type: 'tool/result', call_id: 'call-1', name: 'read_file', content: 'real tool output', status: 'completed' } }));
    expect(state.value?.messages).toHaveLength(1);
    expect(state.value?.messages[0]).toMatchObject({ status: 'completed', content: 'real tool output' });
    expect(state.value?.turnId).toBe('s1');
    state.apply(event('state', 2, { tool: { type: 'tool/result', call_id: 'call-1', content: 'duplicate' } }));
    expect(state.value?.messages[0].content).toBe('real tool output');
    state.apply(event('state', 3, { status: 'cancelled' }));
    expect(state.value?.turnId).toBe('');
  });
  it('restores partial streaming and persisted tool cards on refresh without claiming completion', () => {
    const value = projectSnapshot({ ...snapshot(), tools: [{ type: 'tool/result', call_id: 'x', name: 'shell', content: 'actual output', status: 'completed' }], streaming: { attempt_id: 'active', content: 'partial response' } });
    expect(value.messages[1]).toMatchObject({ id: 'active', status: 'running', content: 'partial response' });
    expect(value.messages[0]).toMatchObject({ role: 'tool', status: 'completed' });
  });

  it('projects durable messages directly and keeps receipts active', () => {
    expect(projectSnapshot(snapshot('accepted')).turnId).toBe('s1');
    expect(projectSnapshot(snapshot('completed')).turnId).toBe('');
    expect(() => projectSnapshot({ ...snapshot(), messages: undefined } as unknown as RuntimeSnapshot)).toThrow('Incomplete');
  });
  it('deduplicates replay and ignores out-of-order and cross-session events', () => {
    const state = initialized();
    state.apply(event('assistant.delta', 1, { message_id: 'a', delta: 'hello' }));
    state.apply(event('assistant.delta', 1, { message_id: 'a', delta: 'hello' }));
    state.apply({ ...event('assistant.delta', 2, { message_id: 'a', delta: 'wrong' }), session_id: 'other' });
    expect(state.value?.messages[0].content).toBe('hello');
    state.apply(event('message.committed', 3, { message: { id: 'a', role: 'assistant', content: 'hello world' } }));
    state.apply(event('assistant.delta', 4, { message_id: 'a', delta: 'late' }));
    expect(state.value?.messages).toHaveLength(1);
    expect(state.value?.messages[0]).toMatchObject({ content: 'hello world', status: 'completed' });
  });
  it('fences retired generations and replaces partial text from a durable refresh', () => {
    const state = initialized();
    state.apply(event('assistant.delta', 1, { message_id: 'a', delta: 'partial' }));
    state.apply(event('state', 2, { status: 'running' }, 'two'));
    state.apply(event('assistant.delta', 3, { message_id: 'a', delta: 'stale' }));
    expect(state.value?.messages[0].content).toBe('partial');
    const settled = { ...snapshot('completed'), messages: [{ id: 'a', role: 'assistant', content: 'persisted final' }], cursor: '8' };
    state.apply(event('snapshot', 8, settled as unknown as Record<string, unknown>, 'two'));
    expect(state.value?.messages[0].content).toBe('persisted final');
    expect(state.value?.turnId).toBe('');
  });
  it('surfaces runtime errors without a fabricated assistant success', () => {
    const state = initialized();
    state.apply(event('error', 1, { message: 'bridge failed' }));
    expect(state.value?.runtimeError).toBe('bridge failed');
    expect(state.value?.turnId).toBe('');
    expect(state.value?.messages).toEqual([]);
    state.apply(event('state', 2, { status: 'failed' }));
    expect(state.value?.session?.status).toBe('failed');
  });
  it('handles interaction replay, resolution, and cancellation', () => {
    const state = initialized();
    state.apply(event('interaction.requested', 1, { id: 'q', kind: 'approval', prompt: 'Allow?' }));
    state.apply(event('interaction.requested', 2, { id: 'q', kind: 'approval', prompt: 'Allow?' }));
    expect(state.value?.pendingApprovals).toHaveLength(1);
    state.apply(event('interaction.resolved', 3, { request_id: 'q' }));
    expect(state.value?.pendingApprovals).toEqual([]);
    state.apply(event('state', 4, { status: 'cancelled' }));
    expect(state.value?.turnId).toBe('');
  });
});

describe('neutral stream reconnect', () => {
  it('reconciles snapshot on reconnect and resumes its cursor after disconnect', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const read = vi.fn(async () => { reads++; return { ...snapshot(reads === 1 ? 'running' : 'completed'), cursor: String(reads), messages: reads === 1 ? [] : [{ id: 'persisted', role: 'assistant', content: 'durable after reconnect' }] }; }) as unknown as FetchJSON;
    const stream = vi.fn(async (_url: string, _init?: RequestInit) => new Response('data: ' + JSON.stringify(event('assistant.delta', 2, { message_id: 'partial', delta: 'streamed' })) + '\r\n\r\n', { headers: { 'Content-Type': 'text/event-stream' } }));
    const update = vi.fn(), error = vi.fn();
    const dispose = subscribeRuntime(read, 'p1', 's1', { update, error, open: vi.fn() }, stream as typeof fetch);
    await vi.advanceTimersByTimeAsync(50);
    expect(update.mock.calls.some(([view]) => view.messages.some((message: { content: string }) => message.content === 'streamed'))).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('disconnected') }));
    await vi.advanceTimersByTimeAsync(300);
    expect(reads).toBe(2);
    expect(stream.mock.calls[1][0]).toContain('cursor=2');
    expect(update.mock.calls.some(([view]) => view.messages.some((message: { content: string }) => message.content === 'durable after reconnect'))).toBe(true);
    dispose();
    await vi.advanceTimersByTimeAsync(6000);
    expect(reads).toBe(2);
  });
  it('reports rejected streams, and fences late snapshots after disposal', async () => {
    vi.useFakeTimers();
    const error = vi.fn(), update = vi.fn();
    let resolve: (value: RuntimeSnapshot) => void = () => {};
    const pending = new Promise<RuntimeSnapshot>(done => { resolve = done; });
    const read = (() => pending) as FetchJSON;
    const stream = vi.fn();
    const dispose = subscribeRuntime(read, 'p1', 's1', { update, error, open: vi.fn() }, stream);
    dispose(); resolve(snapshot());
    await vi.advanceTimersByTimeAsync(1);
    expect(update).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled();
    const stop = subscribeRuntime((async () => snapshot()) as FetchJSON, 'p1', 's1', { update, error, open: vi.fn() }, (async () => new Response('', { status: 503 })) as typeof fetch);
    await vi.advanceTimersByTimeAsync(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('503') }));
    stop();
  });
});

it('restores opaque attachment references and failed messages without persisting image data', () => {
  const value = projectSnapshot({ ...snapshot('error'), messages: [{ id: 'u', role: 'user', content: 'Inspect image', attachments: [{ attachmentId: 'image-1', mediaType: 'image/png', name: 'sample.png' }] }, { id: 'a', role: 'assistant', content: 'partial error', status: 'error' }] });
  expect(value.messages[0].attachments?.[0]).toMatchObject({ id: 'image-1', name: 'sample.png', src: '/api/plugins/workbench/attachments/image-1/preview?profile=p1&session_id=s1' });
  expect(value.messages[1].status).toBe('failed');
  expect(value.runtimeError).toContain('failed');
});

it('restores one process card per tool call when durable messages and snapshot tools overlap', () => {
  const tool = { type: 'tool/result', call_id: 'call-overlap', name: 'read_file', arguments: { path: 'note.txt' }, status: 'completed', content: 'Tool result' };
  const value = projectSnapshot({ ...snapshot('completed'), messages: [{ id: 'native-tool-message', role: 'tool', content: 'Tool result', tool }], tools: [tool] });
  expect(value.messages).toHaveLength(1);
  expect(value.messages[0]).toMatchObject({ id: 'tool:call-overlap', role: 'tool', toolName: 'read_file', result: 'Tool result' });
});

it('keeps durable Fleet notifications separate from assistant replies and ongoing inference', () => {
  const projection = initialized();
  projection.apply(event('state', 1, { status: 'running' }, 'model-attempt'));
  const delivery = { delivery_id: 'delivery-1', source: 'fleet', task_id: 'task-1', attempt_id: 'worker-attempt', epoch: 2, kind: 'result', content: 'Actual background result' };
  projection.apply(event('delivery.received', 2, { delivery }, 'worker-attempt'));
  projection.apply(event('delivery.received', 3, { delivery }, 'worker-attempt'));
  expect(projection.value?.messages).toHaveLength(1);
  expect(projection.value?.messages[0]).toMatchObject({ role: 'notification', delivery: { source: 'fleet', task_id: 'task-1', epoch: 2 } });
  expect(projection.value?.turnId).toBe('s1');
  expect(projection.attempt).toBe('model-attempt');
  const restored = projectSnapshot({ ...snapshot('idle'), deliveries: [delivery] });
  expect(restored.messages.filter(message => message.role === 'assistant')).toHaveLength(0);
  expect(restored.messages[0].id).toBe(projection.value?.messages[0].id);
});

it('projects actual DSH questions into the existing form and replies with neutral selected/custom answers', () => {
  const questions = [{ id: 'choice', question: 'Choose', options: [{ label: 'Alpha' }, { label: 'Beta' }] }];
  expect(projectInteraction({ id: 'request', kind: 'question', questions })).toMatchObject({ kind: 'user-input', questions: [{ id: 'choice', question: 'Choose', isOther: true }] });
  expect(runtimeInteractionResponse({ choice: { answers: ['Beta'] } }, questions)).toEqual({ answer: { answers: [{ id: 'choice', selected: ['Beta'] }] } });
  expect(runtimeInteractionResponse({ choice: { answers: ['Custom'] } }, questions)).toEqual({ answer: { answers: [{ id: 'choice', selected: [], custom: 'Custom' }] } });
  expect(runtimeInteractionResponse('approve')).toEqual({ decision: 'allowed-once' });
  expect(runtimeInteractionResponse('reject')).toEqual({ decision: 'rejected' });
});
