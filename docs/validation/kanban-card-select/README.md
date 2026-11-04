# Kanban card selection layout

Risk: **R1**. Completed task cards now put the checkbox on the title row, at the
left of the title. The previous standalone checkbox row is gone. The four
completed-column actions read **Select**, **Clear**, **Archive**, and **Show
archived**; their existing selection, disabled, archive and archived-visibility
behaviour is unchanged. Titles use a two-line clamp with ellipsis, so the
checkbox keeps a fixed click target when a title is long or the viewport is
narrow.

## Layout and visual evidence

All images use fictional English fixture content on a localhost mock host with
the production bundle and real Chromium. No installed instance was changed.

| Viewport | Light | Dark |
| --- | --- | --- |
| Desktop 1536 × 960 | [image](desktop-light.png) | [image](desktop-dark.png) |
| Phone 390 × 844 | [image](mobile-light.png) | [image](mobile-dark.png) |

The fixture deliberately includes a long completed title to exercise the
two-line clamp. Raw geometry for each viewport and theme is in
[evidence.json](evidence.json). In every variant the checkbox sits fully left of
the title, vertically overlaps the title's first line, and the title stays inside
the card without horizontal overflow.

## Validation

- `pnpm typecheck`: passed.
- `pnpm test`: 556 passing tests across 105 files.
- `pnpm build`: passed (isolated development policy).
- `tests/browser/task-control-tower.mjs`: passed desktop/phone light/dark,
  bulk selection, archive, archived discovery, and console checks.
- `tests/browser/fleetd-console.mjs`: passed single selection, select-all,
  partial archive failure with retained selection, retry and archived discovery.
- `tests/browser/kanban-task-tower.mjs`: passed demo/live navigation checks.
- Geometry and compact-label assertions ran at 1536px and 390px in both themes.

## R1 self-review and limits

- The change is limited to the task card heading, completed-column action labels,
  card title clamping, and their focused tests.
- Selection, bulk archive, archived visibility, drag-and-drop, review and detail
  drawer behaviour are unchanged.
- No production instance was built over, deployed or published.
- Screenshots were manually inspected for clipping, overlap and light/dark
  contrast; they contain only fixture content.
