# Compatibility validation

Validated on 2026-10-14 against the upstream commit in `manifest.json`.

- A fresh sparse checkout of the public base accepted the patch; all 37 output
  files matched the manifest, with no changes outside its file list.
- The management tool rejected a dirty checkout, a wrong upstream revision,
  repeat application, and tampered output. Check-only mode left the target unchanged.
- 107 Python tests passed across 11 files using the upstream per-file test
  runner, including grouped plugin paths, cross-profile achievements, Codex
  activity/startup/approval/authentication, Kanban profiles, and MCP file handoffs.
  These tests ran against the preserved full source snapshot. Python patch
  outputs match that snapshot; only a desktop test hostname was anonymized.
- Credential-pattern scanning found no leaks in this integration directory.
  Added paths, endpoints, profile names, and patch context were also reviewed.

The two upstream frontend suites (connection settings and session navigation)
were not rerun in this packaging task. This is not validation against current
upstream HEAD, all Hermes tests, or every deployment. No running Hermes service
or Workbench browser bundle was changed by this integration publication.
