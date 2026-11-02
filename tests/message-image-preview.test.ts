// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { closeFilePreview, openMessageImagePreview } from '../dashboard/src/file-preview';

afterEach(() => { closeFilePreview(); document.body.replaceChildren(); });

it('isolates the dialog and restores focus and prior page state on Escape', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  openMessageImagePreview('data:image/png;base64,', trigger);
  expect(document.querySelector('dialog[aria-modal="true"]')).not.toBeNull();
  expect(trigger.inert).toBe(true);
  expect(document.activeElement?.getAttribute('aria-label')).toMatch(/Close|关闭/);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
  expect(document.activeElement?.closest('dialog')).not.toBeNull();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.querySelector('#hti-file-preview')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.inert).toBe(false);
  expect(document.body.style.overflow).toBe('');
});

it('shows loading and failure states without exposing the source; backdrop closes', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  openMessageImagePreview('blob:synthetic-test', trigger);
  expect(document.querySelector('[role="status"]')).not.toBeNull();
  document.querySelector('img')!.dispatchEvent(new Event('error'));
  expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Unable|失败/);
  expect(document.body.textContent).not.toContain('blob:synthetic-test');
  document.getElementById('hti-file-preview')!.click();
  expect(document.activeElement).toBe(trigger);
});

it('reveals a successfully loaded image and cleans up when replaced', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  openMessageImagePreview('blob:synthetic-test', trigger);
  const image = document.querySelector('img')!;
  image.dispatchEvent(new Event('load'));
  expect(image.hidden).toBe(false);
  expect(document.querySelector('[role="status"]')).toBeNull();
  openMessageImagePreview('blob:synthetic-test-2', trigger);
  expect(document.querySelectorAll('dialog')).toHaveLength(1);
  closeFilePreview();
  expect(trigger.inert).toBe(false);
});
