# Blocked pending cards evidence

Blocked cards in the Pending column now use a restrained red surface across
the whole card in both themes. A visible `Blocked` label and its accessible
name keep the state recognizable without relying on colour. Hover, focus and
selected states deepen the tint instead of falling back to the neutral card.

## Screenshots

| viewport | theme | before | after |
| --- | --- | --- | --- |
| 1536 x 960 | light | `desktop-light-before.png` | `desktop-light-blocked-mixed.png` |
| 1536 x 960 | dark | `desktop-dark-before.png` | `desktop-dark-blocked-mixed.png` |
| 390 x 960 | light | `mobile-390-light-before.png` | `mobile-390-light-blocked-mixed.png` |
| 390 x 960 | dark | `mobile-390-dark-before.png` | `mobile-390-dark-blocked-mixed.png` |

Each capture contains both blocked Pending cards and the neutral Ready cards in
Queued. The browser regression also asserts WCAG text and metadata contrast,
the visible label `aria-label`, hover/focus tint retention, and no horizontal
overflow at 390px.

## Reproduction

```sh
HERMES_WORKBENCH_DEV_POLICY=/path/to/development.json pnpm build
SHOT_DIR=/tmp/blocked-pending-shots \
  CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
  node tests/browser/task-control-tower.mjs
pnpm typecheck
pnpm test
pnpm test:python
```

The screenshots use the repository's deterministic authenticated mock Fleet
and fictional English sample tasks; they are not production captures.

