// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchLocale } from '../dashboard/src/workbench-locale';
import { chineseUI, uiText } from '../dashboard/src/ui-locale';
import { bilingualText, localizeWorkbenchUI } from '../dashboard/src/locale-overlay';

describe('Workbench locale overlay', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.lang = 'en';
  });

  it('defaults to English and honors an explicit Chinese locale', () => {
    document.documentElement.lang = '';
    expect(chineseUI()).toBe(false);
    expect(uiText('文件', 'Files')).toBe('Files');
    document.documentElement.lang = 'zh-CN';
    expect(uiText('文件', 'Files')).toBe('文件');
  });

  it('selects exactly one language from bilingual labels', () => {
    expect(bilingualText('文件 / Files', true)).toBe('文件');
    expect(bilingualText('文件 / Files', false)).toBe('Files');
    expect(bilingualText('/opt/data/workspace', true)).toBe('/opt/data/workspace');
  });

  it('localizes text and accessibility attributes without mixing languages', () => {
    document.body.innerHTML = '<button aria-label="关闭终端 / Close terminal" title="关闭 / Close">终端 / Terminal</button>';
    document.documentElement.lang = 'zh-CN';
    localizeWorkbenchUI();
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('终端');
    expect(button.getAttribute('aria-label')).toBe('关闭终端');
    expect(button.title).toBe('关闭');
  });
});


describe('Workbench host locale initialization', () => {
  it('uses host React when the SDK hooks facade omits layout effects', async () => {
    const cleanups: Array<() => void> = [];
    const refresh = vi.fn();
    const setLocale = vi.fn();
    const saved = localStorage.getItem('hermes-locale');
    const initialLang = document.documentElement.lang;
    localStorage.removeItem('hermes-locale');
    const sdk = {
      useI18n: () => ({ locale: 'zh', setLocale }),
      hooks: { useState: vi.fn(), useEffect: vi.fn() },
      React: {
        useState: () => [0, refresh] as const,
        useLayoutEffect: (effect: () => void | (() => void)) => {
          const cleanup = effect();
          if (cleanup) cleanups.push(cleanup);
        },
      },
    };
    try {
      useWorkbenchLocale(sdk);
      expect(setLocale).toHaveBeenCalledWith('zh');
      expect(document.documentElement.lang).toBe('zh');
      expect(sdk.hooks.useState).not.toHaveBeenCalled();
      refresh.mockClear();
      document.documentElement.lang = 'en';
      await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(cleanups).toHaveLength(1);
    } finally {
      cleanups.forEach(cleanup => cleanup());
      document.documentElement.lang = initialLang;
      if (saved === null) localStorage.removeItem('hermes-locale');
      else localStorage.setItem('hermes-locale', saved);
    }
  });
});
