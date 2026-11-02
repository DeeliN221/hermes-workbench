# Profile session home validation

These are actual localhost browser screenshots of the Workbench bundle with deterministic, public-safe English fixtures. They are not production screenshots. The baseline images show the previous root-page task tower; the after images show the new profile overview in both themes and at 1440×900 / 390×844.

- `/` renders profile columns in roster order, including empty profiles and empty projects. Columns keep a readable width, scroll independently vertically, and snap horizontally on phones.
- `/kanban` renders only the task board. Parallel links preserve the active view through reload, back/forward, and legacy `/home`, `/sessions?view=recent`, board-query and `/kanban?view=legacy` entries.
- `GET /api/plugins/workbench/profile-overview` aggregates the existing lightweight roster and the sidebar's trusted-user Codex groups/session store. Hermes history uses the existing read-only `/api/profiles/sessions?profile=all` aggregate with pagination. There are two aggregate data-source requests initially, independent of profile count; history pages are additional requests when needed. No new session database, repair writes, provider calls, or read acknowledgements are introduced.
- `last_opened_at` wins when supplied; otherwise `last_activity_at` and existing source activity fields are used. Existing stores do not consistently supply opening timestamps, so the UI labels the fallback as **Active**. Opening and unread state remain distinct; this change does not invent opening timestamps.
- The three newest sessions per profile use 14%, 9%, and 5% accent-to-transparent gradients only while younger than seven days. Exactly seven days old, unknown timestamps, future timestamps, and rank four onward have ordinary backgrounds. Relative text and full timestamps accompany color. “Today” follows the viewer's local calendar; “Past week” means a rolling seven days.
- Loading, empty, individual-source errors, aggregate failure, and retry are exercised. Subscription allowances remain in Settings.

Validation commands:

```sh
pnpm typecheck
pnpm test
pnpm build
env -u CODEX_APP_SERVER_ENDPOINT -u CODEX_HOME uv run --no-project --with-requirements requirements-dev.txt pytest -q tests/test_profile_overview.py tests/test_sidecar_app.py
pnpm test:browser
```

The browser suite uses `CHROMIUM_EXECUTABLE_PATH` when Chromium is provided by the local environment. `tests/browser/profile-home.mjs` saves the after screenshots and checks routing, profile ownership on open, request counts, failure states, desktop scrolling, phone snapping, and light/dark backgrounds.
