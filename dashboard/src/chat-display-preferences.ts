import type { FetchJSON } from './workbench-api';
import { currentProfile } from './profile-scope';
import { uiText } from './ui-locale';

export type ChatDisplayPreferences = {
  generationSpeedEnabled: boolean;
  userMessageNavigatorEnabled: boolean;
};

const CHANGE = 'workbench:chat-display-preferences-change';
const DEFAULT_PREFERENCES: ChatDisplayPreferences = Object.freeze({
  generationSpeedEnabled: false,
  userMessageNavigatorEnabled: false,
});
const cache = new Map<string, ChatDisplayPreferences>();
const pending = new Map<string, Promise<ChatDisplayPreferences>>();

const endpoint = (profile: string) =>
  `/api/plugins/workbench/chat-display-preferences?profile=${encodeURIComponent(profile)}`;

function normalize(value: unknown): ChatDisplayPreferences {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    generationSpeedEnabled: row.generationSpeedEnabled === true,
    userMessageNavigatorEnabled: row.userMessageNavigatorEnabled === true,
  };
}

function publish(profile: string, preferences: ChatDisplayPreferences): void {
  cache.set(profile, preferences);
  window.dispatchEvent(new CustomEvent(CHANGE, { detail: { profile, preferences } }));
}

export function cachedChatDisplayPreferences(profile = currentProfile()): ChatDisplayPreferences {
  return cache.get(profile) || DEFAULT_PREFERENCES;
}

export function primeChatDisplayPreferences(profile: string, value: ChatDisplayPreferences): void {
  publish(profile, normalize(value));
}

export async function loadChatDisplayPreferences(read: FetchJSON, profile: string): Promise<ChatDisplayPreferences> {
  const existing = pending.get(profile);
  if (existing) return existing;
  const request = read<unknown>(endpoint(profile), { cache: 'no-store' })
    .then(value => {
      const preferences = normalize(value);
      publish(profile, preferences);
      return preferences;
    })
    .finally(() => pending.delete(profile));
  pending.set(profile, request);
  return request;
}

export async function saveChatDisplayPreferences(
  read: FetchJSON,
  profile: string,
  preferences: ChatDisplayPreferences,
): Promise<ChatDisplayPreferences> {
  const value = normalize(await read<unknown>(endpoint(profile), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  }));
  publish(profile, value);
  return value;
}

export function ensureChatDisplayPreferences(profile = currentProfile()): Promise<ChatDisplayPreferences> {
  const read = (window as any).__HERMES_PLUGIN_SDK__?.fetchJSON as FetchJSON | undefined;
  return typeof read === 'function'
    ? loadChatDisplayPreferences(read, profile)
    : Promise.resolve(cachedChatDisplayPreferences(profile));
}

/** Shared state for React chat surfaces; settings changes apply without a reload. */
export function useChatDisplayPreferences(sdk: { hooks: any; fetchJSON: FetchJSON }, profile: string): ChatDisplayPreferences {
  const [state, setState] = sdk.hooks.useState({ profile, preferences: cachedChatDisplayPreferences(profile) });
  sdk.hooks.useEffect(() => {
    let active = true;
    const update = (event: CustomEvent<{ profile: string; preferences: ChatDisplayPreferences }>) => {
      if (event.detail.profile === profile) setState({ profile, preferences: event.detail.preferences });
    };
    window.addEventListener(CHANGE, update as EventListener);
    loadChatDisplayPreferences(sdk.fetchJSON, profile).then(preferences => {
      if (active) setState({ profile, preferences });
    }).catch(() => { /* Optional controls stay hidden until the setting can be read. */ });
    return () => {
      active = false;
      window.removeEventListener(CHANGE, update as EventListener);
    };
  }, [profile, sdk.fetchJSON]);
  return state.profile === profile ? state.preferences : DEFAULT_PREFERENCES;
}

type ToggleOption = {
  key: keyof ChatDisplayPreferences;
  testId: string;
  title: string;
  description: string;
};

/** Render compact, server-backed visibility controls for optional chat utilities. */
export function renderChatDisplayPreferences(panel: HTMLElement, read: FetchJSON, profile = currentProfile()): void {
  const options: ToggleOption[] = [
    {
      key: 'userMessageNavigatorEnabled',
      testId: 'user-message-ball-toggle',
      title: uiText('用户消息导航', 'User message navigator'),
      description: uiText(
        '桌面显示在会话右侧；手机显示在左侧导航栏。',
        'Shown beside chats on desktop and in the left navigation on phones.',
      ),
    },
    {
      key: 'generationSpeedEnabled',
      testId: 'generation-speed-toggle',
      title: uiText('TPS 生成速度', 'Generation speed (TPS)'),
      description: uiText(
        '仅在手机左侧导航栏显示；桌面端不显示。',
        'Shown only in the left navigation on phones; hidden on desktop.',
      ),
    },
  ];
  let preferences = cachedChatDisplayPreferences(profile);
  let disabled = true;
  const buttons = new Map<keyof ChatDisplayPreferences, HTMLButtonElement>();
  const status = document.createElement('p');
  status.className = 'workbench-chat-display-status';
  status.setAttribute('role', 'status');

  const sync = () => {
    for (const [key, button] of buttons) {
      button.setAttribute('aria-checked', String(preferences[key]));
      button.textContent = preferences[key] ? uiText('开启', 'On') : uiText('关闭', 'Off');
      button.disabled = disabled;
    }
  };

  for (const option of options) {
    const section = document.createElement('section');
    section.className = 'workbench-chat-display-toggle';
    section.dataset.testid = `${option.testId}-setting`;
    const copy = document.createElement('div');
    copy.className = 'workbench-chat-display-toggle-copy';
    const title = document.createElement('strong');
    title.textContent = option.title;
    const description = document.createElement('span');
    description.textContent = option.description;
    copy.append(title, description);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workbench-chat-display-switch';
    button.dataset.testid = option.testId;
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', option.title);
    button.addEventListener('click', async () => {
      if (disabled) return;
      const previous = preferences;
      const next = { ...preferences, [option.key]: !preferences[option.key] };
      preferences = next;
      sync();
      disabled = true;
      status.textContent = uiText('正在保存…', 'Saving…');
      try {
        preferences = await saveChatDisplayPreferences(read, profile, next);
        status.textContent = '';
      } catch {
        preferences = previous;
        status.textContent = uiText('保存失败，请重试。', 'Could not save. Please retry.');
      } finally {
        disabled = false;
        sync();
      }
    });
    buttons.set(option.key, button);
    section.append(copy, button);
    panel.append(section);
  }
  panel.append(status);
  loadChatDisplayPreferences(read, profile).then(value => {
    preferences = value;
    disabled = false;
    sync();
  }).catch(() => {
    status.textContent = uiText('无法读取显示设置。', 'Could not load display settings.');
  });
  sync();
}
