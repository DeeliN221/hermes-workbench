# Task control tower

The Workbench home routes (`/`, `/home`, `/sessions`) and the Kanban tab
(`/kanban`) open the same four-column operator task console. RecentHome remains intact at `/sessions?view=recent`; the main console
uses a narrow right rail for up to two user-pinned conversations and three recent
conversations. Pins and manual card order are versioned browser preferences.
The desktop Workbench menu and mobile action rail link directly to `/kanban`,
preserving the selected profile without requiring a native board assignment.
The Kanban tab has its own active navigation state and opens as a full page.
Existing `/kanban?board=...&panel=1` bookmarks also show the tower; those legacy
parameters do not select a Fleet board or open a floating panel. Refresh and
browser history retain the URL and profile. `view=recent` remains home-only.

Hermes' native Kanban remains available explicitly at `/kanban?view=legacy`
(with optional `board`, `profile`, and `panel=1` parameters). It is no longer
the navigation default. Native compatibility tests use this escape hatch.
This feature does not modify Hermes or Fleet source, the v2 proxy, or the
server-side live/demo selection and credential boundary.

## Operator flow

```text
Task console
  |
  +-- Needs you --> choose A/B/C, accept delivery, or resolve a human blocker
  |
  +-- Task card --> next action + acceptance checklist
  |                  +-- artifacts: filename / type / size / Download
  |                  +-- collapsed brief / timeline / linked sessions and PRs
  |
  +-- Right rail --> running (4 rows), delivery pulse, pinned/recent sessions
```

There is one attention strip, not a metrics dashboard. Its count is the union of
open decisions, human review tasks, and blockers explicitly marked `needs_human`.
An empty attention set displays only “Nothing needs you now” in the strip and a
quiet right rail. R0/R1 default to automatic verification; R2/R3 default to human
verification. An explicit `verify_mode` overrides the risk default. Automatic
verification never enters the human review column or the review attention count.
An open decision remains actionable irrespective of verification mode.

Decisions contain 2–4 distinct options with a label, impact/tradeoff and exactly
one recommendation. The recommended option appears first, with A/B/C/D buttons.
No free-form decision input or raw execution record is rendered. Invalid decisions
ask the task owner to complete the options rather than solicit an open-ended answer.

## State machine and column mapping

| Column | Subgroups / statuses |
| --- | --- |
| Pending | Draft (`triage`), Ready (`ready`) |
| In progress | Running (`running`), Blocked (`blocked`) |
| Your review | `review`, human verification only |
| Delivered | `done`, newest `created_at` first |

`scheduled` remains reserved for retry, exposed in a collapsed retry group rather
than a fifth board column. `archived` is available through the Delivered footer.

```text
triage --dispatch--> ready --worker claim--> running
                                               | complete(auto) --> done
                                               | complete(human) --> review
review --approve--> done                       | decision --> blocked
review --request_changes--> running            blocked --decide--> ready
triage/ready/scheduled/blocked/done --archive--> archived --restore--> previous status
```

In live mode the worker owns claim/complete/fail; the console never fabricates a
worker completion or manually moves Ready to Running. Dragging maps only to
contracted dispatch, review, archive and restore actions. Unsupported drops show
an actionable explanation. Local reordering and four columns/subgroups remain.
Dispatch requires a brief, acceptance criteria, repository and machine. Human
review uses explicit **Accept delivery** / **Request changes** clicks. Fleet v2
acceptance is text, not a writable review checklist; review/done criteria display
the worker-completed state, and the explicit approve action records human approval.

Fleet owns automatic archival after 72 hours from creation and persistent restore
exemptions. The browser does not hide or rearchive live restored deliveries. Live
list merges the default task list and explicit archived list. Demo mode retains
the prior simulated transitions/checklist and client-side age archival behavior.

The desktop list groups attention, pending, active, human review and recent
deliveries into compact rows. At 700px and below the board switches to the list;
a bottom Tasks / Needs you / Sessions navigation exposes the rail without squeezing
six columns onto a phone. The drawer has keyboard focus containment, Escape and
focus restoration. It opens full-width on phones.

## Fleet v2 proxy contract

Browser calls are same-origin under `/api/plugins/workbench/fleet`. `plugin_api.py`
mounts `fleet_proxy.router` behind the existing Hermes/sidecar authentication gate.
The fleet token is read only on the server and is never stored in JS, local storage
or browser API responses.

