# Remote session replication

A Workbench execution node is the single writer for its raw session history. A controlling Workbench can read that history through the authenticated `GET /api/plugins/workbench/codex/session/replication` route.

The controller sends the last `nextCursor` as `after` and may safely retry a batch. Events are ordered by the node's durable sequence, and the response includes the complete identity needed to keep sources separate:

```text
executionNodeId + profile + sessionId + sessionScope + workspacePath
```

The route is deliberately read-only. It does not acknowledge, mutate, compact, delete, or project a node transcript. The controller owns its local cursor and may later derive summaries, memory entries, or Kanban items from the replicated events.

Runtime context compaction remains a node responsibility. Replication carries the resulting durable event stream; it is not a second live agent controller and must never replay user turns.

If a node restarts, the controller resumes from its last committed cursor. If the same batch is returned again, event sequence numbers make the retry idempotent.
