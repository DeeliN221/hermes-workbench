# Task control tower

The Workbench home routes (`/`, `/home`, `/sessions`) now open an operator task
console. RecentHome remains intact at `/sessions?view=recent`; the main console
uses a narrow right rail for up to two user-pinned conversations and three recent
conversations. Pins and manual card order are versioned browser preferences.
Hermes' native Kanban remains available and unchanged. This feature does not
modify Hermes or Fleet source.

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
triage --dispatch--> ready --claim--> running --complete(auto)--> done
   ^                   |               |  ^                       |
   +-------------------+               v  |                       v
                                    blocked                    archived
                                       |                          |
                                       +--> running      restore -> triage

running --complete(human)--> review --accept--> done
                              |
                              +--rework--> running
scheduled --retry--> ready
```

Dragging is supported onto a subgroup or onto a card. Dropping onto a card also
positions the moved card before that card. Same-subgroup reordering is saved in
local storage. Delivered cards always use descending **creation** time and reject
manual reordering. Transitions and their guards are shared by the UI model and
mirrored at the proxy boundary:

- Draft to Ready requires a brief, non-empty acceptance criteria, repository and
  machine. Ready can return to Draft.
- Ready can start Running; Running and Blocked can move between one another.
- Only human verification can enter Review. An unchecked human checklist is
  allowed into Review so the operator can verify it there.
- Delivery requires a complete, non-empty acceptance checklist. Human delivery
  must pass through Review; automatic delivery goes directly from Running to Done.
- A task with an open decision cannot change status before the decision is resolved.
- Only Done can archive; restore returns Archived to Draft. Illegal moves leave
  the task in place and show a reason. Revision conflicts refresh server state.

Done cards older than three days **from `created_at`**, not completion time, are
excluded from the delivery column and sent through the revision-checked archive
operation while the console is open. The console refreshes every 15 seconds;
failed archive requests are surfaced and can be retried by reloading. Continuous
archival while no console is open would need Fleet's own scheduler.

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
| `GET /tasks?status=...` | `GET /api/v1/tasks?status=...` |
| `GET /tasks/{id}` | `GET /api/v1/tasks/{id}` |
| `PATCH /tasks/{id}` | `PATCH /api/v1/tasks/{id}` |
| `POST /tasks/{id}/dispatch` | `POST /api/v1/tasks/{id}/dispatch` |
| `POST /tasks/{id}/archive` | `POST /api/v1/tasks/{id}/archive` |
| `POST /tasks/{id}/restore` | `POST /api/v1/tasks/{id}/restore` |
| `POST /tasks/{id}/decide` | `POST /api/v1/tasks/{id}/decide` |
| `GET /artifacts/{id}/download?task_id=...` | Task authorization/membership check, then `GET /api/v1/artifacts/{id}/download` |

Updates carry matching integer `revision` and `If-Match` values. Upstream 409 is
preserved; the UI explains that the task changed elsewhere and refreshes. PATCH
allows only title/spec_json/acceptance/priority/risk/capability/machine/repo/
verify_mode/revision. The browser cannot PATCH status or set verified_by. Fleet
owns final validation and verification. Server responses are no-store projections:
attempts, raw events, artifact refs, arbitrary upstream URLs and errors are not
forwarded to the browser. Since the list contract does not promise open decisions,
the proxy hydrates non-delivered tasks from detail, with at most four concurrent
upstream reads. Large task sets may require a future paginated/bulk decision API.

Artifact IDs and task IDs are restricted to safe opaque identifiers. The proxy
checks that the artifact belongs to the fetched, authorized task, never opens a
filesystem `ref`, never follows `download_url` or redirects, and serves downloads
as attachments with no-sniff/sandbox headers. JSON reads are capped at 4 MiB and
downloads at 32 MiB with a 10-second upstream timeout. Browser downloads use the
SDK's authenticated fetch and a temporary object URL, with visible failure text.
Linked session/PR URLs are restricted to HTTP(S).

Server configuration:

```text
HERMES_WORKBENCH_FLEET_URL=https://fleet.example
HERMES_WORKBENCH_FLEET_TOKEN=<server secret>
HERMES_WORKBENCH_FLEET_MODE=live
```

The URL is an origin, without credentials, path, query or fragment. Non-loopback
plain HTTP requires an explicit `HERMES_WORKBENCH_FLEET_ALLOW_HTTP=1` deployment
choice. Missing configuration is a quiet disconnected state; recent conversations
remain usable. There is no silent fallback from a failed live request to fake data.

### Mock-only extension and integration gaps

The supplied authoritative contract does **not** define task creation or a general
manual status-transition/acceptance endpoint. The implementation must not invent
live Fleet mutations. Consequently:

- Live list/detail/PATCH/dispatch/archive/restore/decide/download use the confirmed
  contract. Unsupported manual drag transitions return an explicit explanation.
- `HERMES_WORKBENCH_FLEET_MODE=mock` enables the mock-only `POST /tasks` and
  `POST /tasks/{id}/transition` extension for the full lifecycle demonstration.
  Both endpoints fail closed in live mode. The frontend reads this capability
  from `/config`; no browser flag can enable it on a live proxy.
- The presentation adapter currently expects `acceptance: [{label, checked}]`,
  `spec_json.summary`, a boolean `needs_human` for actionable blockers, and an open
  decision `{id, question, options: [{id, label, impact, recommended}]}` in detail.
  These field shapes and decide payload `{decision_id, option_id, revision}` need
  confirmation against the real Fleet v2 implementation. `verify_mode` and
  `verified_by` follow the supplied contract.
- Real Fleet integration was not run: no test Fleet URL/token was configured in
  the isolated environment, and the parallel implementation's availability could
  not be established here. No production tasks were read or mutated. No deployment,
  merge, release, or daily-instance restart is part of this change.

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
installed plugin loading route and a real Fleet test environment remain unverified.
