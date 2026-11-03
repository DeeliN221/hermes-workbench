# OpenCode Go model selection

Localhost mock-host acceptance for the Workbench profile editor.

## Evidence

| View | Screenshot |
| --- | --- |
| Desktop light | [desktop-light.png](desktop-light.png) |
| Desktop dark | [desktop-dark.png](desktop-dark.png) |
| Mobile light | [mobile-light.png](mobile-light.png) |
| Mobile dark | [mobile-dark.png](mobile-dark.png) |

The browser test:

- opens `/profiles?edit=default&section=model`;
- saves with the OpenCode Go provider and `opencode-go/kimi-k3`;
- checks the saved payload is `{ provider: "opencode-go", model: "opencode-go/kimi-k3" }`;
- runs desktop and mobile, light and dark, with no console or page errors.

Run:

```sh
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome-headless-shell \
  node tests/browser/opencode-go-check.mjs
```

The screenshots use deterministic mock data only. No live OpenCode credentials
or production Workbench instance were used.

