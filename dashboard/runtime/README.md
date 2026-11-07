The bridge owns only this directory and a private state directory. It uses DSH `0.2.2-rc.1`, official Connection + Remote/Mux, and the existing explicit local Magpie provider. Node >=24.9 is required.

Start the prepared Mac runtime:

```sh
node dashboard/runtime/bridge.mjs
```

Defaults: bridge `http://127.0.0.1:38472`, managed native Host `127.0.0.1:38471`, state `~/.local/state/workbench-dsh-mac/runtime`. The bridge supervises its native Host and resumes owned sessions after restart. It supports migrated `profiles/web/cordis.patch.yml`; the original `~/.dsh` is never edited.

All routes require backend `Authorization: Bearer …`. The bridge reads or creates an owner-only `bridge.token` in its private state. Override with `WORKBENCH_DSH_BRIDGE_TOKEN_FILE`. Configure the app host's **server-side** `WORKBENCH_RUNTIME_BRIDGE_TOKEN_FILE` to the same file. Never expose the file contents or native Host cookie/token to the browser. The bridge prints only the token file's path.

Dependencies installed in `dashboard/runtime` resolve by default; the prepared private state installation is the fallback. `DSH_MODULE_ROOT` explicitly selects an isolated installation.

`WORKBENCH_DSH_STATE`, `DSH_MODULE_ROOT`, `DSH_HOME`, `PORT`, `DSH_HOST_PORT`, `DSH_PROVIDER`, and `DSH_MODEL` override deployment inputs. The default model is `magpie-responses` / `codex/gpt-6.1-sol`. For an existing native Host, supply `DSH_HOST_URL` and `DSH_HOST_LOG` (or `DSH_HOST_TOKEN_FILE`); that Host must have this directory's native context extension installed. `WORKBENCH_DSH_ALLOWED_ORIGINS` is an optional comma-separated list for trusted host proxies; Host/Origin checks remain enforced.

Routes under `/api/runtime`:

- `GET capabilities`, `GET models`, `GET/POST sessions`.
- `GET sessions/:id/snapshot`, `GET sessions/:id/events?cursor=…`.
- `POST sessions/:id/messages`, `POST sessions/:id/cancel`, `POST sessions/:id/model`.
- `GET sessions/:id/requests/:request_id`, `POST sessions/:id/interactions/:id`.
- `POST/GET sessions/:id/deliveries`, `GET sessions/:id/deliveries/:idempotency_key`.

Lists, snapshots, receipts and mutations accept `profile_id`, `project_id`, and `user_id` query filters. Snapshots include Session ownership. IDs from another scope return 404. Only bridge-owned sessions are listed.

Message input accepts `request_id` or `client_request_id`, `mode: queue|steer`, optional text, and up to four images `{type:'image',media_type,data,name?}`. `mediaType`, `mime_type` and `base64` are aliases. Images require canonical base64 and matching PNG/JPEG/WebP/GIF signatures; limits are 8 MiB/image, 16 MiB aggregate and 24 MiB HTTP body. Native DSH validates/normalizes the image and persists opaque references. Workspace references also accept `{type:'file'|'folder',path,name,mimeType?}`. Paths may be relative or absolute inside the Session cwd; canonical targets must be strict descendants. URLs, root/outside paths, wrong types and escaping symlinks (including directory descendants) are rejected. Directory scans stop after 2048 entries / depth 32; `WORKBENCH_DSH_REFERENCE_MAX_ENTRIES` configures the entry bound. References become explicitly attributed relative-path text for normal native read/list tools; no file bytes or invented upload receipts are sent. Reference metadata is persisted by request ID and restored on user messages and inbox items. Targets are checked again immediately before dispatch/replay. Generic native file-upload receipts and timed questions remain unsupported.

Message `accepted:true` is never turn completion. `durable:true` requires native persistence flush plus an exact `rpcId` match in the persisted user/inbox journal and a fsynced bridge receipt. `native_evidence` names its cursor/event type. Unconfirmed acceptance returns `durable:false,retryable:true`, retaining its intention. Receipt GET actively retries confirmation and local fsync without sending another native prompt. Retry POST with the same ID remains deduplicated. Cancelling preserves the native inbox; a new message resumes retained input.

Every SSE connection has a dense increasing `sequence`. A reconnect sends an authoritative full `snapshot`; native durable `cursor` is independent of sequence. Transient `assistant.delta` has `{message_id,delta,content,transient:true}` and no cursor. Commit IDs are native IDs; `attempt_id` / `data.stream_message_id` correlate the transient draft. Exactly one derived frame carries each native event's durable cursor. Other derived state/error frames remain visible without reusing that cursor. `state.data.tool` contains call/result cards; restored `snapshot.tools` preserves them, and tool results also appear as tool-role messages. Interaction data includes `id`, `request_id`, `kind`, and question/command/prompt fields. Expired generation IDs cannot answer a new request.

