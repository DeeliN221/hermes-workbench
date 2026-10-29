// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposeUserMessageBall,
  installUserMessageBall,
  readUserMessageBallEnabled,
  renderUserMessageBallSetting,
  writeUserMessageBallEnabled,
} from '../dashboard/src/user-message-ball';

const BALL = '[data-workbench-user-message-ball]';
const PANEL = '[data-workbench-user-message-panel]';

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
});

afterEach(() => {
  disposeUserMessageBall();
  localStorage.clear();
  document.body.replaceChildren();
});

/** Build the real chat-pane shell: one center per pane with its own transcript. */
function buildPane(ids: string[], label: string): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'codex-pane-slot';
  const workbench = document.createElement('main');
  workbench.className = 'codex-workbench';
  const center = document.createElement('section');
  center.className = 'codex-center';
  const header = document.createElement('header');
  header.className = 'codex-center-header';
  const list = document.createElement('div');
  list.className = 'codex-message-list';
  for (const id of ids) {
    const message = document.createElement('div');
    message.className = 'codex-message is-user';
    message.setAttribute('data-message-id', id);
    const body = document.createElement('div');
    body.className = 'codex-message-body';
    body.textContent = `${label} message ${id}`;
    message.append(body);
    list.append(message);
  }
  const composer = document.createElement('div');
  composer.className = 'codex-composer-wrap';
  center.append(header, list, composer);
  workbench.append(center);
  pane.append(workbench);
  document.body.append(pane);
  return pane;
}

function balls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(BALL));
}

function panels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(PANEL));
}

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

describe('user message navigator panes', () => {
  it('mounts one navigator per pane and counts only that pane', () => {
    const first = buildPane(['a1', 'a2', 'a3'], 'First');
    const second = buildPane(['b1'], 'Second');
    buildPane([], 'Empty');
    installUserMessageBall();

    const mounted = balls();
    expect(mounted).toHaveLength(3);
    expect(mounted.map(ball => ball.closest('.codex-pane-slot'))).toEqual([first, second, expect.any(HTMLElement)]);
    expect(mounted.map(ball => ball.dataset.count)).toEqual(['3', '1', undefined]);
    expect(mounted[0].hasAttribute('hidden')).toBe(false);
    expect(mounted[1].hasAttribute('hidden')).toBe(false);
    expect(mounted[2].hasAttribute('hidden')).toBe(true);
  });

  it('opens only its own pane transcript and jumps inside that pane', () => {
    buildPane(['a1', 'a2'], 'First');
    buildPane(['b1'], 'Second');
    installUserMessageBall();

    balls()[1].click();
    const [firstPanel, secondPanel] = panels();
    expect(firstPanel.hasAttribute('hidden')).toBe(true);
    expect(secondPanel.hasAttribute('hidden')).toBe(false);
    expect(secondPanel.querySelectorAll('[data-user-message-item]')).toHaveLength(1);
    expect(secondPanel.textContent).toContain('Second message b1');
    expect(secondPanel.textContent).not.toContain('First message');

    secondPanel.querySelector<HTMLElement>('[data-user-message-item]')!.click();
    expect(document.querySelector('[data-message-id="b1"]')!.classList.contains('is-user-message-jump-target')).toBe(true);
    expect(document.querySelector('[data-message-id="a1"]')!.classList.contains('is-user-message-jump-target')).toBe(false);
    expect(secondPanel.hasAttribute('hidden')).toBe(true);
  });

  it('keeps a single panel open at a time', () => {
    buildPane(['a1'], 'First');
    buildPane(['b1'], 'Second');
    installUserMessageBall();

    const mounted = balls();
    mounted[0].click();
    expect(panels()[0].hasAttribute('hidden')).toBe(false);
    mounted[1].click();
    expect(panels()[0].hasAttribute('hidden')).toBe(true);
    expect(panels()[1].hasAttribute('hidden')).toBe(false);
    mounted[1].click();
    expect(panels()[1].hasAttribute('hidden')).toBe(true);
  });

  it('shows and hides every pane navigator from the display setting', async () => {
    buildPane(['a1'], 'First');
    buildPane(['b1'], 'Second');
    installUserMessageBall();
    expect(balls().map(ball => ball.hasAttribute('hidden'))).toEqual([false, false]);

    writeUserMessageBallEnabled(false);
    await vi.waitFor(() => {
      expect(balls().map(ball => ball.hasAttribute('hidden'))).toEqual([true, true]);
    });

    writeUserMessageBallEnabled(true);
    await vi.waitFor(() => {
      expect(balls().map(ball => ball.hasAttribute('hidden'))).toEqual([false, false]);
    });
  });

  it('removes the navigator when its pane closes', async () => {
    buildPane(['a1'], 'First');
    const second = buildPane(['b1'], 'Second');
    installUserMessageBall();
    expect(balls()).toHaveLength(2);

    second.remove();
    await vi.waitFor(() => {
      expect(balls()).toHaveLength(1);
    });
    expect(document.querySelector('.is-user-message-navigator-host')).not.toBeNull();
  });

  it('detaches every layer when the navigator is disposed', () => {
    buildPane(['a1'], 'First');
    buildPane(['b1'], 'Second');
    installUserMessageBall();
    expect(document.querySelectorAll('[data-workbench-user-message-layer]')).toHaveLength(2);

    disposeUserMessageBall();
    expect(document.querySelectorAll('[data-workbench-user-message-layer]')).toHaveLength(0);
    expect(document.querySelector('.is-user-message-navigator-host')).toBeNull();
  });
});
