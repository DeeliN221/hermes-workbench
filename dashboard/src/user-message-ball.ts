import { uiText as sourceText } from './ui-locale';
import './user-message-ball.css';

const STORAGE_KEY = 'workbench.user-message-ball.v1';
const CHANGE_EVENT = 'hermes-workbench:user-message-ball-change';
const LAYER_ATTR = 'data-workbench-user-message-layer';
const BALL_ATTR = 'data-workbench-user-message-ball';
const PANEL_ATTR = 'data-workbench-user-message-panel';
const HOST_CLASS = 'is-user-message-navigator-host';
const JUMP_CLASS = 'is-user-message-jump-target';
const MESSAGE_SELECTOR = '.codex-message.is-user[data-message-id]';
const PANE_SELECTOR = '.codex-pane-slot';
const CENTER_SELECTOR = '.codex-center';
const LIST_SELECTOR = '.codex-message-list';
const COMPOSER_SELECTOR = '.codex-composer-wrap';

type MessageEntry = { id: string; text: string };

type Navigator = {
  center: HTMLElement;
  layer: HTMLElement;
  ball: HTMLButtonElement;
  panel: HTMLElement;
  body: HTMLElement;
  entries: MessageEntry[];
  signature: string;
  open: boolean;
  list: HTMLElement | null;
  composer: HTMLElement | null;
  resize: ResizeObserver | null;
};

export function readUserMessageBallEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeUserMessageBallEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    /* Private browsing can reject storage; the control still updates this page. */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: enabled }));
}

function chatVisible(): boolean {
  const workbench = document.querySelector<HTMLElement>('.dashboard-persistent-workbench');
  return !workbench || workbench.getAttribute('data-chat-visible') !== 'false';
}

function messageText(node: HTMLElement): string {
  const body = node.querySelector<HTMLElement>('.codex-message-body');
  const text = (body?.textContent || node.textContent || '').replace(/\s+/g, ' ').trim();
  return text || '…';
}

function messageEntries(list: HTMLElement): MessageEntry[] {
  const seen = new Set<string>();
  const entries: MessageEntry[] = [];
  for (const node of Array.from(list.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))) {
    if (!node.isConnected) continue;
    const id = node.getAttribute('data-message-id') || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, text: messageText(node) });
  }
  return entries;
}

function scrollToMessage(id: string, list: HTMLElement): void {
  const node = Array.from(list.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))
    .find(message => message.getAttribute('data-message-id') === id);
  if (!node) return;
  const listRect = list.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const top = Math.max(0, list.scrollTop + nodeRect.top - listRect.top - (list.clientHeight - nodeRect.height) / 2);
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const behavior = media?.matches ? 'auto' : 'smooth';
  if (typeof list.scrollTo === 'function') list.scrollTo({ top, behavior });
  else list.scrollTop = top;
  node.classList.remove(JUMP_CLASS);
  void node.offsetWidth;
  node.classList.add(JUMP_CLASS);
  window.setTimeout(() => node.classList.remove(JUMP_CLASS), 1600);
}

/** Render the enable/disable control on the Chat display settings page. */
export function renderUserMessageBallSetting(container: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'workbench-chat-display-toggle';
  section.dataset.testid = 'user-message-ball-setting';
  section.innerHTML = '<div class="workbench-chat-display-toggle-copy"><strong></strong><span></span></div><button type="button" class="workbench-chat-display-switch" role="switch" data-testid="user-message-ball-toggle"><span class="workbench-chat-display-switch-label"></span><span class="workbench-chat-display-switch-track" aria-hidden="true"><span class="workbench-chat-display-switch-thumb"></span></span></button>';
  const title = section.querySelector('strong')!;
  title.textContent = sourceText('用户消息悬浮球', 'User message navigator');
  const description = section.querySelector('.workbench-chat-display-toggle-copy span')!;
  description.textContent = sourceText('在对话右侧快速跳转到任意用户消息。', 'Jump to any user message from the chat corner.');
  const button = section.querySelector<HTMLButtonElement>('[data-testid="user-message-ball-toggle"]')!;
  const label = button.querySelector<HTMLElement>('.workbench-chat-display-switch-label')!;

  const sync = () => {
    const enabled = readUserMessageBallEnabled();
    button.setAttribute('aria-checked', String(enabled));
    label.textContent = enabled ? sourceText('已开启', 'On') : sourceText('已关闭', 'Off');
  };
  button.addEventListener('click', () => {
    writeUserMessageBallEnabled(!readUserMessageBallEnabled());
    sync();
  });
  sync();

  container.append(section);
}

