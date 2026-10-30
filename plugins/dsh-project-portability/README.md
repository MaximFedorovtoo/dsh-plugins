# dsh-project-portability — portable DSH projects

A DeepSeek Harness plugin that exports a whole project into **one `.dshpack`
file** and restores it on another computer — with the project files, every chat,
their full history and the attachments. Work continues in the same chats, with
no context loss.

```
DSH project (workspace)
├── project files             → project/...
├── every chat of the project → sessions/<nnnn>/meta.json + events.jsonl
├── attachments used by chats → attachments/...
└── archive description       → manifest.json
                ↓
        project-2026-10-30.dshpack   (gzip + tar, one file)
                ↓
   external drive → another computer → project_import
```

| Plugin | What it does | Runs on |
|---|---|---|
| `dsh-project-portability` | Exports a project as one `.dshpack` archive and imports it on another computer: files, every chat with its history, and attachments. | Windows, macOS, Linux |

[Русская версия](README.ru.md) · [Installation guide](INSTALL.en.md)

## What is carried over

- **Project files** — the complete project folder tree (including `.git` when
  present); symbolic links are skipped with a warning.
- **Every chat of the project** — each session with its complete v4 event log:
  messages, tool calls, results, titles and metadata. Import creates a new chat
  with the same content, attached to the new project folder.
- **Attachments** — images and uploaded files referenced by the chat events. The
  DSH store is content-addressed, so the bytes travel unchanged and the old
  references stay valid.
- **Project registration** — on the target machine the project appears in the
  DSH sidebar as a workspace, with its chats inside it.

## What is deliberately NOT carried over

- **Spill files** (very long tool outputs flushed into a per-process temporary
  folder). They are ephemeral DSH data and are already invalid on the source
  machine after a restart. Chats do not break because of this: their history and
  previews stay.
- **Live processes and queues** — the archive is a static snapshot.
- **Absolute paths outside the project root** (for example references to files in
  other folders) stay as they were: only the project path is rewritten.
- `.dsh` settings, keys and credentials are not included (personal data).

## Installation

The plugin installs like every other package in this repository. Requirements:
DSH 0.2.x (tested on 0.2.1-rc.3), the `desktop` profile or any other profile.
There are no dependencies: plain JavaScript, nothing else to install.

```powershell
# CLI: from this repository by git address with a path subdirectory
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-project-portability'
```

In PowerShell the `&` is eaten by the `dsh.cmd` wrapper — use the stop-parsing
token:

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-project-portability"
```

Or from a local folder: download the repository, unpack it, and give
**Plugins → Add plugin** the absolute path to `plugins/dsh-project-portability`.
After installing, press `Ctrl+R` in the DSH window (or restart the app).

Details and failure modes are in [INSTALL.en.md](INSTALL.en.md).

## Usage

**UI.** The sidebar gains a **Project portability** page:

- the list of projects with their paths and chat counts, and an **Export**
  button on each card;
- an **Import archive** block — a path to a `.dshpack` (with quick buttons for
  recent archives from the export folder) or a manually typed path.

**Model tools** (you can ask the agent in words):

| Tool | What it does |
|---|---|
| `project_list` | list projects, paths and chat counts |
| `project_export` | `project` + optional `output` → `.dshpack` archive |
| `project_import` | `archive` + optional `targetDir` → restore the project |

**Moving a project to another computer:**

1. Export the project (`project_export` or the UI button). By default the archive
   lands in `%USERPROFILE%\.dsh\exports` (configurable).
2. Copy the `.dshpack` to an external drive / USB stick.
3. Install DSH and this plugin on the new computer.
4. Import the archive (`project_import` or the UI). If the original path is
   free, the project unpacks there; otherwise it lands next to it with a `-2`
   suffix; `targetDir` can be given explicitly.
5. Press `Ctrl+R` — the project and all chats appear in the sidebar; chats open
   and continue.

## Configuration

The plugin row in the profile's `cordis.patch.yml`
(`~/.dsh/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: project-portability
  config:
    archiveDir: ""            # archive folder; empty = <DSH_HOME>/exports
    excludeNames:             # names skipped while packing the tree
      - .dsh-portability.tmp
    includeSessions: true     # carry chats
    includeAttachments: true  # carry attachments
```

For a very large project add `node_modules`, `.venv`, `__pycache__`, `dist` to
`excludeNames` — the archive gets smaller, but the dependencies have to be
restored on the target machine.

## Archive format

`.dshpack` is a plain **gzip tar** (openable with 7-Zip, `tar -tzf`):

```
manifest.json                     format, version, project, chat list
project/...                       project files
sessions/0000/meta.json           chat metadata (id, title, cwd, eventCount)
sessions/0000/events.jsonl        complete event log, one JSON per line
attachments/objects/<xx>/<sha256> content-addressed attachments
```

On import the plugin:

1. validates `manifest.json` (format, version, chats);
2. extracts the project files without escaping the target directory;
3. recreates every chat as a new durable session through
   `ctx.sessionPersistence` with the new `cwd`, rewriting the old project path
   and the old session id inside the events;
4. verifies the session with a cold read (`open` + replay validation);
5. registers the workspace and attaches the chats to it;
6. restores the attachment blobs into the store.

## Limitations and compatibility

- The archive format is versioned (`formatVersion: 1`). An archive written by a
  newer plugin version is refused with a clear error instead of being misread.
- `engines.dsh`: `>=0.2.0 <0.3.0`. Internal DSH APIs may change between minor
  releases — re-check export/import after a DSH upgrade.
- Import registers **new** sessions rather than restoring old ids: DSH sessions
  are bound to a `cwd`, so a new path means a new chat. Titles and history are
  preserved.
- File checksums are not stored in the manifest (the archive is protected by
  gzip integrity and by reading every file during extraction).

## Self-checks

```powershell
node test/tar.test.mjs
node test/archive.test.mjs
node test/remap.test.mjs
node test/host.test.mjs
node test/client.test.mjs
```

A live round trip was run on a real project: export → import into a new folder →
1416 files byte-identical, a 53-event chat with contiguous `seq`, the old path
fully replaced, and the restored session valid after a cold read.
