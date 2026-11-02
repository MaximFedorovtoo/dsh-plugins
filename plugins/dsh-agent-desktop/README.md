# dsh-agent-desktop — computer use for DSH agents

A host-only plugin that turns the [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) CLI into DSH tools. The agent reads the **real accessibility tree** of desktop apps, acts on stable `@<snapshot>:eN` refs, and verifies by taking a fresh snapshot — no pixel guessing.

Works on **Windows, macOS and Linux** (on macOS grant Accessibility permission once; Windows needs no grant for apps at the terminal's integrity level).

## Tools

| Tool | Purpose |
|---|---|
| `desktop_status` | Permissions, platform, supported surfaces |
| `desktop_apps` | Running apps / visible windows |
| `desktop_snapshot` | Accessibility tree with refs (`interactiveOnly`, `skeleton`, `compact`, `root`, `surface`) |
| `desktop_find` | Find elements by role/name/value/text and get refs |
| `desktop_click` | Click / double / triple / right click on a ref |
| `desktop_type` | Type text into a ref |
| `desktop_set_value` | Set an element value directly |
| `desktop_press` | Keyboard combos (`return`, `ctrl+c`, …) |
| `desktop_screenshot` | PNG of an app window or screen (saved to a file, not base64) |
| `desktop_clipboard` | Get / set / clear clipboard |
| `desktop_wait` | Wait for time, element, text, window or menu |
| `desktop_batch` | Sequential CLI commands in one call |
| `desktop_skills` | Built-in CLI docs (`desktop`, `platform`, `ffi`) |
| `desktop_raw` | Escape hatch for the remaining CLI commands (scroll, drag, hover, windows, notifications…) |

## The loop

```text
desktop_status
desktop_apps                                  → find the app name
desktop_snapshot {app:"Notepad", interactiveOnly:true, compact:true}
desktop_click {ref:"@s8f3k2p9:e8"}            → act on a ref from that snapshot
desktop_snapshot {app:"Notepad"}              → observe again and confirm
```

Refs belong to their snapshot: after the UI changes, act on `STALE_REF` by taking a new snapshot. Errors carry `code`, `suggestion`, and `disposition.retry` — retry only when it says `safe`. Delivery is **headless by default**: no pointer movement, no focus stealing.

## Install

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-agent-desktop
dsh plugin --profile desktop add agent-desktop
```

Restart DSH. The `agent-desktop` package ships native binaries for Windows/macOS/Linux and its JS launcher works even if the postinstall step was skipped.

If the profile's pnpm refuses to run the package's postinstall (`ERR_PNPM_IGNORED_BUILDS`), add to `%USERPROFILE%\.dsh\profiles\desktop\pnpm-workspace.yaml`:

```yaml
strictDepBuilds: false
```

and re-run the second command. See [INSTALL.md](INSTALL.md) for per-OS permissions.

## Configuration

```yaml
- id: agent-desktop
  config:
    binary: ""            # '' = platform binary from the profile's agent-desktop package
    timeoutMs: 30000
    maxOutputChars: 20000 # truncate huge snapshots in tool output
    sessionScope: true    # CLI --session = DSH session id (refs are isolated per chat)
    allowRaw: true        # expose desktop_raw
    headed: false         # false = headless semantic delivery, no cursor/focus side effects
```

## Privacy and safety

Snapshots, clipboard contents, screenshots and traces can contain private desktop data: never paste them into public chats or logs. `headed: true` (or `--headed` through `desktop_raw`) permits physical input and focus/cursor changes. Held-key commands (`key-down`, `key-up`, `mouse-down`, `mouse-up`) are refused by the CLI without a daemon and are excluded from `desktop_raw`.

## License

MIT. The wrapped tool is Apache-2.0, © Vercel Labs.