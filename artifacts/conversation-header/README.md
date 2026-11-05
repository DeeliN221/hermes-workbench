# Conversation header validation

All images use fictional English fixture content served on localhost. The
`before/` images come from main at `782c472`; `after/` comes from this change.
Desktop images are 1440 × 1000; phone images are 390 × 844.

| Case | Evidence |
| --- | --- |
| Desktop light, TPS | [Before](before/desktop-light.png) · [After](after/desktop-light.png) |
| Desktop dark, TPS | [Before](before/desktop-dark.png) · [After](after/desktop-dark.png) |
| Phone light, TPS | [Before](before/mobile-light.png) · [After](after/mobile-light.png) |
| Phone dark, TPS | [Before](before/mobile-dark.png) · [After](after/mobile-dark.png) |
| Project color, light | [After](after/project-desktop-light.png) |
| Project color, dark | [After](after/project-desktop-dark.png) |
| Project color, phone | [After](after/project-mobile-light.png) |
| Long title | [After](after/long-title.png) |

Focused localhost browser checks:

- `generation-speed.mjs`: exactly title/close in the header; TPS beside the
  ball, below the message list and above the composer on desktop and phone;
  live 42.0 → 56.0 tok/s, completed/reloaded values, insufficient samples,
  tooltip, model/settings access, light/dark screenshots.
- `project-appearance.mjs`: project green overrides a conflicting red session
  color; updates immediately after saving through navigation, matches the
  folder marker, survives reload, and has no header color editor.
- `session-rename.mjs`: sidebar-only entry, F2 does not rename, title sync,
  polling/reload persistence, clear/error paths, long-title ellipsis with full
  title/aria-label, and phone dialog bounds in both themes.
- `user-message-ball-panes.mjs`: separate per-pane balls, panels, jumps and
  stable desktop/mobile geometry.
- `workbench-smoke.mjs`: pane close, profile switching, mobile drawer, settings,
  files, chat detail modes, and no page errors.
- `route-sidebar.mjs`: navigation/focus, routes and geometry in both themes.

The final pane's close button is disabled to preserve the existing invariant
that the workspace always retains one pane. Other close buttons retain their
original handler and propagation behavior.

Local checks: typecheck, 110 Vitest files / 593 assertions, 448 Python tests
plus 6 subtests, build, version, history, privacy and release verification.
The build uses an isolated XDG configuration directory because this task is
explicitly confined to an isolated clone; no installed runtime was modified.

Browser execution uses Playwright with local Chromium. These checks exercise
the built bundle through the mock Hermes host, not a deployed/authenticated
Hermes installation or a physical phone. Actual provider TPS timing and
production deployment are not verified here.
