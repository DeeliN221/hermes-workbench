/**
 * Extract the current session identity from Hermes PTY sidecar events.
 * Process JSON event envelopes only, without networking or browser-terminal dependencies.
 */

/** Extract the exact Hermes session id from a session.info event. */
export function sessionIdFromEvent(value: unknown): string | null {
  try {
    const frame = JSON.parse(String(value ?? ''));
    const params = frame?.method === 'event' ? frame.params : null;
    if (params?.type !== 'session.info') return null;
    const sessionId = String(params.session_id ?? '').trim();
    return sessionId || null;
  } catch {
    return null;
  }
}

export type SessionActivityDecision = 'ignore' | 'probe' | 'adopt';

/** Reload persisted transcripts when their current session receives a matching status event. */
export function shouldRefreshTranscript(currentSessionId: string, activeSessionId: string): boolean {
  return Boolean(currentSessionId && activeSessionId && currentSessionId === activeSessionId);
}

/** Allow new chats to adopt only active IDs already present in the persisted session list. */
export function sessionActivityDecision(
  currentSessionId: string,
  activeSessionId: string,
  activeSessionIsPersisted: boolean,
): SessionActivityDecision {
  if (!activeSessionId || currentSessionId) return 'ignore';
  return activeSessionIsPersisted ? 'adopt' : 'probe';
}
