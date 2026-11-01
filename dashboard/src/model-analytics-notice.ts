import './model-analytics-notice.css';
import { findTabContent } from './tab-content';

/** The host owns ModelsPage; suppress only its disabled-analytics explanation. */
export function syncModelAnalyticsNotice(): void {
  document.querySelectorAll('[data-workbench-analytics-notice]').forEach(node => node.removeAttribute('data-workbench-analytics-notice'));
  if (location.pathname !== '/models') return;
  findTabContent()?.querySelectorAll('p').forEach(paragraph => {
    const setting = Array.from(paragraph.querySelectorAll('span, code')).some(node => node.textContent?.trim() === 'dashboard.show_token_analytics');
    if (setting && paragraph.textContent?.trim().startsWith('Token & cost analytics are hidden')) {
      paragraph.setAttribute('data-workbench-analytics-notice', 'true');
    }
  });
}

export function installModelAnalyticsNotice(): void {
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; syncModelAnalyticsNotice(); });
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('popstate', schedule);
  schedule();
}
