# Installing the DSH plugins: API spend and screenshots

A user guide for DeepSeek Harness (DSH). The repository ships two packages:

- `dsh-api-spend` — API spend per project;
- `dsh-screenshot` — screenshots as input: composer button, annotation editor, agent tools.

Both are plain JavaScript with no dependencies and no install scripts (`prepare`/`build` are absent), so they install the same way on Windows, macOS and Linux, and the installer never asks for permission to run package code.

**You need:** DSH 0.2.x (Desktop or CLI) and the Web/Desktop surface. Verified on DSH Desktop 0.2.1-rc.3, Windows 11: installation from a local folder and from the GitHub repository (git, subdirectory via `path:`), and the rows composing in `--dump-config`.

---

## 0. Where a plugin goes

Plugins belong to a **profile** — a directory under `~/.dsh/profiles/<name>` (Windows: `%USERPROFILE%\.dsh\profiles\<name>`). The Desktop app usually runs the `desktop` profile; the CLI uses whatever name you pass to `dsh --profile <name>`.

Installing adds the package to the profile's dependencies and its bundle layer to `dsh.profile.bundles`; turning the plugin on or off is a switch on the **Plugins** page.

Every method below installs into the same profile; pick whichever fits.

---

## 1. Discover (plugin index)

Easiest if you only use the UI: DSH shows a card, the version and an **Install** button.

1. Open **Plugins** in the sidebar.
2. Under **Experimental plugins**, enable the **Custom plugin indexes** bundle. A **Discover** tab appears next to **Installed**.
3. Open **Discover** → **Add index source** and paste the index URL:

   ```
   https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
   ```

4. Two plugins appear: **API Spend** and **Screenshot Input**. Press **Install**, confirm the version and the source.
5. When the install finishes, press **Enable now**, or flip the switch on the card under **Installed**.

The index is a plain JSON file you can open in a browser to inspect: [index.json](https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json). You add the source once; new versions show up in Discover when they land in the index.

> Indexes and their cards are third-party content. DSH validates the format, not the author's claims: add only sources you trust.

---

## 2. Git address

Works from both the UI and the CLI. Requires `git`:

