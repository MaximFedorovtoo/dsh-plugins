# Установка dsh-agent-desktop

## 1. Требования

- DeepSeek Harness **0.2.x**.
- Windows, macOS или Linux (x64/arm64).
- Node.js не нужен отдельно: плагин использует нативные бинарники пакета
  `agent-desktop` (npm).
- macOS: разрешение **Accessibility** для терминала/DSH.
- Linux: графическая сессия с `at-spi2-core`; для Wayland-клипборда —
  `wl-clipboard`.

## 2. Установка

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-agent-desktop
dsh plugin --profile desktop add agent-desktop
```

Первая команда ставит плагин, вторая — CLI (нативные бинарники для всех платформ).
Затем перезапустите DSH.

### Если pnpm блокирует postinstall

`agent-desktop` имеет postinstall-скрипт (линкует бинарник). В pnpm 11 он может
заблокироваться с `ERR_PNPM_IGNORED_BUILDS`. Разрешите ему отработать:

`%USERPROFILE%\.dsh\profiles\desktop\pnpm-workspace.yaml`:

```yaml
strictDepBuilds: false
onlyBuiltDependencies:
  - agent-desktop
```

и повторите `dsh plugin --profile desktop add agent-desktop`. Даже без
postinstall пакет рабочий: JS-лаунчер запускает платформенный бинарник сам.

## 3. Разрешения

- **Windows** — ничего выдавать не нужно для приложений того же уровня
  целостности, что и терминал.
- **macOS** — Accessibility: `agent-desktop permissions --guide` (или
  System Settings → Privacy & Security → Accessibility → добавить DSH/терминал).
- **Linux** — AT-SPI включён в типичной GNOME-сессии; проверка:
  `agent-desktop permissions`.

## 4. Проверка

Инструмент `desktop_status` (в чате: «проверь состояние agent-desktop») должен
вернуть `ok:true` и `permissions.accessibility.state:"granted"`.

Дальше:

```text
desktop_apps
desktop_snapshot {app:"<имя приложения>", interactiveOnly:true, compact:true}
desktop_click {ref:"@<snapshot>:e3"}
desktop_snapshot {app:"<имя приложения>"}
```

## 5. Настройка

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

`headed: true` разрешает физический ввод (курсор, фокус); по умолчанию доставка
headless. `binary` — путь к своему бинарнику CLI, если не хотите зависимость.

## 6. Удаление

```powershell
dsh plugin --profile desktop remove dsh-agent-desktop
```

Зависимость `agent-desktop` можно оставить (пригодится для CLI) или удалить
`dsh plugin --profile desktop remove agent-desktop`.

## 7. Безопасность

Снимки дерева, клипборд, скриншоты и трейсы могут содержать приватные данные
рабочего стола. Не публикуйте их. Команды удержания клавиш/кнопок
(`key-down`, `key-up`, `mouse-down`, `mouse-up`) требуют демона и недоступны.