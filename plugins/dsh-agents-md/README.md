# AGENTS.md — global working instructions as an installable plugin

This bundle ships the author's global working rules for DeepSeek Harness and installs them as **`$DSH_HOME/AGENTS.md`** (on Windows `%USERPROFILE%\.dsh\AGENTS.md`). DSH loads that file automatically into every session, in every project, so the same workflow applies everywhere without copying the file by hand.

The instructions themselves are the file [`AGENTS.md`](AGENTS.md) — edit it to taste after installing.

## What it does

- On the first activation after installation the plugin copies the bundled `AGENTS.md` to `$DSH_HOME/AGENTS.md`.
- **An existing different file is kept untouched** unless `overwrite: true` is set: instructions are user data, and a plugin must not replace them silently.
- The write is atomic (temporary file + rename) and happens once per plugin load.
- Removing the bundle never deletes the file — it belongs to you.

## Install

The same three ways as every plugin in this repository (DSH 0.2.x):

**Discover:** enable **Custom plugin indexes** on the Plugins page, add the index source

```
https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
```

and install **AGENTS.md Instructions** from the list.

**Git:**

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-agents-md"
```

**Local folder:** **Plugins → Add plugin** → the absolute path to `plugins/dsh-agents-md`.

Restart DSH after installing: the plugin writes the file on activation, and the new instructions apply to the next sessions.

## Configuration

The `agents-md` row in the profile's `cordis.patch.yml` (or the package layer):

```yaml
- id: agents-md
  config:
    target: ''          # '' = <DSH_HOME>/AGENTS.md; a relative path resolves inside DSH_HOME
    overwrite: false    # true replaces an existing AGENTS.md
```

Use `target` for a different global instruction file, for example:

```yaml
- id: agents-md
  config:
    target: 'instructions/my-rules.md'
    overwrite: false
```

## Updating the instructions

With the default `overwrite: false`, an existing file stays as it is — that is deliberate. To pick up a newer version of the bundled instructions either delete `$DSH_HOME/AGENTS.md` before restarting, or set `overwrite: true` for one restart and turn it back off.

## Checking the result

- `$DSH_HOME/AGENTS.md` exists and matches `plugins/dsh-agents-md/AGENTS.md`;
- a restart followed by a new session shows the instructions in the system context;
- the DSH log contains `agents-md: installed …` or `agents-md: … already exists; left untouched` on the first load.

Self-check: `node test/agents-md.test.mjs` covers install, no-op on identical content, keeping a different existing file, replacing it with `overwrite: true`, and relative/default target resolution.

## Notes

- The bundled rules are the author's own workflow, not a DSH requirement; read them before enabling.
- The file name and location follow DSH's convention — `AGENTS.md` in `$DSH_HOME` is the machine-wide layer, project-level `AGENTS.md` still wins for its project.

## License

MIT — see the repository [LICENSE](../../LICENSE).
