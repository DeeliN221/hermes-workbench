# Mac real-stack acceptance

This is **development acceptance**, not a screenshot of a NAS deployment.
No NAS reads, credentials, user history, container changes or publication are needed.

```text
Chromium (zh-CN, Asia/Shanghai, pinned Noto Sans SC)
  -> 127.0.0.1:9120 nginx
     -> :9119 genuine Hermes dashboard + isolated profiles/history
     -> :9451 Workbench sidecar + isolated SQLite mappings
        -> :9450 genuine Codex app-server (no provider credentials)
        -> :19452 genuine fleetd (isolated database, no workers)
```

## Run

Prerequisites: macOS, pnpm from package.json, nginx installed with Homebrew,
Hermes source with its installed `.venv`, a Codex binary supporting authenticated
WebSockets, and a locally built fleetd binary. Override `HERMES_SOURCE`,
`ACCEPTANCE_CODEX`, `ACCEPTANCE_FLEETD` when their locations differ from the script
defaults. These external checkouts are read only. Install Chromium once with
`pnpm exec playwright install chromium`.

```sh
git fetch origin
git switch main
git pull --ff-only
pnpm stack:rebuild  # frozen install, rebuild dashboard/dist, restart, seed, probe
pnpm test:browser  # defaults to the real stack on 9120; never starts mock-host
pnpm stack:check
pnpm stack:stop
```

On a feature branch, fetch/rebase latest main before `stack:rebuild`; it does not
silently switch branches or discard work. Restart without rebuilding:
`pnpm stack:restart`. All owned PIDs, startup identities, config, databases and logs
are in `.local-stack/`. Stop checks process startup identity before signalling.
Occupied ports belonging to another process fail closed. If replacing an old
launchd stack, retire its **identified development jobs** first; killing just the
listener causes launchd to restart the old source. Never use broad `pkill`.
The requested dev services are background processes and remain available until
`stack:stop`; browser/test command processes exit after verification.

The dependency install covers Workbench. Hermes and fleetd versions are external
prerequisites, not implicitly upgraded. Pin these independently when reproducing
a particular NAS release.

## Version gate and evidence

The build manifest records git commit, source SHA-256, asset SHA-256 and build time.
The authenticated `GET /api/plugins/workbench/runtime-version` snapshots that
manifest at sidecar startup and adds UTC startup time. The local proxy exposes it
at `/__acceptance/version`. This endpoint contains local source location; do not
make the acceptance proxy public.

`verify-local-runtime.py` checks HEAD against the build, current source against the
build digest, disk assets, process identity and HTTP-served JS/CSS. Playwright runs
this before opening a browser and also hashes the resources its page actually
receives. A source edit, commit, stale process, or replaced bundle requires a fresh
build/restart. Health probes additionally initialize the genuine authenticated
Codex WebSocket and probe Hermes, sidecar and fleetd.

`test-results/real-stack/` contains home/menu/kanban PNGs for desktop and mobile,
light and dark, plus machine-readable results; failures keep traces. Desktop is
1440×900 / DPR 1; mobile is 390×844 / DPR 3 with touch. Chromium is lockfile-pinned;
locale is zh-CN, timezone Asia/Shanghai, animations reduced, service workers blocked.
Noto Sans SC **5.3.1** regular/bold is served locally and awaited before capture.
This is an intentional font baseline; NAS clients using system fonts can differ.
External browser network requests are aborted, never replaced with synthetic API
responses. Test API traffic passes through the real application services.

Mock component regressions remain available as `pnpm test:browser:mock`; CI uses
that explicit command because hosted CI has no installed Mac Hermes/Codex stack.
A green mock CI run does not certify real-stack acceptance.

## Seed and reset

`seed-local-stack.py` writes only this checkout's `.local-stack`:

- `default`, `writer`, `empty` profile directories with genuine Hermes SessionDBs.
- Projects and session organization in the actual Workbench BridgeStore schema.
- Long Chinese titles, completed synthetic Hermes history and local text attachments.
- Two synthetic Fleet tasks created through the local fleetd API; no worker is
  registered and no model execution is performed.

Seeding is additive/idempotent for these fixture identities. To reset all fixtures,
stop the stack, remove **only this checkout's `.local-stack/`**, then rebuild.
Task IDs are assigned by fleetd, project IDs by BridgeStore, and timestamps by the
real stores; this suite checks layout/content, not pixel equality across dates.
The mapped Codex sessions are synthetic catalog records, not invented live remote
threads. Chat model generation, authenticated provider calls and attachment
submission to a model are outside this offline acceptance path. Attachments are
real files; the initial matrix covers home, navigation and Fleet rather than an
upload/preview end-to-end claim.

## NAS comparison (2026-11-04)

Instance versions below are supplied by the operator's inspection; this task did
not connect to NAS. Release ancestry was checked against fetched GitHub tags.

| Target | Reported version | Difference from fetched main a6744d8 |
| --- | --- | --- |
| NAS zzl | 20261103-4, tag 76e64e7 | 4 development commits: first-click navigation #121, guarded project + button #122, unified home/Fleet search #124, completed-card layout #125 |
| NAS dmh | 20261101-1, tag 787e8eb | 38 development commits, including profile home/layout, responsive global Kanban, Fleet review/console, search previews, attachment lightbox, project appearance, throughput, file-root recovery, release-note rendering and OpenCode models |
| Mac baseline | main a6744d8 | latest fetched development baseline plus this acceptance change |

Reproduce the exact list with `git log --oneline v20261103-4..a6744d8` and
`git log --oneline v20261101-1..a6744d8`. GitHub also has v20261104-1; its existence
is **not** evidence either NAS instance installed it. None of the four newest main
changes is represented by the operator-reported zzl release.

The NAS image is reported as `hermes-workbench-codex:0.154.0-20260913`.
This Mac validation used Codex 0.166.0, Hermes source
`5fc490e2b34123212d73ef316086f939567a725a`, and a local fleetd binary reporting
`dev (commit none, built unknown)`; its binary hash is recorded with evidence.
These host/runtime differences remain explicit and are not equivalent to NAS.

Not mirrored: Authelia login/SSO/cookies, HTTPS/Caddy and reverse-proxy deployment,
Docker/Linux fonts and filesystem, NAS plugin inventory/settings, provider auth,
real history/attachments, Fleet workers/leases/review execution, NAS latency and
large-history load. Bundled plugins come from the local Hermes host only.

Recommended path: (1) latest-source development acceptance here; (2) separately
build a selected release tag with matched host/runtime versions for release
compatibility; (3) after an independently authorized deployment, capture **that
NAS URL**, its installed release/runtime identity and viewport metadata. Keep NAS
production evidence separate from local screenshots. This change performs no
release publication, NAS upgrade or production container mutation.
