# Home layout evidence

Localhost Playwright captures of the built Workbench bundle with deterministic
mock profiles and sessions.

- `home-default-3x3-light.png`, `home-default-3x3-dark.png`: default desktop grid, three profiles per row
  and three recent sessions per card.
- `settings-home-layout-light.png`: default layout controls in the settings page.
- `settings-home-layout-dark.png`: saved 4-column / 5-session values in dark mode.
- `home-custom-4x5-light.png`, `home-custom-4x5-dark.png`: custom desktop grid.
- `home-custom-4x5-mobile-390-light.png`,
  `home-custom-4x5-mobile-390-dark.png`: the same setting stays single-column at
  390px.

Regenerate with:

```sh
pnpm build
pnpm test:browser:home-layout
```

- `settings-home-layout-mobile-390-light.png` and
  `settings-home-layout-mobile-390-dark.png`: settings at phone width.

Validation: `pnpm typecheck`; full Vitest suite (109 files, 587 assertions);
full Python suite (447 cases, 6 subtests); focused layout Python tests (3);
focused layout/component Vitest tests (8); production build; localhost layout
Playwright; history and public-content checks.

The installation-local development policy points at a different checkout.
The production build used an isolated `XDG_CONFIG_HOME` to honor the requested
workspace boundary. Chromium was supplied through `CHROMIUM_EXECUTABLE_PATH`.
Browser screenshots use the real built bundle with deterministic mock APIs;
backend persistence and user/profile isolation use a real temporary SQLite database.
A fresh FastAPI application reads the same saved database. An actual deployed
Hermes host, full operating-system restart and installed release loading route
were not exercised. The existing home has no View all control; the separate
session list and underlying full session membership are preserved.
