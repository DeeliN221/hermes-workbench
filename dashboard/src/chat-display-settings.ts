import {
  CHAT_DETAIL_MODES,
  readChatDetailMode,
  writeChatDetailMode,
  type ChatDetailMode,
} from './chat-detail';
import { currentProfile } from './profile-scope';
import { uiText as sourceText } from './ui-locale';
import { accessoryPanelOpen, withAccessoryPanel } from './workbench-accessory';
import './chat-display-settings.css';

const LINK_ATTR = 'data-workbench-chat-display-link';
const PANEL_ATTR = 'data-workbench-chat-display-panel';
const PRESERVED_ATTR = 'data-workbench-chat-display-preserved';
const CHANGE_EVENT = 'hermes-workbench:chat-detail-change';

function shellManagesSettings(): boolean {
  return document.documentElement.dataset.workbenchShell === 'true'
    || Boolean((window as any).__HERMES_PLUGINS__);
}

const MODE_COPY: Record<ChatDetailMode, { label: () => string; description: () => string }> = {
  compact: {
    label: () => sourceText('简洁', 'Compact'),
    description: () => sourceText('折叠已完成的过程，只保留最新一行，适合快速浏览。', 'Fold completed work and keep only the latest line for quick scanning.'),
  },
  standard: {
    label: () => sourceText('标准', 'Standard'),
    description: () => sourceText('完成后保持折叠；展开时显示最近约 10 行。', 'Keep work folded after completion; expanded details show the latest ten lines.'),
  },
  detailed: {
    label: () => sourceText('详细', 'Detailed'),
    description: () => sourceText('展开过程详情和工具输出，显示完整内容。', 'Expand process details and tool output with the complete content.'),
  },
};

function displayRoute(): boolean {
  const url = new URL(window.location.href);
  return url.pathname === '/config' && url.searchParams.get('workbench') === 'display';
}

function navigate(url: string): void {
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function addSettingsLink(): void {
  const nav = document.querySelector<HTMLElement>('.dashboard-settings-nav');
  if (!nav) return;
  const profile = encodeURIComponent(currentProfile());
  // Keep the floating settings panel open even when a host loads this link
  // before the Workbench shell has claimed the settings navigation.
  const href = withAccessoryPanel(
    `/config?workbench=display&profile=${profile}`,
    accessoryPanelOpen(window.location.search),
  );
  const existing = nav.querySelector<HTMLAnchorElement>(`[${LINK_ATTR}]`);
  const label = sourceText('聊天显示', 'Chat display');
  if (existing) {
    if (existing.textContent !== label) existing.textContent = label;
    if (existing.getAttribute('href') !== href) existing.setAttribute('href', href);
    return;
  }
  const link = document.createElement('a');
  link.setAttribute(LINK_ATTR, 'true');
  link.href = href;
  link.textContent = label;
  link.addEventListener('click', event => {
    event.preventDefault();
    navigate(link.href);
  });
  nav.append(link);
}

/** Render the three work-detail choices inside an existing settings panel. */
export function renderChatDisplayPanel(panel: HTMLElement): void {
  panel.replaceChildren();
  panel.setAttribute(PANEL_ATTR, 'true');
  const current = readChatDetailMode();

  const header = document.createElement('header');
  header.className = 'workbench-settings-subpage-header';
  const heading = document.createElement('h1');
  heading.textContent = sourceText('聊天显示', 'Chat display');
  const description = document.createElement('p');
  description.className = 'workbench-chat-display-muted';
  description.textContent = sourceText(
    '选择聊天中推理、过程和工具输出的详细程度。助手回复始终完整显示。',
    'Choose how much reasoning, process, and tool detail appears in chat. Assistant replies always stay fully visible.',
  );
  header.append(heading, description);
  const group = document.createElement('div');
  group.className = 'workbench-chat-display-options';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', sourceText('聊天详略程度', 'Chat detail'));
  group.setAttribute('data-testid', 'chat-display-options');

  const buttons = new Map<ChatDetailMode, HTMLButtonElement>();
  const status = document.createElement('p');
  status.className = 'workbench-chat-display-status';
  status.setAttribute('role', 'status');

  const apply = (mode: ChatDetailMode) => {
    writeChatDetailMode(mode);
    for (const [value, button] of buttons) button.setAttribute('aria-checked', String(value === mode));
    status.textContent = sourceText(
      `${MODE_COPY[mode].label()}已保存，下次打开聊天时生效。`,
      `${MODE_COPY[mode].label()} saved. Chat uses it the next time it opens.`,
    );
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: mode }));
  };

  for (const mode of CHAT_DETAIL_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workbench-chat-display-option';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(mode === current));
    button.setAttribute('data-detail-mode', mode);
    const title = document.createElement('strong');
    title.textContent = MODE_COPY[mode].label();
    const detail = document.createElement('span');
    detail.textContent = MODE_COPY[mode].description();
    button.append(title, detail);
    button.addEventListener('click', () => apply(mode));
    buttons.set(mode, button);
    group.append(button);
  }

  panel.append(header, group, status);
}

