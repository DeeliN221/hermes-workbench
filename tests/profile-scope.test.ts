// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { currentProfile, rememberChat, rememberProfile, profileChatURL, switchProfile, profileDrafts, profileAttachments } from '../dashboard/src/profile-scope';

beforeEach(() => { sessionStorage.clear(); document.body.innerHTML = ''; history.replaceState(null, '', '/chat'); });
describe('browser profile scope', () => {
  it('respects explicit deep links and preserves browser selection for bare links', () => {
    rememberProfile('writer');
    expect(currentProfile('')).toBe('writer');
    expect(currentProfile('?profile=career-coach&session=123')).toBe('career-coach');
  });
  it('switches conversation identity as a unit and remembers both spaces', () => {
    history.replaceState(null, '', '/chat?profile=writer&session=a&kanban_task=t&workbench=files');
    expect(switchProfile('career-coach')).toBe(true);
    expect(location.search).toBe('?profile=career-coach');
    history.replaceState(null, '', '/chat?profile=career-coach&hermesSession=b');
    switchProfile('writer');
    expect(location.search).toBe('?profile=writer&session=a');
    expect(profileChatURL('career-coach')).toBe('/chat?profile=career-coach&hermesSession=b');
  });
  it('keeps the last conversation while visiting settings or terminals', () => {
    rememberChat('/chat?profile=writer&session=a');
    rememberChat('/profiles?profile=writer');
    rememberChat('/chat?profile=writer&workbench=terminal');
    expect(profileChatURL('writer')).toBe('/chat?profile=writer&session=a');
  });
  it('commits scope before changing pages so the host cannot restore its old scope', async () => {
    history.replaceState(null, '', '/config?profile=writer');
    const observed: string[] = [];
    const observe = () => observed.push(location.pathname + location.search);
    window.addEventListener('popstate', observe);
    try {
      expect(switchProfile('career-coach')).toBe(true);
      expect(observed).toEqual(['/config?profile=career-coach']);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      expect(location.pathname + location.search).toBe('/chat?profile=career-coach');
      expect(observed).toEqual(['/config?profile=career-coach', '/chat?profile=career-coach']);
    } finally { window.removeEventListener('popstate', observe); }
  });
  it('waits for the host scope render before navigating to chat', async () => {
    history.replaceState(null, '', '/config?profile=writer');
    const native = document.createElement('div');
    native.id = 'hermes-profile-switcher'; native.textContent = 'writer';
    document.body.append(native);
    switchProfile('career-coach');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(location.pathname).toBe('/config');
    native.textContent = 'career-coach';
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(location.pathname + location.search).toBe('/chat?profile=career-coach');
  });
  it('does not overwrite a newer navigation while a profile transition is pending', async () => {
    history.replaceState(null, '', '/config?profile=writer');
    switchProfile('career-coach');
    history.pushState(null, '', '/skills?profile=career-coach');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(location.pathname).toBe('/skills');
  });
  it('does not commit a cancelled navigation', () => {
    rememberProfile('writer');
    const cancel = (e: Event) => e.preventDefault();
    window.addEventListener('workbench:before-navigate', cancel, { once: true });
    expect(switchProfile('career-coach')).toBe(false);
    expect(currentProfile()).toBe('writer');
    expect(location.pathname).toBe('/chat');
  });
  it('isolates drafts and attachments across profiles and panes', () => {
    profileDrafts('writer', 'pane-1').set('writer:', 'draft');
    profileAttachments('writer', 'pane-1').set('writer:', [{ name: 'file' }]);
    expect(profileDrafts('career-coach', 'pane-1').size).toBe(0);
    expect(profileDrafts('writer', 'pane-2').size).toBe(0);
    expect(profileDrafts('writer', 'pane-1').get('writer:')).toBe('draft');
    expect(profileAttachments('career-coach', 'pane-1').size).toBe(0);
  });
});
