import { uiText } from './ui-locale';
import './send-shortcut.css';

export type SendShortcut = 'ctrl-enter' | 'enter';
const STORAGE_KEY = 'hermes.workbench.send-shortcut';
const CHANGE_EVENT = 'workbench-send-shortcut-change';
let fallback: SendShortcut = 'ctrl-enter';

export function readSendShortcut(): SendShortcut {
  try { return localStorage.getItem(STORAGE_KEY) === 'enter' ? 'enter' : 'ctrl-enter'; }
  catch { return fallback; }
}

export function setSendShortcut(value: SendShortcut): void {
  fallback = value;
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Keep the current page usable without storage. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useSendShortcut(sdk: any): SendShortcut {
  const [value, setValue] = sdk.hooks.useState(readSendShortcut);
  sdk.hooks.useEffect(() => {
    const update = () => setValue(readSendShortcut());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    update();
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return value;
}

type KeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'keyCode'> & {
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
};

export function shouldSendMessage(event: KeyEvent, shortcut: SendShortcut): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing
    || event.nativeEvent?.isComposing || event.keyCode === 229) return false;
  return shortcut === 'enter' ? !event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey;
}

export function sendShortcutHint(shortcut: SendShortcut): string {
  return shortcut === 'enter'
    ? uiText('Enter 发送，Shift + Enter 换行', 'Enter to send; Shift + Enter for a new line')
    : uiText('Ctrl / ⌘ + Enter 发送，Enter 换行', 'Ctrl / ⌘ + Enter to send; Enter for a new line');
}

export function createSendShortcutControl(sdk: any) {
  const h = sdk.React.createElement;
  return function SendShortcutControl() {
    const value = useSendShortcut(sdk);
    return h('label', { className: 'workbench-send-shortcut' },
      h('span', null, uiText('发送消息快捷键', 'Send message shortcut')),
      h('select', { value, 'aria-label': uiText('发送消息快捷键', 'Send message shortcut'), onChange: (event: { target: { value: SendShortcut } }) => setSendShortcut(event.target.value) },
        h('option', { value: 'ctrl-enter' }, uiText('Ctrl + 回车键', 'Ctrl + Enter')),
        h('option', { value: 'enter' }, uiText('回车键', 'Enter'))),
      h('small', null, sendShortcutHint(value)));
  };
}

/** Settings page for the current and future keyboard preferences. */
export function createShortcutSettings(sdk: any) {
  const h = sdk.React.createElement;
  const SendShortcutControl = createSendShortcutControl(sdk);
  return function ShortcutSettings() {
    return h('section', { className: 'workbench-shortcut-settings' },
      h('h1', null, uiText('快捷键', 'Keyboard shortcuts')),
      h('p', null, uiText('按你的习惯设置快捷键，修改后自动保存。', 'Choose the shortcuts you prefer. Changes are saved automatically.')),
      h(SendShortcutControl));
  };
}