export function createChatDisplaySettings(sdk: any) {
  const h = sdk.React.createElement;
  const { useEffect, useRef } = sdk.hooks;
  return function ChatDisplaySettings() {
    const ref = useRef(null as HTMLElement | null);
    useEffect(() => {
      const node = ref.current;
      if (!node) return;
      const render = () => renderChatDisplayPanel(node);
      render();
      const observer = new MutationObserver(render);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      return () => observer.disconnect();
    }, []);
    return h('section', {
      ref,
      className: 'workbench-settings-subpage',
      'data-testid': 'chat-display-settings',
    });
  };
}

function cleanupFallbackPanel(): void {
  document.querySelectorAll<HTMLElement>(`[${PRESERVED_ATTR}]`).forEach(node => {
    node.style.display = '';
    node.removeAttribute(PRESERVED_ATTR);
  });
  document.querySelectorAll<HTMLElement>(`main:not(.dashboard-owned-page) > [${PANEL_ATTR}]`).forEach(node => node.remove());
}

async function renderPanel(): Promise<void> {
  if (shellManagesSettings()) {
    cleanupFallbackPanel();
    return;
  }
  const main = document.querySelector<HTMLElement>('.dashboard-owned-page') || document.querySelector<HTMLElement>('main');
  if (!main) return;
  let panel = main.querySelector<HTMLElement>(`[${PANEL_ATTR}]`);
  if (!displayRoute()) {
    const tab = new URL(window.location.href).searchParams.get('workbench');
    const otherCustomActive = new URL(window.location.href).pathname === '/config'
      && (tab === 'models' || tab === 'versions' || tab === 'settings');
    main.querySelectorAll<HTMLElement>(`[${PRESERVED_ATTR}]`).forEach(node => {
      if (!otherCustomActive) node.style.display = '';
      node.removeAttribute(PRESERVED_ATTR);
    });
    panel?.remove();
    return;
  }
  if (panel) return;
  const preserved = Array.from(main.children).filter(node => !(node as HTMLElement).hasAttribute(PANEL_ATTR));
  preserved.forEach(node => {
    const element = node as HTMLElement;
    element.setAttribute(PRESERVED_ATTR, 'true');
    element.style.display = 'none';
  });
  panel = document.createElement('section');
  panel.setAttribute(PANEL_ATTR, 'true');
  panel.setAttribute('data-testid', 'chat-display-settings');
  renderChatDisplayPanel(panel);
  main.append(panel);
}

/** Add the settings link and mount the panel without touching the chat header. */
export function installChatDisplaySettings(): void {
  if ((window as any).__HERMES_WORKBENCH_CHAT_DISPLAY_SETTINGS__) return;
  (window as any).__HERMES_WORKBENCH_CHAT_DISPLAY_SETTINGS__ = true;
  const schedule = () => window.requestAnimationFrame(() => {
    if (shellManagesSettings()) {
      cleanupFallbackPanel();
      return;
    }
    addSettingsLink();
    void renderPanel();
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang', 'data-workbench-shell'] });
  window.addEventListener('popstate', schedule);
  schedule();
}

