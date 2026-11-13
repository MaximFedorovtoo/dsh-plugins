# dsh-superuser

Superuser mode and a universal MCP hub for DeepSeek Harness.

## What it does

**Per-chat superuser mode.** One switch per chat replaces the permission preset
with `danger-full-access`: full file access in the sandbox and approval policy
`never`, so no approval prompts appear. Switching it off restores
`workspace-write` with approval prompts (`ask`).

- A new chat gets superuser mode automatically (`autoEnable: true` in
  `cordis.patch.yml`); the chats that are already open when the plugin activates
  are switched too.
- Turn it off or back on for the current chat anywhere:
  - the panel in the left sidebar (a switch per chat),
  - the `SU` toggle in the chat header,
  - the model-facing tool `superuser_mode` (`get` / `on` / `off`),
  - the HTTP API below.
- The choice is stored in the chat's session log through the public
  permission-preset service, so it survives reloads and applies to later turns.

**Universal MCP hub.** Any MCP server can be added at runtime, without editing a
profile patch and without a restart:

- transports: `stdio` (spawn a local process) and streamable `http` (a URL);
- servers persist in `%USERPROFILE%\.dsh\superuser\mcp-servers.json`;
- actions: add, update, remove, connect, disconnect, reconnect-on-drop;
- while a server is connected, each of its tools is registered as
  `mcp__<server>__<tool>` for the model;
- calls run in parallel per server (no global lock), with per-call timeouts and
  compact error messages; a dropped server reconnects with exponential backoff;
- the model can manage everything through the `mcp_manage` tool
  (`list` / `add` / `update` / `remove` / `connect` / `disconnect` / `call`).

**Bundled desktop MCP server.** The hub ships with a `desktop` stdio server
(`desktop-mcp.js`) that drives any desktop application through the installed
`agent-desktop` CLI:

`apps`, `windows`, `snapshot`, `click`, `type`, `press`, `screenshot`,
`scroll`, `find`, `wait`, `set_value`.

Read-only tools (`apps`, `windows`, `snapshot`, `screenshot`, `find`) do not focus
windows and do not move the pointer.

## Risk note

Superuser mode gives the model **full file access and no confirmations**. It is
meant for trusted, local work. OS prompts remain by default: UAC confirmations
are turned off only by the explicit one-time setup in the "Windows: no OS
confirmations" block below (one user consent); SmartScreen does not apply to
programs that are already installed, and Windows needs no separate
accessibility permission.

MCP servers added here run with the same rights as the Harness process. Only add
servers you trust.

## Install

Install the bundle from this directory through Plugin Manager (`install_bundle`
with this package folder). `cordis.patch.yml` inserts one row, `superuser`.

## How to enable / disable

- Panel (sidebar → Superuser) and the chat-header `SU` toggle: per chat, on/off.
- Model tool: `superuser_mode { "action": "on" | "off" | "get" }`.
- API: `POST /api/superuser/permission { "sessionId": "...", "enabled": true }`.
- Whole plugin: disable the bundle in Plugin Manager; the MCP store stays on disk,
  the permission presets already recorded in chats are not rewritten.

## MCP hub usage

Examples for the `mcp_manage` tool:

```json
{ "action": "add", "name": "filesystem", "transport": "stdio",
  "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\work"] }
```

```json
{ "action": "add", "name": "remote", "transport": "http",
  "url": "http://127.0.0.1:8090/mcp" }
```

```json
{ "action": "connect", "server": "filesystem" }
{ "action": "call", "server": "filesystem", "tool": "list_directory", "callArgs": { "path": "C:\\work" } }
```

The bundled desktop server is always configured as `desktop` and connects on
startup. Example call: `{ "action": "call", "server": "desktop", "tool": "apps" }`.

Server ids are safe lowercase names; the persisted store is plain JSON and can be
backed up or edited while the Harness is stopped.

## HTTP API (browser panel contract)

All routes return JSON (`content-type: application/json; charset=utf-8`) with the
envelope `{ "ok": true, "data": ... }` or
`{ "ok": false, "error": { "message": "...", "code": "..." } }`.

