# Kanban tab routing validation

The flow under test is: desktop Workbench menu / mobile action rail -> Kanban ->
task control tower, retaining the selected profile and Kanban active state.

Evidence is captured from the built bundle on a localhost mock Hermes host,
using the real authenticated Python proxy. The four screenshots use the
credential-free built-in demo, at 1536x960 and 390x844, in light and dark themes.
Mobile retains the existing tower's grouped list and bottom Tasks / Needs you /
Sessions navigation; desktop displays the four columns.

`tests/browser/kanban-task-tower.mjs` also exercises live mode against a local
stateful Fleet fixture. It checks refresh, browser back/forward, old board/panel
bookmarks, the mobile chat return, absence of native-board prerequisites, and
same-origin browser requests without Fleet URL/token exposure. Existing native
Kanban browser tests now explicitly use `view=legacy`.

Browser plugin not available. Playwright used the locally installed Chromium
1237 executable because Chromium 1248 stalled on actionability even on an
isolated one-button page. No production credentials or installation were used.
Actual installed Hermes loading, real remote Fleet, other browsers and physical
mobile devices remain unverified. No release or deployment was performed.

```sh
pnpm typecheck
pnpm test
pnpm test:python
pnpm build
pnpm test:browser
# Optional evidence capture (after build):
WORKBENCH_SCREENSHOT_DIR=/tmp/kanban-task-tower node tests/browser/kanban-task-tower.mjs
```

- [Desktop light](kanban-desktop-light.png)
- [Desktop dark](kanban-desktop-dark.png)
- [Mobile light](kanban-mobile-light.png)
- [Mobile dark](kanban-mobile-dark.png)
