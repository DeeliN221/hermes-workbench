# Isolated Workbench services integration

These modules contain the business services for the independent FastAPI host.
They import neither Hermes nor a Codex runtime, start nothing on import, and
never discover a home directory, open a credential file, or import history
without an explicit selection. All storage is below the host's `storage_root`.

```text
Authenticated host resolver
          |
          +--> workspace files / sandboxed PTY
          +--> isolated profile memory / skills / MCP configuration
          +--> explicitly imported read-only archives
          +--> schedule occurrence journal --> Fleet task submission
DSH persistent history <--- delivery adapter <--- Fleet authoritative deliveries
                               |
                               +--> Fleet ACK only after durable persistence
```

## Mounting

```python
from dashboard.standalone_services import (
    create_services_router,
    create_extra_router,
)

plugins = create_services_router(resolve_context, storage_root, runtime=adapter)
services = plugins.services
app.include_router(plugins, prefix="/api/plugins/workbench")
app.include_router(create_extra_router(services=services))  # No prefix.
```

The extra router provides `/api/cron/jobs`, `/api/plugins/workbench-cron/jobs`,
`/api/plugins/workbench-cron/executions`, `/api/profiles/sessions`, and
`/api/sessions/...`. It also aliases configuration routes at `/api/memory`,
`/api/mcp`, `/api/runtime-context`, and `/api/skills/files/...`.

**Avoid overlapping live session routes.** If the host combines live DSH and
archive lists/search, use `create_extra_router(services=services, archives=False)`
and have the host's existing session endpoints combine
`services.archives.list(context, q="", exclude_sources="")` with native sessions.
IDs prefixed `archive_` go to `services.archives.get(context, id)`; native IDs go
to DSH. Archive objects are explicitly `runtime="archive"`, `read_only=True`,
`resumable=False`. The host must not hand these IDs to native resume endpoints.
Use `config_aliases=False` if the host already owns the top-level settings API;
the plugin configuration routes remain available. `schedules=False` allows a
host to mount its own schedule composition layer.

`StandaloneServices(resolve_context, storage_root, runtime=None,
fleet_request=None, clock=None)` is also public. Its `.router()` and
`.extra_router(...)` return routers sharing one service instance.

## Authentication and scope

`resolve_context(request_or_websocket)` may be synchronous or asynchronous. It
must authenticate before returning an actual server-selected dictionary:

```python
{
    "user_id": "authenticated-user",
    "profile_id": "selected-profile",
    "project_id": "selected-project",
    "workspace": resolved_workspace_path,
    # Optional server-configured roots; never populate these from request JSON.
    "import_roots": [explicit_local_import_root],
}
```

Return no context or raise `HTTPException(401, ...)` for an unauthorized request.
The resolver must authorize the selected project and workspace, including any
session query used to derive them. The services check identity hints against
this context and never use payload identity as an authority. There is no HTTP
endpoint to bind arbitrary sessions. A WebSocket is authenticated before accept.

Memory, skills, and MCP selections are intentionally shared across projects of
one user/profile. Attachments, archive imports, session bindings, schedules,
request identities, and delivery receipts are scoped to user/profile/project.
Another user/profile cannot see that profile's configuration; another project
cannot see its stateful conversation records. Legacy Fleet tasks without origin
are excluded and rejected on direct access. There is no implicit administrator
bypass or AGY-to-DSH relabeling.

## Runtime adapter

The adapter is an object with methods or a dictionary of callbacks. Callbacks
may be synchronous or asynchronous; these modules do not import bridge types.
The host should wrap its `/api/runtime` bridge/Python client with these signatures.
Existing `/api/runtime/sessions`, snapshot/events/messages/cancel/interactions,
capabilities and models endpoints remain the runtime owner's responsibility.

