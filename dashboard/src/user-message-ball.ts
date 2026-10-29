import { uiText as sourceText } from './ui-locale';
import './user-message-ball.css';

const STORAGE_KEY = 'workbench.user-message-ball.v1';
const CHANGE_EVENT = 'hermes-workbench:user-message-ball-change';
const FAB_ATTR = 'data-workbench-user-message-ball';
const PANEL_ATTR = 'data-workbench-user-message-panel';
const JUMP_CLASS = 'is-user-message-jump-target';
const MESSAGE_SELECTOR = '.codex-message.is-user[data-message-id]';

type MessageEntry = { id: string; text: string };

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

function activePane(): HTMLElement | null {
  const panes = Array.from(document.querySelectorAll<HTMLElement>('.codex-pane-slot'));
  return panes.find(pane => pane.classList.contains('is-active')) || panes[0] || null;
}

function activeList(): HTMLElement | null {
  return activePane()?.querySelector<HTMLElement>('.codex-message-list') || null;
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
  const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
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

/** Mount one navigator beside the active chat pane; it follows pane and message changes. */
export function installUserMessageBall(): void {
  if ((window as any).__HERMES_WORKBENCH_USER_MESSAGE_BALL__) return;
  (window as any).__HERMES_WORKBENCH_USER_MESSAGE_BALL__ = true;

  const start = () => {
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'workbench-user-message-ball';
    fab.setAttribute(FAB_ATTR, 'true');
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12H9l-5 4zM8 9h8M8 13h5"></path></svg>';
    fab.hidden = true;

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
    document.body.append(fab, panel);

    let open = false;
    let signature = '';
    let entries: MessageEntry[] = [];
    let observedList: HTMLElement | null = null;
    const resize = new ResizeObserver(() => schedule());

    const observeList = (list: HTMLElement | null) => {
      if (list === observedList) return;
      resize.disconnect();
      observedList = list;
      if (list) resize.observe(list);
    };

    const renderList = () => {
      body.innerHTML = entries.map((_, index) => `<button type="button" class="workbench-user-message-panel-item" data-user-message-item="${index}"><span class="workbench-user-message-panel-index">${index + 1}</span><span class="workbench-user-message-panel-text"></span></button>`).join('');
      body.querySelectorAll<HTMLElement>('.workbench-user-message-panel-text').forEach((node, index) => {
        node.textContent = entries[index].text;
      });
    };

    const setOpen = (next: boolean) => {
      open = next && entries.length > 0;
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', String(open));
      if (open) {
        renderList();
        position();
      }
    };

    const position = () => {
      const list = activeList();
      if (!list) return;
      const rect = list.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const gap = 14;
      const size = 44;
      const top = Math.min(window.innerHeight - size - gap, Math.max(gap, rect.bottom - size - gap));
      const right = Math.max(gap, window.innerWidth - rect.right + gap);
      const width = Math.max(180, Math.min(360, rect.width - gap * 2));
      fab.style.top = `${Math.round(top)}px`;
      fab.style.right = `${Math.round(right)}px`;
      panel.style.width = `${Math.round(width)}px`;
      panel.style.right = `${Math.round(right)}px`;
      panel.style.bottom = `${Math.round(window.innerHeight - top + 10)}px`;
      panel.style.maxHeight = `${Math.round(Math.max(160, top - 20))}px`;
    };

    const update = () => {
      const list = activeList();
      observeList(list);
      if (!readUserMessageBallEnabled() || !chatVisible() || !list) {
        entries = [];
        fab.hidden = true;
        setOpen(false);
        return;
      }
      entries = messageEntries(list);
      if (!entries.length) {
        fab.hidden = true;
        setOpen(false);
        return;
      }
      fab.hidden = false;
      fab.dataset.count = String(entries.length);
      const label = sourceText(`用户消息（${entries.length}）`, `User messages (${entries.length})`);
      fab.setAttribute('aria-label', label);
      position();
      const nextSignature = entries.map(entry => `${entry.id}\u0000${entry.text}`).join('\u0001');
      if (open && nextSignature !== signature) {
        signature = nextSignature;
        renderList();
        position();
      }
    };

    fab.addEventListener('click', () => {
      setOpen(!open);
    });
    close.addEventListener('click', () => setOpen(false));
    body.addEventListener('click', event => {
      const item = (event.target as Element | null)?.closest<HTMLElement>('[data-user-message-item]');
      if (!item) return;
      const entry = entries[Number(item.dataset.userMessageItem)];
      const list = activeList();
      if (entry && list) scrollToMessage(entry.id, list);
      setOpen(false);
    });
    document.addEventListener('click', event => {
      const target = event.target;
      if (!open || !(target instanceof Node)) return;
      if (panel.contains(target) || fab.contains(target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
        fab.focus({ preventScroll: true });
      }
    });

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-message-id', 'data-pane-count', 'data-active-pane-id', 'data-chat-visible'],
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener(CHANGE_EVENT, schedule);
    schedule();
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
