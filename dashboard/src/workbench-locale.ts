/** Initialize a fresh browser in Chinese through the host's own locale context. */
/** The host React surface required by locale initialization; no untyped SDK hooks. */
export interface WorkbenchLocaleSDK {
  React: {
    useState(initial: number): readonly [number, (value: number | ((current: number) => number)) => void];
    useLayoutEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void;
  };
  useI18n?: () => { locale: string; setLocale(locale: string): void };
}

/** Share the host locale and watch its language changes before the page paints. */
export function useWorkbenchLocale(sdk: WorkbenchLocaleSDK): void {
  const host = sdk.useI18n?.();
  // Layout effects are available on host React, outside the limited SDK hooks facade.
  const { useLayoutEffect, useState } = sdk.React;
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    if (!host?.setLocale) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem('hermes-locale'); } catch { /* Private browsing. */ }
    if (!saved) host.setLocale('zh');
  }, []);
  useLayoutEffect(() => {
    if (host?.locale && document.documentElement.lang !== host.locale) {
      document.documentElement.lang = host.locale;
      refresh((value: number) => value + 1);
    }
    // The host and plugin share a locale, including changes from the language menu.
    const observer = new MutationObserver(() => refresh((value: number) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, [host?.locale]);
}
