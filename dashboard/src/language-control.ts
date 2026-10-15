import { uiText } from './ui-locale';

/** A visible language menu in Workbench's replacement settings navigation. */
export function createLanguageControl(sdk: any) {
  const h = sdk.React.createElement;
  return function LanguageControl() {
    const host = sdk.useI18n?.();
    const [open, setOpen] = sdk.hooks.useState(false);
    const ref = sdk.hooks.useRef(null);
    sdk.hooks.useEffect(() => {
      if (!open) return;
      const close = (event: Event) => {
        if (!ref.current?.contains(event.target)) setOpen(false);
      };
      document.addEventListener('pointerdown', close);
      return () => document.removeEventListener('pointerdown', close);
    }, [open]);
    if (!host?.setLocale) return null;
    const label = uiText('选择语言', 'Choose language');
    return h('div', { className: 'workbench-language-control', ref,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setOpen(false);
          ref.current?.querySelector('button')?.focus();
          event.stopPropagation();
        }
      },
    }, h('button', { type: 'button', title: label, 'aria-label': label,
      'aria-expanded': open, onClick: () => setOpen(!open),
    }, h('svg', { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
      h('circle', { cx: 12, cy: 12, r: 9 }),
      h('path', { d: 'M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z' }))),
    open ? h('div', { className: 'workbench-language-menu', role: 'group', 'aria-label': label },
      [['zh', '简体中文'], ['en', 'English']].map(([locale, name]) => h('button', {
        key: locale, type: 'button', lang: locale, 'aria-pressed': host.locale === locale,
        onClick: () => { host.setLocale(locale); setOpen(false); ref.current?.querySelector('button')?.focus(); },
      }, name))) : null);
  };
}