| Callback | Required behavior |
| --- | --- |
| `get_session(context, session_id)` | Authorize **user ownership**, profile and project in the native session store; return a SessionRef or `None`. |
| `create_session(context, payload)` | Durably/idempotently create DSH session using `payload.request_id`; apply `payload.context` as DSH `runtime_context`, including explicit archive selection if present. Return SessionRef. |
| `send_message(context, session_id, payload)` | Submit foreground `text`, `request_id`, and backend `context`; return the native receipt. Dependencies/skill overrides are rejected for foreground input. |
| `scheduled_input(context, session_id, payload)` | Durably accept an idempotent scheduled input independently of an HTTP connection. Return `{request_id: same_id, status: "accepted" or "completed"}`. |
| `persist_delivery(context, session_id, delivery, idempotency_key)` | Atomically append to **that original DSH session** and deduplicate the key in native history; return `{"persisted": True}` only after commit. |
| `fleet_request(method, path, body, params)` | Optional server-owned Fleet v2 transport. Paths are relative to `/api/v2`. Never accept its URL or credentials from a browser. |
| `shell_command(context, isolated_home)` | Optional host OS-sandbox launcher returning an argv list, needed on non-Mac hosts. Must confine filesystem access to the authorized workspace/home and exclude internal data/credentials. |

SessionRef is `{id, runtime: "dsh", profile_id, project_id}`. Session identifiers
allow letters, digits, underscores and hyphens, maximum 128 characters.
If the host does not supply `get_session`, it must call
`services.bind_session(context, ref)` immediately after durable native creation.
A SessionRef does not itself prove user ownership: only the trusted runtime
lookup or host binding does. Missing/unbound sessions fail closed.

For scheduled foreground input, implement the durable `scheduled_input` callback.
An optional `capabilities.durable_scheduled_input=false` disables this feature;
the documented callable contract is sufficient when no flag is supplied. Saving
a capability flag alone does not execute input. Accepted
receipts stay `accepted` in the submission journal and are never presented as
completed work. Fleet remains the source of background task status.

`services.build_runtime_context(context)` supplies selected memory, selected
skill entry contents/version/local root, and selected MCP configurations.
The module-level `build_runtime_context(context, storage_root)` is an equivalent
backend helper. **The result can contain MCP credentials; do not expose it as
an HTTP response or place it in logs.** `/runtime-context` returns selection
names only. MCP environment values and headers are redacted on configuration
reads and writes; saving redacted placeholders is rejected. Saving MCP settings
means configured, not installed, connected, tested, or executed. Unknown plugin
manifests/server fields/transports are rejected. The runtime must explicitly
support the selected configurations before using them.

## Files, attachments, and terminal

- `/workspace`, `/files?path=`, `/file?path=` GET/PUT, and `/asset?path=` follow
  `workbench-api.ts`. PUT requires the current SHA-256 `version`; creation must
  explicitly specify `mode="create"`. Writes use atomic rename/fsync and locks.
- Paths must be relative. All symlink components, sensitive names, special
  files, traversal, and the internal storage tree are denied. UTF-8 editor reads
  and writes are capped at 2 MiB; file/download/upload data at 20 MiB. Raster
  preview uses signature detection; active SVG is not an inline image.
- `/attachments?session_id=` GET/POST; multipart `file` returns
  `{"attachment": {id,name,size,mimeType,kind}}`.
- `/attachments/folder?session_id=` POST accepts repeated `files`, JSON `paths`,
  and `name`, matching `uploadCodexFolder`. Limit 100 files/20 MiB total; unique
  safe paths only. Cards include `fileCount` for folders.
- `/attachments/{id}/preview` and `/download` require `session_id` and the same
  authenticated context. The `/codex/attachments` storage-only aliases preserve
  existing composer upload contracts; they do not start or import Codex.
- `await services.attachments.resolve_inputs(context, session_id, ids)` returns
  canonical inline DSH images `{type:"image",media_type:"image/png",data:base64,name}`
  from the already bounded, safely read bytes. Four images maximum; 8 MiB per
  image and 16 MiB total. PNG/JPEG/GIF/WebP structures are checked; SVG, malformed
  image signatures and non-image impersonation fail explicitly.
- Non-images remain scoped `{type:"file",id,path,name,mimeType,size}` read-tool
  descriptors; folders also have `kind="folder"`. The host must register only
  these verified attachment paths with the DSH read-tool allowlist. Image records
  contain no local path. There is no URL fetch or frontend-supplied path.
- `/shell` is a real PTY with raw input, JSON resize `{type:"resize",cols,rows}`,
  legacy `ESC[RESIZE:cols;rows]`, and `{type:"cancel"}` (SIGINT). Dimensions must
  be 20–500 columns / 5–200 rows; input frames are capped at 64 KiB. Disconnect
  teardown cancels pumps, terminates the process group and reaps the shell.