| method | route | body / query | result |
|---|---|---|---|
| GET | `/api/superuser/state?sessionId=<id>` | — | `{sessionId, session:{title?}, permission:{preset,sandbox,approval,enabled}, servers:[ServerView]}`; without `sessionId` → `permission: null` |
| POST | `/api/superuser/permission` | `{sessionId, enabled}` | the same state data |
| GET | `/api/superuser/mcp/servers` | — | `{servers:[ServerView]}` |
| POST | `/api/superuser/mcp/servers` | `{action:'add'\|'update'\|'remove'\|'connect'\|'disconnect', server:{id?,name,label?,transport,command?,args?,env?,url?,autoConnect?}}` | `{server:ServerView}` |
| POST | `/api/superuser/mcp/call` | `{server, tool, args}` | `{result}` (raw MCP tool-call result) |

`ServerView` is
`{id,name,label,transport,command?,args?,url?,autoConnect,status:'connected'|'disconnected'|'starting'|'error',tools:[{name,title?,description,inputSchema}],lastError?}`.

Errors: `404` unknown session or unknown server, `409` agent not live (the chat
is stored but has no live agent in this process — open it and retry), `400`
malformed JSON or invalid fields, `405` wrong method (carrier).

## Windows: без подтверждений ОС

Windows asks for confirmation of its own (UAC) before privileged actions. This
bundle cannot remove those from inside the app — Windows does not allow that.
It does offer a **one-time setup the user runs from the panel**, with exactly
one Windows consent dialog:

- **Enable** — writes `C:\Users\Public\dsh-superuser\windows-setup.ps1` and
  starts it elevated once (the public folder keeps the elevated command line
  ASCII-only: a localized profile path such as `C:\Users\ПК` is mangled when it
  crosses the elevation boundary). The script sets
  `ConsentPromptBehaviorAdmin=0` and `PromptOnSecureDesktop=0` (UAC stays
  enabled: `EnableLUA=1`; reversible, no reboot) and registers a logon task
  `DSH Superuser Elevated` (`/RL HIGHEST /IT`) that starts the current DSH
  executable, so later starts need no confirmation either.
- **Disable** — the same script restores `ConsentPromptBehaviorAdmin=5`,
  `PromptOnSecureDesktop=1` and deletes the task.
- **Restart** — runs the task now (`schtasks /Run`) so an elevated DSH starts;
  the current DSH window closes.

`windowsAdmin { "action": "status" }` and `GET /api/superuser/windows` are
read-only: they report whether the current DSH runs elevated, the UAC values,
whether the task exists and its run level, plus the last setup log lines. The
tool cannot enable anything — only the user's click in the panel can.

Notes and trade-offs:

- The generated script has a `-DryRun` mode that prints the exact registry and
  task commands without changing anything, and it refuses to change anything
  when it is not elevated (exit code 5).
- Disabling UAC notifications is a **security trade-off**: programs that
  normally raise a UAC prompt will start without one. Revert with **Disable**
  (or restore `ConsentPromptBehaviorAdmin=5`, `PromptOnSecureDesktop=1`
  manually) and delete the logon task.
- SmartScreen only gates downloaded/unknown binaries, so it does not appear for
  installed tools; it is not changed by this setup.
- Windows accessibility (UI Automation) needs no separate permission, but
  windows owned by elevated applications can be operated only from an elevated
  DSH — that is what the logon task provides.
- UAC prompts of the operating system itself are not "bypassed silently":
  the user gives one explicit consent at setup, and Windows remembers it.

## Configuration

`cordis.patch.yml` row config:

| key | default | meaning |
|---|---|---|
| `autoEnable` | `true` | apply superuser mode to new and already-live agents |
| `mcpStorePath` | `""` → `<DSH_HOME>/superuser/mcp-servers.json` | MCP server store |
| `connectTimeoutMs` | `20000` | MCP handshake + `tools/list` budget |
| `callTimeoutMs` | `90000` | one remote MCP tool-call budget |

## Limitations

- OS prompts are never bypassed silently: UAC is removed only by the one-time
  setup in the "Windows" block (one consent), SmartScreen does not apply to
  installed programs, and Windows needs no separate accessibility permission.
- A tool registered while a server connects may become callable one model step
  later; `mcp_manage` is always available for the same import in the meantime.
- Permission switching requires a live chat (a stored but unopened chat answers
  `409`).
- The bundled desktop server needs the `agent-desktop` npm package in the active
  profile (the same dependency `dsh-agent-desktop` uses).
