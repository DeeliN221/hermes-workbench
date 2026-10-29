import { uiText as sourceText } from './ui-locale';
import { connectRealtime } from './realtime-connection';
/**
 * Surface a backup-model switch in the open chat.
 *
 * The bridge retries an overloaded turn on a backup model. This module waits
 * until the chat actually renders a capacity error, then watches that session's
 * bridge event stream for the switch and explains it, so no socket or polling
 * runs during ordinary chatting.
 */

const FALLBACK_METHOD = 'workbench/modelFallback';
const NOTICE_TIMEOUT_MS = 20_000;
const CAPACITY_TEXT = /at capacity|容量不足|容量超限|serveroverloaded|server_overloaded/i;

export type ModelFallbackPayload = { fromModel?: string; toModel?: string; attempt?: number; turnId?: string };

/** Explain one switch in the current UI language. */
export function fallbackNoticeText(payload: ModelFallbackPayload | null | undefined): string {
  const from = String(payload?.fromModel || '').trim();
  const to = String(payload?.toModel || '').trim();
  if (!to) return '';
  return from
    ? sourceText(
      `模型 ${from} 容量不足，已自动切换到备用模型 ${to} 继续回答`,
      `Model ${from} is at capacity; the session switched to ${to} automatically`,
    )
    : sourceText(
      `主模型容量不足，已自动切换到备用模型 ${to} 继续回答`,
      `The primary model is at capacity; the session switched to ${to} automatically`,
    );
}

/** Match the bridge event shape from either a live event or a snapshot. */
export function fallbackFromEvent(event: any): ModelFallbackPayload | null {
  if (!event || event.method !== FALLBACK_METHOD) return null;
  const params = event.payload?.params;
  return params && typeof params === 'object' ? params : null;
}

/** Recognize the provider's overload line in rendered chat output. */
export function looksLikeCapacityError(text: string): boolean {
  return CAPACITY_TEXT.test(String(text || ''));
}

function chatSessionContext(): { profile: string; sessionId: string } | null {
  if (!window.location.pathname.includes('chat')) return null;
  const params = new URLSearchParams(window.location.search);
  const sessionId = (params.get('session') || '').trim();
  if (!sessionId) return null;
  return { profile: (params.get('profile') || 'default').trim() || 'default', sessionId };
}

function eventStreamUrl(profile: string, sessionId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/plugins/workbench/codex/events`
    + `?profile=${encodeURIComponent(profile)}&session_id=${encodeURIComponent(sessionId)}`;
}

/** Install the notice once; the event stream starts only after a capacity error. */
export function installChatCapacityFallback(): void {
  if ((window as any).__HERMES_WORKBENCH_CAPACITY_NOTICE__) return;
  (window as any).__HERMES_WORKBENCH_CAPACITY_NOTICE__ = true;

  const notice = document.createElement('div');
  notice.className = 'hti-model-fallback-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  const text = document.createElement('span');
  text.className = 'hti-model-fallback-text';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'hti-model-fallback-dismiss';
  dismiss.textContent = sourceText("知道了", "Dismiss");
  dismiss.addEventListener('click', () => { notice.hidden = true; });
  notice.append(text, dismiss);

  let hideTimer = 0;
  const show = (message: string) => {
    if (!message) return;
    if (!notice.isConnected) document.body.append(notice);
    text.textContent = message;
    notice.hidden = false;
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => { notice.hidden = true; }, NOTICE_TIMEOUT_MS);
  };

  let dispose: (() => void) | null = null;
  let connectedKey = '';
  const disconnect = () => {
    dispose?.();
    dispose = null;
    connectedKey = '';
  };
  const watchSession = () => {
    const context = chatSessionContext();
    if (!context) {
      disconnect();
      return;
    }
    const key = `${context.profile}\u0000${context.sessionId}`;
    if (key === connectedKey) return;
    disconnect();
    connectedKey = key;
    dispose = connectRealtime(eventStreamUrl(context.profile, context.sessionId), {
      message: event => {
        let payload: any;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (payload?.type === 'snapshot') {
          for (const entry of Array.isArray(payload.events) ? payload.events : []) {
            const fallback = fallbackFromEvent(entry);
            if (fallback) show(fallbackNoticeText(fallback));
          }
          return;
        }
        if (payload?.type !== 'event') return;
        const fallback = fallbackFromEvent(payload);
        if (fallback) show(fallbackNoticeText(fallback));
      },
      error: () => undefined,
      open: () => undefined,
      socket: () => undefined,
    });
  };

  let announced = '';
  const scanErrors = () => {
    if (!window.location.pathname.includes('chat')) return;
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.codex-message.is-error pre, .codex-message.is-error'));
    for (const row of rows.slice(-3)) {
      const value = String(row.textContent || '').slice(0, 4000);
      if (!looksLikeCapacityError(value)) continue;
      watchSession();
      if (announced === value) return;
      announced = value;
      show(sourceText(
        "模型容量不足，正在自动切换到可用模型继续回答…",
        "The selected model is at capacity; switching to an available model automatically…",
      ));
      return;
    }
    announced = '';
  };

  const timer = window.setInterval(scanErrors, 1500);
  window.addEventListener('beforeunload', () => window.clearInterval(timer));
  window.setTimeout(scanErrors, 800);
  window.addEventListener('popstate', () => {
    disconnect();
    notice.hidden = true;
  });
}
