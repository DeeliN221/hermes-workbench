# Localhost sidebar and TPS evidence

These are actual Chromium captures of the built Workbench bundle on localhost,
with public synthetic host/session fixtures. No production data is used.

- `before-*.png`: unmodified `bc4f3bf`, showing the globally hidden desktop
  sidebar and transcript TPS based on observed event gaps.
- `after-*.png`: restored desktop navigation and a single header chip, between
  the color button and title. The same fixture has provider output counts but
  no authoritative model duration, so the chip correctly shows an em dash.
- `desktop-*` / `mobile-*`: home, Kanban, chat and settings acceptance captures
  in both themes. Desktop navigation is hidden only on overview routes.
- `tps/*`: synthetic authoritative timing exercises live/final values, reload
  and placement in both themes and viewport sizes; not a claim that the current
  provider supplies model-only duration.

The current backend uses provider `output_tokens`/`outputTokens` from scoped
`token_usage_record`, `token_count`, or `thread/tokenUsage/updated` events.
Reasoning is a subset of output, not added again. Response counters are deduped;
thread totals are differenced. Tool text lengths are never counted. Previously,
time was inferred between generation or counter events, splitting gaps over
five seconds and known tool intervals. Those observations cannot exclude all
queueing, buffering, or short waits. They now carry `observed-event-gaps` and no
TPS. Legacy unqualified timing is also rejected by the frontend. Only the
explicit `model-generation` timing contract permits a numeric chip; the current
backend does not emit that contract.
