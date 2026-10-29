# Установщик Codex Bridge

Устанавливает плагин `dsh-codex-bridge` («Импорт из Codex») в профиль DeepSeek Harness без git и без Plugins/Discover.

## Состав

```
installer/
  install.cmd        ← запуск установки (двойной клик)
  uninstall.cmd      ← удаление плагина
  install.ps1        ← обёртка: находит встроенный Node и вызывает install.mjs
  install.mjs        ← логика установки/удаления
  README.md
../                  ← сам плагин (package.json, index.js, src/…)
```

## Требования

- Windows, PowerShell 5.1+ (есть в Windows по умолчанию);
- установленный DeepSeek Harness (нужны встроенные Node.js и pnpm из `~/.dsh/dsh-runtimes`);
- интернет не нужен: плагин подключается как локальный `link:`, зависимостей у него нет.

## Установка

```powershell
# из папки installer
.\install.cmd

# или явно, с параметрами
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile desktop
```

| Параметр | Смысл |
|---|---|
| `-Profile <имя\|папка>` | профиль DSH; по умолчанию `$env:DSH_PROFILE_DIR`, затем `desktop` |
| `-Source <папка>` | откуда брать плагин (по умолчанию корень пакета) |
| `-ImportMode in-place\|copy` | режим импорта: `in-place` — проект остаётся в своей папке (по умолчанию), `copy` — копия в `TargetRoot` |
| `-TargetRoot <папка>` | куда копировать проекты в режиме `copy` (по умолчанию `Documents\deepseek-harness\Codex`) |
| `-CodexHome <папка>` | папка данных Codex (по умолчанию `~/.codex`) |
| `-DryRun` | показать план, ничего не менять |
| `-Uninstall` | удалить плагин из профиля |
| `-KeepFiles` | при удалении оставить папку плагина |

Что делает установщик:

1. копирует плагин в `<профиль>\plugins\dsh-codex-bridge`, предварительно удаляя прежнюю копию (чтобы не остались файлы от старой версии);
2. в `<профиль>\package.json` добавляет `"dsh-codex-bridge": "link:./plugins/dsh-codex-bridge"` и имя бандла в `dsh.profile.bundles`; перед изменением сохраняет резервную копию `package.json.bak-codex-bridge-…`;
3. при указании `-TargetRoot`/`-CodexHome`/`-ImportMode` пишет блок `id: codex-import` в `<профиль>\cordis.patch.yml` (пользовательский слой сохраняется при обновлениях);
4. выполняет `pnpm install` в профиле встроенным pnpm. Если pnpm недоступен, создаёт junction `<профиль>\node_modules\dsh-codex-bridge`.

После установки **перезапустите DeepSeek Harness**. Проверка: Settings → Plugins — «Import from Codex»; в левой панели — иконка «Codex».

## Режимы импорта

- `in-place` (по умолчанию) — проект остаётся в своей папке; DSH-рабочая область указывает на неё; в папку добавляется только `.codex-import.json`.
- `copy` — проект копируется в `TargetRoot`; повторный импорт обновляет ту же папку, а не создаёт `-2`.

Сменить режим после установки: отредактируйте блок `codex-import` в `<профиль>\cordis.patch.yml` или запустите установщик с `-ImportMode` и нужными путями.

## Обновление

Запустите `install.cmd` ещё раз: файлы плагина перезаписываются, старая папка пакета удаляется, регистрация остаётся одна. Перезапуск DSH обязателен — загруженный модуль живёт в процессе.

## Удаление

```powershell
.\uninstall.cmd
# или: .\install.ps1 -Uninstall
```

Убирает регистрацию из `package.json`, блок установщика из `cordis.patch.yml` и папку `<профиль>\plugins\dsh-codex-bridge`, затем выравнивает `node_modules` через pnpm. `-KeepFiles` сохранит файлы плагина. Импортированные проекты и чаты не затрагиваются.

## Диагностика

- `install.cmd -DryRun` — план без изменений.
- Если pnpm недоступен или завершился ошибкой, появится `WARN` и будет создан junction — плагин всё равно загрузится; при следующем `pnpm install` в профиле связь нормализуется.
- Плагин не появился после перезапуска: проверьте, что в `<профиль>\package.json` есть `dsh-codex-bridge` в `dependencies` и в `dsh.profile.bundles`, а в `<профиль>\plugins\dsh-codex-bridge` лежит `package.json` плагина.
- Не устанавливайте плагин одновременно этим установщиком и через Plugins/Discover: получатся два бандла с одной строкой `codex-import`.