| Workbench endpoint | Fleet upstream endpoint |
| --- | --- |
| `GET /config` | Server-only capability projection, no upstream URL/token |
| `POST /tasks` | `POST /api/v2/tasks` (triage only) |
| `POST /tasks/{id}/approve` | `POST /api/v2/tasks/{id}/approve` (review token) |
| `POST /tasks/{id}/request_changes` | `POST /api/v2/tasks/{id}/request_changes` (review token) |
| `GET /tasks?status=...` | `GET /api/v2/tasks?status=...` |
| `GET /tasks/{id}` | `GET /api/v2/tasks/{id}` |
| `PATCH /tasks/{id}` | `PATCH /api/v2/tasks/{id}` |
| `POST /tasks/{id}/dispatch` | `POST /api/v2/tasks/{id}/dispatch` |
| `POST /tasks/{id}/archive` | `POST /api/v2/tasks/{id}/archive` |
| `POST /tasks/{id}/restore` | `POST /api/v2/tasks/{id}/restore` |
| `POST /tasks/{id}/decide` | `POST /api/v2/tasks/{id}/decide` |
| `GET /artifacts/{id}/download?task_id=...` | Task authorization/membership check, then `GET /api/v2/artifacts/{id}/download` |

Updates carry matching integer `revision` and `If-Match` values. Upstream 409 is
preserved; the UI explains that the task changed elsewhere and refreshes. PATCH
allows only title/spec_json/acceptance/priority/risk/capability/machine/repo/
verify_mode/revision. The browser cannot PATCH status or set verified_by. Fleet
owns final validation and verification. Server responses are no-store projections:
attempts, raw events, filesystem artifact refs, arbitrary upstream URLs and raw errors are not
forwarded to the browser. Since the list contract does not promise open decisions,
the proxy hydrates non-delivered tasks from detail, with at most four concurrent
upstream reads. Large task sets may require a future paginated/bulk decision API.

Artifact IDs and task IDs are restricted to safe opaque identifiers. The proxy
checks that the artifact belongs to the fetched, authorized task, never opens a
filesystem `ref`, never follows `download_url` or redirects, and serves downloads
as attachments with no-sniff/sandbox headers. JSON reads are capped at 4 MiB and
downloads at 32 MiB with a 10-second upstream timeout. Browser downloads use the
SDK's authenticated fetch and a temporary object URL, with visible failure text.
PR/URL artifact refs become external links restricted to credential-free HTTP(S);
they are never fetched by the proxy. File path and symlink containment remain
fleetd responsibilities; Workbench cannot open local artifact paths.

Server configuration:

```text
FLEET_URL=https://fleet.example
FLEET_TOKEN=<server secret>
FLEET_REVIEW_TOKEN=<different human-review secret>
HERMES_WORKBENCH_FLEET_MODE=live
```

The URL is an origin, without credentials, path, query or fragment. Non-loopback
plain HTTP requires an explicit `HERMES_WORKBENCH_FLEET_ALLOW_HTTP=1` deployment
choice. The default mode is `mock`, even when Fleet credentials exist in the
environment. Live requires the explicit flag **and** URL/token. Missing URL/token
uses the process-local demo with a visible “Demo mode” / “演示模式” badge.
A failed configured live request never falls back to fake data. Review credentials
are server-only and used exclusively for approve/request_changes. Missing or
incorrect review credentials return 403 without falling back to worker credentials.

### v2 adapter and mock boundary

Validated against `zzl/fleet` commit `fdabd48` and its `docs/api-contract.md`:

- UI `spec_json.summary` maps to Fleet's plain string `spec_json`.
- UI criterion labels map to newline-separated `acceptance`; checkbox state is
  demo-only. Priority `Pn` maps to integer `n`.
- Artifact/decision numeric IDs become opaque strings. Options without IDs receive
  stable indices for the displayed revision; decide validates the selected decision
  and option, then sends `{"choice":"selected label"}`.
- GET detail's `decision` is projected as `open_decision`; execution records remain
  server-only. File downloads authenticate with the worker token after task ownership
  validation. External PR links are separate from downloads.
- PATCH has an atomic revision check upstream. Action endpoints have a proxy
  revision preflight, but fdabd48 does not promise atomic If-Match checks for actions;
  Fleet still enforces its state machine. This limitation cannot be fixed in the
  Workbench adapter alone. No Fleet source change was made.
- 409 asks to reload/retry; 403 asks the administrator to check review credentials
  or artifact permissions; 404 asks to refresh; 410 asks for a new worker decision.
  Upstream error bodies are never exposed.
- `transition` is exclusively demo-only. The built-in demo uses process memory,
  sample decision/report, and no database/network. It resets with the process.
  `HERMES_WORKBENCH_FLEET_DEMO_URL` is an optional loopback-only test fixture
  transport; it never selects a non-loopback Fleet service.

