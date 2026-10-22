import { describe, expect, it } from 'vitest';
import { paneTargetUrl } from '../dashboard/src/codex-pane-route';

describe('pane route target', () => {
  it('moves the URL from a closed session to the surviving active pane', () => {
    const next = paneTargetUrl('https://example.test/chat?profile=zzl&session=closed', {
      sessionId: 'next', hermesSessionId: '',
    });
    expect(new URL(next).searchParams.get('session')).toBe('next');
    expect(new URL(next).searchParams.get('profile')).toBe('zzl');
  });
  it('clears both route keys for a new empty pane', () => {
    const next = paneTargetUrl('https://example.test/chat?session=closed&hermesSession=old', {
      sessionId: '', hermesSessionId: '',
    });
    expect(new URL(next).searchParams.has('session')).toBe(false);
    expect(new URL(next).searchParams.has('hermesSession')).toBe(false);
  });
});
