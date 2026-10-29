# DeepSeek Harness plugins: spend, screenshots, Russian localization and Codex

Four plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):

| Plugin | What it does | Runs on |
|---|---|---|
| [`dsh-api-spend`](plugins/dsh-api-spend) | Shows the API spend of the current project next to the token counters; the pill opens a per-project breakdown for Today / 7 days / All time plus the provider platform's own totals for comparison. | Windows, macOS, Linux |
| [`dsh-screenshot`](plugins/dsh-screenshot) | A screenshot button in the composer (reads the clipboard image or opens the file picker), an annotation editor on attached images (pen, arrow, rectangle, text), agent tools to look at the screen or the clipboard, and a region zoom tool. | UI on every platform; screen and clipboard capture on Windows only |
| [`dsh-locale-ru`](https://github.com/MaximFedorovtoo/dsh-locale-ru) | Full Russian localization of the web client: 64 namespaces, 2910 interface strings and 545 plugin titles/descriptions. | Windows, macOS, Linux |
| [`dsh-codex-bridge`](https://github.com/MaximFedorovtoo/dsh-codex-bridge) | Imports projects and chat history from the OpenAI Codex app into DSH: the project stays in its own folder and the chat continues in DSH. | Windows, macOS, Linux |

All plugins are plain JavaScript with no dependencies and no build step. Installation is identical on every OS; the only platform limitation is screen capture in `dsh-screenshot` (see [platform support](#platform-support)).

[Русская версия](README.md) · [Installation guide](INSTALL.en.md)

## Requirements

- DeepSeek Harness **0.2.x** (tested on 0.2.1-rc.3), Desktop app or CLI.
- The **Web/Desktop** surface: the plugins render inside the chat UI.
- Nothing else: no Node.js, no Python, no compiler. The packages have no dependencies.

Installation is verified end-to-end on a real profile: both the local-folder install and the git install from this repository with a `path:` subdirectory work, and the plugin rows compose in `dsh --profile <name> --dump-config`.

## Quick start

The full guide, covering every method and every failure mode, is in [INSTALL.en.md](INSTALL.en.md).

**1 — Discover (plugin index).** Open **Plugins → Discover**, choose **Add index source** and paste:

```
https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
```

The Discover tab appears after the experimental **Custom plugin indexes** bundle is enabled on the Plugins page.

**2 — Git address.** **Plugins → Add plugin → Install a third-party plugin** and paste the package you want:

```
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-api-spend
```

`<commit>` is a SHA from the [commit list](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main). The long form `git+https://github.com/MaximFedorovtoo/dsh-plugins.git#<commit>&path:/plugins/dsh-screenshot` works too. A Git install requires `git` on the machine.

**3 — CLI.**

```sh
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot'
dsh --profile desktop
```

In PowerShell the `&` in that argument is eaten by the `dsh.cmd` wrapper; use the stop-parsing token or `cmd.exe`:

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot"
```

See [INSTALL.en.md](INSTALL.en.md#21-from-the-ui) for details.

**4 — Local folder.** Download the repository (Code → Download ZIP), unpack it, and give **Add plugin** the absolute path to the plugin folder, for example `C:\Users\Name\dsh-plugins\plugins\dsh-api-spend` or `/Users/name/dsh-plugins/plugins/dsh-api-spend`.

After installing, switch the bundle on: **Plugins → Installed** → toggle it, or press **Enable now** in the install dialog.

## Platform support

| Capability | Windows 10/11 | macOS | Linux |
|---|---|---|---|
| Install and enable the plugins | yes | yes | yes |
| `dsh-api-spend`: spend pill, breakdown, platform totals | yes | yes | yes |
| `dsh-screenshot`: composer button, clipboard, file picker, annotation editor, drag and drop | yes | yes | yes |
| `dsh-screenshot`: agent tools `screenshot` and `zoom_image` (capture the screen or clipboard, zoom a region) | yes | no | no |

Screen and clipboard capture uses Windows PowerShell 5.1 with `System.Drawing`/WPF, because the DSH host is plain Node where no Electron capture API exists. On macOS and Linux those two tools return an explicit error, while the rest of the plugin (button, editor, image attachments) keeps working. Porting capture to macOS (`screencapture`) and Linux (`grim`/`gnome-screenshot` plus ImageMagick) is the obvious next step; this version does not do it.

## Configuration

Both rows are configured in the profile's `cordis.patch.yml` (`~/.dsh/profiles/<profile>/cordis.patch.yml`; on Windows `%USERPROFILE%\.dsh\profiles\<profile>\cordis.patch.yml`).

`dsh-api-spend`:

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
```

`dsh-screenshot`:

```yaml
- id: screenshot
  config:
    cacheDir: ''          # default: <DSH_HOME>/cache/screenshot
    defaultZoomScale: 2
    maxZoomScale: 4
```

Rates are USD per million tokens at peak hours; off-peak applies `offPeakFactor`. The platform totals include every client of the API key, so they are larger than the per-project sum by design.

## Repository layout

```
dsh-plugins/
├── plugins/
│   ├── dsh-screenshot/     # package dsh-screenshot
│   └── dsh-api-spend/      # package dsh-api-spend
├── icons/                  # icons for the Discover index
├── index.json              # plugin index for the Discover tab
├── INSTALL.md              # installation guide (Russian)
└── INSTALL.en.md           # this guide's companion (English)
```

The other two plugins — the [Russian localization](https://github.com/MaximFedorovtoo/dsh-locale-ru) and [Codex Bridge](https://github.com/MaximFedorovtoo/dsh-codex-bridge) — live in their own repositories, with their own history and installers. The Discover index above already lists them together with these two.

## License

MIT — see [LICENSE](LICENSE).

The plugins are written for DeepSeek Harness and use its internal services (`ctx.tools`, `ctx.systemPrompt`, `ctx.sessionQuery`, `ctx.webServer`, `ctx.connection`, `ctx.deepseekAccount`, client slots). Check compatibility after DSH upgrades: `engines.dsh` in both packages is pinned to the 0.2.x line.
