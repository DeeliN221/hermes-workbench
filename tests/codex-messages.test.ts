import { describe, expect, it } from 'vitest';
import { applyChatEvent, messagesFromTurns, normalizeMessage, userContentText } from '../dashboard/src/codex-messages';
const start = 1800000000000;
const event = (method: string, params: object) => ({ method, params });
describe('typed Codex transcript boundary', () => {
  it('retains timing, successful command exit codes and attachment labels in native snapshots', () => {
    const messages = messagesFromTurns([{ id: 'turn', status: 'completed', startedAt: start / 1000, durationMs: 2500, weeklyRemainingPercent: 64,
      items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'Review' }, { type: 'localImage', path: '/workspace/demo/image.png' }], observedAt: start },
        { id: 'tool', type: 'commandExecution', status: 'running', exitCode: 0, aggregatedOutput: 'OK' }],
    }], 'session');
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Review\nAttachment: image.png', observedAt: start, turnCompletedAt: start + 2500, weeklyRemainingPercent: 64 });
    expect(messages[1]).toMatchObject({ role: 'tool', status: 'completed', content: 'OK', error: false });
  });
  it('does not append replayed deltas to a running snapshot, or reopen completed items', () => {
    const snapshot = messagesFromTurns([{ id: 't', status: 'inProgress', items: [{ id: 'a', type: 'agentMessage', text: 'Already streamed\n' }] }], 's');
    expect(applyChatEvent(snapshot, event('item/agentMessage/delta', { itemId: 'a', delta: 'duplicate' }))).toEqual(snapshot);
    const completed = applyChatEvent(snapshot, event('item/completed', { turnId: 't', item: { id: 'a', type: 'agentMessage', text: 'Final' } }));
    const lateStart = applyChatEvent(completed, event('item/started', { turnId: 't', item: { id: 'a', type: 'agentMessage', text: '' } }));
    expect(lateStart).toEqual(completed);
    expect(applyChatEvent(completed, event('item/agentMessage/delta', { itemId: 'a', delta: 'late' }))).toEqual(completed);
  });
  it('merges optimistic requests, native item identity and independent completion snapshots', () => {
    const optimistic = normalizeMessage({ id: 'request', role: 'user', status: 'pending', content: 'Hello', observedAt: start }, 'fallback')!;
    const started = applyChatEvent([optimistic], event('item/started', { turnId: 't', item: { id: 'native', clientId: 'request', type: 'userMessage', content: 'Hello' } }));
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ id: 'request', itemId: 'native', observedAt: start });
    const another = normalizeMessage({ id: 'another', role: 'tool', turnId: 'other', content: 'Work', weeklyRemainingPercent: 80 }, 'fallback')!;
    const metric = applyChatEvent([...started, another], event('workbench/turnMetrics', { turnId: 't', completedAt: start + 5000, weeklyRemainingPercent: 64 }));
    expect(metric[0]).toMatchObject({ turnCompletedAt: start + 5000, weeklyRemainingPercent: 64 });
    expect(metric[1]).toEqual(another);
  });
  it('keeps local image previews on the optimistic request through native merges', () => {
    const optimistic = normalizeMessage({ id: 'request', clientRequestId: 'request', role: 'user', status: 'pending', content: 'See image',
      attachments: [{ id: 'local-image', name: 'photo.png', src: 'blob:http://localhost/preview' }] }, 'fallback')!;
    expect(optimistic.attachments).toEqual([{ id: 'local-image', name: 'photo.png', src: 'blob:http://localhost/preview' }]);
    const started = applyChatEvent([optimistic], event('item/started', { turnId: 't', item: { id: 'native', clientId: 'request', type: 'userMessage', content: 'See image' } }));
    expect(started).toHaveLength(1);
    expect(started[0].attachments).toEqual(optimistic.attachments);
    expect(normalizeMessage({ id: 'bad', role: 'user', content: 'x', attachments: [{ id: 'bad', name: 'x', src: 'javascript:alert(1)' }] }, 'fallback')!.attachments).toEqual([]);
  });
  it('keeps failed tools failed and emits one diagnostic when a turn fails', () => {
    const initial = [normalizeMessage({ id: 'command', role: 'tool', turnId: 't', status: 'running', content: 'failed', exitCode: 1 }, 'fallback')!];
    const failure = event('turn/failed', { turn: { id: 't', status: 'failed', startedAt: start, error: { message: 'Capacity exceeded' } } });
    const complete = applyChatEvent(initial, failure);
    expect(complete[0]).toMatchObject({ status: 'failed', error: true });
    expect(complete.at(-1)).toMatchObject({ runtimeError: 'Capacity exceeded', turnId: 't' });
    expect(applyChatEvent(complete, failure)).toHaveLength(2);
  });
  it('normalizes collaboration items into visible subagent task and progress data', () => {
    const messages = messagesFromTurns([{ id: 't', status: 'inProgress', items: [{
      id: 'collab', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'in_progress',
      prompt: 'Inspect the version UI', receiverThreadIds: ['thread-a'],
      receiverAgents: [{ name: 'version-ui' }], agentsStates: { 'thread-a': { status: 'in_progress', message: 'Scanning files' } },
    }] }], 'session');
    expect(messages[0]).toMatchObject({
      role: 'tool', status: 'running', toolName: 'collab_agent_tool_call', content: 'spawnAgent: Inspect the version UI: 1 subagent(s)',
      subagent: { tool: 'spawnAgent', prompt: 'Inspect the version UI', receiverThreadIds: ['thread-a'], agentsStates: { 'thread-a': { status: 'in_progress', message: 'Scanning files' } } },
    });
    const completed = applyChatEvent(messages, event('item/completed', { turnId: 't', item: {
      id: 'collab', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', prompt: 'Inspect the version UI',
      receiverThreadIds: ['thread-a'], agentsStates: { 'thread-a': { status: 'completed', message: 'Done' } },
    } }));
    expect(completed[0]).toMatchObject({ status: 'completed', subagent: { agentsStates: { 'thread-a': { status: 'completed', message: 'Done' } } } });
  });
  it('accepts malformed items without exposing nested objects as transcript text', () => {
    expect(normalizeMessage(null, 'x')).toBeNull();
    expect(normalizeMessage([], 'x')).toBeNull();
    expect(userContentText([{ text: { internal: 'not visible' } }])).toBe('');
    expect(normalizeMessage({ type: 'reasoning', summary: ['One', [{ text: 'Two' }]] }, 'x')?.content).toBe('One\n\nTwo');
  });
});
