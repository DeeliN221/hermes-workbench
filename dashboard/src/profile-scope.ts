import { uiText as sourceText } from './ui-locale';
/** Browser-local chat scope; never writes Hermes' machine-wide active profile. */
const CURRENT = 'workbench.profile.v1';
const LAST_CHAT = 'workbench.profile.last-chat.v1:';
const fallbackDrafts = new Map<string, Map<string, string>>();
const fallbackAttachments = new Map<string, Map<string, unknown[]>>();

export function currentProfile(search = window.location.search): string {
  const explicit = new URLSearchParams(search).get('profile')?.trim();
  if (explicit) return explicit;
  try { return window.sessionStorage.getItem(CURRENT) || 'default'; }
  catch { return 'default'; }
}

export function rememberProfile(profile: string): void {
  try { window.sessionStorage.setItem(CURRENT, profile); } catch { /* Private storage unavailable. */ }
}

export function rememberChat(href = window.location.href): void {
  const url = new URL(href, window.location.origin);
  if (url.pathname !== '/chat' || url.searchParams.get('workbench') === 'terminal') return;
  const profile = currentProfile(url.search);
  // Only retain the conversation identity, never a stale task launch or file action.
  const saved = new URLSearchParams({ profile });
  for (const key of ['session', 'hermesSession']) {
    const value = url.searchParams.get(key);
    if (value) saved.set(key, value);
  }
  try { window.sessionStorage.setItem(LAST_CHAT + profile, `/chat?${saved}`); } catch { /* optional */ }
}

export function profileChatURL(profile: string): string {
  try {
    const saved = window.sessionStorage.getItem(LAST_CHAT + profile);
    if (saved) {
      const url = new URL(saved, window.location.origin);
      if (url.pathname === '/chat' && url.searchParams.get('profile') === profile) return url.pathname + url.search;
    }
  } catch { /* optional */ }
  return `/chat?${new URLSearchParams({ profile })}`;
}

export function switchProfile(profile: string): boolean {
  const home = ['/', '/home', '/sessions'].includes(window.location.pathname);
  const path = home ? `${window.location.pathname}?${new URLSearchParams({ profile })}` : profileChatURL(profile);
  if (!window.dispatchEvent(new CustomEvent('workbench:before-navigate', {
    cancelable: true, detail: { path, profile },
  }))) return false;
  rememberChat();
  rememberProfile(profile);
  if (home || window.location.pathname === '/chat') {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } else {
    // Host ProfileProvider synchronizes scope and pathname in separate effects.
    // Commit the scope on this page first so its old scope cannot overwrite the
    // destination when both change in the same React commit.
    const scopedPage = new URL(window.location.href);
    scopedPage.searchParams.set('profile', profile);
    window.history.pushState(null, '', scopedPage);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const pending = window.location.href;
    const nativeSwitcher = document.getElementById('hermes-profile-switcher');
    const finish = () => {
      // A later navigation or profile selection supersedes this transition.
      if (window.location.href !== pending) return;
      window.history.replaceState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new Event('workbench:session-navigation-select'));
    };
    if (nativeSwitcher) {
      // BrowserRouter may defer its update with startTransition. Wait for its
      // own switcher to render the new scope, rather than guessing a delay.
      let timer: ReturnType<typeof setTimeout>;
      const check = () => {
        const selected = nativeSwitcher.textContent?.trim() || '';
        if (window.location.href !== pending || selected === profile ||
            (profile === 'default' && /\bdefault\b/.test(selected))) {
          observer.disconnect(); clearTimeout(timer);
          finish();
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(nativeSwitcher, { childList: true, subtree: true, characterData: true });
      timer = setTimeout(() => {
        observer.disconnect();
        if (window.location.href === pending) window.dispatchEvent(new CustomEvent('workbench:profile-error', {
          detail: { message: sourceText("档案同步未完成，请重试。", "Profile synchronization is incomplete. Please retry.") },
        }));
      }, 5000);
      check();
    } else {
      window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
    }
  }
  window.dispatchEvent(new Event('workbench:session-navigation-select'));
  return true;
}

/** Keep per-pane drafts/attachments through profile remounts without persisting files or secrets. */
export function profileDrafts(profile: string, pane: string): Map<string, string> {
  const key = JSON.stringify([profile, pane]);
  if (!fallbackDrafts.has(key)) fallbackDrafts.set(key, new Map());
  return fallbackDrafts.get(key)!;
}
export function profileAttachments(profile: string, pane: string): Map<string, unknown[]> {
  const key = JSON.stringify([profile, pane]);
  if (!fallbackAttachments.has(key)) fallbackAttachments.set(key, new Map());
  return fallbackAttachments.get(key)!;
}
