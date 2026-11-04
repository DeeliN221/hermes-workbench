# Mac development acceptance — 2026-11-04

The PNGs were captured from the genuine local stack at `127.0.0.1:9120`,
using the source commit and build hashes in [evidence.json](evidence.json).
They are not NAS screenshots. No API responses were mocked.

| View | Light | Dark |
| --- | --- | --- |
| Desktop home | [PNG](desktop-light-home.png) | [PNG](desktop-dark-home.png) |
| Mobile home | [PNG](mobile-light-home.png) | [PNG](mobile-dark-home.png) |
| Desktop menu | [PNG](desktop-light-menu.png) | [PNG](desktop-dark-menu.png) |
| Mobile menu | [PNG](mobile-light-menu.png) | [PNG](mobile-dark-menu.png) |
| Desktop Fleet | [PNG](desktop-light-kanban.png) | [PNG](desktop-dark-kanban.png) |
| Mobile Fleet | [PNG](mobile-light-kanban.png) | [PNG](mobile-dark-kanban.png) |

Verified: page identity, populated profiles and synthetic Chinese titles, runtime
JS/CSS response hashes, no framework overlay, W opens the navigation menu, real
Fleet cards render, actual theme matches the matrix, and no page exceptions.
Console checks permit only a WebSocket closed-before-connect warning during page
reload (local Hermes bundled Kanban event subscription); other console errors fail.

An actual stale-HEAD run of `pnpm test:browser` exited before browser launch.
Unit checks also reject changed source, disk assets, stale startup identity and
wrong HTTP bytes. Real Codex initialize, Hermes HTTP, sidecar health and fleetd
health succeeded. No model credentials or workers are present.

See [setup, seed and residual differences](../../docs/mac-acceptance.md).
