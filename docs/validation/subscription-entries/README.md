# Configurable subscription entries validation

Validated against the main branch containing merged PR #93 (`c0620ab`) in an
isolated checkout. No release, merge, deployment, production connection or running
installation was modified. All identities, balances and screenshots are fictional.

## Results

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | 480 cases passed across 96 files |
| `pnpm test:python` | 275 cases and 6 subtests passed |
| `pnpm build` | Passed; existing Vite configuration-loader advisory remains |
| `pnpm test:browser` | Complete existing browser chain passed |
| `pnpm test:quotas:e2e` | All 12 scenarios passed; four management scenarios rerun successfully after final wording change |
| `pnpm privacy:check` | Passed |
| `pnpm release:verify` | Passed (local layout validation only) |
| `pnpm history:check` | Passed with full history |

The browser plugin was unavailable. Tests used repository Playwright, Chromium,
Node 24.19.0 and pnpm 11.22.0. This host intermittently stalled screenshots and
stable-element waits with normal GPU settings, also in the pre-existing diagram
smoke test. Final successful runs used an isolated executable wrapper launching
Chromium with `--disable-gpu --disable-software-rasterizer`, selected through
`CHROMIUM_EXECUTABLE_PATH` (existing browser chain) and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (quota suite). No assertions were skipped or
forced. The wrapper and machine-specific paths are not committed.

## Exercised flow

Settings → Subscription allowances → add Example Cloud → add a second account
for the same vendor → reload → edit name and used amount → move up → disable →
reload → enable → refresh → inspect both themes → add/cancel editor → delete →
reload → restore a built-in preset. The browser forwards quota requests to the
real Python router and a temporary SQLite database, while provider responses are
fictional. Separate Python cases reopen the store/router to verify restart
persistence and cover empty-list persistence, identity/profile isolation,
concurrent writers, validation redaction, manual expiration, cache invalidation,
provider failure and timeout isolation.

| Render check | Result |
| --- | --- |
| Correct route and page title | Passed |
| Meaningful content, no blank page | Passed |
| No framework error overlay | Passed |
| No relevant page/console errors | Passed |
| Real management interactions and reload persistence | Passed |
| No horizontal overflow at 1440×1000 and 390×844 | Passed |
| Light/dark screenshot inspection | Passed |

## Evidence

| View | Overview | Custom subscription | Editor |
| --- | --- | --- | --- |
| Desktop light | [Image](desktop-light-overview.png) | [Image](desktop-light-subscriptions.png) | [Image](desktop-light-editor.png) |
| Desktop dark | [Image](desktop-dark-overview.png) | [Image](desktop-dark-subscriptions.png) | [Image](desktop-dark-editor.png) |
| Mobile light | [Image](mobile-light-overview.png) | [Image](mobile-light-subscriptions.png) | [Image](mobile-light-editor.png) |
| Mobile dark | [Image](mobile-dark-overview.png) | [Image](mobile-dark-subscriptions.png) | [Image](mobile-dark-editor.png) |

The mobile editor scrolls vertically; the editor images show its first fields.
The automated flow also interacts with fields and save controls below the fold.

## Limits and choices

Live subscription ownership/balances, production storage permissions and
production deployment are unverified. OpenCode and Gemini retain their existing
unsupported status rather than reporting invented quotas. Codex presets share
the existing server bridge; separate account authentication is not added.

Manual entries track one selected window each, and monthly resets use an explicit
date rather than inferred calendar arithmetic. Supporting several manual windows
inside one entry or separate automatic account connections would be follow-up
product choices. Configuration is bounded to 100 entries per user/profile, with
an optimistic revision check rather than silent last-writer-wins behavior.
