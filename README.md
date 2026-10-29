# Плагины для DeepSeek Harness: расходы, скриншоты, русский язык и Codex

Четыре плагина для [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):

| Плагин | Что делает | Где работает |
|---|---|---|
| [`dsh-api-spend`](plugins/dsh-api-spend) | Показывает расходы на API в текущем проекте рядом со счётчиками токенов; клик — разбивка по проектам за «Сегодня / 7 дней / Всё время» и официальные итоги платформы для сверки. | Windows, macOS, Linux |
| [`dsh-screenshot`](plugins/dsh-screenshot) | Кнопка «скриншот» в поле ввода (берёт картинку из буфера или открывает выбор файла), редактор разметки прямо во вложении (кисть, стрелка, рамка, текст), инструменты агента «посмотреть на экран / на буфер» и «увеличить участок изображения». | Интерфейс — на всех платформах; снимок экрана и буфера — только Windows |
| [`dsh-locale-ru`](https://github.com/MaximFedorovtoo/dsh-locale-ru) | Полная русская локализация веб-клиента: 64 неймспейса, 2910 строк интерфейса и 545 названий/описаний плагинов. | Windows, macOS, Linux |
| [`dsh-codex-bridge`](https://github.com/MaximFedorovtoo/dsh-codex-bridge) | Переносит проекты и переписку из OpenAI Codex в DSH: проект остаётся в своей папке, чат продолжается в DSH. | Windows, macOS, Linux |

Все плагины — чистый JavaScript без зависимостей и без этапа сборки. Устанавливаются одинаково на всех ОС; ограничение по платформам касается только захвата экрана в `dsh-screenshot` (см. [совместимость](#совместимость-по-платформам)).

[English version](README.en.md) · [Инструкция по установке](INSTALL.md)

## Требования

- DeepSeek Harness **0.2.x** (проверено на 0.2.1-rc.3) — Desktop-приложение или CLI.
- Поверхность **Web / Desktop**: плагины добавляют элементы в интерфейс чата.
- Ничего доустанавливать не нужно: ни Node.js, ни Python, ни компиляторов. Зависимостей у пакетов нет.

Установка проверена end-to-end на реальном профиле: пакеты ставятся и из локальной папки, и из этого репозитория по git-ссылке с `path:`-подкаталогом; строки плагинов собираются в `dsh --profile <name> --dump-config`.

## Быстрая установка

Подробно, со всеми способами и разбором ошибок — в [INSTALL.md](INSTALL.md). Коротко:

**Способ 1 — Discover (индекс плагинов).** В DSH откройте **Plugins → Discover**, нажмите **Add index source** и вставьте:

```
https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
```

Вкладка Discover появляется после включения экспериментального бандла **Custom plugin indexes** на странице Plugins.

**Способ 2 — по ссылке на репозиторий.** **Plugins → Add plugin → Install a third-party plugin** и вставьте адрес нужного пакета:

```
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-api-spend
```

`<commit>` — SHA коммита из [страницы коммитов](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main). Полная форма `git+https://github.com/MaximFedorovtoo/dsh-plugins.git#<commit>&path:/plugins/dsh-screenshot` работает так же. Для git-установки на машине должен быть установлен `git`.

**Способ 3 — CLI.** То же самое из терминала:

```sh
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot'
dsh --profile desktop
```

В PowerShell символ `&` в таком аргументе ломается об обёртку `dsh.cmd`; используйте стоп-парсинг или `cmd.exe`:

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot"
```

Подробнее — в [INSTALL.md](INSTALL.md#21-из-интерфейса).

**Способ 4 — локальная папка.** Скачайте репозиторий (Code → Download ZIP), распакуйте и укажите в **Add plugin** абсолютный путь к папке плагина, например `C:\Users\Имя\dsh-plugins\plugins\dsh-api-spend` (Windows) или `/Users/имя/dsh-plugins/plugins/dsh-api-spend` (macOS). В CLI то же самое: `dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-api-spend`.

После установки включите плагин: **Plugins → Installed** → переключатель нужного бандла (или кнопка **Enable now** в окне установки).

## Совместимость по платформам

| Возможность | Windows 10/11 | macOS | Linux |
|---|---|---|---|
| Установка и включение плагинов | да | да | да |
| `dsh-api-spend`: пилюля расходов, разбивка, итоги платформы | да | да | да |
| `dsh-screenshot`: кнопка в поле ввода, буфер обмена, выбор файла, редактор разметки, drag-and-drop | да | да | да |
| `dsh-screenshot`: инструменты агента `screenshot` и `zoom_image` (снимок экрана/буфера, увеличение участка) | да | нет | нет |

Почему так: захват экрана и буфера в `dsh-screenshot` сделан через Windows PowerShell 5.1 и `System.Drawing`/WPF, потому что хост DSH — это обычный Node без API захвата Electron. На macOS и Linux эти два инструмента возвращают явную ошибку «нужен Windows PowerShell», а остальная часть плагина (кнопка, редактор, отправка картинки вложения) продолжает работать. Порт захвата на macOS (`screencapture`) и Linux (`grim`/`gnome-screenshot` + ImageMagick) — очевидный следующий шаг; в этой версии его нет.

## Что именно ставят эти плагины

- **`dsh-api-spend`** (`api-spend`) — хост-часть читает журналы сессий через `ctx.sessionQuery`, умножает токены на официальные тарифы DeepSeek с учётом пиковых/внепиковых часов и складывает по проектам; клиент-часть рисует пилюлю в строке под полем ввода и диалог разбивки. Тарифы, валюта, окна пика и лимит сессий настраиваются в строке плагина.
- **`dsh-screenshot`** (`screenshot`) — хост-часть регистрирует инструменты `screenshot` и `zoom_image` и раздел системного промпта «How to read a screenshot»; клиент-часть заменяет рейл вложений на версию с редактором разметки и добавляет кнопку захвата в поле ввода.

## Настройка

Обе строки плагинов настраиваются в `cordis.patch.yml` профиля (`~/.dsh/profiles/<profile>/cordis.patch.yml`, на Windows `%USERPROFILE%\.dsh\profiles\<profile>\cordis.patch.yml`) или на странице плагина в **Plugins**, если плагин объявляет собственную страницу конфигурации.

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
    cacheDir: ''          # по умолчанию <DSH_HOME>/cache/screenshot
    defaultZoomScale: 2
    maxZoomScale: 4
```

Ставки в тарифах — за 1 млн токенов в часы пик; вне пика применяется `offPeakFactor`. Итоги платформы в диалоге показывают расходы **всех** клиентов API-ключа, поэтому они больше суммы по проектам — это нормально, для сверки так и задумано.

## Структура репозитория

```
dsh-plugins/
├── plugins/
│   ├── dsh-screenshot/     # пакет dsh-screenshot
│   └── dsh-api-spend/      # пакет dsh-api-spend
├── icons/                  # иконки для индекса Discover
├── index.json              # индекс для вкладки Discover
├── INSTALL.md              # инструкция по установке (рус.)
└── INSTALL.en.md           # installation guide (English)
```

## Лицензия

MIT — см. [LICENSE](LICENSE).

Плагины написаны для DeepSeek Harness и используют его внутренние сервисы (`ctx.tools`, `ctx.systemPrompt`, `ctx.sessionQuery`, `ctx.webServer`, `ctx.connection`, `ctx.deepseekAccount`, слоты клиента). При обновлении DSH проверяйте совместимость: `engines.dsh` в пакетах ограничен веткой 0.2.x.
