# Instant Workbench startup

Local browser harness using mock Hermes data, Chromium, and a 390 x 844 mobile
viewport. These numbers exclude the one-time runtime download after a release.

- Repeat open: the versioned runtime came from the browser cache (`transferSize: 0`).
- Cached transcript paint: 440 ms; with the session API delayed 2.5 s, the cached
  message still painted at 476 ms.
- Runtime delayed 2.5 s: the thin loader painted the last Codex message at 203 ms.

The screenshots show the loader preview in dark and light themes on mobile and
desktop, plus the loaded mobile chat. They use only the local mock host.

The first open after installing or switching a release still downloads the
runtime once. Later opens reuse the immutable versioned asset, and a new release
changes the cache key automatically.
