# Compact subscription allowances evidence

Localhost Playwright evidence from `tests/browser/quota-dashboard.spec.ts` at
1440px desktop and 390px mobile in light and dark themes. Fictional fixture data
only; no provider credentials or real allowances are included.

- `*-loading.png`: no-cache first paint with structured subscription skeleton rows.
- `*-list.png`: one-line subscription rows with only name and remaining allowance,
  a single `Updated` line, and the `Refresh` / `Add subscription` toolbar.
- `*-cached.png`: reload first paint from the profile-scoped local cache.

The suite also verifies the row `…` menu, detail drawer, delete confirmation,
failed-refresh cache retention, inline retry, timeout handling, and profile cache
isolation.
