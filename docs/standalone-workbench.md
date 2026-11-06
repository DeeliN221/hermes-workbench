# Standalone Workbench

Build both entries with `pnpm build:standalone` and `pnpm build`. Start the isolated
host with `pnpm start:standalone --port PORT` after setting an explicit workspace,
separate state directory and DSH bridge URL. See the sanitized configuration in
`deploy/standalone-local.env.example` and `deploy/standalone-proxy.env.example`.
Neither entry starts a legacy agent runtime. The plugin entry remains available.

Local mode binds loopback and prints a reusable browser bootstrap credential.
Trusted proxy mode requires the configured public origin, allowed hosts, private
proxy secret and allowlisted identities. Every HTTP and WebSocket request is
reauthenticated; a local bootstrap cookie cannot bypass proxy authentication.
Forwarded headers never establish the public origin. Proxy users have separate
physical workspace roots and durable profile/project/session namespaces.

`GET /health` requires the same authentication as the application APIs. It returns
`{"status":"ready","runtime":"dsh"}` only when built assets, domain services and
upstream DSH readiness are available; otherwise it returns 503.

Background execution requires `WORKBENCH_FLEET_URL` and
`WORKBENCH_FLEET_TOKEN_FILE`. Review actions additionally require
`WORKBENCH_FLEET_REVIEW_TOKEN_FILE`. Credential files must be private (0600).
Optional `WORKBENCH_FLEET_MACHINE` and `WORKBENCH_FLEET_CAPABILITY` are administrator
routing choices, never browser inputs. A background receipt links to the actual
task and keeps the foreground conversation usable. Follow-ups target that task;
terminal conflicts preserve the unsent text. Lifecycle polling continues while
the browser is closed.

Fleet results enter the original DSH session as distinct persisted notifications,
with source, task, attempt and epoch identities. The host acknowledges the Fleet
outbox only after the bridge confirms durable notification storage. This does not
submit a new model prompt. Scheduled foreground input uses a stable request ID
and queries its durable receipt; HTTP acceptance or inference completion alone
cannot acknowledge a scheduled submission. Unavailable capabilities remain
visible errors, without synthetic success.

Profiles configure actual new-session model and instruction context. Memory,
selected skills and MCP settings use the domain service store. Files use scoped
relative paths and versioned writes. Attachment descriptors come only from the
service resolver; the host does not reread client paths. Imported transcripts
remain read-only and explicitly selected messages become reference context in a
new DSH session.

The isolated protocol fixture tests transport/reconnect/error behavior only.
They are not real DSH or Fleet end-to-end evidence. Live validation must use the
actual bridge and an explicitly authorized Fleet worker/workspace.
