# Subscription allowances

Open **Settings → Subscription allowances**. The default Workbench profile starts
with three built-in presets: OpenCode Go, Gemini AI Pro and OpenAI ChatGPT Pro.
The browser renders the server's ordered entries; provider names and counts are
not compiled into the UI. Add any service with **Add subscription**, including
multiple accounts or plans from the same vendor. The entry-source selector also
offers the server-provided built-in presets, so deleted presets can be restored. Edit labels and manual values,
enable/disable entries, move them up/down, or delete with inline confirmation.
Deleting all entries is supported and does not recreate the defaults.

## Configuration and adapters

Each entry has its own stable ID, display name, service, plan/account label,
enabled flag and adapter. Array position is its display order. Manual entries
support a 5-hour, weekly or monthly window, an explicit timezone-qualified reset
time, remaining or used amount, optional total allowance and a unit. Blank
amounts are unavailable, not zero. A monthly window is a label, not an assumed
30-day reset schedule. The server stamps changed observations; refreshing does
not make an old manual observation look newly measured. Expired manual values
are unavailable on the next read, including when a cached read spans the reset.
There is no automatic rollover or polling.

`GET /api/plugins/workbench/quotas?profile=default` returns provider results,
non-secret entries and a revision. `PUT /api/plugins/workbench/quotas/entries`
accepts `{revision, entries}` and atomically replaces the ordered list. A stale
revision returns 409 instead of overwriting another tab. A failed save preserves
the editor; refresh reloads authoritative configuration. Requests and responses
contain no credential fields. Unknown fields are rejected with generic errors
without echoing their values. Do not put secrets in display labels.

Configuration is stored in SQLite, separately for each authenticated user and
profile, with file mode 0600. Set `HERMES_WORKBENCH_SUBSCRIPTIONS_DB` to select a
persistent database path; the default is
`~/.local/share/hermes-workbench/subscriptions.sqlite3`. The example deployment's
HOME is inside its persistent data volume. Keep this database outside versioned
release directories and back it up with application state. No browser storage is
used. Defaults are returned only for identities without a saved configuration.

### Upgrade and rollback

This release adds a separate SQLite database; it does not migrate or rewrite the
existing session, profile or credential stores. The table is created on first
access. Existing identities see the three presets until they first save; an
explicitly saved empty list stays empty. Writes replace the list and increment
its revision in one transaction, so a failed transaction preserves both.

Before upgrading, back up the database with SQLite's backup API (or copy it while
the application is stopped). Rolling back the application to the previous
release restores its fixed preset UI and ignores this database; retain the file
to recover the saved configuration when upgrading again. Do not delete or modify
credential/session stores as part of this rollback. No destructive schema
migration is required for this version.

## Live provider connections

Existing Gemini/OpenCode presets (including previously saved entries) now dispatch
to live server adapters. The stored `unsupported` adapter identifier is retained
for backwards-compatible configuration; it no longer means these presets lack an
adapter. Labels do not switch upstream accounts. These connections belong to the
Workbench service account and are shared by authorized dashboard users, like the
Codex bridge. Profile names are not separate provider identities.

### Gemini AI Pro

The service executes exactly `agy -p '/usage'` with a fixed 20-second deadline.
Only TSV rows whose first column is **Gemini Models** are accepted. Week/Weekly
Limit Remaining and Five Hour Limit Remaining map to weekly and 5-hour windows.
Claude/GPT and other model groups are excluded. Reset times are parsed as UTC;
missing/invalid times stay unavailable. The UI displays the command source and
successful retrieval time. The AI Pro label is a configured plan label; the CLI
does not independently verify the subscription tier.

Install `agy` on the service PATH and sign in under the Workbench service account.
Missing command, login failure, timeout, empty output and unrecognized TSV each
have actionable states. Timeout/cancellation kills and reaps the command group.

### OpenCode Go

The service calls only `GET https://opencode.ai/zen/go/v1/usage`. Its `usage`
object contains rolling, weekly and monthly windows with **used** `percent` and
`resetsAt`; remaining is `100 - percent`. Missing windows stay unknown. The
rolling label is kept explicit and monthly reset dates are never calculated locally.

The adapter first honors `WORKBENCH_OPENCODE_AUTH_FILE`, otherwise reuses the
service account's `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json` API key
for `opencode-go` or `opencode`. No persistent browser scraping runs in the app.
If the existing login is absent, the card says “需要配置 OpenCode Go 登录” and
shows the configuration steps:

1. On the server, create a private JSON file owned by the Workbench service user
   with mode **0600**, outside the repository and release directories.
2. Store `{"token":"<OpenCode Go API key>"}` (preferred) or
   `{"cookie":"<session cookie>"}` there. Cookie authentication depends on the
   provider accepting that session; a 401 instructs the operator to renew login.
