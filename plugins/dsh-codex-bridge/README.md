# Codex Bridge — move projects and chats from OpenAI Codex into DeepSeek Harness

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): it finds the projects and threads of the **OpenAI Codex** app and brings them into DSH — the project folder is registered as a workspace and a chat with the transcript is created, ready to continue.

The point that differs from copying importers: **by default the project stays in its original folder**. No new folder appears next to it and no `-2`, `-3` copies are made — the DSH workspace points at the same directory the project lived in under Codex. The copy mode is still available as an option (`importMode: copy`).

[Русская версия](README.ru.md) · [Installation guide](INSTALL.en.md)

## What it does

- Reads the saved Codex projects (`~/.codex/.codex-global-state.json`) and threads (`~/.codex/sessions/**`) without modifying Codex data.
- Imports a project and its transcript into DSH:
  - **in-place (default)** — the workspace is registered at the original project path, no files are copied;
  - **copy** — the project is copied into `targetRoot` (default `Documents/deepseek-harness/Codex`) with `.git`, and a later import refreshes **the same** folder.
- Creates a DSH chat session from the Codex transcript (user/assistant) and attaches it to the workspace.
- Supports **bulk import**: the project's "All chats" button imports every thread, and "Import everything" imports every project with all of its chats. Each thread gets its own chat; a repeat run appends only new messages.
- A later import **appends only new messages** to the same chat, without duplicate sessions.
- Keeps a `.codex-import.json` manifest that marks an imported project. In in-place mode the manifest lives inside the project folder (the only file the plugin creates there); deleting it turns the folder into an ordinary one.

## Where it shows up

- Sidebar → **Codex** icon → the "Import from Codex" page: projects and threads, Import/Update, the result and an "Open chat" button.
- Model tool `codex_import` (`action: "catalog" | "import"`).
- Settings → Plugins shows the plugin card with its icon and description.
- Panel routes: `GET /api/codex-import/catalog`, `POST /api/codex-import/import` (owner of the session only).

## Install

Package `dsh-codex-bridge`, DSH 0.2.x, plain JavaScript with no dependencies and no build step. Methods are in [INSTALL.en.md](INSTALL.en.md); the short version:

```powershell
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-codex-bridge'
```

In PowerShell use `dsh --% plugin --profile desktop add "..."` — otherwise the `&` in the address is eaten by the `dsh.cmd` wrapper (details in [INSTALL.en.md](INSTALL.en.md)).

or **Plugins → Add plugin** → `github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-codex-bridge`; or run `installer\install.cmd` (Windows, no git). Restart DSH afterwards.

## Configuration

The `codex-import` row in the profile's `cordis.patch.yml` (or the same row in the package layer):

| Field | Default | Meaning |
|---|---|---|
| `importMode` | `in-place` | `in-place` keeps the project in its own folder; `copy` clones into `targetRoot` |
| `codexHome` | `''` → `$CODEX_HOME` or `~/.codex` | Where Codex data lives |
| `targetRoot` | `Documents/deepseek-harness/Codex` | Where copy mode writes |
| `maxTranscriptChars` | `0` | `0` imports the whole transcript; a positive number keeps only the newest N characters |
| `excludeNames` | `node_modules`, `.next`, `.nuxt`, `.turbo`, `.cache` | Never copied in copy mode |

Enabling copy mode:

```yaml
- id: codex-import
  config:
    importMode: copy
    targetRoot: D:\CodexProjects
```

## Import behaviour

- **First in-place import:** the workspace is the original project folder; a chat with the history is created; `.codex-import.json` is written into the folder.
- **Bulk import:** "All chats" on a project card imports every thread of that project, "Import everything" imports every project. A failing thread does not stop the rest and is reported in the summary.
- **Later imports:** same folder, same chat; only new Codex messages are appended (`appended` in the response).
- **First copy import:** `targetRoot/<project name>`; when that folder already exists and is a project copy (has `.git` or a manifest), it is reused and refreshed instead of getting a `-2` suffix. A suffix appears only when the name is taken by a **different** Codex project or by an unrelated non-empty folder.
- **Switching modes:** an imported project is located through its manifest, so a later import does not create a second copy; changing the mode for one project without removing the manifest is not recommended.

## Import response

```json
{
  "ok": true,
  "updated": false,
  "projectId": "4e3573dd-…",
  "projectName": "server",
  "threadId": "01a0f78d-…",
  "targetDir": "D:\\projects\\server",
  "workspaceId": "…",
  "sessionId": "session-…",
  "sessionTitle": "Codex · server · Check server availability",
  "sessionCreated": true,
  "appended": 0,
  "messages": 70,
  "copiedFiles": 0,
  "importMode": "in-place",
  "eventCount": 0,
  "attached": true
}
```

- `updated` — the project was already imported and has been refreshed;
- `copiedFiles` — always 0 in in-place mode;
- `appended` — how many new messages were appended to the existing chat;
- `importMode` — the mode actually used;
- `attached` — the chat is attached to the workspace; otherwise the reason is in `warning`.

## Limitations

- Codex data is read-only. In in-place mode the plugin creates one service file, `.codex-import.json`, inside the project folder.
- Copy-mode updates overwrite files with Codex versions but do not delete files Codex no longer has.
- A thread without text messages imports only the project (no chat session).
- Appending works only while the session is not open by the agent; otherwise files update and `warning` names the reason.
- The parser is sensitive to the Codex log format; `src/codex-source.js` needs updating when it changes.
- In-place import changes the DSH workspace, not the project's source code.

## Checks

- `test/target-dir.test.mjs` — self-check of folder selection: an empty folder is reused, an existing project copy (`.git`) is adopted, a different project or an unrelated non-empty folder gets a suffix, and the manifest is found by id. Run: `node test/target-dir.test.mjs`.
- Syntax of every module — `node --check`.
- Installation from the repository was checked on a throwaway DSH profile: `dsh plugin add` plus the `id: codex-import` row in `dsh --profile <name> --dump-config`.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with OpenAI or DeepSeek; "DeepSeek Harness" is a DeepSeek product, "Codex" is an OpenAI product.