Fleet notifications use the delivery endpoint with full trusted `user_id`, `profile_id`, `project_id` query scope and body `{source:'fleet',epoch:1,idempotency_key,task_id,attempt_id,kind:'result'|'question'|'notice',content,metadata?,wake_supervisor?}`. Metadata must be a bounded JSON object. Equal keys/payloads return the same `{delivery_id,session_id,idempotency_key,accepted:true,durable:true,status:'persisted'}` receipt; changed payloads (including wake policy) return 409. Distinct attempt keys are retained separately. Records publish only after file+directory fsync, emit cursorless `delivery.received` with `data.delivery`, and restore in `snapshot.deliveries`. The bridge does not update Fleet task state.

The authenticated standalone host sets `wake_supervisor:true` only after validating origin and the current task attempt/epoch. Notification and native prompt intent share one durability barrier before Fleet ACK. The bridge queues that prompt using a reserved stable request ID (`workbench-delivery:…`), retries uncertain acceptance with native deduplication, and resumes after restart without a browser connection. Native `user/message` consumption assigns the request to its turn; a matching `turn/end` plus nonempty assistant output is required for `supervisor.status:delivered`. Failed, cancelled or empty replies retain a visible automatic receipt, without retrying execution. Pending replies expose a fallback receipt after 60 seconds. Internal prompt text is hidden from user messages and the inbox. `delivery.updated` refreshes the persisted supervisor status; it never masquerades as assistant output. Low-level deliveries without the flag, and historical records, remain notification-only.

Create requests accept a stable `request_id` (`client_request_id` alias) with trusted `user_id`, `profile_id`, and `project_id`. Equal requests in that ownership scope share one durable native identity; changed normalized payloads return 409. Omit the ID for a fresh session. Recovery checks the native registry and resumes an existing nonblank Session rather than calling native create again.

`GET models` exposes route-specific `reasoning.efforts` and `defaultEffort`. Create and `POST sessions/:id/model` accept `reasoning_effort`; unsupported efforts return 400 and `service_tier` returns 422. Model mutation returns the native `selected` value plus its public SessionRef. Snapshots include actual `model`, `provider`, and optional `reasoning_effort`, reconciled from native durable projections so a lost metadata acknowledgement cannot display a stale choice.

Create input may include trusted `user_id`, `agent_preset: standard|minimal`, and `runtime_context: {workspace,memory,skills,mcpServers}`. Context is immutable per created native preset. Memory sections are literal (`interpolate:false`); skills are staged into that owner/profile/context's private root with default roots disabled. Only selected bundle resources are linked. Stdio and HTTP MCP map to native `dsh-mcp-client`; legacy SSE is rejected with 422. MCP commands/headers/env are trusted backend inputs and never appear in public receipts or snapshots. Incoming plugin names, JS expressions, or Cordis YAML are rejected.

Validation:

```sh
node --test dashboard/runtime/test/*.test.mjs
# Real native DSH protocol with a localhost inference fixture; no real keys:
node dashboard/runtime/scripts/supervisor-probe.mjs --local-fake-inference
node dashboard/runtime/scripts/probe.mjs --real-local-inference
node dashboard/runtime/scripts/context-probe.mjs --real-local-inference
node dashboard/runtime/scripts/deny-probe.mjs --real-local-inference
# Fresh private state and ports 38572/38571; leaves the parent bridge untouched:
node dashboard/runtime/scripts/create-model-probe.mjs --real-local-inference
# Separate ports 38672/38671; file reads, Fleet delivery, schedule durability/restart:
node dashboard/runtime/scripts/files-deliveries-probe.mjs --real-local-inference
# Stop the test bridge first; this probe owns and restarts both processes:
node dashboard/runtime/scripts/restart-probe.mjs --real-local-inference
```

Probes use private state, produce private JSON results and never print credentials. The restart probe simulates a lost acceptance acknowledgement on its own request to test native deduplication. Public tests require no DSH installation or credentials. For a new private installation, copy this directory's package/lock/build policy into the private install directory, run `pnpm install --frozen-lockfile`, then run `scripts/setup-private.mjs --use-existing-local-gateway` once with a fresh isolated home. No global installation is needed.

Fresh-home setup parses dotenv and copies only the exact configured `MAGPIE_GATEWAY_KEY` binding into an owner-only file. It never copies other environment entries, comments, or source credentials wholesale. It preserves the configured loopback gateway URL without assuming a particular port, refuses nonempty destinations, and reports credential/setup failures without source text.
