# Installation and upgrades

## Quick start (existing Hermes host)

Use a Linux host with a compatible Hermes Dashboard (plugin SDK 1.1.0), Python
3.13, and the backend dependencies described in [deployment setup](../deploy/README.md).
Codex features require a configured Codex app-server. Workbench does not bundle
Hermes, a container runtime image, or authentication. No frontend build is needed.

Download the latest stable release with the [GitHub CLI](https://cli.github.com/):

```sh
mkdir workbench-release
cd workbench-release
gh release download --repo DeeliN221/hermes-workbench \
  --pattern '*.tar.gz' --pattern SHA256SUMS
sha256sum --check SHA256SUMS
# Extract only the runtime archive, not the matching source archive.
archive=$(find . -maxdepth 1 -name 'hermes-workbench-v*.tar.gz' ! -name '*-source.tar.gz')
tar -xzf "$archive"
release_dir=${archive%.tar.gz}
python3 "$release_dir/scripts/install-managed-release.py" --help
```

On the destination host, stop the Workbench sidecar and back up any existing
installation. Replace the paths and owner IDs below with those for your host.
Run as an administrator with permission to set the destination ownership:

```sh
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$release_dir/release.json")
checksum=$(sha256sum "$archive" | cut -d ' ' -f 1)
python3 "$release_dir/scripts/install-managed-release.py" \
  --archive "$archive" --sha256 "$checksum" --version "$version" \
  --root /path/to/workbench --plugin-root /path/to/plugins/workbench \
  --uid "$(id -u)" --gid "$(id -g)"
```

The installer preserves the old plugin directory and installs matching frontend
and backend files. It refuses to overwrite an already managed installation.
Use the included `deploy/compose.example.yaml`, `.env.example`, and routing template
to configure and start the backend; follow [deployment setup](../deploy/README.md).
Set `WORKBENCH_RELEASE_HOME` to the installation root. Install the included themes
in the host theme directories as described below. After the first setup,
**Settings → Version switching** provides explicit upgrades and rollback without
building from source. See [managed releases](managed-releases.md) for migration,
health checks, and recovery.

## File layout

Release archives contain `plugin/`, `sidecar/`, themes, and extensions. Extract into
a temporary directory, verify hashes, and back up the destination before installing.
A compatible Hermes Dashboard (plugin SDK 1.1.0) and Python backend environment are
required. Codex integration also requires a configured app-server.

Install `plugin/` into the host's Workbench plugin directory. In `dashboard/dist/`:

- `index.js` and `style.css` are stable thin loaders.
- `workbench.js` and `workbench.css` contain this release's actual interface.
- `mermaid.min.js` supplies local Mermaid rendering.

Do not overwrite the plugin loader's `index.js` with the source build's `index.js`.
The backend uses `sidecar/dashboard/`, retaining its original `dist/index.js` and
`style.css` paths. Python dependencies are listed in `requirements-dev.txt`, which
also includes validation tools. Configure `HERMES_WORKBENCH_*` and
`CODEX_APP_SERVER_*` for your instance; see `dashboard/sidecar_app.py` and the
[deployment templates](../deploy/README.md). Hermes, an authentication proxy,
and Codex are not bundled with Workbench.

Keep installed resources writable by the shared group. Back up, replace assets
atomically, and compare hashes. Verify JS/CSS bodies, Content-Type, and hashes
through the actual Dashboard route; an HTTP 200 login page is not validation.
Then check light/dark themes, sessions, profile switching, and affected interactions.
Roll back the complete matching version and verify the same route again.

Themes use `workbench-light` / `workbench-dark`. Install `theme/*.yaml` in the
Dashboard theme directory and `theme/skins/*.yaml` in the TUI skin directory.
When upgrading old themes, select light or dark mode again.
