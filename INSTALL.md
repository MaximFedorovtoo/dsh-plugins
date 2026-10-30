# Установка плагинов DSH

Инструкция для пользователей DeepSeek Harness (DSH). Плагины лежат в этом репозитории отдельными пакетами в `plugins/`; список с ссылками — в [README.md](README.md).

Все пакеты — чистый JavaScript без зависимостей и без скриптов установки (`prepare`/`build` нет), поэтому ставятся одинаково на Windows, macOS и Linux и не требуют разрешений на запуск кода при установке.

**Что нужно:** DSH 0.2.x (Desktop или CLI) и поверхность Web/Desktop. Проверено на DSH Desktop 0.2.1-rc.3, Windows 11: установка из локальной папки и из GitHub-репозитория (git, подкаталог через `path:`), сборка строк в `--dump-config`.

---

## 0. Куда ставится плагин

Плагины живут в **профиле** DSH — это папка `~/.dsh/profiles/<имя>` (Windows: `%USERPROFILE%\.dsh\profiles\<имя>`). У Desktop-приложения профиль обычно называется `desktop`, у CLI — тем именем, с которым вы запускаете `dsh --profile <имя>`.

Установка добавляет пакет в зависимости профиля и его бандл-слой в список `dsh.profile.bundles`; включение/выключение плагина — это переключатель на странице **Plugins**.

Все способы ниже ставят плагин в один и тот же профиль; выбирайте любой.

---

## 1. Способ через Discover (индекс плагинов)

Самый простой для тех, кто пользуется только интерфейсом: DSH сам показывает карточку плагина, версию и кнопку **Install**.

1. Откройте **Plugins** в левом меню.
2. В разделе **Experimental plugins** включите бандл **Custom plugin indexes**. После этого рядом с **Installed** появится вкладка **Discover**.
3. Откройте **Discover** → **Add index source** и вставьте URL индекса:

   ```
   https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
   ```

4. В списке появятся карточки всех плагинов репозитория (например, **API Spend**, **Screenshot Input**, **Project Portability**). Нажмите **Install** у нужного, подтвердите версию и источник.
5. Дождитесь окончания установки и нажмите **Enable now** (или включите переключатель на карточке в **Installed**).

Индекс — обычный JSON-файл, его можно открыть в браузере и проверить: [index.json](https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json). Источник ставится один раз и обновляется сам: новые версии появятся в Discover, когда они будут в индексе.

> Индекс и карточки — сторонний контент. DSH проверяет формат, но не репутацию автора: добавляйте только те источники, которым доверяете.

---

## 2. Способ через Git (ссылка на репозиторий)

Подходит и для интерфейса, и для CLI. Нужен установленный `git`:

