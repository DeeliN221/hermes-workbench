# Subscription allowance dashboard

Open **Allowances** in the Workbench home-page header. The dashboard checks the default
Workbench profile, shows all three subscriptions together, and labels the scope
of each result. It does not verify that a user owns a particular subscription.
“200x” is retained only as a user label, never a quota multiplier.

## Verified capability boundary

Official documentation checked 2026-10-31:

| Provider | Reliable source and implemented behavior | Limitations |
| --- | --- | --- |
| OpenAI ChatGPT Pro | Existing Workbench Codex App Server bridge, `account/rateLimits/read`; normalize only the `codex` bucket, its actual `windowDurationMins`, `usedPercent`, and `resetsAt`. Remaining percent is exactly 100 minus reported used percent. | This is Codex allowance, not a ChatGPT-wide balance. No assumed plan, multiplier, requests or tokens remaining. Missing 300/10080-minute windows and reset timestamps remain unavailable. No configured bridge, auth/RPC failure or timeout is explicit. |
| OpenCode Go | Official Go documentation describes per-model 5-hour, weekly and monthly allowances and the Console usage view. | No verified remaining-quota endpoint/schema or existing Workbench quota connection was found. The API overview lists Usage read permission but does not establish a Go remaining-window endpoint. Inference `opencode.allowance` describes a single request, not account-wide remaining allowance. We do not accumulate local usage, scrape login cookies or make paid inference probes. |
| Gemini AI Pro | Official Gemini CLI documentation offers `/stats model` for supported model usage/quota information. | The existing OpenCodex Antigravity report is an intermediary connection, not a verified Google AI Pro quota contract. CLI model quotas, Gemini API billing, and all Google AI Pro benefits are different scopes. No supported machine-readable account-wide quota contract was established; no invented 5-hour/week fields. |

Sources:
- https://learn.chatgpt.com/docs/app-server (Rate limits)
- https://opencode.ai/v2/docs/console/go/
- https://opencode.ai/v2/docs/console/api/
- https://opencode.ai/v2/docs/console/api/inference
- https://geminicli.com/docs/get-started/
- https://geminicli.com/docs/resources/quota-and-pricing/

## Connection audit and security

The checked-out source contains an existing Codex bridge configured through
`CODEX_APP_SERVER_ENDPOINT`. It has no OpenCode Go quota adapter. Latest main also contains `provider_quotas.py`, which reads OpenCodex `/api/provider-quotas` for Antigravity model-family reports. That adapter assumes 5-hour/weekly meanings from `Gem`/`Gem (Weekly)` labels and does not preserve verified account identity, observation time or window duration. The aggregate dashboard therefore does not promote those values to a Google AI Pro subscription balance. The isolated worker has no configured OpenCodex quota credentials or home. The
isolated development worker has no configured Workbench app-server endpoint;
production account connectivity and subscription tiers have **not** been
verified by a live authenticated call. Worker authentication is not treated as
Workbench account authorization, and credential files are not read or copied.

The new API is behind the existing trusted-proxy gate. User/profile validation
is reused from the bridge, cache and in-flight work are scoped to that identity,
and the browser response has `Cache-Control: no-store`. No upstream error text,
email, token, credit identifier or credential is exposed. Only known numeric
quota fields are returned. This adds no secret, configuration, login or billing
mutation. The bridge's existing app-server account remains authoritative; a
Workbench profile is not a separate provider account.

## Refresh semantics

Initial reads use a 15-second bounded in-memory cache. Refresh bypasses completed
cache entries; simultaneous requests share a single in-flight read. Upstream
reads time out after 8 seconds; the browser aborts after 12 seconds. Checked time
is distinct from the last successful retrieval time. Failed provider reads have
no current numerical value. Failed dashboard refreshes discard old displayed
numbers and offer retry. There is no automatic polling or model invocation.

## Live verification prerequisites (separate from this PR)

No production configuration change is needed for a deployed instance that
already has its authenticated Codex bridge. Verify the new read-only endpoint
through that instance's normal authenticated proxy after an independently
approved deployment. If the bridge is absent, stop: have the operator identify
an existing authorized endpoint and approve any required configuration change;
do not copy the worker's credentials. For OpenCode/Gemini, obtain a documented,
authorized quota contract and confirm scope before proposing any connector.
Do not request new API keys merely to turn unavailable cards into numbers.

## Validation evidence

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
