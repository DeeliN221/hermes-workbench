// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackFromEvent, fallbackNoticeText, looksLikeCapacityError } from '../dashboard/src/chat-capacity-fallback';
import { createAssigneeAssistant } from '../dashboard/src/kanban-create-dialog-bridge';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  delete (window as any).__HERMES_PLUGIN_SDK__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Chat model fallback notice', () => {
  it('explains a switch between two models without leaking ids', () => {
    document.documentElement.lang = 'en';
    expect(fallbackNoticeText({ fromModel: 'gpt-a', toModel: 'gpt-b' }))
      .toBe('Model gpt-a is at capacity; the session switched to gpt-b automatically');
    expect(fallbackNoticeText({ toModel: 'gpt-b' }))
      .toBe('The primary model is at capacity; the session switched to gpt-b automatically');
    expect(fallbackNoticeText({ fromModel: 'gpt-a' })).toBe('');
    expect(fallbackNoticeText(null)).toBe('');
  });

  it('reads only the bridge fallback event', () => {
    expect(fallbackFromEvent({ method: 'workbench/modelFallback', payload: { params: { toModel: 'gpt-b' } } }))
      .toEqual({ toModel: 'gpt-b' });
    expect(fallbackFromEvent({ method: 'turn/completed', payload: { params: { toModel: 'gpt-b' } } })).toBeNull();
    expect(fallbackFromEvent({ method: 'workbench/modelFallback', payload: {} })).toBeNull();
    expect(fallbackFromEvent(null)).toBeNull();
  });

  it('recognizes the provider overload line in rendered output', () => {
    expect(looksLikeCapacityError('Selected model is at capacity. Please try a different model.')).toBe(true);
    expect(looksLikeCapacityError('codexErrorInfo: serverOverloaded')).toBe(true);
    expect(looksLikeCapacityError('模型容量不足')).toBe(true);
    expect(looksLikeCapacityError('ordinary assistant answer about capacity planning')).toBe(false);
  });
});

describe('Create dialog assignee assistant', () => {
  it('prefills the installed profile that matches the typed title', async () => {
    document.documentElement.lang = 'en';
    (window as any).__HERMES_PLUGIN_SDK__ = {
      fetchJSON: async (url: string) => {
        if (url.includes('/profiles')) {
          return { profiles: [{ name: 'default' }, { name: 'project-manager' }, { name: 'writer' }] };
        }
        throw new Error(`unexpected ${url}`);
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    let title = '';
    const form = document.createElement('form');
    const assistant = createAssigneeAssistant(form, () => ({ title, body: '' }));
    form.append(assistant.root);
    document.body.append(form);

    const select = assistant.root.querySelector('select')!;
    await vi.waitFor(() => expect(Array.from(select.options).map(option => option.value))
      .toEqual(['', 'default', 'project-manager', 'writer']));

    title = 'Refactor the frontend deployment pipeline';
    form.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(select.value).toBe('project-manager'));
    expect(assistant.root.querySelector('.hti-kanban-recommendation')?.textContent)
      .toContain('Recommended project-manager');
    expect(assistant.value()).toBe('project-manager');
  });

  it('never overwrites a profile the person chose', async () => {
    (window as any).__HERMES_PLUGIN_SDK__ = {
      fetchJSON: async () => ({ profiles: [{ name: 'default' }, { name: 'project-manager' }, { name: 'writer' }] }),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    let title = '';
    const form = document.createElement('form');
    const assistant = createAssigneeAssistant(form, () => ({ title, body: '' }));
    form.append(assistant.root);
    document.body.append(form);
    const select = assistant.root.querySelector('select')!;
    await vi.waitFor(() => expect(select.options.length).toBe(4));

    select.value = 'writer';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    title = 'Refactor the frontend deployment pipeline';
    form.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 260));
    expect(select.value).toBe('writer');
    expect(assistant.value()).toBe('writer');
  });
});
