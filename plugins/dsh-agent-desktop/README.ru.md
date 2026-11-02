# dsh-agent-desktop — компьютерные действия для агентов DSH

Плагин только для хоста: оборачивает CLI [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) в инструменты DSH. Агент читает **настоящее accessibility-дерево** приложений рабочего стола, действует по устойчивым refs `@<snapshot>:eN` и проверяет результат новым снимком — без угадывания по пикселям.

Работает на **Windows, macOS и Linux** (на macOS один раз выдать Accessibility-разрешение; на Windows разрешения не нужны для приложений того же уровня целостности).

## Инструменты

| Инструмент | Назначение |
|---|---|
| `desktop_status` | Разрешения, платформа, поддерживаемые поверхности |
| `desktop_apps` | Запущенные приложения / видимые окна |
| `desktop_snapshot` | Дерево с refs (`interactiveOnly`, `skeleton`, `compact`, `root`, `surface`) |
| `desktop_find` | Поиск элементов по role/name/value/text и выдача refs |
| `desktop_click` | Клик / двойной / тройной / правый по ref |
| `desktop_type` | Ввод текста в ref |
| `desktop_set_value` | Установить значение элемента напрямую |
| `desktop_press` | Клавиатурные комбинации (`return`, `ctrl+c`, …) |
| `desktop_screenshot` | PNG окна/экрана (сохраняется в файл, не base64) |
| `desktop_clipboard` | Чтение / запись / очистка буфера обмена |
| `desktop_wait` | Ожидание времени, элемента, текста, окна или меню |
| `desktop_batch` | Последовательные CLI-команды одним вызовом |
| `desktop_skills` | Встроенная справка CLI (`desktop`, `platform`, `ffi`) |
| `desktop_raw` | Остальные команды CLI (scroll, drag, hover, окна, уведомления…) |

## Цикл работы

```text
desktop_status
desktop_apps                                  → найти имя приложения
desktop_snapshot {app:"Notepad", interactiveOnly:true, compact:true}
desktop_click {ref:"@s8f3k2p9:e8"}            → действие по ref из этого снимка
desktop_snapshot {app:"Notepad"}              → снова снимок и проверка
```

Refs живут только в своём снимке: при `STALE_REF` сделайте новый снимок. Ошибки содержат `code`, `suggestion` и `disposition.retry` — повторять можно только при `safe`. Доставка по умолчанию **headless**: без движения курсора и перехвата фокуса.

## Установка

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-agent-desktop
dsh plugin --profile desktop add agent-desktop
```

Перезапустите DSH. Пакет `agent-desktop` содержит нативные бинарники для Windows/macOS/Linux, а JS-лаунчер работает даже если postinstall был пропущен.

Если pnpm профиля блокирует postinstall (`ERR_PNPM_IGNORED_BUILDS`), добавьте в `%USERPROFILE%\.dsh\profiles\desktop\pnpm-workspace.yaml`:

```yaml
strictDepBuilds: false
```

и повторите вторую команду. Разрешения по ОС — в [INSTALL.md](INSTALL.md).

## Настройка

```yaml
- id: agent-desktop
  config:
    binary: ""            # '' = платформенный бинарник из пакета agent-desktop в профиле
    timeoutMs: 30000
    maxOutputChars: 20000 # обрезка больших снимков в выводе инструмента
    sessionScope: true    # CLI --session = id сессии DSH (refs изолированы по чатам)
    allowRaw: true        # включить desktop_raw
    headed: false         # false = headless, без движения курсора и смены фокуса
```

## Приватность и безопасность

Снимки, буфер обмена, скриншоты и трейсы могут содержать приватные данные рабочего стола: не публикуйте их в открытых чатах и логах. `headed: true` (или `--headed` через `desktop_raw`) разрешает физический ввод и смену фокуса/курсора. Команды удержания клавиш (`key-down`, `key-up`, `mouse-down`, `mouse-up`) CLI не выполняет без демона и они исключены из `desktop_raw`.

## Лицензия

MIT. Обёрнутый инструмент — Apache-2.0, © Vercel Labs.