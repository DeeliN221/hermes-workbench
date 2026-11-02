# Session overview acceptance

Unmodified localhost Playwright screenshots of the actual bundle with deterministic, public-safe mock Hermes data. Before: c6be705. After: this branch. These are not production screenshots.

Desktop: 1440 × 900, light/dark, 13 complete rows in the initial viewport (previously about 7 cards). Mobile: 390 × 844, light/dark; additional groups images show profile boundaries after vertical scrolling.

Groups follow the authorized profile roster and saved order. Sessions retain recently-opened-first ordering with activity as fallback. Group titles show profile and count. Rows show title, project, engine, status, optional unread indicator, and update time; exact timestamps are available through accessible labels and tooltips. Empty profiles/projects retain concise messages.

Validation: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm test:python`, `pnpm build`, `pnpm privacy:check`, `git diff --check`.

Browser command: `CHROMIUM_EXECUTABLE_PATH=<local-chromium> SHOT_DIR=assets/session-overview node tests/browser/profile-home.mjs`.

Browser coverage: ordering across reload/fresh tab; scoped desktop/mobile navigation; route history; empty/loading/error/retry states; both themes; vertical mobile grouping; no nested scrolling; long unbroken titles at 390/800/1024/1440px. The localhost host serves the compiled plugin. Production authentication, live profile data, and deployment are outside this validation.
