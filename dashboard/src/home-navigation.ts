import { uiText as sourceText } from './ui-locale';
import { currentProfile, switchProfile } from './profile-scope';
import { isNewSessionRoute } from './codex-pane-route';
/** Open existing home conversations atomically; preserve new-pane/profile synchronization. */
export function openHomeConversation(path: string, profile: string, navigate: (path: string, profile: string) => void): void {
  const openedFromHome = ['/', '/home', '/sessions'].includes(window.location.pathname);
  if (openedFromHome && !isNewSessionRoute(path)) {
    // Staging a profile switch on the custom home route remounts the host's
    // fallback route. Its pending redirect can overwrite the subsequent chat.
    // The destination already carries the profile; commit both in one navigation.
    navigate(path, profile);
    return;
  }
  if (currentProfile() === profile) { navigate(path, profile); return; }
  if (!switchProfile(profile)) return;
  const pending = window.location.href;
  const finish = () => { if (window.location.href === pending) navigate(path, profile); };
  // New-session actions still need the profile pane to mount before consuming new=1.
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
    if (query.has('workbench') || query.get('new') === '1' || query.has('homeOpen') || query.has('paneOwner')) return;
    const hermes = query.get('hermesSession');
    const codex = query.get('session');
    if (hermes) select.hermes(hermes);
    else if (codex) select.codex(codex);
  };
  window.addEventListener('popstate', sync);
  sync();
  return () => window.removeEventListener('popstate', sync);
}
