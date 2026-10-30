import { describe, expect, it } from 'vitest';
import { createProcessWindowScroller } from '../dashboard/src/process-window';

function scrollingWindow(overrides: { scrollHeight?: number; scrollTop?: number; clientHeight?: number } = {}) {
  return { scrollHeight: 900, scrollTop: 0, clientHeight: 240, ...overrides };
}

describe('process window scroller', () => {
  it('pins a newly expanded window to the newest line', () => {
    const node = scrollingWindow();
    createProcessWindowScroller(node).update();
    expect(node.scrollTop).toBe(900);
  });

  it('leaves the position alone once the reader scrolls up', () => {
    const node = scrollingWindow();
    const scroller = createProcessWindowScroller(node);
    scroller.update();
    node.scrollTop = 120;
    scroller.handleScroll();
    expect(scroller.following).toBe(false);

    node.scrollHeight = 1400;
    scroller.update();
    expect(node.scrollTop).toBe(120);
  });

  it('resumes following after the reader returns to the bottom', () => {
    const node = scrollingWindow();
    const scroller = createProcessWindowScroller(node);
    node.scrollTop = 100;
    scroller.handleScroll();
    expect(scroller.following).toBe(false);

    node.scrollTop = 660;
    scroller.handleScroll();
    expect(scroller.following).toBe(true);

    node.scrollHeight = 1200;
    scroller.update();
    expect(node.scrollTop).toBe(1200);
  });
});