- **Windows:** [Git for Windows](https://git-scm.com/download/win) (`winget install --id Git.Git -e`).
- **macOS:** `xcode-select --install` (or `brew install git`).
- **Linux:** `sudo apt install git` / `sudo dnf install git`.

The install is pinned to one commit, so the content of the branch cannot change under you. The SHA is on the [commit list](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main).

### 2.1. From the UI

**Plugins → Add plugin → Install a third-party plugin** (the arrow next to **Add plugin**), then paste one of:

```
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-api-spend
```

Replace `<commit>` with the 40-character SHA. Press **Install**, wait for pnpm, then **Enable now**.

The long form is accepted too: `git+https://github.com/MaximFedorovtoo/dsh-plugins.git#<commit>&path:/plugins/dsh-screenshot`.

### 2.2. From the CLI

```sh
# use your profile name and commit SHA
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot'
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-api-spend'
dsh --profile desktop
```

**Windows and PowerShell.** The argument contains `&`. The `dsh` wrapper is a `.cmd` file, and PowerShell hands the argument to `cmd`, which cuts everything after `&`; pnpm then receives the address without `path:` and fails with `ERR_PNPM_INVALID_DEPENDENCY_NAME`. Working forms:

```powershell
# PowerShell: --% stops parsing the rest of the line, quotes reach cmd
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot"
```

```bat
:: cmd.exe: the quotes keep & literal
dsh plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot"
```

The **Add plugin** dialog has no such problem: the field passes the address directly, without a command shell.

Check the layer without booting:

```sh
dsh --profile desktop --dump-config | grep -i -E 'screenshot|api-spend'
```

On Windows use `Select-String` instead of `grep`.

---

## 3. Local folder (ZIP)

1. On GitHub: **Code → Download ZIP**, unpack it, for example to `C:\Users\Name\dsh-plugins` or `~/dsh-plugins`.
2. **From the UI:** **Plugins → Add plugin** → paste the **absolute** path to the plugin folder, not to the repository:

   ```
   C:\Users\Name\dsh-plugins\plugins\dsh-api-spend
   /Users/name/dsh-plugins/plugins/dsh-screenshot
   ```

3. **From the CLI:**

   ```sh
   dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-api-spend
   dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-screenshot
   ```

> A folder installed this way must not be moved or deleted: pnpm keeps a link to it, and the plugin stops loading afterwards. If you need independence from the folder, use a Git install or pack a tarball (`pnpm pack` inside the package directory) and install the `.tgz`.

---

## 4. Enabling after installation

Installing and enabling are separate steps: a package can be installed but switched off.

- **Enable now** in the install dialog; or
- **Plugins → Installed** → the plugin card → the switch; or
- the plugin row in the profile's `cordis.patch.yml` (optional).

If DSH says a restart is required, restart the app; for the web UI a page refresh is usually enough.

---

## 5. Checking that it works

**`dsh-api-spend`.** Below the composer, in the same row as the token counters, a pill shows today's spend (for example `$0.004`). Click it for the per-project breakdown and the platform totals. The pill stays hidden until today has spend.

**`dsh-screenshot`.**

- A camera button appears in the composer: it attaches the clipboard image (for example after `Win+Shift+S`), or opens the file picker when the clipboard holds no image.
- Attach an image and click it in the attachment rail — the annotation editor opens (pen, arrow, rectangle, text; six colors, three widths, undo, clear). **Apply** replaces the attachment with the annotated PNG.
- Ask the agent to "look at my screen": on Windows it calls the `screenshot` tool; to read small text it calls `zoom_image`.

---

## 6. Configuration

Edit the plugin rows in the profile's `cordis.patch.yml`, then restart DSH (or let the profile recompose).

```yaml
- id: api-spend
  config:
    currency: USD
    symbol: '$'
    priceUnit: 1000000
    offPeakFactor: 0.5
    peakWindows: [{ start: 1, end: 4 }, { start: 6, end: 10 }]
    peakWeekdays: [1, 2, 3, 4, 5]
    holidays: []
    defaultModel: deepseek-flash
    models:
      deepseek-flash: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 }
      deepseek-v4-pro: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 }
    maxSessions: 400
    platformRefreshMs: 120000

- id: screenshot
  config:
    cacheDir: ''          # default: <DSH_HOME>/cache/screenshot
    defaultZoomScale: 2
    maxZoomScale: 4
```

The defaults follow the official DeepSeek rates (USD per million tokens at peak); off-peak applies `offPeakFactor`. If the provider changes rates, edit `models` — the calculation reads the configuration.

---

## 7. Updating and removing

**Update:** for a Git or folder install, remove and install again (or move to a newer SHA); with Discover the card offers the newer version.

**Remove:**

- **Plugins → Installed** → card → **Remove** (with confirmation); or
- ```sh
  dsh plugin --profile desktop remove dsh-api-spend
  dsh plugin --profile desktop remove dsh-screenshot
  ```

Removal deletes the package and the layer from the profile; the plugins store no data. `dsh-screenshot` keeps its capture cache in `~/.dsh/cache/screenshot`, which you can delete by hand.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No cards in Discover | The **Custom plugin indexes** bundle is off, or the index is not added / not readable. Open the index URL in a browser. |
| `Plugin is incompatible with dsh ...` | The DSH version is outside `engines.dsh` (`>=0.2.0 <0.3.0`). Update the plugin, or explicitly allow that exact version: `dsh plugin --profile <profile> allow-version dsh-screenshot@1.4.0 --dsh-version <exact DSH version> --accept-risk`. `--accept-risk` means "I understand the internal APIs may have changed". |
| Install fails on GitHub / timeout | `git` is missing, or github.com is unreachable (proxy). Install git or use the ZIP folder method. |
| `pnpm blocked a build script` | These packages have no build scripts, so pnpm is asking about some other dependency already in your profile. Read the package names before allowing. |
| No spend pill | No spend today yet, the plugin is off, or the account uses a raw API key — then only session-based estimates show, without platform totals. |
| Pill shows less than platform.deepseek.com | The platform page counts every client of the API key; the panel counts this DSH's sessions only. Different numbers by design. |
| `screenshot`/`zoom_image` fail on macOS or Linux with a Windows PowerShell message | Expected in this version: capture is implemented for Windows only. The button, editor and attachments still work. |
| The camera button cannot read the clipboard | The browser/OS denied clipboard access. Grant it for the DSH page, or attach the file through the picker / `Ctrl+V`. |
| The plugin stops loading after a DSH upgrade | Internal DSH services may have changed. Check the repository issues; `engines.dsh` exists so such mismatches are visible instead of silent. |

---

## 9. What lands in the profile

The profile's `package.json` gains the dependency, and `dsh.profile.bundles` gains the bundle names:

```json
{
  "dependencies": {
    "dsh-api-spend": "git+https://github.com/MaximFedorovtoo/dsh-plugins.git#<commit>&path:/plugins/dsh-api-spend"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "...",
        "dsh-api-spend"
      ]
    }
  }
}
```

The plugin rows (`api-spend`, `screenshot`) come from each package's own `cordis.patch.yml` layer. Keep your configuration overrides in the profile's `cordis.patch.yml`; installing a package does not overwrite them.
