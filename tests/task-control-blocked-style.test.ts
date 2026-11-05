import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("../dashboard/src/task-control-tower.css", import.meta.url),
  "utf8",
);

function rule(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `missing CSS rule: ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("blocked pending card surface", () => {
  it("tints the whole blocked card in Pending and leaves other columns neutral", () => {
    expect(rule(':is(.tower-column, .tower-list > section)[data-column="pending"] .tower-card[data-blocked="true"]')).toMatch(
      /background:\s*var\(--tower-blocked-bg\)/,
    );
    expect(css).not.toMatch(
      /\.tower-card\[data-status="blocked"\]\s*\{[^}]*border-inline-start/,
    );
  });

  it("defines separate restrained light and dark blocked surfaces", () => {
    expect(rule(".task-tower")).toMatch(/--tower-blocked-bg:\s*#f7e7e3/);
    expect(css).toMatch(
      /:root\[data-workbench-theme="dark"\] \.task-tower,[\s\S]*?\{[^}]*--tower-blocked-bg:\s*#332321/,
    );
  });

  it("keeps hover, focus and selected blocked cards visibly tinted", () => {
    const hover = ':is(.tower-column, .tower-list > section)[data-column="pending"] .tower-card[data-blocked="true"]:hover';
    const focus = ':is(.tower-column, .tower-list > section)[data-column="pending"] .tower-card[data-blocked="true"]:focus-within';
    expect(rule(hover)).toMatch(/background:\s*var\(--tower-blocked-bg-hover\)/);
    expect(rule(focus)).toMatch(/background:\s*var\(--tower-blocked-bg-hover\)/);
    expect(css).toContain('.tower-card[data-blocked="true"][aria-selected="true"]');
    expect(css).toContain('.tower-card[data-blocked="true"].is-selected');
  });
});
