# Hermes Workbench

[![CI](https://github.com/DeeliN221/hermes-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/DeeliN221/hermes-workbench/actions/workflows/ci.yml)

**Your conversations, projects, and tools in one workspace.**

Hermes Workbench brings side-by-side conversations, project files, kanban boards,
and scheduled jobs to Hermes Agent Dashboard. Keep a plan open while an agent
writes the guide and another checks the results.

[Get started](docs/installation.md#quick-start-existing-hermes-host) ·
[Download a release](https://github.com/DeeliN221/hermes-workbench/releases) ·
[Developer guide](dev.md)

![Three conversations in a macOS Brave/Chrome style window: release planning, writing a guide, and reviewing tool results](assets/showcase/three-pane-workspace.png)

## Keep related work together

Each conversation pane has its own history and composer. Group sessions by
project, switch profiles, and inspect tool output alongside the work it supports.
The home page brings recent activity across profiles into view; agent questions
can be answered directly in the conversation.

| Pick up where you left off | Answer without leaving the conversation |
| --- | --- |
| ![Recent activity across profiles](assets/showcase/home-overview.png) | ![Agent question with options and a free-text answer](assets/showcase/agent-questions.png) |

## From a task to its files

Track work on a kanban board, review recurring jobs, and open workspace files
without leaving Workbench.

### Kanban

See tasks by stage and assigned profile, and filter the board to find the work
you need. New and edited cards use the versioned `standard@1` form: background,
output, acceptance, and boundaries, with an explicit review mode of `auto`,
`human`, or `none`. This view integrates the Hermes Kanban plugin.

![Kanban board in a macOS Brave/Chrome style window](assets/showcase/kanban.png)

### Scheduled jobs

Review recurring tasks across profiles, read their instructions and schedules,
and check recent runs from the same page.

![Scheduled jobs with instructions and recent run details](assets/showcase/scheduled-jobs.png)

### Files and diagrams

Read formatted Markdown, switch to source, or download a file from the preview.
Mermaid diagrams render locally with Pele, and PlantUML diagrams render offline
in the browser, so diagram source does not leave the instance. UML files can
also be opened directly.

![Formatted workspace README with preview and file controls](assets/showcase/files-preview.png)

## At your desk or on your phone

Press **W** on desktop to open the Minecraft-inspired Workbench menu, with
access to tools including files, skills, and the terminal. On a phone, the compact
action rail keeps profiles, search, kanban, scheduled jobs, files, and theme
controls beside the conversation.

<table>
  <tr><th>Desktop · Workbench menu</th><th>Mobile · Quick actions</th></tr>
  <tr>
    <td><img src="assets/showcase/workbench-desktop.png" alt="Workbench menu in a macOS Brave/Chrome style window" width="760"></td>
    <td><img src="assets/showcase/workbench-mobile.png" alt="Mobile conversation in a mobile Brave/Chrome style browser frame" width="250"></td>
  </tr>
</table>

English is the default interface language. The included Simplified Chinese pack
follows the Dashboard's explicit language selection.

*Images show actual Workbench layouts with fictional English data and mocked API
responses. Browser frames are decorative Brave/Chrome style presentations.
No private conversations or credentials are shown. Click an image for full size.*

## Get started

Workbench is an extension for Hermes Agent Dashboard. Download a prebuilt archive
and `SHA256SUMS` from [Releases](https://github.com/DeeliN221/hermes-workbench/releases),
then follow the [installation guide](docs/installation.md#quick-start-existing-hermes-host).
Prebuilt releases include the installer and require no Node.js, pnpm, or frontend build.

The [installation guide](docs/installation.md) also covers upgrades and rollback.
For source setup, tests, contributions, and releases, see the [developer guide](dev.md).
The complete source-checkout browser setup is documented in the
[local test environment guide](deploy/README.md#local-test-environment).

Workbench's web chat creates Codex conversations only. Existing Claude Code or
Pi sessions are history-only; continue them from their native terminal. See
[the chat provider policy](docs/codex-only-chat.md).

## Troubleshooting

### 1. Source dependency installation or build fails

- **Symptom:** `pnpm install` or `pnpm build` fails with a runtime/version error.
- **Cause:** The source toolchain requires Node.js 22.12+, pnpm 11.22.0
  (see `package.json`), and Python 3.13; older or missing runtimes cannot
  satisfy the documented development prerequisites.
- **Solution:** Install/select those versions, then run from the checkout root:
  ```sh
  node --version
  pnpm --version
  python3 --version
  pnpm install --frozen-lockfile
  pnpm build
  ```
  Prebuilt releases need no Node.js, pnpm, or frontend build; follow the
  [installation guide](docs/installation.md#quick-start-existing-hermes-host) instead.

### 2. Source changes do not appear, or browser assets are missing

- **Symptom:** Editing `dashboard/src/` leaves the interface unchanged, or a
  source checkout has no usable `dashboard/dist/` assets.
- **Cause:** The browser loads generated assets; editing source does not rebuild
  them or publish them to a separately installed plugin.
- **Solution:** From the checkout root, run `pnpm build`, then
  `pnpm preview:local` to inspect the rebuilt interface at
  `http://127.0.0.1:9130/sessions?profile=default` with mock data.
  For a separately installed developer plugin, use the publisher and explicit
  destination paths in [Development and forks](deploy/README.md#development-and-forks).
  For managed installations, use **Settings → Version switching** to install a
  matching frontend/backend release; do not copy the source `dist/index.js`
  over the installed plugin's thin loader.

### 3. The Workbench tab is missing or the URL shows no interface

- **Symptom:** Hermes has no Workbench tab, or opening the sidecar URL does not
  display the workspace.
- **Cause:** The serving Hermes profile has not enabled `workbench`, or the
  browser is pointed at the API sidecar instead of the Dashboard plugin route.
- **Solution:** In the serving profile's `config.yaml`, add `workbench` to
  `plugins.enabled` (preserve other entries), as shown in the
  [installation guide](docs/installation.md#quick-start-existing-hermes-host).
  Open `/workbench` on the authenticated Dashboard origin. For the documented
  [local test setup](deploy/README.md#local-test-environment), the configuration
  is `$HERMES_HOME/config.yaml` and the browser URL is
  `http://localhost:9120/workbench`; port `9451` serves the sidecar API.

Licensed under [AGPL-3.0-only](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md).
