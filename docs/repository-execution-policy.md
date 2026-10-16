# Repository execution policy

Workbench uses the same chat and session model for personal work and repository work. A session carries a `session_scope` field so an execution node can keep raw work history without silently changing the controlling instance's personal data.

`personal` is the legacy default. It may use the compact cross-session memory index and the existing Hermes projection hooks.

`repository` keeps the capabilities needed to run a long task and recover its transcript:

- local context compaction remains enabled;
- the node keeps the raw transcript and its normal session database;
- the node does not receive the controlling instance's cross-session memory instructions;
- completed Codex history is not projected into Hermes review or learning queues;
- future cross-session recall, memory writes, and Kanban projection belong to the controlling Workbench instance.

The `execution_node_id` field identifies the process that owns execution. It is metadata for routing and later event replication; it is not a second session identifier. A complete remote session identity is `execution_node_id + profile + session_id + workspace_path`.

This first policy layer deliberately does not move session storage to shared files or change the existing remote Gateway transport. The execution node remains the single writer for its raw transcript. A later synchronization layer can expose read-only history or an append-only event stream to the controlling instance.
