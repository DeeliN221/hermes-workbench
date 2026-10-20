[← Back to README](README.md)

# Development

Requirements: Node.js 22.12+, the pnpm version declared in package.json, and Python 3.13 / uv.
Mermaid diagrams require an ES2024-capable browser (Safari 17.4+ or a current Chrome/Firefox).

```sh
pnpm install --frozen-lockfile
pnpm version:check
pnpm typecheck
pnpm test
pnpm test:python
pnpm build
pnpm release:verify
pnpm release:package
```

Browser source lives in `dashboard/src/`; `dashboard/dist/` contains generated assets.
Python test dependencies are pinned in `requirements-dev.txt`. To update them:
`uv pip compile requirements-dev.in -o requirements-dev.txt`.

Optional Hermes-side compatibility changes are maintained with their tests in
[`integrations/hermes`](integrations/hermes/README.md). The layer is pinned to
an explicit upstream revision and is applied separately from the plugin.

## Contributions and releases

Use pull requests against `main` and pass CI before releasing.
See [releases](docs/releases.md) and [managed releases](docs/managed-releases.md)
for versioning, isolated instances, manual updates, and rollback.
Deployment templates are in `deploy/`. Copy `.env.example` and supply your own
image, paths, and authentication settings; templates include no runtime image,
identity provider, or credentials.
For a source-checkout browser test, follow the [local test environment](deploy/README.md#local-test-environment)
steps; the Workbench tab is served at `/workbench` through the local proxy.

The repository starts from a reviewed source snapshot. Clone it afresh rather
than merging old repository history. Existing private recovery copies remain
separate from this public project.

### UML diagrams

Markdown chat and file previews render `plantuml`, `puml`, and `uml` fences
through the public PlantUML Server by default. An instance can override the
endpoint without changing the bundle by defining
`window.__HERMES_WORKBENCH_CONFIG__ = { plantumlEndpoint: "https://.../svg" }`
before rendering. The recommended deployment setting is `dashboard.workbench.plantuml_endpoint`
in the instance's Hermes `config.yaml`; Workbench reads it from `/api/config`
and falls back to the public server when it is absent or invalid. A private
deployment can point this at its own PlantUML Server so its CJK font fallback
stays correct. A build can also set
`VITE_PLANTUML_RENDER_ENDPOINT` as the default for that build.
`.puml`, `.plantuml`, and `.uml` files also open as diagrams.

````markdown
```plantuml
@startuml
actor User
User -> Workbench : Send message
Workbench --> User : Show response
@enduml
```
````

Source viewing and copying remain available, including after a rendering error.
Local rendering currently rejects `!include` and `!import`; inline those definitions.
Mermaid fences continue to use Mermaid syntax and the existing renderer.

## README showcase images

Original interface captures live in `assets/screenshots/`. They use fictional
English conversations and mocked local API responses. The README uses
`assets/showcase/`, rendered with decorative Brave/Chrome style
browser frames: a dark teal tab strip and address bar on desktop, with matching
mobile controls. The frames do not indicate testing on physical devices.

To regenerate the images with an isolated Playwright installation:

```sh
npm install --prefix /tmp/workbench-readme-render playwright
/tmp/workbench-readme-render/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/workbench-readme-render/node_modules node scripts/render-readme.cjs
```

The renderer preserves each original capture at its native resolution and adds
the browser controls, rounded corners, shadow, and background with HTML/CSS.
The address `workbench.example` is illustrative. To use an existing Chromium
binary, set `CHROMIUM_EXECUTABLE_PATH` when running the script.
# Pull request body check

GitHub PRs must pass the repository contract before publication. Save the
proposed body to a file and run:

```sh
pnpm pr:check /tmp/pr-body.md
```

The checker requires English text and the `Behavior`, `Scope`, and `Validation`
sections. It does not require an image. Frontend changes should include relevant
before and after screenshots under an optional `Visuals` section; backend-only
changes can omit it. The checker rejects test-count waterfalls and similar
execution logs.

