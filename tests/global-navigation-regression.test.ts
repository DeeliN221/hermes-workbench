import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The chat/session entry must remain reachable before the chat pane mounts. */
describe('global conversation navigation', () => {
  it('keeps a permanent session entry in the host navigation', () => {
    const runtime = readFileSync(
      new URL('../dashboard/src/recovered-runtime.js', import.meta.url),
      'utf8',
    );
    expect(runtime.includes('id: "dashboard-workbench-sessions"')).toBe(true);
    expect(runtime.includes('className: `dashboard-global-nav')).toBe(true);
    expect(runtime.includes('className: "dashboard-action-rail"')).toBe(true);
    expect(runtime.includes('k("/achievements", runtimeText("成就", "Achievements"), "achievements"')).toBe(true);
  });
});
