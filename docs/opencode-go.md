# OpenCode Go in Workbench / OpenCodex

OpenCode Go subscriptions expose an API for other **coding agents**, including
OpenCodex. This integration keeps GPT and direct DeepSeek API choices alongside
`opencode-go/<model-id>` choices. A visible model is not proof that the key,
subscription, workspace privacy settings or runtime routing are valid.

## Official findings (checked 2026-11-04)

Sources: [OpenCode Go](https://opencode.ai/v2/docs/console/go/),
[Inference API](https://opencode.ai/v2/docs/console/api/inference),
[Codex harness](https://opencode.ai/v2/docs/console/harnesses/codex/),
[OpenCodex providers](https://opencodex.me/guides/providers/).

- Subscribe in the OpenCode Console and create a **personal API key** in that
  workspace. Inference uses `Authorization: Bearer <key>`; this is not a ChatGPT
  login or an OpenCodex management token. Go Teams does not cover service accounts.
- Go is for coding-agent traffic. Use an identifying User-Agent and a stable
  `x-opencode-session` per conversation. Do not use a single fixed session ID for
  every chat. OpenCodex's Go transport derives that header from the session lane.
- Go / Go Plus / Go Teams currently cost $10 / $40 / $20 per member per month.
  Each model has a monthly dollar allowance; the 5-hour and weekly limits are
  20% and 50% of that allowance. Consult the live table for individual allowances
  and over-limit behavior; this is not unlimited general-purpose API access.
- Workspace privacy/region settings can restrict models. DeepSeek requires the
  Global region; Muse Spark Contributor requires allowing paid training endpoints.

| API | Endpoint / use |
| --- | --- |
| Public Go catalog | `GET https://opencode.ai/inference/go/v1/models` |
| OpenAI Chat | `POST https://opencode.ai/inference/go/openai/v1/chat/completions` |
| OpenAI Responses | `POST https://opencode.ai/inference/go/openai/v1/responses` |
| Anthropic | `POST https://opencode.ai/inference/go/anthropic/v1/messages` |
| Gemini | `POST https://opencode.ai/inference/go/google/v1beta/models/<model>:generateContent` |

The official Codex guide documents Responses translation for all Go model
families. OpenCodex 2.88.0 instead has a built-in mixed-protocol Go preset: its
recognized bases are `https://opencode.ai/zen/go/v1` and
`https://opencode.ai/inference/go/v1`. Use that preset for this proxy integration;
changing its base to the native Codex `/openai/v1` URL can bypass the proxy's
Go-specific session-header and model-wire recognition. The helper writes the
canonical legacy base: OpenCodex 2.88.0 normalizes the inference alias back to
`/zen/go/v1` internally. The catalog adapter independently uses the current
public inference URL.

The current documented roster includes Grok 4.7; GLM-5.3-Flash, 5.3, 5.2;
GPT 6 Luna and 5.6 Luna; Claude Haiku 5.5; Gemini 4 Argon; Kimi K3.1 Pro,
K3 and K2.7 Code; LongCat-2.0; Step 5 Preview; Beam Free and Iceman Contributor
Free; MiMo-V2.6-Flash/Pro and V2.5/Pro; MiniMax M3.1 Flash and M3;
Muse Spark 1.3/1.2 Contributor; Qwen3.8 Max/Flash and 3.7 Plus;
DeepSeek V4.1 Flash and V4 Pro; Hy4 preview and Hy3.
Models change, and some have region/time restrictions. Workbench fetches IDs,
reasoning options, modalities and context sizes dynamically; it does not hardcode
this dated roster. An older OpenCodex build may need upgrading for newly added
model protocols. A live unauthenticated catalog request with the Workbench
User-Agent returned 28 IDs during validation; the documentation roster also
mentions MiMo V2.5 variants absent from that response. The fetched catalog is the
source of selectable IDs, not this prose list.

## Configure the intended OpenCodex instance

Keep the Codex app-server connected to its existing OpenCodex proxy. Do **not**
switch the app-server's global provider to a direct Go endpoint: the proxy routes
qualified IDs and preserves the other providers.

1. Obtain the personal key privately in the OpenCode Console.
2. Supply `OPENCODE_GO_API_KEY` to **both** the OpenCodex and Workbench service
   environments using the deployment's secret manager or a private environment
   file outside the repository. Never pass it as a command argument, paste it into
   Workbench, or include it in diagnostics. Workbench also accepts `OPENCODE_API_KEY`;
   the helper below specifically references `OPENCODE_GO_API_KEY`.
3. Stop only the intended test OpenCodex instance before editing its config.
   Run the helper with an explicit instance directory:

   ```sh
   python3 scripts/configure-opencode-go.py --opencodex-home /path/to/test-opencodex --dry-run
   python3 scripts/configure-opencode-go.py --opencodex-home /path/to/test-opencodex
   ```

   It atomically adds `providers.opencode-go` to `config.json`, with only the
   literal `${OPENCODE_GO_API_KEY}` reference. It preserves other providers,
   model selections and `defaultProvider`. An existing Go entry is left unchanged
   and must be checked separately. The helper neither starts nor restarts services.
4. Start that test instance with its private environment. Enable the desired Go
   models in OpenCodex's model selection and refresh Workbench. In the profile
   editor choose **OpenCode Go**, then `opencode-go/kimi-k3`, for example. The
   chat picker also merges Go catalog entries with the app-server catalog. If the
   profile uses an explicit visibility list, enable the Go models under
   **Settings → Chat model visibility**; existing visibility preferences are
   deliberately preserved.

OpenCodex owns inference authentication, model-prefix routing and session headers.
Workbench only reads the public model catalog; it sends **no key or cookie** to
that endpoint. Its credential-presence check controls whether to offer Go choices,
but it does not validate subscription access. Catalog failures leave GPT and
DeepSeek choices usable.

For compatibility, Workbench can also detect a private OpenCode
`${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json` (`opencode-go`, type `api`,
field `key`) or `WORKBENCH_OPENCODE_AUTH_FILE` (JSON `token` or legacy `cookie`).
Those files must belong to the service user and be mode 0600. These sources
**do not configure OpenCodex's key**. Cookies are a legacy usage-card source,
not the documented inference authentication. The existing usage card separately
uses `/zen/go/v1/usage` and its file-based credentials; setting only the environment
key does not enable that card.

`WORKBENCH_OPENCODE_BASE_URL` overrides the catalog base for a test gateway;
omit the trailing `/v1`. No default-provider or daily-instance changes are needed
for localhost validation.

## Validation boundary

Unit tests cover configuration preservation, secret references, catalog metadata,
and failure isolation. The browser check uses the built frontend and mocked APIs
on localhost. `tests/opencode-go-runtime-check.mjs` optionally checks the installed
OpenCodex routing and request construction with synthetic credentials and a local
HTTP sink (see its header). These checks do not prove a user's paid subscription
can complete inference; that requires their private configuration and a deliberate
coding request after they apply it. No live inference or deployment is performed
by these checks.
