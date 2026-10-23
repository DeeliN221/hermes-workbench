import { describe, expect, it } from 'vitest';
import {
  clearNewSessionRoute,
  isNewSessionRoute,
  paneInitialSession,
  paneTargetUrl,
  temporarySessionTarget,
} from '../dashboard/src/codex-pane-route';

describe('new temporary session routing', () => {
  it('keeps an explicitly empty pane empty instead of reopening the route session', () => {
    expect(paneInitialSession('', 'running')).toBe('');
    expect(paneInitialSession(undefined, 'running')).toBe('running');
    expect(paneInitialSession(undefined, null)).toBe('');
  });

  it('navigates from another page with the current profile and a new-pane marker', () => {
    expect(temporarySessionTarget('https://example.test/home?profile=writer', 'writer'))
      .toBe('/chat?profile=writer&new=1');
    expect(temporarySessionTarget('https://example.test/chat?profile=writer&session=run', 'writer'))
      .toBeNull();
    expect(temporarySessionTarget('https://example.test/chat?profile=writer&workbench=terminal', 'writer'))
      .toBe('/chat?profile=writer&new=1');
  });

  it('consumes the marker once the empty pane has mounted', () => {
    expect(isNewSessionRoute('https://example.test/chat?profile=writer&new=1')).toBe(true);
    expect(isNewSessionRoute('https://example.test/chat?profile=writer')).toBe(false);
    expect(clearNewSessionRoute('https://example.test/chat?profile=writer&new=1'))
      .toBe('https://example.test/chat?profile=writer');
  });
});

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
  it('keeps the pane profile in the route for cross-profile panes', () => {
    const next = paneTargetUrl('https://example.test/chat?profile=writer&session=old', {
      sessionId: 'inbox', hermesSessionId: '', profile: 'default',
    });
    expect(new URL(next).searchParams.get('profile')).toBe('default');
    expect(new URL(next).searchParams.get('session')).toBe('inbox');
  });
});