- The Mac default uses `sandbox-exec`, an isolated HOME/TMPDIR, a minimal
  environment, system and discovered Node/Python runtime binaries, and no network access. Workspace reads/writes
  are allowed except sensitive files and internal service storage. Outside
  regular files and directory contents are denied; filesystem metadata and
  ancestor directories remain available for OS startup. No real login scripts,
  history, or inherited backend credentials are passed to the shell. Other
  platforms fail closed unless the host supplies an OS sandbox launcher.

## Memory, skills, MCP

`/memory` GET returns `{files: {MEMORY.md,USER.md,SOUL.md,AGENTS.md}, version}`;
PUT accepts a partial `files` dictionary plus the current integer version.
Only these four memory names are supported. `/mcp` GET/PUT manages
`{mcpServers: {name: config}}`; stdio command/args/env and HTTP url/headers
are declarative configurations. SSE is rejected because the runtime does not support it. `/runtime-context` PUT selects
`{memory:[names],skills:[names],mcp:[names]}`. Selected names must exist.

The complete `skills-api.ts` file subset is implemented below `/skills/files`:
list, tree, file/content, preview/download, versioned text, multipart upload,
mkdir, copy/move/rename, node deletion, whole-skill creation/deletion/move, and
ZIP import/export. ZIP input is bounded before extraction and rejects links,
traversal, duplicate paths and encryption. Imports require a root `SKILL.md`;
replacement is staged and swaps roots before returning success. No skill code
is run by these services and no production profile directory is modified.

## Read-only archive selection

POST `/archives/import` with `{path, source: "hermes"|"codex", title?}` explicitly
chooses UTF-8 JSON/JSONL fixtures. Relative paths use the authenticated workspace;
absolute paths must be under that workspace or resolver-provided `import_roots`.
There is no automatic history scan. Source bytes are SHA-256 hashed; source,
hash, original document/records, message IDs, timestamps and record indexes are
retained. Reimporting the same bytes/source in the same scope is idempotent.

GET `/archives?q=` lists/searches; the extra router offers the existing
profiles/sessions list, search, detail, messages (offset/latest), export and
latest-descendant contracts. These routes only read imported copies and never
modify original files. Unsupported transcript shapes fail explicitly.

POST `/archives/{id}/context` with `{indexes:[message_indexes]}` returns only the
explicitly chosen content/provenance for a **new** DSH context. POST
`/archives/{id}/new-session` additionally accepts `request_id` and calls the
runtime creation adapter with that selection. The callable equivalent is
`await services.create_session_from_archive(context, id, indexes, request_id)`.
The archive remains read-only and cannot become natively resumable.

## Schedules, execution, and delivery

The frozen Fleet v2 contract does not define a recurring scheduler endpoint.
Consequently these services persist schedule metadata and occurrence submissions
only; Fleet exclusively owns background tasks, dependencies, retries, attempts,
workers and deliveries. This is not a second task execution engine.

`/api/cron/jobs` GET/POST; `/{id}` PUT `{updates:{...}}` or DELETE;
`/{id}/pause`, `/resume`, `/trigger` POST; `/{id}/runs` GET.
`/api/plugins/workbench-cron` aliases and `/executions?job_id=` match `cron-api.ts`.
Use `request_id` or `Idempotency-Key` for idempotent creation, and
`Idempotency-Key` for repeated manual triggers. Without a client key, each
manual action receives a new server-generated request ID, as the existing UI
expects. Conflicting reuse fails with 409. A schedule without `session_id`
requires native `create_session`; `attach_to_session=true` requires an explicit
owned session ID.

Schedules accept five-field cron (ranges/lists/steps; Sunday 0 or 7),
`@every 5m`/`every 5m` intervals (10 seconds–366 days), and one-shot ISO timestamps
with explicit offsets. Timezone defaults to UTC and is always returned. Cron
uses timezone-aware UTC iteration: nonexistent DST times are skipped and both
folds are eligible. Day-of-month/day-of-week follow conventional OR semantics
when both are restricted. Intervals retain their original phase across downtime.
`missed_run_policy="skip"` drops occurrences at least 60 seconds late;
`"latest"` coalesces missed input into one occurrence under its original stable
request ID. Both advance to the next future time; there is no replay storm.
`repeat` bounds accepted submissions and disables the schedule at its limit.

