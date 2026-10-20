# Deployment templates

These examples describe one isolated instance. Copy `compose.example.yaml` to
`compose.yaml` and `.env.example` to `.env`, then fill every required value.
Real identities, endpoints, secrets and host paths belong only in your local
configuration. They must never be committed. Each instance needs its own data,
workspace, credentials, allowed-user list and proxy secret.

## Runtime prerequisites

`WORKBENCH_IMAGE` is an image you supply; this project does not publish a runtime
image. It must provide Python 3.13, the locked `requirements-dev.txt` dependencies,
a compatible Hermes installation at `/opt/hermes` (including its Python environment
at `/opt/hermes/.venv`), and Codex CLI at `/usr/local/bin/codex`. The supervisor can
instead use a separately installed app-server binary under
`/opt/data/bin/codex-runtime/codex`. Test that runtime before exposing the instance.

Use `scripts/install-managed-release.py` to initialize the mounted data directory
with a verified release as described in [managed releases](../docs/managed-releases.md).
The example will not start until that bootstrap is installed. Sign in with Codex
using the instance's `CODEX_HOME` before starting the combined runtime. Existing
credentials are preserved. Importing a Hermes authentication pool is optional and
requires an explicit `HERMES_WORKBENCH_CODEX_AUTH_SOURCE` path; it is never inferred
from another instance or an undocumented shared mount.

Set UID/GID to the data owner/shared group on your host. Set data and workspace
to absolute host directories and `WORKBENCH_NETWORK` to the private network of
your authenticated Dashboard proxy. No host port is published. Check the rendered
configuration with `docker compose --env-file .env -f compose.yaml config` before
starting it. Rendered configuration contains secrets; do not publish its output.

## Authenticated routing

`Caddyfile.example` is a snippet, not a complete authentication configuration.
Import `workbench_routes` inside your existing `route` after authentication and
before the Hermes fallback. Authentication must reject unauthenticated requests
and replace client-supplied `Remote-User`. Set `WORKBENCH_UPSTREAM` to the sidecar
service address (for example `workbench:8787`) and use the same proxy secret as
the sidecar. The sidecar additionally checks that the user is in its configured
allowlist. Keep the sidecar unreachable from untrusted networks.

For multiple instances, use separate authenticated routing and service names;
never point unrelated users at the same data directory. Workbench does not rewrite
your proxy configuration or install an identity provider.

## Development and forks

Developers can build from source and run `scripts/publish-dev.py dashboard
--target /path/to/plugin/dashboard --backup-root /path/to/backups` against their
own development plugin. The script refuses managed-release symlinks. Publishing
browser files does not upgrade the backend or restart a service.

### Local test environment

This is the shortest complete setup for testing the Workbench interface from a
source checkout. It uses a separate Hermes home and keeps the browser entrypoint
on `localhost:9120`; `9119` is the native Hermes dashboard, `9451` is the
Workbench sidecar, and `9450` is the Codex app-server.

```sh
export HERMES_HOME="$HOME/.hermes-workbench-test"
export HERMES_WORKBENCH_HERMES_HOME="$HERMES_HOME"
export HERMES_WORKBENCH_ALLOWED_USERS=local-dev
export HERMES_DASHBOARD_TRUSTED_PROXY_SECRET=local-dev-workbench-secret
export HERMES_WORKBENCH_PORT=9451
export HERMES_WORKBENCH_HOST=127.0.0.1
export HERMES_SOURCE=/path/to/hermes-agent
mkdir -p "$HERMES_HOME/plugins"
ln -sfn "$PWD" "$HERMES_HOME/plugins/workbench"
cat > "$HERMES_HOME/config.yaml" <<'YAML'
plugins:
  enabled:
    - workbench
YAML
pnpm install --frozen-lockfile
pnpm build
```

Start these processes in separate terminals, using the Python environment that
contains the Hermes Dashboard dependencies:

```sh
python dashboard/sidecar_app.py                         # 127.0.0.1:9451
hermes dashboard --host 127.0.0.1 --port 9119 --skip-build --no-open
nginx -c "$PWD/deploy/nginx.local-dev.conf.example"
```

If Codex chat is required, start the app-server on `ws://127.0.0.1:9450` and
set `CODEX_APP_SERVER_ENDPOINT`, `CODEX_APP_SERVER_TOKEN_FILE`, and `CODEX_HOME`
before starting the sidecar. With a local Codex binary and an authenticated
`CODEX_HOME`, the command is:

```sh
export CODEX_HOME="$HERMES_HOME/codex-home"
export CODEX_APP_SERVER_ENDPOINT=ws://127.0.0.1:9450
export CODEX_APP_SERVER_TOKEN_FILE="$CODEX_HOME/ws-token"
mkdir -p "$CODEX_HOME"
codex app-server --listen "$CODEX_APP_SERVER_ENDPOINT" \
  --ws-auth capability-token --ws-token-file "$CODEX_APP_SERVER_TOKEN_FILE"
```

Then open **http://localhost:9120/workbench**.
The root path shows Hermes' native dashboard; `/workbench` is the Workbench tab.

Verify the wiring before opening the browser:

```sh
curl http://127.0.0.1:9451/health
curl http://127.0.0.1:9120/api/dashboard/plugins
curl http://127.0.0.1:9120/api/plugins/workbench/capabilities
```

The plugin list must contain `workbench`, and the last request must report
`codexChat: true` when the app-server is configured. Stop the test processes
and remove `$HERMES_HOME` when the test is complete.

Forks may set `HERMES_WORKBENCH_RELEASE_REPOSITORY=owner/repository` and
`HERMES_WORKBENCH_PLUGIN_ROOT=/path/to/plugins/workbench`. The official repository
URL is a public project identifier, not an instance identity. Releases are
manually selected by users; CI never deploys to your host.

## PlantUML rendering

Workbench uses the public PlantUML Server by default. An instance with its own
server can configure it in the Hermes `config.yaml`:

```yaml
dashboard:
  workbench:
    plantuml_endpoint: https://plantuml.example.com/svg
```

The value must be an absolute HTTP(S) URL. Workbench reads it from `/api/config`;
missing or invalid values fall back to the public server. A self-hosted server
is useful when the instance needs a particular CJK font fallback. Diagrams are
sent as UTF-8 hex GET URLs; each source is limited to 3500 bytes so the request
stays below common proxy limits. Split larger diagrams into smaller views.
