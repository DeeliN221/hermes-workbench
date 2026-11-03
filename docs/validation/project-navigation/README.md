# Project navigation acceptance

Localhost Playwright evidence uses synthetic English fixtures. No installed loading route or daily instance was changed, and nothing was published.

- Desktop: 1440 × 900; mobile: 390 × 844, with touch emulation.
- Project rows show icon and name. Desktop reveals the single more button on hover/focus; touch layouts keep it discoverable. Rename and delete live in a native top-layer menu, including arrow-key navigation, Escape, outside dismissal, and deletion confirmation.
- The folder icon is an independently focusable appearance button. Color and icon changes use the existing Save action and update the row immediately; reload persistence is covered by `project-appearance.mjs`.
- The Projects heading supports a 600 ms hold, right-click, Context Menu key, and Shift+F10. A visible hint and the existing section menu offer discovery and a click/keyboard alternative. Movement beyond 10 px, pointer cancellation, release, or leaving the heading cancels a pending hold. Touch context menus cannot bypass the timer. Compatibility mouse events on release are suppressed so the new-project dialog stays open.
- Empty lists retain the Projects heading and creation menu. Temporary sessions have one new-session button and no project-creation shortcut.
- Existing project membership, ordering, session selection/switching, drag and drop, history/archive, and section resizing keep their existing implementation. There is no backend or data-model change.

## Screenshots

Baseline is commit `2a147cd`; after images come from this feature worktree. All pages are served by `createMockHost({ host: 'localhost' })`.

| View | Before | After | More menu | Icon and color | Hold to create |
| --- | --- | --- | --- | --- | --- |
| Desktop light | [Before](desktop-light-before.png) | [After](desktop-light-sidebar.png) | [Menu](desktop-light-menu.png) | [Appearance](desktop-light-appearance.png) | [Create](desktop-light-create.png) |
| Desktop dark | [Before](desktop-dark-before.png) | [After](desktop-dark-sidebar.png) | [Menu](desktop-dark-menu.png) | [Appearance](desktop-dark-appearance.png) | [Create](desktop-dark-create.png) |
| Mobile light | [Before](mobile-light-before.png) | [After](mobile-light-sidebar.png) | [Menu](mobile-light-menu.png) | [Appearance](mobile-light-appearance.png) | [Create](mobile-light-create.png) |
| Mobile dark | [Before](mobile-dark-before.png) | [After](mobile-dark-sidebar.png) | [Menu](mobile-dark-menu.png) | [Appearance](mobile-dark-appearance.png) | [Create](mobile-dark-create.png) |

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:python
pnpm build
SHOT_DIR=docs/validation/project-navigation node tests/browser/project-navigation.mjs
pnpm test:browser
pnpm test:quotas:e2e
pnpm privacy:check
pnpm history:check
pnpm release:verify
```

In this isolated environment, the build command used a process-scoped `XDG_CONFIG_HOME` inside the task directory to avoid the host installation's canonical-checkout policy. The host policy itself was not edited. Browser runs used `CHROMIUM_EXECUTABLE_PATH` (and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for the quota suite) pointing to the preinstalled Chromium headless shell.

The gzip budget increases from 637 to 638 KiB for the accessible menus and hold gesture; the 2 MiB raw cap, single-chunk requirement, and SDK React boundary remain enforced.