Execution defaults to `background`: POST `/api/v2/tasks` with server origin,
`depends_on`, and stable `request_id`. Fleet tasks continue after HTTP disconnect
and without a Workbench heartbeat. `foreground` uses the durable DSH callback.
The occurrence is journaled **before** network submission and retried with the
same identity after timeout/restart, never with a new task attempt. Submitted
prompt/foreground context is retained for safe reconciliation. History records
submission receipts/task IDs and persisted delivery IDs, not invented task
completion. Private foreground context is excluded from HTTP journal responses.

Only local DSH delivery is supported. Script/no-agent/monitor execution,
model/provider/base-URL/toolset/skill overrides, continuity/context inheritance,
nonlocal delivery and failure-delivery overrides are rejected with clear 422s.
`workdir` must be the actual resolved workspace or is rejected. There is no
silent acceptance of these unsupported options and no Fleet model-policy write.

### Host lifecycle

No timer/process is started by router construction. The exact host hooks are:

```python
# Host startup, inside its running event loop:
services.start_background(load_authorized_context, interval=5)
# Host shutdown, before closing its native runtime/history store:
await services.stop_background()
```

`load_authorized_context(identity)` may be sync/async. The identity contains only
`user_id`, `profile_id`, and `project_id`. The host must reauthorize those IDs and
return the current complete trusted context, including actual workspace and
server Fleet routing; revoked access returns no context or raises 401/403.
The services persist scope identities and a workspace **fingerprint**, not raw
restored paths or credentials. Different identities or changed roots are rejected
before any submission/delivery. Never construct this loader from request JSON.

The loop calls `await services.poll_once(load_authorized_context, now=None,
limit=100)` to run due occurrences and drain each bound original session,
including those with no open browser tab. `services.enumerate_work()` lists the
persisted identities/fingerprints for host inspection. A cycle returns submission
receipts, delivery counts and explicit per-operation errors; private runtime
contexts are filtered. Lifecycle start is idempotent; stop cancels and awaits
its managed task. Host lifespan must call stop. Lower-level `run_due(context)`
and `drain_deliveries(context,session_id,limit=100)` remain callable separately.
An interrupted submission stays pending under its original request ID.

Pausing prevents future automatic submissions but does not cancel an accepted
Fleet task. Manual triggering works on paused schedules. Unconfirmed submissions
prevent schedule deletion until reconciliation.

POST `/fleet/deliveries/drain` with `{session_id,limit?}` is the explicit HTTP
alternative. Real Fleet delivery rows omit origin: the services use the five
server-derived query fields, then independently cross-check the task **and** its
`/collaboration` origin. Latest attempt identity comes from GET task response
`attempts[0].id` / `attempts[0].lease_epoch`, never an invented `task.current_attempt`.

Obsolete attempts are discarded and ACKed with the exact server-derived origin,
without updating DSH or any task attempt. The drain fetches again after ACK, so
`limit=1` advances past stale rows to current results. Valid results call native
`persist_delivery`; only `{persisted:true}` after history commit permits a local
receipt and Fleet ACK. Native persistence must atomically deduplicate keys for
the crash window between native commit and local receipt. Changed delivery
identity/content and missing attempt identity fail closed. Each cycle is bounded
to 100 pages, with the next lifecycle cycle continuing remaining work.

### Fleet proxy and credentials

`/fleet` and `/fleetd` are aliases for the same origin-enforced v2 adapter. They
provide config, task list/search/full-snapshot sync/detail, PATCH with revision
and If-Match, scoped lifecycle/review actions, collaboration, follow-up messages,
and task-validated artifact download. The console's title-only creation must be
augmented by the standalone host with its owned `session_id` and `request_id`;
missing context is rejected rather than assigned to an arbitrary viewed chat.
Unsupported Fleet actions fail explicitly, including upstream 501 responses.

