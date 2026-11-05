# Home session selection evidence

The screenshots use synthetic English fixture data and the production bundle served on localhost. No live sessions or credentials are involved.

- [Desktop light selection](desktop-light-selected.png)
- [Desktop dark selection](desktop-dark-selected.png)
- [Desktop light opened panes](desktop-light-opened.png)
- [Desktop dark opened panes](desktop-dark-opened.png)
- [390px phone light home](mobile-light-home.png)
- [390px phone dark home](mobile-dark-home.png)
- [390px phone light opened pane](mobile-light-opened.png)
- [390px phone dark opened pane](mobile-dark-opened.png)

## Reproduce

```sh
pnpm build
node tests/browser/home-session-selection.mjs
```

The focused Playwright harness mounts the host router before Workbench and checks desktop light/dark at 1440x900 and phone light/dark at 390x844. It covers selection without navigation, deselection, clear, Space/Escape, transient selection on reload, mixed Codex/Hermes sessions with identical ids across profiles, selection order, the three-session union limit, confirmation clearing, persisted pane profiles/order, already-open markers and focus, closing/reloading/reopening, drag/drop below and at capacity, card dimensions and horizontal overflow. Phone checks also verify that the active conversation is visible in the existing horizontal pane strip.

The optional installation development policy points at a different workspace on the verification machine. For this isolated clone only, the build uses `XDG_CONFIG_HOME="$PWD/.local-config"`; it writes generated assets only under this checkout. Browser runs use the preinstalled Chromium headless shell via `CHROMIUM_EXECUTABLE_PATH`.

## Local validation

- TypeScript checking and production build passed.
- Vitest: 593 tests in 110 files passed.
- Python: 448 tests and 6 subtests passed.
- Focused Playwright: all four viewport/theme combinations passed, including pane closure and synthetic drag/drop.
- Browser regressions passed: home-first-click, home-layout, profile-home, session-search, workbench-search, user-message-ball-panes, mobile-tabs and workbench-smoke.
- Release verification, version/history checks and public-content checks passed.

## Limits

Live authenticated Hermes/Codex services and physical touch devices are not exercised. The local browser fixtures exercise routing, rendering, API profile scoping, and persistence; they do not send real agent messages.
