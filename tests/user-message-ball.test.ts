// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readUserMessageBallEnabled,
  renderUserMessageBallSetting,
  writeUserMessageBallEnabled,
} from '../dashboard/src/user-message-ball';

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
});

afterEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe('user message navigator settings', () => {
  it('defaults on and persists the off choice', () => {
    expect(readUserMessageBallEnabled()).toBe(true);
    writeUserMessageBallEnabled(false);
    expect(readUserMessageBallEnabled()).toBe(false);
    writeUserMessageBallEnabled(true);
    expect(readUserMessageBallEnabled()).toBe(true);
  });

  it('renders a switch that updates the stored preference', () => {
    const target = document.createElement('section');
    document.body.append(target);
    renderUserMessageBallSetting(target);
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="user-message-ball-toggle"]')!;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(readUserMessageBallEnabled()).toBe(false);
    expect(toggle.textContent).toContain('已关闭');
  });
});
