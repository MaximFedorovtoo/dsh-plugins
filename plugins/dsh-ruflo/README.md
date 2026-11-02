# dsh-ruflo — Ruflo (memory, tasks, swarms) for DSH agents

Wraps the [ruvnet/ruflo](https://github.com/ruvnet/ruflo) CLI into DSH tools with an explicit **scope**:

- **`project`** — the open project's working directory. Ruflo memory/tasks/swarm live next to the project (`.swarm/`, `.claude-flow/`).
- **`chat`** — an isolated directory per DSH session (`<DSH_HOME>/cache/ruflo/chats/<session-id>`). One chat never sees another chat's memory, tasks or swarm state.

A model can therefore attach Ruflo to a project (shared memory across chats) or to a single chat (private scratch memory), without mixing the two.

## Composer command

Type `/ruflo` in the composer, or open the `+` menu and pick **Ruflo** in the Commands section. A popup offers quick actions:

- status of the project scope or of this chat;
- remember / search in project memory, remember / search / stats in chat memory;
- list project or chat tasks;
- initialize Ruflo in the project or in this chat;
- chat swarm status + init.

Picking an action appends a ready prompt to the composer (the project or chat scope is spelled out in the prompt) — review it and send; the model then calls the matching `ruflo_*` tool. Nothing is executed from the menu itself.

## Tools

| Tool | What it does |
|---|---|
| `ruflo_status` | Agents/tasks/memory/performance JSON for the scope |
| `ruflo_init` | Explicitly initialize Ruflo in the scope (writes `.claude-flow/`, `.claude/`, `.swarm/`; no global changes, no mods) |
| `ruflo_memory` | `store`, `search` (semantic/keyword/hybrid), `list`, `stats`, `retrieve`; first call auto-creates the local memory DB |
| `ruflo_task` | `create`, `list`, `status`, `cancel` |
| `ruflo_swarm` | `init` (`--v3-mode`, topology, maxAgents), `status`, `stop` |
| `ruflo_agent` | `spawn` (type), `list`, `status`, `stop`, `metrics` |
| `ruflo_hooks` | `list`, `route`, `metrics`, `pretrain`, `statusline`, `session-restore/session-end`, `pre-task/post-task`, `pre-edit/post-edit`, `worker` |
| `ruflo_raw` | Escape hatch for `status, memory, task, swarm, agent, hooks, session, analyze, route, doctor, config, progress, neural, workflow, security, guidance, embeddings` |

Nothing is initialized implicitly except the memory database inside the chosen scope. `ruflo_init` is explicit because it writes service files into the project.

## Typical flows

**Project memory (shared between chats):**

```text
ruflo_init {scope:"project"}
ruflo_memory {scope:"project", action:"store", key:"arch/auth", value:"JWT + refresh in src/auth", provenance:"agent_output"}
ruflo_memory {scope:"project", action:"search", query:"auth"}
ruflo_task   {scope:"project", action:"create", type:"implementation", description:"Add refresh token rotation"}
```

**Chat scratch memory (private to this chat):**

```text
ruflo_memory {scope:"chat", action:"store", key:"chat/goal", value:"Проверить плагин"}
ruflo_memory {scope:"chat", action:"search", query:"плагин"}
```

`chat` state is stored under `<DSH_HOME>/cache/ruflo/chats/<session-id>`; delete that folder to reset a chat.

## Install

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-ruflo
dsh plugin --profile desktop add ruflo
```

Restart DSH. The plugin runs the CLI with DSH's bundled Node; no global npm install is needed.

## Configuration

```yaml
- id: ruflo
  config:
    cliPath: ""          # '' = profile's node_modules/ruflo/bin/ruflo.js
    projectRoot: ""      # '' = the agent session's workspace; set to pin project scope
    scopeRoot: ""        # '' = <DSH_HOME>/cache/ruflo
    timeoutMs: 60000
    initTimeoutMs: 180000
    allowRaw: true
```

## Notes and limitations

- Ruflo is its own runtime: its swarm/agents are not DSH Agent Teams and do not execute through DSH tools.
- `ruflo_init` writes `.claude-flow/`, `.claude/settings.json` and `.swarm/memory.db` into the chosen folder and updates `.gitignore`; chat scope keeps that inside the per-chat cache directory.
- The CLI may start a Ruflo background daemon for a scope directory; `ruflo_raw {command:"daemon", args:["stop"]}` is not exposed — use the CLI directly if you need to stop it.
- Secrets and project data can end up in Ruflo memory; keep `scope` appropriate and do not store credentials.

## License

MIT. Ruflo is MIT, © rUv (ruvnet).
## DeepSeek Harness init (0.3.0)

`ruflo_init` initializes for **DSH**, not Claude Code: it runs `ruflo init --codex --skip-claude`, so the project gets `AGENTS.md` + `.agents/` + `.claude-flow/` and **no** `.claude/` directory. After init the plugin appends a “Ruflo in DeepSeek Harness” section to `AGENTS.md`: the DSH agent is told to use the `ruflo_*` tools (project/chat scopes) instead of Claude Code slash commands. Use `force: true` to migrate an existing Claude-mode initialization; memory and swarm data are preserved.
## Executor: DeepSeek via DSH subagents (0.4.0)

Ruflo is a coordinator and memory, not an executor: its own agents need an Anthropic API key or Claude Code (`claude -p`), so with neither a DeepSeek runtime, a task stays pending and its Ruflo agents stay idle. DSH already has the DeepSeek runtime, so the plugin bridges the two:

- `ruflo_execute { scope, taskId | description }` picks a pending Ruflo task (or creates one), starts a **DSH subagent** with the parent's DeepSeek model, hands it the task, and asks it to store the result in Ruflo memory (`task/<id>/result`) plus an executor mapping (`task/<id>/executor`).
- `delivery: parent` — the tool returns the child id immediately and the completion notice arrives in the chat; the child works in the scope folder (`cwd`).
- Config: `subagentProvider` (`spawn` by default) and `executeMaxDepth` (`0` — the executor cannot delegate further).

Ruflo swarm readiness only means coordination state is initialized; execution happens in DSH.
## DeepSeek-only executor and key UI (0.5.0)

The plugin now speaks to exactly one model provider: **DeepSeek**.

- **Plugins → Ruflo** has a settings page: the DeepSeek API key is pasted there (it is never written into the project or into a repository file), the endpoint is fixed to `https://api.deepseek.com`, and the model is one of `deepseek-chat` / `deepseek-reasoner`.
- **Verify key** sends `GET https://api.deepseek.com/models` with the key. Nothing is sent to OpenRouter, Anthropic, OpenAI, or any other endpoint; a non-DeepSeek base URL is rejected by the host before any request.
- The key lives in `<DSH_HOME>/ruflo/settings.json` on this machine and is surfaced to the model only as `hasKey: true/false`.
- Every Ruflo CLI child gets `RUFLO_PROVIDER=openrouter`, `OPENROUTER_API_KEY=<key>`, `OPENROUTER_BASE_URL=https://api.deepseek.com` and `OPENROUTER_DEFAULT_MODEL=<model>`; `ANTHROPIC_*` and `OLLAMA_*` credentials are stripped from the child environment, so a non-DeepSeek model cannot answer.
- `ruflo_execute` prefers the **DeepSeek API executor**: `ruflo agent spawn -t coder -p openrouter -m <model> --task <task>` inside Ruflo, which executes through `api.deepseek.com`. If that fails (or no key is set), it falls back to a DSH subagent (also DeepSeek) with `executeMaxDepth` defaulting to `1`.