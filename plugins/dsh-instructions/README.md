# Instructions panel — upload the default AGENTS.md from the UI

A DSH plugin that adds an **Instructions** page: choose a local `.md`/`.txt` file (or paste text), review it, and save it as the machine-wide instruction file **`$DSH_HOME/AGENTS.md`**. DSH loads that file into every session, in every project, so the uploaded rules apply by default.

[Русская версия](README.ru.md)

## What it adds

| Surface | Behaviour |
|---|---|
| Sidebar | One **Instructions** entry next to the other panels. |
| Page | Shows the file path, whether it exists, its size, the size limit and the last modification time. |
| Editor | A monospace textarea with the current content; changes are marked as unsaved. |
| **Choose file…** | Reads a local `.md`/`.markdown`/`.txt` file in the browser and puts its text into the editor. Nothing is written yet. |
| **Save** | Sends the text to the Host, which writes `$DSH_HOME/AGENTS.md` atomically. |
| **Discard changes** | Restores the editor from the file on disk. |
| **Delete file** | Removes the instruction file (with a confirmation). |

The panel never touches the filesystem itself: two authenticated Host routes own the file (`GET`/`POST`/`DELETE /api/instructions`), and the DSH connection fence restricts them to the session owner.

## Install

Package `dsh-instructions`, DSH 0.2.x, plain JavaScript, no dependencies.

**Discover:** enable **Custom plugin indexes** on the Plugins page, add the index

```
https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
```

and install **Instructions Panel**.

**Git:**

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-instructions"
```

**Local folder:** **Plugins → Add plugin** → the absolute path to `plugins/dsh-instructions`.

Restart DSH after installing; the sidebar entry appears and the page can read the current instruction file.

## Configuration

The `instructions` row in the profile's `cordis.patch.yml` (or the package layer):

```yaml
- id: instructions
  config:
    target: ''          # '' = <DSH_HOME>/AGENTS.md; a relative path resolves inside DSH_HOME
    maxBytes: 65536     # byte ceiling; matches the DSH instruction cap (see below)
```

## File size

DSH's own instruction loader (`agent-instructions`) reads `$DSH_HOME/AGENTS.md` up to **65 536 bytes** by default. The panel uses the same limit, so a file that is accepted here is actually loaded in full. For a larger instruction file raise both limits: `maxBytes` on the `instructions` row and `maxBytes` on the `agent-instructions` row in the profile's `cordis.patch.yml`.

## How the file is applied

- `$DSH_HOME/AGENTS.md` is DSH's machine-wide instruction layer: every new session in every project reads it.
- Saving in the panel takes effect for **new sessions**; a session that is already running keeps the instructions it started with (open a new chat or restart DSH to apply immediately).
- Project-level `AGENTS.md` files still take precedence inside their own project, as usual.
- Deleting the file leaves project-level instructions untouched.

## Security notes

- Only the session owner can call the routes; the panel is not exposed to other browser peers.
- The save is atomic (temporary file + rename), so an interrupted save never truncates the existing file.
- The plugin writes exactly one path; it does not scan or modify project files.

## Checking the result

1. Sidebar → **Instructions** → the path and state of the current file are shown.
2. Choose your `AGENTS.md` → **Save** → the badge shows the new size and modification time.
3. Open a new chat: the rules are in effect. The file on disk equals the editor content.

Self-check: `node test/instructions.test.mjs` covers default/relative target resolution, missing-file state, atomic save/replace, empty and oversized validation, delete, and the client bundle wiring.

## License

MIT — see the repository [LICENSE](../../LICENSE).
