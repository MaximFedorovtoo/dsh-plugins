# Installing the Russian localization for DeepSeek Harness

`dsh-locale-ru` is a DSH client plugin. It does not modify the installed application: files land in a profile (`~/.dsh/profiles/<profile>`; on Windows `%USERPROFILE%\.dsh\profiles\<profile>`), and the dictionaries register through the public `ctx.locale` API.

**You need:** DSH 0.2.x (Web/Desktop surface). A Git install needs `git`; the `.cmd` installer needs Windows only. The package has no dependencies and no build scripts.

There are four methods below. **Pick exactly one.** If the pack was already installed another way, remove it first (see [switching methods](#switching-methods)).

---

## 1. Discover (plugin index)

1. **Plugins → Experimental plugins** → enable **Custom plugin indexes**; a **Discover** tab appears.
2. **Discover → Add index source** → paste:

   ```
   https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
   ```

3. Find the **Russian Language Pack** card → **Install** → confirm the version and source → **Enable now**.
4. Restart DSH or press Ctrl+R. Language: **Settings → General → Language → Русский** (selected automatically when the Windows language is Russian).

The index is public and inspectable: [index.json](https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json).

---

## 2. Git (any OS)

Requires `git`:

- **Windows:** [Git for Windows](https://git-scm.com/download/win) (`winget install --id Git.Git -e`).
- **macOS:** `xcode-select --install` or `brew install git`.
- **Linux:** `sudo apt install git` / `sudo dnf install git`.

The commit SHA is on the [commit list](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main).

**From the UI:** **Plugins → Add plugin → Install a third-party plugin** → paste:

```
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-locale-ru
```

**From the CLI:**

```sh
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-locale-ru'
dsh --profile desktop
```

**Windows and PowerShell.** The address now has a subdirectory and a `&`. The `dsh` wrapper is a `.cmd` file, and PowerShell hands such an argument to `cmd`, which cuts everything after `&`; pnpm then receives the address without `path:` and fails with `ERR_PNPM_INVALID_DEPENDENCY_NAME`. Working forms:

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-locale-ru"
```

In `cmd.exe` plain quotes are enough. Check the layer without booting:

```sh
dsh --profile desktop --dump-config | grep locale-ru
```

On Windows use `Select-String locale-ru` instead of `grep`.

---

## 3. Windows installer (no git)

The `windows-installer/` folder is a standalone installer: it copies the pack into `<profile>\plugins\dsh-locale-ru` and appends one row to the profile's `cordis.patch.yml`. No network, no administrator rights, no Node.js; the scripts are plain text you can read in Notepad.

1. Download the repository (Code → Download ZIP) and unpack it **completely**.
2. If the ZIP came from the internet: right-click → Properties → **Unblock** → OK.
3. Double-click `windows-installer\Install-DSH-Russian.cmd` and wait for `Done`.
4. Restart DSH or press Ctrl+R. Language: **Settings → General → Language → Русский**.

The script is idempotent: re-running refreshes the files and does not add a second row. A backup of `cordis.patch.yml` is created next to it.

Uninstall: `windows-installer\Uninstall-DSH-Russian.cmd` removes the folder and the patch row (also with a backup).

---

## 4. Local folder

**Plugins → Add plugin** → the absolute path to the **plugin folder** `plugins\dsh-locale-ru` inside the unpacked repository (where `package.json` lives):

```
C:\Users\Name\dsh-plugins\plugins\dsh-locale-ru
/Users/name/dsh-plugins/plugins/dsh-locale-ru
```

From the CLI: `dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-locale-ru`.

Do not move the folder afterwards: pnpm keeps a link to it.

---

## Switching methods

DSH rejects two simultaneous registrations of the same client module (source conflict), so switching is a two-step operation:

- **From `.cmd` to Plugins/Discover:** run `windows-installer\Uninstall-DSH-Russian.cmd` first, then install from Plugins.
- **From Plugins/Discover to `.cmd`:** press **Remove** on the plugin card first (or `dsh plugin --profile desktop remove dsh-locale-ru`), then run the installer.

Check that exactly one `locale-ru` row remains:

```powershell
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" -Pattern 'locale-ru'
```

---

## Verifying it works

1. After the restart the interface is Russian: «Новая сессия», «Плагины», «Рабочие области».
2. Settings → General → Language shows «Русский».
3. Plugin titles and descriptions in Settings → Plugins are Russian too.

If the interface stays English: press Ctrl+R; confirm the profile's `cordis.patch.yml` has the `locale-ru` row and `plugins\dsh-locale-ru` exists; check the DSH log for client-module load errors.

---

## Limitations

- Native Electron menus, the welcome window and update dialogs stay English/Chinese: they live inside the application and cannot switch languages.
- Strings added to DSH after 0.2.1-rc.3 appear in English — the interface does not break.
- Model answers, session titles and technical identifiers are not translated.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No «Русский» in the language list | The plugin did not load: the `locale-ru` row is missing from `cordis.patch.yml`, or `plugins\dsh-locale-ru` does not exist. Reinstall with one method. |
| Interface still English after install | The profile did not reload: Ctrl+R or restart DSH. Check the language setting. |
| The log reports a source conflict/duplicate | The pack is connected twice (for example `.cmd` + Plugins). Remove one installation (see switching methods). |
| `Plugin is incompatible with dsh ...` | The DSH version is outside `engines.dsh` (`>=0.2.0 <0.3.0`). Update the pack or allow this exact version: `dsh plugin --profile <profile> allow-version dsh-locale-ru@0.1.0 --dsh-version <exact DSH version> --accept-risk`. |
| The installer says "DSH home not found" | DSH has never run: start it once, close it, retry. A custom `DSH_HOME` is honoured automatically. |
| The installer says "plugin folder is missing" | The archive was not unpacked whole: `windows-installer` and `lib` must sit next to `Install-DSH-Russian.cmd`. |

---

## What lands in the profile

- `plugins\dsh-locale-ru\` — `package.json`, `lib\index.js`, `lib\client.js`.
- In `cordis.patch.yml`:

  ```yaml
  - insert:
      - id: locale-ru
        name: ./plugins/dsh-locale-ru/lib/index.js
  ```

  (a Plugins/Discover install records the package name `dsh-locale-ru` instead; both are fine.)

The pack stores no data; removing it loses nothing.
