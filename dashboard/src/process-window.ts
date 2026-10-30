/** Scroll following for one expanded chat process window. */
import { isProcessWindowAtLatest, type ProcessWindowMetrics } from './chat-detail';

export interface ProcessWindowScroller {
  /** True while new content should stay pinned to the newest line. */
  readonly following: boolean;
  /** Pin after a render; a reader who scrolled up keeps their position. */
  update(): void;
  /** Refresh the follow flag after a scroll event. */
  handleScroll(): void;
}

/**
 * Track whether one process window should follow appended content. The window
 * opens at the newest line, stops following as soon as the reader scrolls up,
 * and resumes once the bottom is visible again.
 */
export function createProcessWindowScroller(node: ProcessWindowMetrics): ProcessWindowScroller {
  let following = true;
  return {
    get following() {
      return following;
    },
    update() {
      if (following) node.scrollTop = node.scrollHeight;
    },
    handleScroll() {
      following = isProcessWindowAtLatest(node);
    },
  };
}
