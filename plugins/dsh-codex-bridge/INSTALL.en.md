# Installing Codex Bridge

`dsh-codex-bridge` attaches to a DeepSeek Harness profile (`~/.dsh/profiles/<profile>`; on Windows `%USERPROFILE%\.dsh\profiles\<profile>`). Once enabled, a **Codex** icon appears in the sidebar and the model gains the `codex_import` tool.

**You need:** DSH 0.2.x (Web/Desktop). A Git install needs `git`; the `.cmd` installer needs Windows. The package has no dependencies and no build step. Codex data (`~/.codex`) is required only when importing, not when installing.

Pick **one** method: the installer and Plugins/Discover register the same plugin differently, and two registrations at once would duplicate the bundle and the tool.

---

## 1. Discover (plugin index)

1. **Plugins → Experimental plugins** → enable **Custom plugin indexes**.
2. **Discover → Add index source**:

   ```
   https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
   ```

3. The **Codex Bridge** card → **Install** → **Enable now**.
4. Restart DSH.

---

## 2. Git (any OS)

Requires `git` (Windows: Git for Windows; macOS: `xcode-select --install`; Linux: `sudo apt install git`).

**From the UI:** **Plugins → Add plugin → Install a third-party plugin** →

```
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-codex-bridge
```

**From the CLI:**

```sh
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-codex-bridge'
dsh --profile desktop
```

The SHA is on the [commit list](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main). **Windows and PowerShell.** The address has a subdirectory and a `&`. The `dsh` wrapper is a `.cmd` file, and PowerShell hands such an argument to `cmd`, which cuts everything after `&`; pnpm then receives the address without `path:` and fails. Working forms:

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-codex-bridge"
```

In `cmd.exe` plain quotes are enough.

Check without booting:

```sh
dsh --profile desktop --dump-config | grep codex-import
```

(use `Select-String codex-import` on Windows).

---

## 3. Windows installer (no git)

The `installer/` folder is standalone: it copies the plugin into `<profile>\plugins\dsh-codex-bridge`, adds the link dependency and bundle to the profile's `package.json`, reconciles `node_modules` with the bundled pnpm, and writes overrides into `cordis.patch.yml` when asked.

```powershell
cd <unpacked repository>
.\installer\install.cmd                      # install
.\installer\install.cmd -DryRun              # plan only
.\installer\install.cmd -ImportMode copy -TargetRoot "D:\CodexProjects"
.\installer\install.cmd -Uninstall           # remove
```

| Option | Meaning |
|---|---|
| `-Profile <name\|dir>` | DSH profile (default: `$env:DSH_PROFILE_DIR`, then `desktop`) |
| `-Source <dir>` | package directory (default: the package root) |
| `-ImportMode in-place\|copy` | import mode (default `in-place`) |
| `-TargetRoot <dir>` | where copy mode writes projects |
| `-CodexHome <dir>` | Codex data directory (default `~/.codex`) |
| `-DryRun` / `-Uninstall` / `-KeepFiles` | plan / remove / keep files |

The installer backs up `package.json` before registering, and re-running refreshes the plugin files (stale package files are removed so old code cannot load). Restart DSH afterwards.

---

## 4. Local folder

**Plugins → Add plugin** → the absolute path to the plugin folder `plugins\dsh-codex-bridge` inside the unpacked repository (where `package.json` is). From the CLI: `dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-codex-bridge`.

---

## Configuring the import mode

By default the project **stays in its own folder** (`importMode: in-place`). Switch to copying with a row in the profile's `cordis.patch.yml`:

```yaml
- id: codex-import
  config:
    importMode: copy
    targetRoot: D:\CodexProjects
    codexHome: ''
    maxTranscriptChars: 1500000
```

Restart DSH after editing.

What import does:

- `in-place` — the workspace is the original project folder, files are not copied, `.codex-import.json` is added to the folder;
- `copy` — `targetRoot/<project name>`; if that folder already exists and is a project copy, it is refreshed instead of getting a `-2`.

---

## Verifying it works

1. After the restart the **Codex** icon is in the sidebar; Settings → Plugins shows "Import from Codex".
2. Open Codex → pick a project → **Import**: the result has `ok: true`, `targetDir` equal to the project's own folder (default mode), `sessionCreated: true`, `copiedFiles: 0`.
3. **Open chat** opens the session with the transcript, attached to the workspace.
4. Re-importing the same project reports `updated: true`, the same `targetDir` and `sessionId`, with no new folders or chats.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No Codex icon | The plugin did not load: check the `codex-import` row in `dsh --profile <name> --dump-config` and the DSH log. A restart is required. |
| `project not found in Codex` | `codexHome` points elsewhere; check `~/.codex/.codex-global-state.json` or set `codexHome`. |
| `project directory is missing` | The Codex project folder was deleted or sits on an unavailable drive. |
| Import produced a new `-2`/`-3` folder | Copy mode is on and the name is taken by another project or an unrelated non-empty folder. The default mode (`in-place`) creates no copies at all. |
| A re-import created a new chat | The `.codex-import.json` manifest is gone from the project folder (in-place) or the copy folder (copy mode). Restore it, or delete it and import again. |
| `Plugin is incompatible with dsh ...` | The DSH version is outside `engines.dsh` (`>=0.2.0 <0.3.0`). Update the plugin, or allow this exact version: `dsh plugin --profile <profile> allow-version dsh-codex-bridge@1.1.0 --dsh-version <exact version> --accept-risk`. |
| The tool/page is duplicated | The plugin is registered twice (installer + Plugins). Remove one installation. |

---

## What lands in the profile

- `plugins\dsh-codex-bridge\` — the package files (or a pnpm dependency for a Plugins install).
- The profile's `package.json`: `"dsh-codex-bridge": "link:./plugins/dsh-codex-bridge"` (installer) plus the name in `dsh.profile.bundles`.
- `cordis.patch.yml` in the profile — only when `-TargetRoot`/`-CodexHome`/`-ImportMode` were given; otherwise the package layer defaults apply.

Imported projects and chats survive plugin removal; the `.codex-import.json` files remain in the projects (delete them by hand if you want).
