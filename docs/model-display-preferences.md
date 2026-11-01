# Durable model display preferences

Model visibility and chat display names are Workbench preferences, independent of
Codex configuration and the backend model catalog. The settings page and chat
selector read the server on opening. A failed read is reported, not replaced by
browser defaults. Saves disable editing until acknowledged; errors restore the
last confirmed settings and show a failure message. A revision conflict requires
reopening the settings page before retrying.

## Storage and identity

Reuse the existing plugin-owned database:
`<dashboard.workbench.root>/.hermes-workbench/session-organization.sqlite3`, table
`model_display_preferences`, primary key `(owner, profile)`. The root follows the
existing resolver: configured `dashboard.workbench.root`, otherwise `/opt/data`
when present, otherwise the service working directory. Keep the service working
directory stable if using that last fallback. No new configuration system or
external database is introduced. The existing directory/file permissions are
0700/0600. Database transactions serialize migrations and revisions serialize edits.

In the independent service, `owner` is `user:<normalized Remote-User>` supplied
by the existing verified proxy gate. Raw browser headers and query parameters
cannot select an owner. Legacy embedded plugin hosting exposes no authenticated
account identity to this router: it uses `instance-owner`, inheriting that host's
single-owner authentication boundary. Multi-user installations must use the
independent service with its trusted proxy; embedded hosting does not promise
account isolation. Profiles, including aliases, are independent within an owner.

## Migration and defaults

`GET /api/plugins/workbench/model-display?profile=...` returns the stored record,
or null without creating defaults. Only then does the browser submit
`POST /api/plugins/workbench/model-display/migrate?profile=...`. A transaction
inserts only if absent and returns the winning record if another browser arrived
first. An existing empty preference object is still initialized; it is never
remigrated. `PUT` requires the last revision and returns 409 for stale edits.

The initial visible set is `gpt-6-astra`, `gpt-6-luna`, `gpt-6.1-terra`, and
`deepseek/deepseek-flash`, with aliases `astra`, `luna`, `terra`, and `ds`.
An explicit visible set also hides newly introduced models until selected.

Existing `workbench.model-visibility.v1:<profile>` overrides the initial visibility
policy. Its hidden-list semantics are retained, including `[]` meaning show all
and visibility of future models. This avoids changing existing user choices.
Aliases merge defaults, the current profile's `workbench.model-aliases.v1:<profile>`,
then `workbench.model-aliases.v2`; newer values take priority. Other profiles' v1
keys are not imported into this profile. Explicit empty alias maps retain original
model names. Malformed keys fall back independently. Browser keys are retained
unchanged as a read-only migration source; they are never consulted once a server
record exists. No account data is cached in the unscoped legacy keys.

The first browser initializes each user/profile. To import richer existing local
settings, first open that profile from the browser holding them. Later browsers
cannot silently overwrite the first migration. Browser settings unavailable to
this checkout cannot be pre-imported by a pull request.

## Backup and rollback

Use SQLite's online backup API (or `.backup` command) on the existing database;
copying only the main file while WAL writes are active is not a consistent backup.
The backup includes the other existing plugin tables. Normal version rollback
leaves the additive table intact; old code ignores it and uses the retained local
keys. Preferences changed after this migration are not synchronized back to the
old browser-only implementation. Reinstalling the fixed version reads the saved
server preferences again. Do not delete the whole database to reset model settings.
For a deliberate migration reset, back up first, then delete only the chosen
`(owner, profile)` row; the next browser visit initializes it again.

This change does not deploy, restart a service, or modify a release pointer.
