# Global kanban rescue validation

Screenshots in this directory are actual localhost browser captures using fictional fixture data, in English. They are not production screenshots.

- Desktop: 1536 × 960, light and dark; four fixed columns, no toolbar or duplicate attention panel.
- Mobile: 390 × 960, light and dark; automatic grouped list, compact navigation, bounded drawer.
- Card metadata: device, CLI, model, reasoning and total attempt runtime in minutes. Missing metadata is explicitly unrecorded; incomplete attempt history is not presented as a total.
- Review: approve and multiline request changes through the authenticated Python proxy; failed writes preserve input.
- Lifecycle: real archive, retry and decision contracts; partial batch failures retain only failed selections.
- Search: server-side title/ID/repository substring search, archived inclusion, opaque cursor pagination, empty/error/retry states. No client-side fallback over the current board window.
- Conversations: explicit source/execution profile and kind associations open the corresponding conversation. Historical IDs without routing metadata display an explanation instead of guessing a destination.
- Navigation: canonical global route, reload/history, desktop W menu, mounted chat and unsent draft restoration.
- Home: compact profile groups; ordering and project-label preferences persist via settings.

## Fleet integration

`tests/browser/fleetd-review-integration.py` runs the real fleetd binary against a disposable localhost database, with separate test worker and review credentials. It verifies approve, note/request_changes, archive, retry, decision and archived search. No worker process executes these tasks.

Verified against Fleet commit `987f824` (indexed task search and keyset pagination), fetched from its default branch. Search follows `GET /api/v1/tasks?q=...&include_archived=1&limit=100&cursor=...`; the response must include `has_more` and `next_cursor`. An older server that silently ignores `q` produces an explicit unsupported-search message. The proxy validates and forwards each page; it does not download all history for local matching.

Reproduction:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:python
pnpm test:browser
pnpm test:quotas:e2e
FLEET_TEST_BINARY=/path/to/isolated/fleetd uv run --no-project --with-requirements requirements-dev.txt python tests/browser/fleetd-review-integration.py
```

## Explicit limits

Production fleetd availability/version, production credentials, real worker execution and production session linkage were not tested. The Fleet task creation API does not currently provide complete source-session/profile/kind linkage; Workbench projects only recorded associations. Missing reasoning/model metadata is not fabricated. Total runtime is withheld for missing or truncated attempt history. A retry may remain blocked if fleetd cannot find a matching worker.

No deployment, service restart, release switching or modification to the installed `current` tree is part of this PR.
