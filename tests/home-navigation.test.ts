// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installHomeChatNavigation } from '../dashboard/src/home-navigation';
let dispose = () => {};
afterEach(() => dispose());
describe('persistent chat home links', () => {
  it('selects both sources on route changes without selecting another profile or hidden page', () => {
    history.replaceState(null, '', '/sessions?profile=writer');
    const select = { codex: vi.fn(), hermes: vi.fn() };
    dispose = installHomeChatNavigation('writer', select);
    const go = (path: string) => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); };
    go('/chat?profile=writer&session=one');
    expect(select.codex).toHaveBeenLastCalledWith('one');
    go('/chat?profile=writer&session=two');
    expect(select.codex).toHaveBeenLastCalledWith('two');
    go('/chat?profile=writer&hermesSession=history');
    expect(select.hermes).toHaveBeenCalledWith('history');
    go('/chat?profile=default&session=other');
    go('/sessions?profile=writer&session=other');
    go('/chat?profile=writer&session=other&workbench=terminal');
    go('/chat?profile=writer&session=other&new=1');
    expect(select.codex).toHaveBeenCalledTimes(2);
    dispose(); go('/chat?profile=writer&session=after-dispose');
    expect(select.codex).toHaveBeenCalledTimes(2);
  });
  it('consumes a direct link when the profile pane mounts', () => {
    history.replaceState(null, '', '/chat?profile=writer&session=one');
    const select = { codex: vi.fn(), hermes: vi.fn() };
    dispose = installHomeChatNavigation('writer', select);
    expect(select.codex).toHaveBeenCalledWith('one');
  });

  it.each(['/', '/home', '/sessions'])('opens the first home card atomically from %s', async home => {
    history.replaceState(null, '', `${home}?profile=default`);
    const navigate = vi.fn();
    const push = vi.spyOn(history, 'pushState');
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    const { openHomeConversation } = await import('../dashboard/src/home-navigation');
    try {
      openHomeConversation('/chat?session=one&profile=writer', 'writer', navigate);
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/chat?session=one&profile=writer', 'writer');
      // A staged home/profile route can trigger the host's fallback redirect.
      expect(push).not.toHaveBeenCalled();
      expect(frame).not.toHaveBeenCalled();
      expect(location.pathname + location.search).toBe(`${home}?profile=default`);
    } finally { push.mockRestore(); frame.mockRestore(); }
  });
});
