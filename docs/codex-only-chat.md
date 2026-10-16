# Workbench chat provider policy

Workbench creates new web conversations through the Codex app-server only.
Claude Code and Pi remain available from the execution node's terminal, and
their existing transcripts may be indexed or displayed as history when a
history adapter is present. Workbench does not create, continue, steer, or
send messages to those sessions from the web chat.

This boundary keeps subscription credentials and session ownership with the
CLI that created them. A user who wants to continue a Claude Code or Pi
conversation must open the terminal on its execution node and use the native
CLI. The sidecar advertises this contract through `/api/plugins/workbench/capabilities`:

- `newChatProviders` is `['codex']`;
- `historyOnlyProviders` is `['claude', 'pi']`;
- `supportsExternalContinuation` is `false`.

The profile model editor still exposes authenticated providers. A provider
such as DeepSeek may be configured when it is compatible with the Codex
interface; this does not add a separate Claude/Pi web runtime.
