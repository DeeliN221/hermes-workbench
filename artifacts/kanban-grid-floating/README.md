# Shared floating Kanban launcher acceptance

Validated on localhost with deterministic mock Hermes/Fleet fixtures and headless Chromium.

- Typecheck passed (`pnpm typecheck`).
- All unit tests passed: 110 files, 593 tests (`pnpm test`).
- Build passed (`XDG_CONFIG_HOME=/tmp/fleet-T-15cc923f/.local-config pnpm build`), using isolated configuration because the machine default build policy points at another workspace.
- Browser regression passed (`tests/browser/kanban-floating.mjs`): desktop crafting-grid open without navigation, reopen grid and toggle closed, B toggle, single tower on chat, selected state, focus restoration to workbench opener, 80vw x 80vh centered geometry, periodic refresh, search/drawer Escape precedence, outside dismissal, editable/modifier/IME guards, full-page /kanban deep link, mobile rail navigation, 390px mobile B guard, light/dark themes, no console errors.
- Browser executable: preinstalled Chromium headless shell 1228, via CHROMIUM_EXECUTABLE_PATH.

Screenshots: desktop-*-before.png (chat), desktop-*-button.png (opened using crafting grid), desktop-*.png (keyboard opening / task drawer regression), mobile-*.png (390 x 844 full-page board).

Not verified: actual installed Hermes loading route, production backend or deployment. This change does not deploy the running installation.
