# Fleet review browser evidence

Real localhost Chromium captures with synthetic English fixture tasks. No live
user content or credentials appear in these screenshots. `before.png` uses the
previous deployed full release's assets against the same fixture API; the other
captures show this change. No image generation or compositing was used.

The browser regression exercises pending, missing credentials, conflicts,
feedback retention, successful note + request changes and approval, desktop and
mobile in both themes, W menu keyboard navigation, Escape and focus restoration.

For an isolated test against a real fleetd executable, set `FLEET_TEST_BINARY`
and run `uv run --no-project --with-requirements requirements-dev.txt python
tests/browser/fleetd-review-integration.py`. This starts a localhost process with
its own temporary database and never writes to a deployed fleetd instance.