const navigators = new Map<HTMLElement, Navigator>();
let openNavigator: Navigator | null = null;
let installCleanup: (() => void) | null = null;

function signatureOf(entries: MessageEntry[]): string {
  return entries.map(entry => `${entry.id}\u0000${entry.text}`).join('\u0001');
}

function renderList(navigator: Navigator): void {
  const { entries, body } = navigator;
  body.innerHTML = entries.map((_, index) => `<button type="button" class="workbench-user-message-panel-item" data-user-message-item="${index}"><span class="workbench-user-message-panel-index">${index + 1}</span><span class="workbench-user-message-panel-text"></span></button>`).join('');
  body.querySelectorAll<HTMLElement>('.workbench-user-message-panel-text').forEach((node, index) => {
    node.textContent = entries[index].text;
  });
  navigator.signature = signatureOf(entries);
}

function setOpen(navigator: Navigator, next: boolean): void {
  const open = next && navigator.entries.length > 0;
  if (open && openNavigator && openNavigator !== navigator) setOpen(openNavigator, false);
  if (open && navigator.signature !== signatureOf(navigator.entries)) renderList(navigator);
  navigator.open = open;
  navigator.panel.hidden = !open;
  navigator.ball.setAttribute('aria-expanded', String(open));
  openNavigator = open ? navigator : (openNavigator === navigator ? null : openNavigator);
}

function closeAll(): void {
  if (openNavigator) setOpen(openNavigator, false);
}

function createNavigator(center: HTMLElement): Navigator {
  const layer = document.createElement('div');
  layer.className = 'workbench-user-message-layer';
  layer.setAttribute(LAYER_ATTR, 'true');

  const ball = document.createElement('button');
  ball.type = 'button';
  ball.className = 'workbench-user-message-ball';
  ball.setAttribute(BALL_ATTR, 'true');
  ball.setAttribute('aria-haspopup', 'dialog');
  ball.setAttribute('aria-expanded', 'false');
  ball.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12H9l-5 4zM8 9h8M8 13h5"></path></svg>';
  ball.hidden = true;

  const panel = document.createElement('section');
  panel.className = 'workbench-user-message-panel';
  panel.setAttribute(PANEL_ATTR, 'true');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', sourceText('用户消息', 'User messages'));
  panel.hidden = true;
  panel.innerHTML = '<header><div class="workbench-user-message-panel-heading"><strong></strong></div><button type="button" class="workbench-user-message-panel-close"></button></header><div class="workbench-user-message-panel-list"></div>';

  const title = panel.querySelector('strong')!;
  title.textContent = sourceText('用户消息', 'User messages');
  const close = panel.querySelector<HTMLButtonElement>('.workbench-user-message-panel-close')!;
  close.setAttribute('aria-label', sourceText('关闭', 'Close'));
  close.textContent = '×';
  const body = panel.querySelector<HTMLElement>('.workbench-user-message-panel-list')!;

  const navigator: Navigator = {
    center,
    layer,
    ball,
    panel,
    body,
    entries: [],
    signature: '',
    open: false,
    list: null,
    composer: null,
    resize: typeof ResizeObserver === 'function' ? new ResizeObserver(() => measureComposer(navigator)) : null,
  };

  ball.addEventListener('click', () => setOpen(navigator, !navigator.open));
  close.addEventListener('click', () => setOpen(navigator, false));
  body.addEventListener('click', event => {
    const item = (event.target as Element | null)?.closest<HTMLElement>('[data-user-message-item]');
    if (!item) return;
    const entry = navigator.entries[Number(item.dataset.userMessageItem)];
    if (entry && navigator.list) scrollToMessage(entry.id, navigator.list);
    setOpen(navigator, false);
  });

  layer.append(ball, panel);
  center.classList.add(HOST_CLASS);
  center.append(layer);
  return navigator;
}

/** Keep the navigator above the composer by publishing its height to CSS. */
function measureComposer(navigator: Navigator): void {
  const height = navigator.composer?.getBoundingClientRect().height ?? 0;
  const next = `${Math.max(0, Math.round(height))}px`;
  if (navigator.layer.style.getPropertyValue('--umb-clear') !== next) {
    navigator.layer.style.setProperty('--umb-clear', next);
  }
}