The app's background hook is exactly
`await services.submit_background(context,message,request_id,session_id)` returning
`{task_id,status,origin}`. POST `/tasks/background` under the plugin prefix accepts
`{message,request_id,session_id}`; `profile_id`/`session_id` query parameters go
through the authenticated host resolver. Query/body session disagreement is a
403. Structured/attached background input is explicitly rejected, including
`attachmentIds`; it is never silently dropped. Use foreground DSH for images.

Creation sends a nonempty task-specific deliverable and acceptance, `kind="code"`,
a request-appropriate risk and `report_required=false` unless a report is
explicitly requested. The trusted context can provide `repo`/`repository`,
`fleet_machine`/`machine`/`device_id`, or a server-only `fleet` routing dictionary
with `machine`, `capability`, `kind`, `risk`. Workspace always comes from the
resolver. Frontend repository/device routing overrides are rejected. No model
or reasoning setting is forced; Fleet retains its global AGY policy.

Fleet creates in triage. The adapter persists the request fingerprint/task ID,
then POSTs `/tasks/{id}/dispatch`. Retries reconcile existing status, including a
lost dispatch response; they never redispatch running, completed or other released
tasks. Reused request IDs with changed input fail 409, including across restart.
The receipt reports actual Fleet state, which can be blocked if no suitable
worker is available. Upstream 400 errors retain their bounded machine code, such
as `deliverable_required`, without exposing upstream text or secrets.

`services.fleet.create(context, payload)` preserves `execution` selection;
`followup(context, task_id, message_id, text)` keeps the original task origin.
Worker-side `worker_messages(context,task_id,attempt_id,epoch)` and
`ack_worker_message(context,task_id,message_id,attempt_id,epoch)` implement the
frozen attempt-bound message/ACK paths; stale attempts fail before forwarding.

The default `FleetHTTP` reads server `FLEET_URL` and `FLEET_TOKEN` lazily, and
uses the separate `FLEET_REVIEW_TOKEN` for review actions. Remote plain HTTP
requires explicit server `HERMES_WORKBENCH_FLEET_ALLOW_HTTP=1`; redirects are not
followed. URLs/credentials are never accepted in browser task payloads. Hosts
using an existing token-file contract should inject
`FleetHTTP(url, token_provider, review_token_provider)` through
`services.fleet.transport`, or supply `fleet_request`. Only the **host** credential
provider opens its approved file; these modules never do so. Secrets/upstream
URLs are not included in configuration responses. No global Fleet model policy
is modified.

## Validation and remaining integration

Run the focused Python suite with `requirements-dev.txt` in an isolated uv
venv. The normal run uses temporary workspaces, deterministic native callback
adapters and a Fleet contract fake. The opt-in
`tests/test_standalone_services_real_fleet.py` additionally requires an explicit
`WORKBENCH_TEST_FLEET_URL` and `WORKBENCH_TEST_FLEET_TOKEN_FILE`; it accepts only
the user-authorized isolated loopback test daemon. The credential stays inside
its Authorization provider, never stdout/logs/source. It creates one uniquely
owned shell-routed no-file-change probe, registers only its private probe worker,
and deterministically exercises leases/failure/retry/outbox over real HTTP,
without starting an AI worker or model call. It cancels its own task and marks
its own worker offline during cleanup, without listing/mutating others' tasks.

Validated: **79 focused tests plus one real-daemon test**, including real triage
creation/dispatch, lost dispatch receipt, restart idempotence, actual
`attempts[0].lease_epoch` and originless delivery shapes, stale advancement with
`limit=1`, and current delivery persisted to an independent SQLite history
receiver before ACK. Other coverage includes file/scope/WS protection, real Mac
PTY and background-child cleanup, `git status`/Node/Python usability, image inline
encoding/count/size/type limits, profile config/MCP rejection, skills and archive
editing/import, lifecycle reauthorization/start/stop, schedules/DST/restart and
foreground accepted-versus-completed semantics.

**Host composition still belongs to the app/runtime owners:** mount both routers,
combine native/archive session lists, wrap native session/history callbacks,
register non-image attachment read descriptors, and call lifecycle startup and
shutdown with a reauthorizing context loader. The real Fleet contract is verified;
actual DSH inference and AI-worker execution are intentionally not started by
this suite. No deployment, daily service restart, production task/configuration,
real user history, production credential or global model-policy change occurred.
