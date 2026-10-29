import { uiText } from './ui-locale';

/** One settings link: target href, visible label, and optional legacy marker attribute. */
export type SettingsNavItem = [href: string, label: string, linkAttr?: string];
export type SettingsNavSection = { id: string; title: string; items: SettingsNavItem[]; collapsible?: boolean };

const MORE_OPEN_KEY = 'hermes.workbench.settings-more-open';

/**
 * Settings are grouped by intent: everyday Workbench preferences first, then
 * agent setup, then maintenance. Integrations and diagnostics that are rarely
 * touched stay reachable under a collapsed "More" section.
 */
export function settingsNavSections(): SettingsNavSection[] {
  return [
    {
      id: 'preferences',
      title: uiText('偏好', 'Preferences'),
      items: [
        ['/config', uiText('常规', 'General')],
        ['/config?workbench=display', uiText('聊天显示', 'Chat display'), 'data-workbench-chat-display-link'],
        ['/config?workbench=models', uiText('模型显示', 'Model visibility'), 'data-workbench-model-link'],
        ['/config?workbench=shortcuts', uiText('快捷键', 'Keyboard shortcuts')],
      ],
    },
    {
      id: 'agent',
      title: uiText('智能体', 'Agent'),
      items: [
        ['/profiles', uiText('配置档案', 'Profiles')],
        ['/models', uiText('模型', 'Models')],
        ['/env', uiText('凭据', 'Credentials')],
      ],
    },
    {
      id: 'maintenance',
      title: uiText('维护', 'Maintenance'),
      items: [
        ['/config?workbench=versions', uiText('版本切换', 'Version switching'), 'data-workbench-version-link'],
        ['/logs', uiText('日志', 'Logs')],
      ],
    },
    {
      id: 'more',
      title: uiText('更多', 'More'),
      collapsible: true,
      items: [
        ['/plugins', uiText('插件', 'Plugins')],
        ['/mcp', uiText('外部工具', 'External tools')],
        ['/channels', uiText('消息渠道', 'Channels')],
        ['/webhooks', uiText('网络回调', 'Webhooks')],
        ['/pairing', uiText('设备配对', 'Pairing')],
        ['/system', uiText('系统', 'System')],
        ['/docs', uiText('帮助', 'Help')],
      ],
    },
  ];
}

/** Match a settings link against the current route, including Workbench-owned /config tabs. */
export function settingsLinkActive(href: string, route: { path: string; settingsTab: string }): boolean {
  const url = new URL(href, 'http://localhost');
  if (url.pathname === '/config') {
    const tab = url.searchParams.get('workbench') || '';
    const current = route.settingsTab === 'settings' ? 'versions' : route.settingsTab;
    return route.path === '/config' && current === tab;
  }
  if (url.pathname === '/profiles') return route.path === '/profiles' || route.path.startsWith('/profiles/');
  return route.path === url.pathname;
}

export function readSettingsMoreOpen(): boolean {
  try { return window.localStorage.getItem(MORE_OPEN_KEY) === 'true'; } catch { return false; }
}

export function writeSettingsMoreOpen(open: boolean): void {
  try { window.localStorage.setItem(MORE_OPEN_KEY, String(open)); } catch { /* Collapse state is optional. */ }
}
