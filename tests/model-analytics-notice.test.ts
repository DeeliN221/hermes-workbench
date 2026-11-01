// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { syncModelAnalyticsNotice } from '../dashboard/src/model-analytics-notice';

afterEach(() => { document.body.replaceChildren(); history.replaceState({}, '', '/'); });
it('hides only the host disabled-analytics notice while preserving stats and controls', () => {
  history.replaceState({}, '', '/models');
  document.body.innerHTML = '<main><dl><dt>Models used</dt><dd>3</dd><dt>Total sessions</dt><dd>12</dd></dl><button>Configure models</button><p id="notice">Token &amp; cost analytics are hidden because the local counts exclude auxiliary calls. Enable <span>dashboard.show_token_analytics</span> in Config.</p><p id="other">Enabled setting: <code>dashboard.show_token_analytics</code></p></main>';
  syncModelAnalyticsNotice();
  expect(document.querySelectorAll('[data-workbench-analytics-notice]')).toHaveLength(1);
  expect(document.querySelector('#notice')?.hasAttribute('data-workbench-analytics-notice')).toBe(true);
  expect(document.querySelector('dl')?.textContent).toContain('Total sessions12');
  expect(document.querySelector('button')?.textContent).toBe('Configure models');
  history.replaceState({}, '', '/config');
  syncModelAnalyticsNotice();
  expect(document.querySelectorAll('[data-workbench-analytics-notice]')).toHaveLength(0);
});

it('supports host route canvases without a main element', () => {
  history.replaceState({}, '', '/models');
  document.body.innerHTML = '<div><aside id="app-sidebar"></aside><section class="relative z-2"><p>Token &amp; cost analytics are hidden. <span>dashboard.show_token_analytics</span></p><div>Models used: 3</div></section></div>';
  syncModelAnalyticsNotice();
  expect(document.querySelectorAll('[data-workbench-analytics-notice]')).toHaveLength(1);
  expect(document.body.textContent).toContain('Models used: 3');
});
