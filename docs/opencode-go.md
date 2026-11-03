# OpenCode Go models

Workbench can list OpenCode Go models alongside Codex and direct-API models.
The integration is read-only: Workbench reads the model catalog and never sends
credentials to the browser or writes them to the repository.

## Authentication

Use one of these server-side credential sources:

1. **Existing OpenCode auth file (default).** The server reads
   `~/.local/share/opencode/auth.json` and looks for an `opencode-go` entry
   with `type: "api"` and `key`. This is the same file used by OpenCode.
2. **Dedicated private file.** Set `WORKBENCH_OPENCODE_AUTH_FILE` to an absolute
   path containing a mode-0600 JSON object with either `{"token": "..."}` or
   `{"cookie": "..."}`.

The Workbench service account must own the file and it must not be readable by
group or other users. Do not paste credentials into the Workbench UI.

## Endpoint

The adapter uses the official OpenCode Go gateway:

- Base: `https://opencode.ai/zen/go`
- Model list: `GET https://opencode.ai/zen/go/v1/models`
- Usage (existing allowance card): `GET https://opencode.ai/zen/go/v1/usage`

Override the base with `WORKBENCH_OPENCODE_BASE_URL` only when testing a
compatible gateway. The value must not include the trailing `/v1`.

## UI behavior

- Profile editor → Default model lists `OpenCode Go` only when credentials are
  present and the catalog can be read.
- The chat model picker merges `opencode-go/<model>` entries after the Codex
  catalog. Existing GPT and DeepSeek choices remain available.
- If the provider is missing or unreachable, the profile editor and chat keep
  the existing Codex choices; the OpenCode request is best-effort.

