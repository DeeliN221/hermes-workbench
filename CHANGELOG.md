# Changelog

## Unreleased

- Exclude Kanban worker runs from recent home so task retries no longer appear as unread conversations.
- Persist recent-home read state on the server so acknowledgements follow the account across browsers.
- Show terminal Codex turn errors on recent cards instead of claiming the request is not cached.
- Render PlantUML locally with the bundled browser engine instead of a remote server.
- Keep diagram source inside the browser and remove the PlantUML endpoint setting.
- Reconcile streaming Markdown updates so trailing PlantUML fences render from the complete message.

## Fresh public source snapshot

- Rebuild the public repository under DeeliN221 with one initial commit.
- Use English by default while retaining explicit Chinese translations and legacy input compatibility.
- Preserve existing functionality and private recovery copies separately.
- Entries below describe earlier development releases; their tags are not imported into the fresh repository.

Versions follow SemVer. GitHub release notes summarize pull requests and commits between release tags.

## 0.12.0

- Add a Settings selector for Ctrl/Command + Enter (default) or Enter to send messages.
- Remember the selection in the current browser; Enter mode uses Shift + Enter for newlines.
- Protect IME composition from accidental sends and update the send-button hint.
- Include the reviewed Node type-definition update to 26.6.5.
- Managed instances still using the retired xbugs221 repository need their release
  repository setting changed to DeeliN221/hermes-workbench by an administrator.
  Publishing this release does not upgrade those instances automatically.

## 0.11.0

- First installable release from the fresh public repository, with prebuilt runtime,
  matching source, checksums, an installer, and deployment templates.
- Automatically publish checked releases when a version PR merges into main.
- Localize browser tab titles by profile and open temporary sessions in a new pane.
- Apply each profile's model, reasoning effort, and response priority to Codex app-server.
- Show synchronous and asynchronous Codex questions as interactive answer forms.
- Include reviewed dependency updates and English public PR screenshots.
- Runtime requirements: Node.js 22.12+ for source builds, Python 3.13 for the backend,
  and an ES2024-capable browser. Existing Hermes and authenticated routing are required.

## 0.10.0

- The home page aggregates recent sessions across profiles, sorted by activity, with agent identity and first/latest requests.
- Add swipe-to-read and Mark all handled. Failed items remain visible, and activity arriving during a batch is not incorrectly marked read.
- Persist collapsed cards locally by profile and synchronize Codex read progress with the server.
- Deduplicate Codex sessions against their Hermes records and filter injected environment messages.
- Fix home redirects and cross-profile session navigation while retaining responsive chat-options layouts.

## 0.9.1

- Include the 0.9.0 features below and fix release lists being mistaken for empty caches within five minutes of host startup.
- CI found this issue on the 0.9.0 tag, so no archive was published; use 0.9.1.

## 0.9.0 (unreleased)

- Add a recent-session home page with profile filtering, conversation continuation, and new sessions.
- Refine quick navigation and profile switching while preserving themes and isolating drafts and attachments by profile.
- Select default models from profile settings, associate boards with their owners, and prevent sends when model loading fails.
- Render PlantUML locally and open execution conversations from kanban run history.
- Include chat-input, file-preview, and narrow-menu improvements plus date-based versioning and rollback.
- Isolate credential tests and verify PlantUML assets in release packages.

## 0.8.2

- Sanitize repository history, author metadata and legacy deployment references.
- Retire older tags and release archives; new installs should use this release.
- Reject reintroduction of retired history in CI. Existing clones must be replaced or carefully migrated without merging old history.
- Runtime source is unchanged from 0.8.1; this release updates repository hygiene and provenance.

## 0.8.1

- Remove instance-specific deployment configuration and historical session identifiers; add parameterized single-instance templates.
- Replace personal locale and theme identifiers with Workbench identifiers. Install the included `theme/workbench-*.yaml` and `theme/skins/workbench-*.yaml` in the host before using the new theme toggle; existing dark/light preferences are recognized.
- Configure release repositories, plugin paths and credential imports explicitly; preserve existing per-instance credentials.
- Add a public-content CI check and editor/theme/credential regression coverage.
- Include reviewed dependency updates and the chat file-preview fixes.
- Historical tags and release archives are unchanged by this source update.

## 0.8.0

- Managed installations switch matching frontend/backend versions atomically with health checks and rollback.
- Keep source development and independently installed releases separate; updates remain user-selected.

## 0.7.1

- Sort versions by descending SemVer, including correct ordering of codex.14 and codex.9.
- Combine GitHub releases and local caches, showing the active version, prereleases, and release notes.
- Download and verify browser assets only when requested; retain old versions and restore previous assets on failure.
- Retain local versions during network failures and offer retry without automatic deployment or service restarts.
- Initial setup requires the updater backend; publishing a release does not automatically update old instances.

## 0.7.0

- Move Workbench into an independent GitHub repository, retaining history at that time.
- Add Minecraft-inspired grid navigation and global light/dark themes.
- Improve session recovery, image paste, kanban context, and realtime connections.
- Unify the version source and add CI, release PRs, archives, and SHA-256 verification.
- Use AGPL-3.0-only for project code while retaining third-party licenses.
