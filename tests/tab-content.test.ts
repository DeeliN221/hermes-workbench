// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { findTabContent } from '../dashboard/src/tab-content';

afterEach(() => { document.body.innerHTML = ''; });
describe('mobile route canvas discovery', () => {
  it.each([
    '<div id="canvas" class="relative z-2"><div>Routed page</div></div>',
    '<span hidden></span><section id="canvas"><main>Routed page</main></section>',
    '<main id="canvas">Routed page</main>',
  ])('finds the host canvas without depending on an adjacent div: %s', html => {
    document.body.innerHTML = `<div><aside id="app-sidebar"></aside>${html}</div>`;
    expect(findTabContent()?.id).toBe('canvas');
  });
  it('prefers a Workbench-owned route over the retained host canvas', () => {
    document.body.innerHTML = '<main>Hidden host</main><section id="owned" class="dashboard-owned-page"></section>';
    expect(findTabContent()?.id).toBe('owned');
  });
  it('does not use the sidebar or an unrelated overlay as a canvas', () => {
    document.body.innerHTML = '<aside id="app-sidebar"></aside><div role="dialog"></div>';
    expect(findTabContent()).toBeNull();
  });
});
