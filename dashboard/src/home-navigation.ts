import { uiText as sourceText } from './ui-locale';
import { currentProfile, switchProfile } from './profile-scope';
/** Let the host commit profile state before changing pathname to the selected chat. */
export function openHomeConversation(path: string, profile: string, navigate: (path: string, profile: string) => void): void {
  if (currentProfile() === profile) { navigate(path, profile); return; }
  const openedFromHome = ['/', '/home', '/sessions'].includes(window.location.pathname);
  if (!switchProfile(profile)) return;
  const pending = window.location.href;
  const finish = () => { if (window.location.href === pending) navigate(path, profile); };
  // The custom recent-sessions page does not always render the native profile
  // switcher. Let the URL/profile state commit before opening the chat route.
  if (openedFromHome) {
    requestAnimationFrame(() => requestAnimationFrame(finish));
    return;
  }
  const native = document.getElementById('hermes-profile-switcher');
  if (!native) { requestAnimationFrame(() => requestAnimationFrame(finish)); return; }
  const observer = new MutationObserver(check);
  const timer = setTimeout(() => {
    observer.disconnect();
    if (window.location.href === pending) window.dispatchEvent(new CustomEvent('workbench:profile-error', {
      detail: { message: sourceText("档案同步未完成，请重试。", "Profile synchronization is incomplete. Please retry.") },
    }));
  }, 5000);
  function check() {
    const selected = native!.textContent?.trim() || '';
    if (window.location.href !== pending || selected === profile || (profile === 'default' && /\bdefault\b/.test(selected))) {
      observer.disconnect(); clearTimeout(timer); finish();
    }
  }
  observer.observe(native, { childList: true, subtree: true, characterData: true });
  check();
}

/** Persistent chat panes must consume deep links even when they were mounted on home. */
export function installHomeChatNavigation(profile: string, select: {
  codex: (id: string) => void; hermes: (id: string) => void;
}): () => void {
  const sync = () => {
    if (location.pathname !== '/chat' || currentProfile() !== profile) return;
    const query = new URLSearchParams(location.search);
    // ``new=1`` asks the chat shell to mount an empty pane; selecting the
    // previous session here would immediately resurrect it.
    if (query.has('workbench') || query.get('new') === '1') return;
    const hermes = query.get('hermesSession');
    const codex = query.get('session');
    if (hermes) select.hermes(hermes);
    else if (codex) select.codex(codex);
  };
  window.addEventListener('popstate', sync);
  sync();
  return () => window.removeEventListener('popstate', sync);
}
