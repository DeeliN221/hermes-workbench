# Hermes compatibility patch

This directory keeps the Hermes-side changes used by Workbench in the same
public repository as the plugin. It avoids maintaining a second application
fork. It is an **optional, pinned compatibility layer**, not an automatic
upgrade or a requirement for every Workbench installation.

## Scope

- Resolve plugins stored in grouped installation directories.
- Preserve profile identity when aggregating achievements and opening sessions.
- Protect desktop connection-registry baselines from accidental writes.
- Retry Codex startup, track activity during scheduled runs, and handle managed
  MCP approvals and Kanban file handoffs.
- Support explicit shared Codex authentication and per-board assignee defaults.

The patch includes source changes and regression tests. Hermes's Kanban plugin
maintains its browser entrypoint directly under `dashboard/dist`; that small
entrypoint change is included. Workbench's own generated bundle is not included.

## Apply to a separate Hermes checkout

The supported base is the public upstream commit
[`a55c972e09177e4db3934915e329993858b247d6`](https://github.com/NousResearch/hermes-agent/commit/a55c972e09177e4db3934915e329993858b247d6).
Use a clean checkout at that exact commit. Do not apply to a running service,
a read-only installation, or an arbitrary newer upstream revision.

From this Workbench checkout:

```sh
# Check compatibility without changing the target.
python3 integrations/hermes/manage.py /path/to/hermes

# Apply after the check succeeds; this does not commit or restart anything.
python3 integrations/hermes/manage.py /path/to/hermes --apply

# Check the resulting source against the manifest.
python3 integrations/hermes/manage.py /path/to/hermes --verify
```

The tool checks the patch checksum, exact base, and clean working tree before
applying. It verifies every resulting file against `manifest.json`. Review and
commit the result in your Hermes checkout before building or deploying it.

`HERMES_CODEX_AUTH_FILE` is opt-in. Leave it unset to retain normal Hermes
authentication. If enabled, point it to a credential file outside Git, restrict
access to the intended service users, and keep login/recovery material in your
password manager. No credentials, account names, or deployment settings are
distributed here.

## Validation and updates

The patch was reconstructed from the public base using a separate Git index;
all 37 resulting files matched the manifest. The runtime-related Python tests
were previously validated separately (91 tests), including MCP 2.0 handoff
tests. See `VALIDATION.md` for the current check results and limitations.

To update the layer, start from a new upstream base in a separate Hermes
checkout, re-evaluate each change, regenerate the patch and manifest, and run
the relevant upstream tests. Remove changes already supplied by upstream.
Never use this old patch as an unattended upgrade mechanism.

Historical prototype interfaces, machine-specific deployments, and private
repository history are not part of this compatibility layer.

The patch is distributed under the MIT license; see `LICENSE-Hermes.txt` for
the upstream copyright and license notice. Workbench itself retains its own
license.
