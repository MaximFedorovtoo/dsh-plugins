# Installing dsh-agent-desktop

## 1. Requirements

- DeepSeek Harness **0.2.x**.
- Windows, macOS or Linux (x64/arm64).
- No separate Node.js: the plugin uses the native binaries shipped by the
  `agent-desktop` npm package.
- macOS: **Accessibility** permission for the terminal/DSH.
- Linux: a graphical session with `at-spi2-core`; for Wayland clipboard install
  `wl-clipboard`.

## 2. Install

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-agent-desktop
dsh plugin --profile desktop add agent-desktop
```

The first command installs the plugin, the second one the CLI (native binaries
for all platforms). Restart DSH afterwards.

### If pnpm blocks the postinstall

`agent-desktop` has a postinstall step (links the native binary). Under pnpm 11
it can be blocked with `ERR_PNPM_IGNORED_BUILDS`. Allow it in
`%USERPROFILE%\.dsh\profiles\desktop\pnpm-workspace.yaml`:

```yaml
strictDepBuilds: false
onlyBuiltDependencies:
  - agent-desktop
```

then repeat `dsh plugin --profile desktop add agent-desktop`. The package also
works without the postinstall: its JS launcher picks the platform binary.

## 3. Permissions

- **Windows** — nothing for apps at the terminal's integrity level.
- **macOS** — Accessibility: `agent-desktop permissions --guide`.
- **Linux** — AT-SPI is present in a regular GNOME session; check with
  `agent-desktop permissions`.

## 4. Verify

Ask the agent to run `desktop_status`: it must return `ok:true` and
`permissions.accessibility.state:"granted"`. Then:

```text
desktop_apps
desktop_snapshot {app:"<app name>", interactiveOnly:true, compact:true}
desktop_click {ref:"@<snapshot>:e3"}
desktop_snapshot {app:"<app name>"}
```

## 5. Configuration

```yaml
- id: agent-desktop
  config:
    binary: ""
    timeoutMs: 30000
    maxOutputChars: 20000
    sessionScope: true
    allowRaw: true
    headed: false
```

`headed: true` allows physical input (cursor/focus); delivery is headless by
default. `binary` overrides the CLI executable.

## 6. Uninstall

```powershell
dsh plugin --profile desktop remove dsh-agent-desktop
```

The `agent-desktop` dependency can stay for CLI use or be removed separately.

## 7. Safety

Snapshots, clipboard contents, screenshots and traces may contain private
desktop data — do not publish them. Held-key/mouse commands
(`key-down`, `key-up`, `mouse-down`, `mouse-up`) require a daemon and are not
available.