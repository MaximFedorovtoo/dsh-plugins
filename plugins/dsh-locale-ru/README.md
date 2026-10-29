# Russian localization for DeepSeek Harness

A language pack for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web client: a full Russian translation of the interface — **64 namespaces, 2910 interface strings and 545 plugin titles/descriptions**. The installed application is not modified: the pack attaches to a profile as a regular client plugin and registers its dictionaries through the public `ctx.locale` API.

The language appears in **Settings → General → Language → Русский**. If the Windows display language is Russian, it is selected automatically.

[Русская версия](README.ru.md) · [Installation guide](INSTALL.en.md)

## Requirements

- DeepSeek Harness **0.2.x** (built against 0.2.1-rc.3), Web/Desktop surface.
- A Git install needs `git`; the Windows `.cmd` installer needs only Windows 10/11 — no Node.js, no Python, no administrator rights.

## Install — short version

Every method and the troubleshooting table are in [INSTALL.en.md](INSTALL.en.md).

**Discover:** Plugins → enable **Custom plugin indexes** → Discover → Add index source:

```
https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
```

**Git** (any OS, needs `git`):

```powershell
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-locale-ru'
```

In PowerShell use `dsh --% plugin --profile desktop add "..."` — otherwise the `&` in the address is eaten by the `dsh.cmd` wrapper (details in [INSTALL.en.md](INSTALL.en.md)).

**Windows installer (no git):** run `windows-installer\Install-DSH-Russian.cmd`, wait for `Done`, then restart DSH or press Ctrl+R.

**Local folder:** Add plugin → the absolute path to the plugin folder `plugins\dsh-locale-ru` inside the unpacked repository.

Install it **one way only**. If the pack was previously installed by the `.cmd` installer, run `windows-installer\Uninstall-DSH-Russian.cmd` first and then install through Plugins/Discover: two simultaneous registrations of the same client module are rejected by DSH as a source conflict.

## What is translated

- The client interface: 64 namespaces — chat, settings, plugins, tasks, Codex, voice input, sidebar, dialogs, errors, hints.
- Plugin titles and descriptions (545 strings): the pack extends `ctx.locale.resolveText`, so plugin metadata arriving from the host as literal strings or `{en, zh}` maps is shown in Russian too.

## Limitations

- Native Electron menus, the welcome window and update dialogs stay English/Chinese: they are sealed inside the application and cannot switch languages.
- Third-party marketplace indexes, technical package/preset identifiers, model answers and auto-generated session titles stay as they are.
- The pack was built against 0.2.1-rc.3. On other DSH versions new strings appear in English — the interface does not break. Updating the translation needs the generator source (`work/extract_all.py` and friends), which is not part of this repository.

## Uninstall

- Installed through Plugins/Discover: the plugin card → **Remove** (or `dsh plugin --profile desktop remove dsh-locale-ru`).
- Installed through `.cmd`: `windows-installer\Uninstall-DSH-Russian.cmd`.

After removal press Ctrl+R or restart DSH — the interface returns to English.

## How it was verified

- `lib/client.js` is a working bundle already in use: the copy installed in the profile is byte-identical to the repository file, and the DSH interface on that machine runs in Russian.
- The bundle executes behind a `window.__ModuleLoader__.load` stub and registers the language and every dictionary without exceptions; the registration id equals the package name.
- The package installs as a bundle through `dsh plugin add` (checked on a throwaway profile) and composes into `dsh --profile <name> --dump-config` as `id: locale-ru`.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with DeepSeek; "DeepSeek Harness" is a DeepSeek product.
