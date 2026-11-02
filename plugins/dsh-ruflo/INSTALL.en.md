# Installing dsh-ruflo

## 1. Requirements

- DeepSeek Harness **0.2.x**.
- The `ruflo` npm package installed into the profile. The plugin runs the CLI
  with DSH's bundled Node; no global npm install is required.

## 2. Install

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-ruflo
dsh plugin --profile desktop add ruflo
```

Restart DSH.

## 3. Scopes: project or chat

Every tool takes `scope`:

- `project` — the current project's working directory (or `projectRoot` from the
  config). Project memory is shared by all chats.
- `chat` — an isolated folder per session
  (`<DSH_HOME>/cache/ruflo/chats/<session-id>`). Private memory for one chat.

Switching the scope is just switching the state directory.

## 4. Verify

```text
ruflo_memory {scope:"chat", action:"store", key:"chat/hello", value:"test"}
ruflo_memory {scope:"chat", action:"search", query:"test"}
```

The first call creates `.swarm/memory.db` in the scope folder and returns JSON
with results (`score`, `preview`).

`ruflo_status {scope:"project"}` before initialization returns "not
initialized" — call `ruflo_init {scope:"project"}` first.

## 5. Configuration

```yaml
- id: ruflo
  config:
    cliPath: ""
    projectRoot: ""
    scopeRoot: ""
    timeoutMs: 60000
    initTimeoutMs: 180000
    allowRaw: true
```

## 6. Reset

- Chat: delete `<DSH_HOME>/cache/ruflo/chats/<session-id>`.
- Project: delete `.swarm/` and `.claude-flow/` in the project (careful: tasks
  and swarm state live there too).

## 7. Uninstall

```powershell
dsh plugin --profile desktop remove dsh-ruflo
```

The `ruflo` dependency can stay for CLI use or be removed separately.

## 8. Safety

Ruflo memory stores task descriptions and notes locally. Do not store secrets or
credentials. `ruflo_init` in a project writes service files and updates
`.gitignore` — call it deliberately.