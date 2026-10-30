import { describe, expect, it } from 'vitest';
import { CodexSendError, sendCodexMessageRetry } from '../dashboard/src/codex-api';
import type { FetchJSON } from '../dashboard/src/workbench-api';

/** A queue of scripted sidecar responses; the last one repeats. */
function scriptedFetch(responses: Array<{ status: number; body: string }>) {
  let attempts = 0;
  const fetch = async () => {
    const response = responses[Math.min(attempts, responses.length - 1)];
    attempts += 1;
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch: fetch as never, get attempts() { return attempts; } };
}

const accepted = { status: 200, body: JSON.stringify({ request: { status: 'accepted', turn_id: 'turn-1' } }) };
const updating = { status: 503, body: '{"detail":"Workbench is updating. Please retry later."}' };
const archived = { status: 409, body: '{"detail":"Running or awaiting session cannot be archived"}' };
const read: FetchJSON = async () => {
  throw new Error('the retry helper must submit through the authenticated fetch');
};

describe('sendCodexMessageRetry', () => {
  it('replays an update-window rejection until the sidecar accepts', async () => {
    const sidecar = scriptedFetch([updating, updating, accepted]);
    const waits: number[] = [];

    const result = await sendCodexMessageRetry(
      read, 'default', 'session-1', 'hello', 'req-1', {}, sidecar.fetch,
      async milliseconds => { waits.push(milliseconds); },
    );

    expect(result.accepted).toBe(true);
    expect(result.turnId).toBe('turn-1');
    expect(sidecar.attempts).toBe(3);
    expect(waits).toEqual([400, 1200]);
  });

  it('turns an exhausted retry into a failed send with the update notice', async () => {
    const sidecar = scriptedFetch([updating]);
    const waits: number[] = [];

    const error = await sendCodexMessageRetry(
      read, 'default', 'session-1', 'hello', 'req-1', {}, sidecar.fetch,
      async milliseconds => { waits.push(milliseconds); },
    ).catch(reason => reason);

    expect(error).toBeInstanceOf(CodexSendError);
    expect((error as CodexSendError).status).toBe(503);
    expect((error as Error).message).toMatch(/正在更新|is updating/);
    expect(sidecar.attempts).toBe(4);
    expect(waits).toEqual([400, 1200, 3000]);
  });

  it('does not retry a semantic conflict', async () => {
    const sidecar = scriptedFetch([archived]);
    const waits: number[] = [];

    const error = await sendCodexMessageRetry(
      read, 'default', 'session-1', 'hello', 'req-1', {}, sidecar.fetch,
      async milliseconds => { waits.push(milliseconds); },
    ).catch(reason => reason);

    expect(error).toBeInstanceOf(CodexSendError);
    expect((error as CodexSendError).status).toBe(409);
    expect(sidecar.attempts).toBe(1);
    expect(waits).toEqual([]);
  });
});
