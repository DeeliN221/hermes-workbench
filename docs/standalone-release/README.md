# Standalone candidate release

This candidate runs Workbench with its standalone Python services and a managed
DSH 0.2.2-rc.1 bridge. It is independent of historical Hermes/Codex releases.
Those archives remain read only. No production switch, database migration,
provider request, Fleet connection or credential discovery is part of packaging.

```text
external 0600 JSON configuration
             |
        supervisor ---- private lock, status and logs
             |
             +-- bridge (loopback) -- native DSH Host (same owned process group)
             |
             +-- Python app (loopback) -- standalone browser assets
```

## Build from a committed source

Select Node >=24.9 independently of any existing Node 22 development service.
Use Python >=3.13 and the repository's pinned pnpm version. Do not install a
global runtime or reuse a private provider home. Commit all source changes first;
tracked changes and untracked source cause packaging to fail. Ignored local
files are never exported. The build uses a fresh Git export of exactly HEAD,
installs frontend dependencies with the frozen lock and runs
`pnpm build:standalone`. Existing working-tree dist files are never trusted.

```sh
python3 scripts/package-standalone.py --output /tmp/workbench-candidates
```

The archive contains standalone backend/domain modules, runtime sources, package
and lock/build policy, frontend assets, pinned Python requirements, supervisor,
generic templates, project notices and bundled browser dependency license texts.
No node_modules, private service implementation, user workspace or state is
included. License collection visits recognized license/notice names only at
bounded installed package roots; a missing bundled dependency license fails the
build. PlantUML license and Viz.js's embedded notices are retained unchanged.
Runtime dependencies are installed separately and remain subject to their
upstream notices; retain those notices in the external installation.

The manifest records exact source commit/tree, candidate identity, interpreter
requirements, DSH pin and every packaged file's SHA256 except the manifest
itself. `SHA256SUMS` authenticates archive integrity against a separately trusted
checksum; internal hashes alone are not a publisher signature. Extraction and
relocation do not depend on the original checkout's absolute path.

```sh
cd /tmp/workbench-candidates
shasum -a 256 -c SHA256SUMS
tar -xzf workbench-standalone-COMMIT.tar.gz
python3 workbench-standalone-COMMIT/scripts/start-standalone.py --verify
```

## Prepare isolated dependencies and private configuration

Keep the extracted candidate immutable. Create a separate, versioned staging
installation for runtime dependencies and a Python virtual environment outside
the candidate. Replace the example paths and COMMIT before running commands.

```sh
mkdir -p /srv/workbench/runtime-install
cp /srv/workbench/releases/COMMIT/dashboard/runtime/package.json /srv/workbench/runtime-install/
cp /srv/workbench/releases/COMMIT/dashboard/runtime/pnpm-lock.yaml /srv/workbench/runtime-install/
cp /srv/workbench/releases/COMMIT/dashboard/runtime/pnpm-workspace.yaml /srv/workbench/runtime-install/
pnpm --dir /srv/workbench/runtime-install install --frozen-lockfile
uv venv --python 3.13 /srv/workbench/python
uv pip install --python /srv/workbench/python/bin/python -r /srv/workbench/releases/COMMIT/scripts/start-standalone-requirements.txt
```

Choose pnpm explicitly for the external runtime installation; the frozen runtime
lock and its build policy are authoritative. A module_root must be the actual
installation directory containing package.json and node_modules. It is passed as
DSH_MODULE_ROOT. When omitted, the supervisor selects the candidate's
dashboard/runtime installation; using an external module_root keeps candidate
hash verification valid. Native dependencies are platform specific and are
never copied from unrelated node_modules directories.

The operator must configure a fresh isolated DSH_HOME using the published DSH
package setup instructions, with explicit provider/model names. Configure its
settings.yaml (or profiles/web/cordis.patch.yml) and .env as owner-only 0600 files.
Do not point to the original default DSH home or automatically copy its settings.
Provider credentials stay in this external home and are never inspected by the
packager or CI. The supervisor checks file ownership/permissions without parsing
these provider files. Ambient provider keys, Python paths, Node options and proxy
variables are not forwarded. The chosen interpreters' directories and standard
system executable directories form the child PATH.

Copy config.local.json.example to an external file, replace all example paths,
set the chosen executables/provider/model and chmod the config to 0600. State,
app home, workspace, isolated DSH home and token files must be outside the
candidate. The bridge creates its stable 0600 token if absent; both bridge and
app use that same configured file. Private directories use 0700, logs/status use
0600. The supervisor prints no bootstrap URL or product token. App startup output
is retained only in the private app.log. Rotate logs with the stack stopped.

```sh
python3 /srv/workbench/releases/COMMIT/scripts/start-standalone.py --config /etc/workbench/standalone.json --check
python3 /srv/workbench/releases/COMMIT/scripts/start-standalone.py --config /etc/workbench/standalone.json
```

Run the supervisor under an operator-managed service/process manager, in the
foreground of that manager. SIGTERM/SIGINT stop the owned stack. A lock prevents
duplicate supervisors for the same state directory. Stale PID records never
authorize killing another process. The status command reports starting, ready,
restarting, failed or stopped; --check validates prerequisites without starting
the stack or claiming readiness. No signals are sent by --status.

```sh
python3 /srv/workbench/releases/COMMIT/scripts/start-standalone.py --config /etc/workbench/standalone.json --status
```

The bridge must report authenticated capabilities with status=ready and
runtime=dsh before the app starts. Local app health logs in through the bootstrap
API using a CookieJar, then requires authenticated GET /health with the same
ready/dsh contract. HTTP 200 or an HTML shell alone is insufficient. A child exit
or readiness failure invalidates status, stops both process groups, then retries
the whole stack up to max_restarts (default two). Exhaustion exits 1. Forced
bridge termination still leaves its Host in the owned group for cleanup.
External Host mode is unsupported by this supervisor.

## Local development and trusted proxy

For development, build the frontend and use --development with an explicit local
configuration. Source mode deliberately has no archive manifest guarantee. A
localhost bootstrap preview is not production acceptance. Final supervised
startup never uses --allow-missing-services.

For an explicitly configured HTTPS reverse proxy, use config.proxy.json.example.
The public origin must be HTTPS; allowed hosts must explicitly include that
origin's authority, including a nondefault port if present. Set an explicit user
allowlist and external 0600 proxy secret file. The proxy must replace
x-hermes-proxy-secret and remote-user headers, preserve the configured public
Host, and forward browser Origin unchanged for HTTP and WebSocket traffic.
Forwarded identity headers are not trusted. All backend listeners stay on
127.0.0.1. Health carries the allowed public Host, the file-loaded proxy secret
and an explicitly allowed user; there is no health authentication bypass.

Fleet is an optional external private service. Merge the keys from
fleet.json.example into the configuration's environment object only when the
operator has explicitly configured that endpoint. Token and optional review
token files must be 0600 and external. There is no default Fleet endpoint or
token, no Fleet source/binary in the archive, and no Fleet request in CI/health.
Application services must implement these WORKBENCH_FLEET_* file-based names.

## Acceptance boundaries

CI uses fixture subprocesses for startup, authentication, crash/restart and
cleanup faults, and real modules for pure contract/unit tests. Packaging builds
the actual committed frontend and verifies a relocated extracted manifest.
CI never makes model requests, consumes a subscription, reads operator
credentials or contacts real Fleet. The release owner separately performs real
provider/browser acceptance against the prepared isolated environment, including
authenticated app health and lifecycle cleanup, before any production switch.

See manual-switch.md for explicit version selection and rollback.
