// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderChatDisplayPanel } from '../dashboard/src/chat-display-settings';
import { CHAT_DETAIL_STORAGE_KEY } from '../dashboard/src/chat-detail';

function panel(): HTMLElement {
  const section = document.createElement('section');
  document.body.append(section);
  return section;
}

beforeEach(() => {
  document.documentElement.lang = 'en';
  localStorage.clear();
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('chat display settings', () => {
  it('renders the three work-detail choices with Standard selected by default', () => {
    const target = panel();
    renderChatDisplayPanel(target);
    const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-detail-mode]'));
    expect(buttons.map(button => button.dataset.detailMode)).toEqual(['compact', 'standard', 'detailed']);
    expect(buttons.map(button => button.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(buttons.map(button => button.querySelector('strong')?.textContent)).toEqual(['Compact', 'Standard', 'Detailed']);
  });

  it('persists a new choice and announces it without leaving the settings page', () => {
    const target = panel();
    const events: string[] = [];
    const listener = (event: Event) => events.push(String((event as CustomEvent).detail));
    window.addEventListener('hermes-workbench:chat-detail-change', listener);
    try {
      renderChatDisplayPanel(target);
      target.querySelector<HTMLButtonElement>('[data-detail-mode="detailed"]')!.click();
      expect(localStorage.getItem(CHAT_DETAIL_STORAGE_KEY)).toBe('detailed');
      expect(target.querySelector('[data-detail-mode="detailed"]')!.getAttribute('aria-checked')).toBe('true');
      expect(target.querySelector('[data-detail-mode="standard"]')!.getAttribute('aria-checked')).toBe('false');
      expect(target.querySelector('[role="status"]')!.textContent).toContain('Detailed saved');
      expect(events).toEqual(['detailed']);
    } finally {
      window.removeEventListener('hermes-workbench:chat-detail-change', listener);
    }
  });

  it('restores a saved compact choice', () => {
    localStorage.setItem(CHAT_DETAIL_STORAGE_KEY, 'compact');
    const target = panel();
    renderChatDisplayPanel(target);
    expect(target.querySelector('[data-detail-mode="compact"]')!.getAttribute('aria-checked')).toBe('true');
    expect(target.querySelector('[data-detail-mode="standard"]')!.getAttribute('aria-checked')).toBe('false');
  });
});