- **Windows:** [Git for Windows](https://git-scm.com/download/win) (`winget install --id Git.Git -e`).
- **macOS:** `xcode-select --install` (или `brew install git`).
- **Linux:** `sudo apt install git` / `sudo dnf install git`.

Установка привязана к конкретному коммиту (так безопаснее: содержимое ветки не может измениться незаметно). SHA последнего коммита — на [странице коммитов](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main).

### 2.1. Из интерфейса

**Plugins → Add plugin → Install a third-party plugin** (стрелка рядом с **Add plugin**), вставьте в поле один из адресов:

```
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-api-spend
```

Замените `<commit>` на 40-символьный SHA. Нажмите **Install**, дождитесь pnpm, затем **Enable now**.

Полная форма тоже принимается: `git+https://github.com/MaximFedorovtoo/dsh-plugins.git#<commit>&path:/plugins/dsh-screenshot`.

### 2.2. Из CLI

```sh
# подставьте свой профиль и SHA коммита
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot'
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-api-spend'
dsh --profile desktop
```

**Важно для Windows и PowerShell.** В аргументе есть символ `&`. Обёртка `dsh` — это `.cmd`-файл, и PowerShell передаёт такой аргумент через `cmd`, который обрезает всё после `&`; pnpm получает адрес без `path:` и падает с `ERR_PNPM_INVALID_DEPENDENCY_NAME`. Рабочие варианты:

```powershell
# PowerShell: --% отключает разбор остатка строки, кавычки доходят до cmd
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot"
```

```bat
:: cmd.exe: кавычки сохраняют &
dsh plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot"
```

В диалоге **Add plugin** этой проблемы нет: поле передаёт адрес напрямую, без командной оболочки.

Проверить, что слой применился, можно без запуска:

```sh
dsh --profile desktop --dump-config | grep -i -E 'screenshot|api-spend'
```

(на Windows `grep` замените на `Select-String`: `dsh --profile desktop --dump-config | Select-String -Pattern 'screenshot|api-spend'`).

---

## 3. Способ из локальной папки (ZIP)

1. На GitHub: **Code → Download ZIP**, распакуйте, например в `C:\Users\Имя\dsh-plugins` (Windows) или `~/dsh-plugins` (macOS/Linux).
2. **Из интерфейса:** **Plugins → Add plugin** → в поле вставьте **абсолютный** путь к папке плагина, не к репозиторию:

   ```
   C:\Users\Имя\dsh-plugins\plugins\dsh-api-spend
   /Users/имя/dsh-plugins/plugins/dsh-screenshot
   ```

3. **Из CLI:** путь можно относительным:

   ```sh
   dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-api-spend
   dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-screenshot
   ```

> Папку, установленную таким способом, **нельзя перемещать и удалять**: pnpm оставляет на неё ссылку, и после переноса плагин перестанет загружаться. Если нужна независимость от папки — используйте git-установку или соберите tarball (`pnpm pack` в папке пакета) и ставьте `.tgz`.

---

## 4. Включение после установки

Установка и включение — разные шаги: пакет может стоять, но быть выключенным.

- Окно установки → **Enable now**; или
- **Plugins → Installed** → карточка плагина → переключатель; или
- строка плагина в `cordis.patch.yml` профиля (необязательно).

Если DSH пишет, что нужен перезапус — перезапустите приложение; для веб-версии обычно достаточно обновить страницу.

---

## 5. Проверка, что всё работает

**`dsh-api-spend`.** Под полем ввода, в той же строке, где счётчики токенов, появляется пилюля с суммой за сегодня (например `$0.004`). Клик открывает разбивку по проектам и итоги платформы. Пилюля не показывается, пока за сегодня расходов нет.

**`dsh-screenshot`.**

- В поле ввода появляется кнопка-камера: она берёт картинку из буфера обмена (например, после `Win+Shift+S`), а если картинки нет — открывает выбор файла.
- Прикрепите изображение и щёлкните по нему в ленте вложений — откроется редактор разметки (кисть, стрелка, рамка, текст; 6 цветов, 3 толщины, отмена, очистка). **Применить** заменит вложение размеченным PNG.
- Спросите агента «посмотри на мой экран» — на Windows он вызовет инструмент `screenshot`; чтобы прочитать мелкий текст на скриншоте, агент вызовет `zoom_image`.

---

## 6. Настройка

Настройки — в строке плагина в `cordis.patch.yml` профиля. После правки перезапустите DSH (или дождитесь пересборки профиля).

`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`:

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
    cacheDir: ''          # по умолчанию <DSH_HOME>/cache/screenshot
    defaultZoomScale: 2
    maxZoomScale: 4
```

Значения по умолчанию соответствуют официальным тарифам DeepSeek (USD за 1 млн токенов в часы пик); вне пика применяется `offPeakFactor`. Если провайдер поменяет тарифы, поправьте `models` — пересчёт идёт по конфигурации, а не по зашитым числам.

---

## 7. Обновление и удаление

**Обновление:** git/локальную установку — удалить и поставить заново (или обновить SHA); из Discover — карточка покажет доступную версию.

**Удаление:**

- **Plugins → Installed** → карточка → **Remove** (с подтверждением); или
- ```sh
  dsh plugin --profile desktop remove dsh-api-spend
  dsh plugin --profile desktop remove dsh-screenshot
  ```

Удаление убирает и пакет, и слой из профиля; данных плагины не хранят. Кэш снимков `dsh-screenshot` лежит в `~/.dsh/cache/screenshot` — его можно удалить вручную.

---

## 8. Если не работает

| Симптом | Причина и решение |
|---|---|
| В Discover нет карточек | Не включён бандл **Custom plugin indexes**, либо индекс не добавлен/не открылся. Проверьте URL индекса в браузере. |
| `Plugin is incompatible with dsh ...` | Версия DSH вне диапазона `engines.dsh` (`>=0.2.0 <0.3.0`). Обновите плагин или осознанно разрешите ровно эту версию: `dsh plugin --profile <профиль> allow-version dsh-screenshot@1.4.0 --dsh-version <точная версия DSH> --accept-risk`. Смысл флага `--accept-risk` — «я понимаю, что внутренние API могли измениться». |
| Установка падает на GitHub / таймаут | Нет `git`, нет доступа к github.com или прокси. Поставьте git или используйте ZIP-папку. |
| `pnpm blocked a build script` | У этих пакетов нет скриптов сборки, значит pnpm просит разрешение для чужой зависимости из вашего профиля. Читайте имена пакетов перед разрешением. |
| Пилюли расходов нет | Сегодня ещё не было расходов; или не выключен плагин; или аккаунт работает через «сырой» API-ключ — тогда показываются только расчёты по сессиям, без итогов платформы. |
| Сумма в пилюле меньше, чем на platform.deepseek.com | Страница платформы считает **все** клиенты API-ключа, панель — только сессии этого DSH. Это разные числа по смыслу. |
| `screenshot`/`zoom_image` на macOS или Linux отвечают ошибкой про Windows PowerShell | Так и задумано в этой версии: захват экрана реализован только для Windows. Кнопка, редактор и отправка картинки работают. |
| Кнопка-камера не берёт картинку из буфера | Браузер/система не даёт доступ к буферу обмена. Разрешите доступ к буферу для страницы DSH или прикрепите файл через выбор файла / `Ctrl+V`. |
| После обновления DSH плагин не загрузился | Внутренние сервисы DSH могли измениться. Проверьте issues репозитория; `engines.dsh` указан специально, чтобы такие несовпадения были видны, а не молчаливы. |
| `EPERM: operation not permitted, scandir` при экспорте проекта | В проект попал каталог с запрещающим ACL. С версии 1.0.1 такой каталог пропускается с предупреждением, а экспорт продолжается — обновите плагин и повторите. |

---

## 9. Что именно появится в профиле

После установки в `package.json` профиля появляются зависимости, а в `dsh.profile.bundles` — имена бандлов:

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

Строки плагинов (`api-spend`, `screenshot`, `project-portability`) добавляет слой `cordis.patch.yml` самого пакета. Свои правки конфигурации держите в `cordis.patch.yml` профиля — установка пакета их не перезапишет.

---

## 10. Перенос проектов (`dsh-project-portability`)

Плагин выгружает проект DSH целиком в **один файл `.dshpack`** и восстанавливает
его на другом компьютере: файлы проекта, все чаты с полной историей и
контекстом, вложения. После импорта проект появляется в сайдбаре как рабочая
область, а чаты открываются и продолжаются как обычно.

**Установка.**

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-project-portability"
```

Или локальная папка: `dsh plugin --profile desktop add C:\путь\dsh-plugins\plugins\dsh-project-portability`.
После установки — `Ctrl+R` (или перезапуск приложения).

**Проверка.** В сайдбаре появляется страница **«Перенос проектов»**; у модели
есть инструменты `project_list`, `project_export`, `project_import`.

**Как перенести проект на другой компьютер:**

1. Экспорт: кнопка **Экспортировать** у проекта или инструмент `project_export`.
   Архив по умолчанию ложится в `%USERPROFILE%\.dsh\exports\<проект>-<дата>.dshpack`.
2. Скопируйте `.dshpack` на внешний диск / флешку.
3. На другом компьютере установите DSH и этот плагин.
4. Импорт: `project_import` или блок **Импорт архива** в панели. Без `targetDir`
   проект развернётся в исходный путь, если он свободен, иначе рядом с суффиксом
   `-2`; путь можно задать явно.
5. Нажмите `Ctrl+R` — проект и все чаты на месте.

**Настройка** — строка плагина в `cordis.patch.yml` профиля:

```yaml
- id: project-portability
  config:
    archiveDir: ''            # по умолчанию <DSH_HOME>/exports
    excludeNames: ['.dsh-portability.tmp']
    includeSessions: true
    includeAttachments: true
```

Если проект большой, добавьте в `excludeNames` `node_modules`, `.venv`,
`__pycache__`, `dist` — архив станет меньше, но зависимости придётся
восстановить на целевой машине.

**Ограничения.** Spill-файлы (временные выгрузки очень длинных выводов
инструментов) не переносятся; абсолютные пути вне корня проекта не
переписываются; импорт создаёт новые id сессий — история и заголовки при этом
сохраняются. Недоступные для чтения каталоги и файлы (например, с запрещающим
ACL) пропускаются с предупреждением: остальной проект копируется, в архиве этих
записей не будет. Неудачный экспорт не оставляет недописанный `.dshpack`.


## 11. Русский голосовой ввод (`dsh-voice-ru`)

Кнопка **«Голосом»** в строке ввода (на месте прежнего встроенного микрофона):
надиктуйте тезисы, после паузы запись остановится, речь распознается локально
(GigaAM), тезисы превращаются в связную задачу с контекстом проекта и
вставляются в поле — вы её проверяете и отправляете сами.

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-voice-ru
dsh plugin --profile desktop add sherpa-onnx-node
```

Затем перезапустите DSH. Чтобы осталась одна кнопка-микрофон, уберите встроенный
bundle `@deepseek-ai/dsh-experimental-voice-input-bundle` из `dsh.profile.bundles`
в `%USERPROFILE%\.dsh\profiles\desktop\package.json`.

Модель CTC (~214 МБ) скачивается при первой диктовке в
`%USERPROFILE%\.dsh\speech-to-text\gigaam`. Опциональный движок `e2e` (с
пунктуацией) требует Python/PyTorch — подробности в
[`plugins/dsh-voice-ru/INSTALL.md`](plugins/dsh-voice-ru/INSTALL.md).