Rollback: set `HERMES_WORKBENCH_FLEET_MODE=mock` in the next planned service
configuration rollout, or revert this PR's adapter commit. No Fleet data migration
is involved. Demo data is isolated from live data. This task does not deploy or
restart any installed instance.

## Reproduction and evidence

```bash
pnpm install --frozen-lockfile
npm run typecheck
npm test
npm run test:python
npm run build
npm run test:browser:tower
npm run test:browser
pnpm privacy:check
pnpm release:verify
```

The browser harness starts a stateful mock Fleet, an authenticated Python plugin
proxy, and a local mock Hermes host, all on ephemeral loopback ports. It terminates
its own child process and closes both servers/browser in `finally`. `uv` supplies
the existing requirements; no runtime dependency is added. Set `SHOT_DIR` to change
the default `/tmp/task-control-tower-screenshots` destination.

The exercised flow is: home → reorder / reject illegal drag → Draft↔Ready →
Running↔Blocked → automatic delivery (no review) → new Draft → complete brief →
dispatch → Running → human Review → check acceptance → accept → archive/restore →
choose A from three decision options → authenticated artifact download → list →
phone navigation → quiet empty attention state → secondary RecentHome and back.
The suite also asserts creation-time sorting, automatic archival, no token/raw log
exposure, no horizontal phone overflow and no browser errors.

Browser plugin not available; evidence uses local Playwright Chromium. Screenshots
are generated at **1536×960** and **390×844**, using existing Workbench light/dark
theme variables. The NAS prototype was not accessible locally, so the confirmed
written specification was used. The package remains a single SDK-React IIFE with
no new dependencies; its gzip budget increases from 618 to 632 KiB for this UI,
while the 2 MiB raw limit remains unchanged.

Review snapshots are in [`../validation/task-control-tower/`](../validation/task-control-tower/):

- `before-desktop-light.png`, `before-desktop-dark.png`, `before-mobile-light.png`: actual GitHub main (`ed894dc`) RecentHome baseline from a temporary worktree.
- `desktop-light.png`, `desktop-dark.png`: four columns, single strip, narrow rail.
- `mobile-light.png`, `mobile-dark.png`: list and bottom navigation.
- `decision-drawer.png`, `artifact-drawer.png`: action/checklist first, choices/download.
- `desktop-list.png`, `desktop-empty.png`, `mobile-empty.png`: grouped and quiet states.
- `recent-home-secondary.png`: previous home surface retained as a secondary entry.

These use fictional English fixtures and are localhost validation only; the actual
installed plugin loading route remains unverified. Real Fleet validation is below.


## Real fleetd local validation

```bash
# In a disposable /tmp checkout of the private Fleet repository:
git checkout --detach fdabd48
go build -o /tmp/workbench-test-fleetd ./cmd/fleetd
# Back in this Workbench branch, after npm run build:
FLEET_TEST_BINARY=/tmp/workbench-test-fleetd node tests/browser/task-control-v2.mjs
```

The harness binds ephemeral loopback ports, creates a temporary SQLite/workspace,
uses distinct synthetic worker/review tokens, disables mirrors/notifications,
and cleans up children and database/workspace in `finally`. The Hermes shell is a
local fixture; the Workbench bundle, authenticated Python proxy and fleetd are real.
Worker claim/complete/decision calls come from the test driver, never the browser.
No production Fleet requests or repository modifications occur.

Verified: browser draft creation/edit/dispatch; worker claim and auto→done;
human→review→request_changes→fresh attempt→review→approve; decision/decide;
authenticated download and wrong-task 404; PR external link; archive/restore;
concurrent PATCH 409 shown in UI; real expired decision 410; file download then
symlink escape 403. Tests also check missing review credentials, no browser Fleet
URL/token exposure, and safe default/mock selection.

Screenshots: `/tmp/fleet-T-01484b8f-v2-screenshots/`, copied into
`docs/validation/task-control-tower-v2/`: desktop light/dark, mobile light/dark,
decision, download, 409 conflict. Chromium localhost only; no installed plugin
route, production deployment, remote worker process or cross-machine mount tested.


Validation result (2026-11-01): `npm run typecheck`, `npm test` (450 tests),
`npm run test:python` (259 tests, 6 subtests), `npm run build`, full
`npm run test:browser`, and the real v2 harness all passed. Browser page identity,
nonblank content, absence of framework overlays, console health (expected 409
resource error excluded), interactions and screenshots were checked. Fleet source
was clean at `fdabd483e84c3831b148d52ea2d2658b8581c62f` after validation.
