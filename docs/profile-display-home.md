# Profile display names and the all-profile home

Hermes `default` resolves to the configured Hermes root. Named profiles resolve
under `profiles/<internal-name>`. Workbench does not rename either identity,
move files, change the active CLI profile, or copy sessions.

In **Profiles**, edit **Display name** and save. An empty value restores the
existing localized fallback. Aliases are per authenticated Workbench user
(or the instance owner without proxy identity), shared by browsers using that
identity. Internal names remain visible in aggregate badges to distinguish
profiles even when display names or project names match.

Aliases use the existing plugin database:
`<Workbench root>/.hermes-workbench/session-organization.sqlite3`, table
`profile_display_names`, keyed by `(owner, profile)`. The existing authentication
gate protects GET/PUT `/api/plugins/workbench/profile-display`; no new external
service or browser-local preference store is introduced. The database uses the existing Workbench root resolver: request override,
Hermes `dashboard.workbench.root`, `/opt/data` when present, or the backend working
directory. Profile identity validation separately uses `HERMES_WORKBENCH_HERMES_HOME`,
then `HERMES_HOME`, then `/opt/data`. Saving an alias validates the target profile and never creates its home.

Home sends messages and creates new conversations in `default`, regardless of
the selected profile. Failed sends retain the session and request identity for
retry. The profile switcher remains available for profile-specific work.

Home reads the installed roster, recent Codex/Hermes sessions, and Codex project
folders through their existing scoped GET APIs. Projects sort by the latest
loaded member activity; empty projects remain visible. The recent session window
is still 30 days and at most 24 sessions per profile. This is a recent-work view,
not a complete project archive. Project membership and session identity retain
the owning profile. Clicking a member or card opens that profile before the chat;
rename, send, and delete continue through the existing scoped chat APIs. Loading
the overview performs no writes. Explicit mark-read actions remain scoped to
each selected row. Failed profile reads show a retryable partial-error message;
failed sources discard cached cards rather than presenting stale accessible data.

Validation includes backend restart/owner isolation, unknown profiles, unauthenticated
access, alias reset, same-ID projects and sessions, default send retries, scoped
rename/delete/send, empty and denied lists, and Playwright desktop (1440 x 900)
and mobile (390 x 844) flows. Browser tests use a local mock host, not a production
Hermes instance. `tests/browser/profile-home.mjs` is included in `pnpm test:browser`.

Rollback: revert the feature commit and rebuild using the normal release process.
The extra table is additive and ignored by older versions; leave it in place to
preserve aliases for re-upgrade. To reset a name without rolling back, save an empty
display name. Never delete the shared organization database: it contains unrelated
session metadata. This change does not deploy or migrate existing profile data.
