# Unified Workbench search

Risk: **R1**. The home action is now **Search**. The existing preview-first dialog
searches both cross-profile conversations and Fleet board tasks. Tasks carry a
visible type label and open `/kanban?task=…`, including tasks outside the recent
board snapshot. Searching and previewing tasks issue GET requests only.

## Layout and visual evidence

All images use fictional English content on a localhost fixture host with the
actual production bundle and real Chromium. No installed instance was changed.

| State | Desktop light | Desktop dark | Phone light | Phone dark |
| --- | --- | --- | --- | --- |
| Results | [image](desktop-light-results.png) | [image](desktop-dark-results.png) | [image](mobile-light-results.png) | [image](mobile-dark-results.png) |
| Conversation | [image](desktop-light-session.png) | [image](desktop-dark-session.png) | [image](mobile-light-session.png) | [image](mobile-dark-session.png) |
| Task summary | [image](desktop-light-task.png) | [image](desktop-dark-task.png) | [image](mobile-light-task.png) | [image](mobile-dark-task.png) |
| Opened task | [image](desktop-light-opened-task.png) | [image](desktop-dark-opened-task.png) | [image](mobile-light-opened-task.png) | [image](mobile-dark-opened-task.png) |
| Empty | [image](desktop-light-empty.png) | [image](desktop-dark-empty.png) | [image](mobile-light-empty.png) | [image](mobile-dark-empty.png) |
| Fleet failure | [image](desktop-light-error.png) | [image](desktop-dark-error.png) | [image](mobile-light-error.png) | [image](mobile-dark-error.png) |

Before: [desktop](before-desktop-light-session.png),
[phone](before-mobile-light-session.png), built from `d37f309` in a separate
baseline worktree with the same long-title/summary fixtures.

Measured transcript viewport height (light and dark):

| Viewport | Before | After |
| --- | ---: | ---: |
| 1440 × 960 | 386px | 561px |
| 390 × 844 | 222px | 573px |

The title and open action share a flex row. Result titles and metadata use
single-line ellipsis; snippets use two lines. The preview title uses two lines
and a full-title tooltip. Explicit line heights and content-sized result rows
prevent host button rules from overlapping text. Error text has its own scroll
boundary and the retry button stays fully visible.

Raw geometry: [before](before-evidence.json), [after](evidence.json).

## Validation

- `pnpm typecheck`: passed.
- `pnpm test`: 555 passing tests across 105 files.
- `pnpm test:python`: 419 passed, 6 subtests passed.
- `pnpm build`: passed, including the unchanged raw/gzip bundle budgets.
- `pnpm privacy:check`, `pnpm history:check`, `pnpm release:verify`: passed.
- `tests/browser/workbench-search.mjs`: passed all four viewport/theme variants,
  home entry label, cross-profile session opening, task deep link and reload,
  empty results, partial source failure, retry, non-overlapping text, inline
  actions, and GET-only task requests. Also passed a 320px Chinese-label check.
- API unit coverage includes source identity, archived tasks, partial publication,
  Fleet errors/timeouts, cancellation and empty queries.

Reproduce the focused acceptance after building:

```sh
SHOT_DIR=docs/validation/workbench-search node tests/browser/workbench-search.mjs
```

An existing Chromium executable can be selected with
`CHROMIUM_EXECUTABLE_PATH`. The isolated build uses its own development policy
pointing to the fresh clone and linked worktree; the installation policy remains
unchanged.

## R1 self-review and limits

- Reuses the authenticated Fleet search endpoint and existing task detail drawer;
  does not change backend authentication, execution, review or deployment logic.
- Cancels stale searches, bounds task search latency and retains successful
  conversation results when Fleet is unavailable.
- Fleet search shows at most 100 tasks, following the existing per-source search
  limit; refine the query for additional matches. Conversation previews remain
  local snapshots (8 Codex turns / up to 160 Hermes messages).
- Public screenshots were manually inspected for clipping, overlap, contrast,
  fictional content and error recovery. No personal data is included.
- Installed Hermes/Fleet credentials and the production loading route were not
  exercised. Local fixtures validate UI/API contracts, not production deployment.
- No automatic release or deployment was performed.
