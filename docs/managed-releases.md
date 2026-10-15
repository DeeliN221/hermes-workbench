# Development and managed instances

## Development instance

Record the authoritative source and existing plugin dashboard as absolute paths
in a local JSON policy with `source` and `target` fields. Keep this file outside the
repository. Set `HERMES_WORKBENCH_DEV_POLICY` to its location, or save it as
`$XDG_CONFIG_HOME/hermes-workbench/development.json` (default:
`~/.config/hermes-workbench/development.json`). An explicitly configured missing
policy is an error; `deploy:dev` always requires a policy.

Run `npm run deploy:dev` in the recorded source directory to type-check, test,
build, verify provenance, and publish browser resources.
Do not create another development checkout or build from an old recovery copy.
Other installations can use the generic publisher described in `deploy/README.md`.

The thin loader remains stable. Publishing verifies installed hashes and keeps
rollback backups; browser loading and interaction still need validation. Backend
changes take effect after the relevant development service restarts. Wait for
active tasks to finish before a backend restart; never restart your own container
while it is executing a task.

## Managed instance

Do not mount development source. Keep user data, workspace, and credentials isolated
from development. `WORKBENCH_RELEASE_HOME=/opt/data/workbench` enables full updates:

```text
/opt/data/workbench/
  bootstrap/             administrator-installed supervisor
  releases/<version>/    verified, read-only release
    plugin/dashboard/    loader, browser assets, manifest
    sidecar/dashboard/   matching backend and build assets
    release.json         version, commit, runtime_abi
    release-files.json   archive file hashes
  current -> releases/<version>
  update.json            recoverable update state
/opt/data/plugins/dist/workbench/dashboard -> /opt/data/workbench/current/plugin/dashboard
```

Settings → Version switching lists GitHub releases and logs. Downloads start only
on user request. The updater verifies SHA256SUMS, version, file hashes, and runtime
ABI; it rejects path traversal, link members, and oversized archives. Switching
is blocked while Codex tasks or terminal connections are active. The supervisor
restarts only the Workbench API, leaving Hermes and Codex App Server running.

One atomic version pointer selects matching browser and backend files. Success
requires the backend's healthy version to match. Failed startup restores the old
pointer and backend; an interrupted update also recovers the previous version on
startup. The UI polls through brief disconnections and resumes status tracking
after refresh. Previous full releases remain available for rollback. Legacy
interface-only caches are not full-version rollback targets.

`runtime_abi=1` describes the supported Python environment and supervisor protocol.
Breaking base dependencies or supervisor compatibility requires an ABI bump and an
administrator-managed environment update. A frontend package must not silently
install system dependencies, update Hermes, or restart an entire container.

## First-time managed migration

1. Wait for tasks to finish and disable `sessions.auto_prune` in affected Hermes
   profiles. Back up databases, settings, credentials, session transcripts, raw
   requests, Compose configuration, and the installed plugin directory.
2. Download a full GitHub release and SHA256SUMS; verify origin and hashes.
3. Stop the managed instance's Workbench. Run `scripts/install-managed-release.py`
   with `--archive`, `--sha256`, `--version`, `--uid`, and `--gid`. The first install
   preserves the original dashboard backup.
4. Start Workbench with `bootstrap/combined_runtime.py` and set
   `WORKBENCH_RELEASE_HOME`. Remove development-source mounts from that managed
   Workbench and Hermes instance.
5. Recreate only services whose mounts changed. Verify image, identity, data
   mounts, healthy version, plugin links, asset hashes, database records,
   transcripts, and the authenticated Dashboard route. Restore saved configuration
   and plugin assets if validation fails.

GitHub Actions publishes releases without accessing deployment hosts or installing
updates. Host-specific paths, identities, and operational commands stay outside the
public repository. Publishing and user installation are separate steps.
