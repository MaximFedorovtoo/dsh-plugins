# Installing dsh-project-portability

## Requirements

- DeepSeek Harness **0.2.x** (tested on 0.2.1-rc.3), the `desktop` profile or any other profile.
- No Node.js, no Python, no compiler: the plugin is plain JavaScript with no dependencies and no build step.
- Git is not required when installing from a local folder.

## Install from a local folder

```powershell
dsh plugin --profile desktop add C:\path\to\dsh-plugins\plugins\dsh-project-portability
```

Or in the UI: **Plugins → Add plugin** → give the absolute path to the plugin
folder (not to the parent folder with the other plugins).

The plugin is added to the profile dependencies and to `dsh.profile.bundles`,
which means it is enabled immediately. After installing, press **Ctrl+R** (or
restart DSH).

## Install from this repository (git)

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-project-portability"
```

`<commit>` is a SHA from the [commit list](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main).
The `--%` stop-parsing token is required in PowerShell because of the `&` in the
address. A git install requires `git` on the machine.

## Verification

1. The sidebar shows a **Project portability** page.
2. The model has the `project_list`, `project_export` and `project_import` tools.
3. `%USERPROFILE%\.dsh\profiles\desktop\node_modules` contains a
   `dsh-project-portability` junction pointing at the plugin folder.

## Updating

The plugin is installed as a link to its folder, so updating means replacing the
files in that folder and pressing `Ctrl+R` (restart the app for the host half):

```powershell
# replace the files in C:\path\to\dsh-project-portability
```

If the folder moved, reinstall:

```powershell
dsh plugin --profile desktop remove dsh-project-portability
dsh plugin --profile desktop add <new folder>
```

## Uninstalling

```powershell
dsh plugin --profile desktop remove dsh-project-portability
```

Archives in `%USERPROFILE%\.dsh\exports` are not removed — delete them manually
if needed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No page in the sidebar | Press `Ctrl+R`; check that the plugin is enabled under **Plugins → Installed** |
| `project_import` says "project directory is missing" | the project folder was moved/deleted — pass another `targetDir` |
| Import fails with "archive format v2 … newer plugin" | the archive was written by a newer plugin version — update the plugin |
| "archive has no manifest.json" | the file is damaged or not a `.dshpack`; check `tar -tzf <file>` |
| Import warns about attachments | some attachments were absent from the local store at export time; chats are still carried over |