3. Set `WORKBENCH_OPENCODE_AUTH_FILE` to the file's absolute path in the service
   environment and press **Refresh** once the service has that configuration.
   Updating an already configured file is picked up on the next Refresh.

Never enter credentials in the browser. No token, cookie, file contents or
upstream error body is logged or returned. Symlinks, foreign ownership and
permissions exposing secrets to other users are rejected. Requests have an
8-second transport deadline and redirects are refused to prevent credential
forwarding. 401, 403, timeout, empty and malformed responses remain explicit.

## Refresh and security

The existing authenticated API and identity-scoped cache remain in use with
`Cache-Control: no-store`. Initial reads use a 15-second cache; Refresh bypasses
completed cache entries and coalesces concurrent refreshes. Each adapter has an
outer 24-second deadline; the browser waits 30 seconds to accommodate the measured
roughly 10-second agy command. Failed reads remove current numbers. Source,
checked time and successful update time remain separate. Disabled entries make
no provider requests. No model inference or automatic polling is performed.

## Data provenance and verification boundary

- Actual Gemini TSV captured 2026-11-02, including non-Gemini groups to test
  exclusion: `tests/fixtures/allowances/gemini-usage.tsv`.
- Actual anonymous OpenCode 401 captured on the same date.
- OpenCode success JSON is an explicitly labeled **contract fixture**, not a
  live authenticated response. No OpenCode login was present in the task
  container or its persistent browser's OpenCode cookies.
- [Official OpenCode endpoint implementation](https://github.com/anomalyco/opencode/blob/d4704347465c1ee63d0c213ed00e648e7f0231c5/packages/console/app/src/routes/zen/go/v1/usage.ts)
  establishes the response schema and used-percent semantics.
- Codex continues using `account/rateLimits/read`; it is Codex allowance, not
  a ChatGPT-wide balance.

Localhost validation does not deploy, restart or switch the installed service.
OpenCode authenticated verification needs only the service-side login file above.

## Configurable entries validation

See the [validation report and light/dark desktop/mobile screenshots](validation/subscription-entries/README.md).

## Original dashboard validation (historical)

Validated in an isolated NAS worktree on 2026-10-31. No production process was
restarted, deployed, or reconfigured. The production installation route and live
account responses were not exercised.

- Frozen-lockfile dependency installation and TypeScript checks passed.
- Vitest: 419 tests across 86 files passed; focused quota UI tests also passed
  after the final home-header integration change.
- Python: 224 tests and 6 subtests passed using the pinned development
  requirements (Python 3.12). Quota cases cover exact reported values, missing
  windows, malformed data, partial availability, timeout, retries, cache,
  duplicate requests, user/profile isolation, cancellation cleanup and redaction.
- Production bundle build, release verification, public-content scan and history
  checks passed.
- `pnpm build` followed by `pnpm test:quotas:e2e`: 3 Playwright scenarios passed
  against the built Workbench app on a loopback-only mock Hermes host. Desktop
  (1440 x 1000) and mobile (390 x 844) screenshots were visually inspected.
  They use fictional quota responses, not measurements of a real account.
  The scenarios cover entry/close/focus, partial availability, refresh and retry,
  discarded stale values, provider timeout, request timeout and mobile overflow.

For a normal development environment, install a Playwright Chromium browser
with `pnpm exec playwright install chromium` before the browser check. An existing
compatible Chromium can be selected using
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. This task kept its toolchain and browser
inside the isolated task directory.

[Home entry](../assets/subscription-allowances/entry.png) ·
[Desktop dashboard](../assets/subscription-allowances/desktop.png) ·
[Mobile dashboard](../assets/subscription-allowances/mobile.png) ·
[Mobile timeout](../assets/subscription-allowances/mobile-timeout.png)

## Live-adapter localhost evidence (2026-11-02)

Validated the built page at `http://127.0.0.1:4183/config?workbench=allowances&profile=default`
against the real adapters behind a loopback-only test API. Desktop 1440×1000 and
mobile 390×844 both displayed real Gemini 5-hour/weekly values and UTC-derived
reset timestamps, OpenCode's missing-login instructions, and successful Refresh.
Page identity, nonblank content, no framework overlay, console health and overflow
checks passed. The preview's surrounding projects and Codex response are fixtures;
Gemini is live. No installed loading route, deployment or production restart was
exercised. Browser plugin unavailable; regular Playwright used the existing Chromium.
Screenshots contain no credentials or account identifiers.

[Desktop](../assets/live-allowances/desktop.png) ·
[Mobile login](../assets/live-allowances/mobile-login.png) ·
[Mobile Gemini](../assets/live-allowances/mobile-gemini.png)
