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

  it('opens a cross-profile recent card after the custom home route switches scope', async () => {
    history.replaceState(null, '', '/sessions?profile=default');
    const navigate = vi.fn();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 0;
    });
    const { openHomeConversation } = await import('../dashboard/src/home-navigation');
    openHomeConversation('/chat?session=one', 'writer', navigate);
    expect(navigate).toHaveBeenCalledWith('/chat?session=one', 'writer');
    raf.mockRestore();
  });
});
