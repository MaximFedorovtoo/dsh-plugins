# Kimi for DeepSeek Harness — subscription plan and pay-per-token API

`dsh-llm-kimi` connects [Kimi](https://www.kimi.com) (Moonshot AI) models to DeepSeek Harness as two first-class provider routes. Both speak Kimi's Anthropic-compatible Messages protocol — the protocol Moonshot documents for third-party tools such as Claude Code, OpenCode and Codex — so the harness gets streaming text, tool calls, reasoning and image input without protocol-conversion proxies.

| Route | What is billed | Where the key comes from | Default endpoint |
|---|---|---|---|
| `kimi-code` | Your **Kimi Code subscription** (the plan that powers Kimi Code CLI / Desktop) | [Kimi Code console](https://www.kimi.com/code/console) → **Create API Key** | `https://api.kimi.ai/coding` (international) / `https://api.kimi.com/coding` (mainland China) |
| `moonshot` | **Pay per token** on the Kimi API platform | [Kimi API platform](https://platform.kimi.ai/console/api-keys) → API Keys | `https://api.moonshot.ai/anthropic` (international) / `https://api.moonshot.cn/anthropic` (China) |

The subscription route is the one to use when you already pay for Kimi Code: requests draw from the membership quota instead of buying separate API credits. Moonshot officially supports this in third-party tools; this plugin is the DSH adapter for it.

Since 1.1.0 the package also adds a **Kimi** entry to the left sidebar of the Web/Desktop client. Open it to save the API key, see the live routes and models, and jump to the Kimi consoles and the Kimi account page. A CLI-only profile still gets the routes: the panel is one surface, not the only way in.

## Models

**`kimi-code` (subscription):**

| Model id | Name | Context (preset) | Reasoning |
|---|---|---|---|
| `k3.1-pro` | Kimi K3.1 Pro | 262144 (raise to 1048576 on Pro+) | `low` / `high` / `max`, default `high` |
| `k3.1-pro-highspeed` | Kimi K3.1 Pro HighSpeed | 262144 (1048576 on Pro+) | always thinking |
| `k3` | Kimi K3 | 262144 (1048576 on Pro+) | `low` / `high` / `max`, default `high` |
| `k3-256k` | Kimi K3 256K | 262144 | `low` / `high` / `max`, default `high` |
| `kimi-for-coding` | Kimi for Coding (K2.8) | 1048576 | `low` / `high` / `max`, default `max` |
| `kimi-for-coding-highspeed` | Kimi for Coding HighSpeed | 262144 | always thinking |

The context window of K3-family subscription models depends on the membership tier (Plus/Moderato get 256K, Pro/Allegretto and above get 1M). The preset uses the conservative 256K value that every paid tier can serve; a higher tier raises it in the profile patch (see [Configuration](#configuration)). Available models also depend on the tier: see [Kimi Code model docs](https://www.kimi.com/code/docs/kimi-code/models.html).

**`moonshot` (pay per token):** `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`, `kimi-k3` — all 1M context, all with `low` / `high` / `max` effort. Moonshot's Anthropic-compatible Messages endpoint documents the K3 family; older K2 models stay off this route.

Every catalog entry accepts **images** (the models are multimodal) and text. Attach images in the composer as usual: the plugin resolves durable attachments into base64 request images.

## Install

### Discover (recommended)

Enable **Custom plugin indexes** on the Plugins page, add the index source

```
https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
```

and install **Kimi provider and connector** from the list.

### Git

```sh
dsh plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-llm-kimi"
```

Use the commit SHA from the [commits page](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main).

### Local folder / manual profile install

**Plugins → Add plugin** accepts the absolute path to this folder. When the Desktop profile is managed by the application, the equivalent manual install is:

```sh
node scripts/install.mjs --profile desktop
```

It copies the package to `$DSH_HOME/profiles/desktop/plugins/dsh-llm-kimi` and appends one insert entry to that profile's `cordis.patch.yml` (backing the file up first). `node scripts/install.mjs --uninstall` removes both. Restart DSH afterwards — the profile patch is read at boot.

## Connect a key

In the Web/Desktop GUI the shortest path is the **Kimi** entry in the left sidebar:

1. Open **Kimi** in the sidebar. The page lists both routes with their endpoints and credential references, and marks **Kimi Code — подписка** as **Recommended** when you pay for Kimi Code.
2. Press **Open console**, create the key in the [Kimi Code console](https://www.kimi.ai/code/console) (up to five keys, the value is shown once), paste it into the subscription card and press **Save key**. The button under the field leads to your [Kimi account](https://www.kimi.ai/settings/account) — the plan, access and balance live there.
3. The page refreshes the saved state by itself after any key change; the models section lists what the provider currently advertises. Open the composer model picker and choose a Kimi Code model (for example `Kimi K3.1 Pro` or `Kimi for Coding`); the reasoning selector beside the model offers the route's documented levels.

The same keys can be entered in **Settings → Models**, where the rows **Kimi Code (подписка)** (`kimi-code`) and **Kimi API (оплата по токенам)** (`moonshot`) appear:

1. Press **Edit** on the row you use and paste the API key. The key is stored write-only in the harness credential store under `KIMI_CODE_API_KEY` or `MOONSHOT_API_KEY`; it never lands in `cordis.patch.yml` or the session log.
2. Open the composer model picker and choose a Kimi model (for example `Kimi K3.1 Pro`).

For CI or a shell-only setup the same references can be exported instead of typed:

```sh
export KIMI_CODE_API_KEY=...   # subscription route
export MOONSHOT_API_KEY=...    # pay-per-token route
```

The file-backed credential provider layers the stored value above the launch environment, so a key saved in the UI always wins.

## Configuration

Defaults live in the plugin schema (`catalog.js`); a deployment overrides individual fields in the profile patch without restating the rest:

```yaml
- id: llm-kimi
  config:
    providers:
      kimi-code:
        baseURL: https://api.kimi.com/coding   # mainland-China subscription endpoint
        models:
          - id: k3.1-pro
            contextWindow: 1048576             # Pro / Allegretto tiers and above
      moonshot:
        apiKeyEnv: MY_MOONSHOT_KEY             # custom credential reference
```

Every provider accepts `displayName`, `baseURL`, `apiKeyEnv`, `authStyle` (`x-api-key` or `bearer`), `maxTokens` (default 32768), `defaultContextWindow`, `streamIdleTimeoutMs` (default 300000) and a full `models` list. A model entry accepts `id`, `name`, `description`, `contextWindow`, `maxTokens`, `inputModalities` (`text` / `image`) and `reasoning` (`efforts`, `always`, `none`), plus `defaultReasoningEffort` for `efforts` models. A model list replaces the preset list; entries that share an id inherit the preset metadata for unset fields.

Routing a new model that Kimi ships later is one patch entry: add a model with its id, context window and reasoning style and it appears in the picker.

## How it works

- The plugin registers both routes with the harness `llm` service and declares them in the configurable-provider directory, so the Models page can edit the connection without a restart.
- The package ships a browser half (`client.js`) as well. It registers the `Kimi` sidebar entry and its main-column page, writes the key through `remote.credentials.set`, and reads the live route directory and model catalog through the shipped Host Remotes. It uses the host theme tokens and ships English and Russian copy, so it follows light/dark and the active language without extra wiring.
- Requests go to `{baseURL}/v1/messages` with `stream: true`, `max_tokens`, top-level `system`, the converted tool list and `output_config.effort` for models with a selectable level. The subscription route authenticates with `x-api-key` (Claude Code's `ANTHROPIC_API_KEY` style); the API-platform route uses `Authorization: Bearer` (Claude Code's `ANTHROPIC_AUTH_TOKEN` style).
- Responses are translated chunk by chunk: `thinking` blocks become reasoning deltas, `text` becomes text deltas, `tool_use` becomes tool calls. The thinking `signature` is persisted in adapter-owned replay state and passed back unchanged on later turns, because Kimi's Messages API requires it.
- Tool names are validated against Kimi's `^[a-zA-Z_][a-zA-Z0-9-_]{0,127}$` grammar and mapped back, so DSH tools with unusual names keep working.
- Usage (including cache reads and cache writes) feeds the harness token counters; failures carry the usual harness codes (`AUTH`, `RATE_LIMIT`, `QUOTA`, `CONTEXT_WINDOW_EXCEEDED`, `TIMEOUT`, …).

No dependencies, no build step: plain ES modules that load directly in the DSH Node runtime.

## Limitations

- Authentication uses a static API key. Kimi Code's browser OAuth device flow (`auth.kimi.com`) is not implemented; create a key in the Kimi Code console instead — Moonshot supports these keys in third-party tools.
- Video input is not sent; images and text are.
- The subscription plan's model availability and context tier are enforced by Kimi. A request for a model outside the plan fails with a provider error (usually HTTP 403); switching the row's key or plan is the fix.
- Kimi bills the subscription quota or the API account directly. The plugin does not add a separate cost model.
- The sidebar panel is a Web-client surface. A CLI-only composition still serves the provider routes, but it renders no panel; keys then come from Settings → Models or the environment.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401` / `AUTH` | The key belongs to the other platform. A Kimi Code console key works only on `api.kimi.ai/coding`, a platform key only on `api.moonshot.ai/anthropic`. |
| No **Kimi** entry in the sidebar | The Web client half is not active: install 1.1.0 or later, make sure the Web/Desktop composition serves client plugins, and reload the page. |
| `403` right after the first request | The plan does not include that model or the 1M context tier. Try `kimi-for-coding` / `k3-256k`, or lower `contextWindow` in the patch. |
| `400` mentioning context | The conversation exceeded the configured context window. Compact, or raise `contextWindow` for a tier that supports it. |
| `MISSING_CREDENTIAL` | No key is stored under the row's reference and the environment does not export it. |
| Key typed but the row still shows "not configured" | The Models page updates after a refresh; reopen Settings → Models. |

## Uninstall

**Plugins → Installed** → disable/remove the bundle, or `node scripts/install.mjs --uninstall` for the manual install. Stored API keys are left in the credential store; delete them in Settings → Models if desired.
