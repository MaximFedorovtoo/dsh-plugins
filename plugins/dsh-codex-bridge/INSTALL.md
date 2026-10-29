# Установка Codex Bridge

Плагин `dsh-codex-bridge` подключается к профилю DeepSeek Harness (`~/.dsh/profiles/<профиль>`, на Windows `%USERPROFILE%\.dsh\profiles\<профиль>`). После подключения в левой панели появляется иконка **Codex**, а модель получает инструмент `codex_import`.

**Требования:** DSH 0.2.x (Web/Desktop). Для git-способа — `git`; для установщика `.cmd` — Windows. Зависимостей и сборки у пакета нет. Данные Codex (`~/.codex`) нужны только на этапе самого импорта, не при установке.

Выберите **один** способ: установщик и Plugins/Discover регистрируют один и тот же плагин по-разному, и два подключения сразу дадут дваBundle и дублирующийся инструмент.

---

## 1. Discover (индекс плагинов)

1. **Plugins → Experimental plugins** → включить **Custom plugin indexes**.
2. **Discover → Add index source**:

   ```
   https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
   ```

3. Карточка **Codex Bridge** → **Install** → **Enable now**.
4. Перезапустите DSH.

---

## 2. Git (любая ОС)

Нужен `git` (Windows: Git for Windows; macOS: `xcode-select --install`; Linux: `sudo apt install git`).

**Из интерфейса:** **Plugins → Add plugin → Install a third-party plugin** →

```
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-codex-bridge
```

**Из CLI:**

```sh
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-codex-bridge'
dsh --profile desktop
```

SHA — на [странице коммитов](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main). **Важно для Windows и PowerShell.** В адресе есть подкаталог и символ `&`. Обёртка `dsh` — это `.cmd`-файл, и PowerShell передаёт такой аргумент через `cmd`, который обрезает всё после `&`; pnpm получает адрес без `path:` и падает. Рабочие варианты:

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-codex-bridge"
```

В `cmd.exe` достаточно кавычек.

Проверка без запуска:

```sh
dsh --profile desktop --dump-config | grep codex-import
```

(на Windows — `Select-String codex-import`).

---

## 3. Установщик для Windows (без git)

Папка `installer/` — самостоятельный установщик: копирует плагин в `<профиль>\plugins\dsh-codex-bridge`, добавляет link-зависимость и bundle в `package.json` профиля, выравнивает `node_modules` встроенным pnpm, а при необходимости пишет переопределения в `cordis.patch.yml`.

```powershell
cd <распакованный репозиторий>
.\installer\install.cmd                      # установить
.\installer\install.cmd -DryRun              # показать план
.\installer\install.cmd -ImportMode copy -TargetRoot "D:\CodexProjects"
.\installer\install.cmd -Uninstall           # удалить
```

| Параметр | Смысл |
|---|---|
| `-Profile <имя\|папка>` | профиль DSH (по умолчанию `$env:DSH_PROFILE_DIR`, затем `desktop`) |
| `-Source <папка>` | папка пакета (по умолчанию — корень пакета) |
| `-ImportMode in-place\|copy` | режим импорта (по умолчанию `in-place`) |
| `-TargetRoot <папка>` | куда копировать проекты в режиме `copy` |
| `-CodexHome <папка>` | папка данных Codex (по умолчанию `~/.codex`) |
| `-DryRun` / `-Uninstall` / `-KeepFiles` | план / удаление / оставить файлы |

Установщик делает резервную копию `package.json` перед регистрацией. Повторный запуск обновляет файлы плагина (старые файлы пакета удаляются, чтобы не загружался устаревший код). После установки **перезапустите DSH**.

---

## 4. Локальная папка

**Plugins → Add plugin** → абсолютный путь к папке плагина `plugins\dsh-codex-bridge` в распакованном репозитории (где `package.json`). Из CLI: `dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-codex-bridge`.

---

## Настройка режима импорта

По умолчанию проект **остаётся в своей папке** (`importMode: in-place`). Переключение на копирование — строка в `cordis.patch.yml` профиля:

```yaml
- id: codex-import
  config:
    importMode: copy
    targetRoot: D:\CodexProjects
    codexHome: ''
    maxTranscriptChars: 1500000
```

После правки перезапустите DSH.

Что происходит при импорте:

- `in-place` — рабочая область = исходная папка проекта, файлы не копируются, в папку добавляется `.codex-import.json`;
- `copy` — папка `targetRoot/<имя проекта>`; если она уже есть и это копия проекта, она обновляется, а не получает `-2`.

---

## Как проверить, что работает

1. После перезапуска слева появилась иконка **Codex**; Settings → Plugins показывает «Import from Codex».
2. Откройте Codex → выберите проект → **Импортировать**: в результате `ok: true`, `targetDir` — та самая папка проекта (в режиме по умолчанию), `sessionCreated: true`, `copiedFiles: 0`.
3. Кнопка **Открыть чат** открывает сессию с перепиской, прикреплённую к рабочей области.
4. Повторный импорт того же проекта: `updated: true`, тот же `targetDir` и `sessionId`, новых папок и чатов нет.

---

## Если не работает

| Симптом | Причина и решение |
|---|---|
| Иконки Codex нет | Плагин не загрузился: проверьте строку `codex-import` в `dsh --profile <имя> --dump-config` и лог DSH. Нужен перезапуск приложения. |
| `project not found in Codex` | `codexHome` указывает не туда; проверьте `~/.codex/.codex-global-state.json` или задайте `codexHome`. |
| `project directory is missing` | Папка проекта из Codex удалена или лежит на недоступном диске. |
| При импорте появилась новая папка `-2`/`-3` | Включён режим `copy`, и имя занято другим проектом или посторонней непустой папкой. В режиме по умолчанию (`in-place`) копий не создаётся вообще. |
| Повторный импорт создал новый чат | Потерян `.codex-import.json` в папке проекта (in-place) или в папке копии (copy). Верните манифест или удалите его и импортируйте заново. |
| `Plugin is incompatible with dsh ...` | Версия DSH вне `engines.dsh` (`>=0.2.0 <0.3.0`). Обновите плагин или разрешите ровно эту версию: `dsh plugin --profile <профиль> allow-version dsh-codex-bridge@1.1.0 --dsh-version <точная версия> --accept-risk`. |
| Дублируется инструмент/страница | Плагин подключён дважды (установщик + Plugins). Удалите одну установку. |

---

## Что появится в профиле

- `plugins\dsh-codex-bridge\` — файлы пакета (или зависимость из pnpm при установке через Plugins).
- В `package.json` профиля: `"dsh-codex-bridge": "link:./plugins/dsh-codex-bridge"` (для установщика) и имя в `dsh.profile.bundles`.
- В `cordis.patch.yml` профиля — только если задавали `-TargetRoot`/`-CodexHome`/`-ImportMode`; иначе работают значения по умолчанию из слоя пакета.

Импортированные проекты и чаты при удалении плагина не затрагиваются; `.codex-import.json` в проектах остаётся (его можно удалить вручную).
