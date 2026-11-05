# Review session targets

The review drawer resolves a task's native `conversation_id` against the authenticated
user's exact Workbench profile. The returned session ID can differ from the native
thread ID. A task's local flag, completion status, or Workbench URL is never evidence
that a session exists or that the operator can access it.

Configure `HERMES_WORKBENCH_LOCAL_DEVICES` as a comma-separated list of this instance's
local device aliases (for example `studio`). Otherwise the requested device must
match the session's recorded `execution_node_id`. Do not list remote devices as local.

For sessions owned by another Workbench, configure the controller's server-only
`HERMES_WORKBENCH_SESSION_DEVICES` JSON map:

```json
{"nas":{"url":"https://nas.example.ts.net","proxy_secret":"<remote trusted proxy secret>"}}
```

The remote instance must run the session-target endpoint from this change and permit
the forwarded authenticated user through its existing trusted-proxy gate. Its device
alias must match the stored execution node or its own local-device configuration.
The controller checks the remote user/profile-scoped mapping before returning a chat
link. Remote HTTPS addresses come only from this administrator map, never task fields;
redirects during lookup are rejected. Keep secrets out of task descriptions and browser
configuration. The configured URL must also be reachable by the operator's browser.
An unavailable remote, unknown device, unmapped thread, or wrong profile leaves the
entry disabled. Archived sessions explicitly show their archived state.

Fleet v1 artifact metadata and external PR/commit/URL references are shown in the
review drawer. Artifacts without an external URL remain visible, but no download is
offered because this adapter has no authenticated v1 binary download route. A declared
deliverable requirement without submitted evidence is explicitly labeled as such.
