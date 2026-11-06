import { useChatDisplayPreferences } from './chat-display-preferences';
import { uiText } from './ui-locale';
import './mobile-chat-utilities.css';

type Snapshot = { messageCount: number; speed: string; speedDetails: string };

function activePane(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.codex-pane-slot.is-active')
    || document.querySelector<HTMLElement>('.codex-pane-slot');
}

function readSnapshot(): Snapshot {
  const pane = activePane();
  const ball = pane?.querySelector<HTMLElement>('[data-workbench-user-message-ball]');
  const count = Number(ball?.dataset.count || 0);
  const speed = pane?.querySelector<HTMLElement>('.codex-generation-speed > summary');
  return {
    messageCount: Number.isFinite(count) ? count : 0,
    speed: speed?.textContent?.trim() || '—',
    speedDetails: speed?.getAttribute('title') || uiText('尚无生成速度数据。', 'No generation speed data yet.'),
  };
}

function sameSnapshot(left: Snapshot, right: Snapshot): boolean {
  return left.messageCount === right.messageCount
    && left.speed === right.speed
    && left.speedDetails === right.speedDetails;
}

/** Optional chat utilities are mounted in the mobile rail instead of over content. */
export function MobileChatUtilities({ React, sdk, profile, active }: {
  React: any;
  sdk: { hooks: any; fetchJSON: any };
  profile: string;
  active: boolean;
}) {
  const h = React.createElement;
  const preferences = useChatDisplayPreferences(sdk, profile);
  const needed = preferences.generationSpeedEnabled || preferences.userMessageNavigatorEnabled;
  const [snapshot, setSnapshot] = sdk.hooks.useState(readSnapshot()) as [
    Snapshot,
    (next: Snapshot | ((current: Snapshot) => Snapshot)) => void,
  ];

  sdk.hooks.useEffect(() => {
    if (!active || !needed) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = readSnapshot();
      setSnapshot((current: Snapshot) => sameSnapshot(current, next) ? current : next);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-count', 'hidden', 'title'],
    });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active, needed]);

  if (!active || !needed) return null;
  const messageButton = preferences.userMessageNavigatorEnabled && snapshot.messageCount > 0
    ? h('button', {
        type: 'button',
        className: 'dashboard-workspace-button dashboard-rail-utility dashboard-rail-messages',
        'data-testid': 'mobile-user-message-navigator',
        'aria-label': uiText(`用户消息（${snapshot.messageCount}）`, `User messages (${snapshot.messageCount})`),
        title: uiText('打开用户消息导航', 'Open user message navigator'),
        onClick: (event: Event) => {
          event.stopPropagation();
          document.querySelector<HTMLButtonElement>('.dashboard-mobile-toggle[aria-expanded="true"]')?.click();
          activePane()?.querySelector<HTMLButtonElement>('[data-workbench-user-message-ball]')?.click();
        },
      },
      h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 4h16v12H9l-5 4z M8 9h8 M8 13h5' })),
      h('span', { className: 'dashboard-rail-utility-badge', 'aria-hidden': true }, String(snapshot.messageCount)))
    : null;
  const speedCard = preferences.generationSpeedEnabled
    ? h('div', {
        className: 'dashboard-workspace-button dashboard-rail-utility dashboard-rail-speed',
        'data-testid': 'mobile-generation-speed',
        role: 'status',
        'aria-label': `${uiText('生成速度', 'Generation speed')}: ${snapshot.speed}. ${snapshot.speedDetails}`,
        title: snapshot.speedDetails,
      },
      h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 18a8 8 0 1 1 16 0 M12 18l4-6 M7 18h10' })),
      h('span', { className: 'dashboard-rail-utility-value', 'aria-hidden': true }, snapshot.speed.replace(/\s*tok\/s$/i, '')))
    : null;

  return h('div', { className: 'dashboard-rail-chat-utilities', 'aria-label': uiText('聊天工具', 'Chat tools') }, messageButton, speedCard);
}
