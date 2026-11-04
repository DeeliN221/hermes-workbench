# Review delivery and execution-session entry points

The task review drawer now puts review material before the long acceptance
checklist. It supports four explicit states:

1. **Final deliverable** — up to four compact links from explicit delivery data,
   task links, or final artifacts: PR, merge, commit, demo, screenshot, report or
   downloadable artifact.
2. **Stage report** — when no final deliverable exists, a locally rendered
   Mermaid/PlantUML progress diagram and at most five short conclusions.
3. **No final deliverable or stage report** — an explicit warning, never a fake
   success state. Approve and Request changes remain available because the review
   workflow still owns that decision.
4. **Execution session** — same-instance sessions open directly and continue in
   Chat; remote sessions expose an absolute Workbench link plus Copy link. If no
   reachable URL is recorded, the drawer names the device and offers Copy session
   ID and Open Workbench + session ID instead of only saying “available later”.

## Data contract

The browser reads delivery data from the task or its `spec_json`:

```json
{
  "final_deliverables": [
    {"kind": "pr", "label": "Pull request #128", "url": "https://github.com/example/repo/pull/128"},
    {"kind": "report", "label": "Delivery report", "artifact_id": "artifact-1"}
  ],
  "stage_report": {
    "status": "UI implementation complete",
    "blocker": "Review token missing",
    "next": "Verify both themes",
    "conclusions": ["Short conclusion one", "Short conclusion two"],
    "diagram": "flowchart TB\n  A[\"Progress\"] --> B[\"Next\"]"
  },
  "conversation_workbench_url": "https://nas.example-tailnet.ts.net/",
  "conversation_machine": "nas"
}
```

`deliverables` and `delivery` are accepted aliases. `Detail.links` supplies PR,
merge, commit, demo, screenshot and report links; final artifact kinds are
preferred before generic artifacts. A `stage_report` string may contain a closed
Mermaid/PlantUML fence; otherwise one concise `flowchart TB` is generated from
progress, blocker and next. Conclusions are capped at five and shortened.

Remote URLs must be absolute HTTP(S). Credentials, token/auth query parameters,
local paths and bare hostnames are rejected. The client appends
`/chat?session=…&profile=…` (or `hermesSession`) from the recorded Workbench base.
`remote_workbench_url`, `workbench_url`, `machine_workbench_url` and per-session
`source_workbench_url` are fallbacks. `conversation_machine` and
`source_machine` name the device.

## Localhost validation

`tests/browser/review-delivery-sessions.mjs` uses the built bundle, the local mock
Hermes host and Playwright request interception. It does not contact Fleet,
production Workbench or a real remote device. It verifies:

- final PR/commit links appear above Summary and review actions remain;
- same-instance execution session opens `/chat` and the composer is interactive;
- remote session link is absolute, copyable, opens in a new tab, and continues;
- stage report renders an actual Mermaid SVG with 3–5 short points;
- empty material shows the explicit warning and never the old “after the run” text;
- 1440×960 and 390×844 screenshots in light and dark themes;
- no browser page/console errors.

```sh
pnpm typecheck
pnpm test
pnpm build
node tests/browser/review-delivery-sessions.mjs
WORKBENCH_SCREENSHOT_DIR=docs/validation/review-delivery node tests/browser/review-delivery-sessions.mjs
```

Screenshots use fictitious English tasks and example PR URLs. A real Tailscale /
MagicDNS device, production fleetd data, installed Hermes loading and physical
phones remain unverified locally.

## Screenshots

- `final-local-{desktop,mobile}-{light,dark}.png` — final PR/commit and same-instance session.
- `final-remote-{desktop,mobile}-{light,dark}.png` — final demo and remote Workbench session link.
- `stage-report-{desktop,mobile}-{light,dark}.png` — no deliverable; rendered Mermaid progress report.
- `no-material-{desktop,mobile}-{light,dark}.png` — explicit empty warning with review actions retained.