function observePane(navigator: Navigator, list: HTMLElement | null, composer: HTMLElement | null): void {
  if (list !== navigator.list) navigator.list = list;
  if (composer === navigator.composer) return;
  navigator.resize?.disconnect();
  navigator.composer = composer;
  if (composer && navigator.resize) navigator.resize.observe(composer);
  measureComposer(navigator);
}

function refresh(navigator: Navigator, enabled: boolean): void {
  const list = navigator.center.querySelector<HTMLElement>(LIST_SELECTOR);
  const composer = navigator.center.querySelector<HTMLElement>(COMPOSER_SELECTOR);
  observePane(navigator, list, composer);

  if (!enabled || !chatVisible() || !list) {
    navigator.entries = [];
    navigator.ball.hidden = true;
    setOpen(navigator, false);
    return;
  }

  const entries = messageEntries(list);
  navigator.entries = entries;
  if (!entries.length) {
    navigator.ball.hidden = true;
    setOpen(navigator, false);
    return;
  }

  navigator.ball.hidden = false;
  if (navigator.ball.dataset.count !== String(entries.length)) {
    navigator.ball.dataset.count = String(entries.length);
  }
  const label = sourceText(`用户消息（${entries.length}）`, `User messages (${entries.length})`);
  if (navigator.ball.getAttribute('aria-label') !== label) navigator.ball.setAttribute('aria-label', label);
  if (navigator.open && navigator.signature !== signatureOf(entries)) renderList(navigator);
}

function destroyNavigator(navigator: Navigator): void {
  if (openNavigator === navigator) openNavigator = null;
  navigator.resize?.disconnect();
  navigator.layer.remove();
  navigator.center.classList.remove(HOST_CLASS);
}

/** Mount one navigator per chat pane; each one only reads and scrolls its own pane. */
export function installUserMessageBall(): void {
  if (installCleanup || (window as any).__HERMES_WORKBENCH_USER_MESSAGE_BALL__) return;
  (window as any).__HERMES_WORKBENCH_USER_MESSAGE_BALL__ = true;

  let frame = 0;
  let observer: MutationObserver | null = null;
  let disposed = false;

  const sync = () => {
    const enabled = readUserMessageBallEnabled();
    const seen = new Set<HTMLElement>();
    for (const pane of Array.from(document.querySelectorAll<HTMLElement>(PANE_SELECTOR))) {
      const center = pane.querySelector<HTMLElement>(CENTER_SELECTOR);
      if (!center) continue;
      seen.add(center);
      let navigator = navigators.get(center);
      if (!navigator) {
        navigator = createNavigator(center);
        navigators.set(center, navigator);
      }
      refresh(navigator, enabled);
    }
    for (const [center, navigator] of Array.from(navigators)) {
      if (!seen.has(center) || !center.isConnected) {
        destroyNavigator(navigator);
        navigators.delete(center);
      }
    }
  };

  const schedule = () => {
    if (frame || disposed) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !openNavigator) return;
    const target = openNavigator;
    event.preventDefault();
    setOpen(target, false);
    target.ball.focus({ preventScroll: true });
  };

  const onDocumentClick = (event: MouseEvent) => {
    if (!openNavigator) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (openNavigator.layer.contains(target)) return;
    closeAll();
  };

  const start = () => {
    if (disposed) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-message-id', 'data-pane-count', 'data-active-pane-id', 'data-chat-visible'],
    });
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', schedule);
    window.addEventListener(CHANGE_EVENT, schedule);
    sync();
  };

  const stop = () => {
    disposed = true;
    observer?.disconnect();
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', schedule);
    window.removeEventListener(CHANGE_EVENT, schedule);
    if (frame) window.cancelAnimationFrame(frame);
    for (const navigator of navigators.values()) destroyNavigator(navigator);
    navigators.clear();
    openNavigator = null;
    installCleanup = null;
    delete (window as any).__HERMES_WORKBENCH_USER_MESSAGE_BALL__;
  };

  installCleanup = stop;
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

/** Detach every mounted navigator; used by tests and full teardown. */
export function disposeUserMessageBall(): void {
  installCleanup?.();
}
