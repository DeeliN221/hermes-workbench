# Mobile tab shell evidence

Captured by `WORKBENCH_SCREENSHOT_DIR=assets/mobile-tab-shell pnpm test:browser:mobile-tabs`
using the built dashboard bundle and the deterministic local mock host.

All current `*-light.png` and `*-dark.png` images use a 390×844 viewport.
`before-*.png` are historical captures from the earlier PR iteration.

- Rail bounds: left 0px, right 48px.
- Page and settings-list container: left 56px, width 334px.
- Page content has additional inner padding; tests assert visible headings,
  forms, input controls and lists also start at or beyond rail right + 8px.
- Settings details (native and Workbench-owned): top 96px, below both headers.
- Skills and sample-plugin images exercise direct URLs only. Neither has a rail entry.
- Achievements, files, kanban and the sample plugin use labelled native host
  fixtures, not live business data. Achievements uses a section canvas; files
  inserts a plugin slot before the canvas. These catch adjacent-div assumptions.
- The suite also resizes each primary route through 800px, 801px and 1440px,
  checks mobile class/header teardown, and verifies the desktop accessory close
  control. It checks exact existing rail links, scrolling, return-chat history,
  cron editing, and temporary preview dismissal.

Custom settings screenshots cover display, models, shortcuts and versions in
both themes. The native settings form is `config-detail-*`; the menu is `config-*`.
