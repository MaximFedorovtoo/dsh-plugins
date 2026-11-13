# dsh-superuser

Режим суперпользователя и универсальный MCP-хаб для DeepSeek Harness.

## Что делает

**Режим суперпользователя для чата.** Один переключатель на чат заменяет пресет
разрешений на `danger-full-access`: полный доступ к файлам и политика подтверждений
`never`, то есть запросы подтверждения не появляются. Выключение возвращает
`workspace-write` с подтверждениями (`ask`).

- Новый чат получает суперпользователя автоматически (`autoEnable: true` в
  `cordis.patch.yml`); уже открытые на момент установки чаты тоже переключаются.
- Выключить или включить для текущего чата можно отовсюду:
  - панель в левом сайдбаре (переключатель на чат),
  - кнопка `SU` в заголовке чата,
  - инструмент модели `superuser_mode` (`get` / `on` / `off`),
  - HTTP API ниже.
- Выбор записывается в лог сессии через публичный сервис пресетов разрешений,
  поэтому он сохраняется после перезагрузки и действует в следующих ходах.

**Универсальный MCP-хаб.** Любой MCP-сервер подключается на лету, без правки
профиля и без перезапуска:

- транспорты: `stdio` (локальный процесс) и streamable `http` (URL);
- серверы хранятся в `%USERPROFILE%\.dsh\superuser\mcp-servers.json`;
- действия: добавить, изменить, удалить, подключить, отключить, автопереподключение;
- пока сервер подключён, каждый его инструмент регистрируется как
  `mcp__<server>__<tool>`;
- вызовы идут параллельно (без глобальной блокировки), с таймаутами и короткими
  ошибками; упавшее соединение переподключается с экспоненциальной задержкой;
- модель управляет всем через инструмент `mcp_manage`
  (`list` / `add` / `update` / `remove` / `connect` / `disconnect` / `call`).

**Встроенный desktop MCP-сервер.** В комплекте — stdio-сервер `desktop`
(`desktop-mcp.js`), который управляет любым приложением через установленный CLI
`agent-desktop`:

`apps`, `windows`, `snapshot`, `click`, `type`, `press`, `screenshot`,
`scroll`, `find`, `wait`, `set_value`.

Инструменты только для чтения (`apps`, `windows`, `snapshot`, `screenshot`,
`find`) не фокусируют окна и не двигают курсор.

## Важно про риск

Режим суперпользователя даёт модели **полный доступ к файлам и никаких
подтверждений**. Он рассчитан на доверенную локальную работу. Всё, что спрашивает
сама ОС (UAC, SmartScreen, разрешения доступности ОС), **не** обходится: такие
запросы по-прежнему появляются и требуют человека.

MCP-серверы запускаются с теми же правами, что и процесс Harness. Добавляйте
только доверенные серверы.

## Установка

Установите бандл из этой папки через Plugin Manager (`install_bundle` с этой
папкой пакета). `cordis.patch.yml` добавляет одну строку `superuser`.

## Включение и выключение

- Панель (сайдбар → Superuser) и кнопка `SU` в заголовке чата: на чат, вкл/выкл.
- Инструмент модели: `superuser_mode { "action": "on" | "off" | "get" }`.
- API: `POST /api/superuser/permission { "sessionId": "...", "enabled": true }`.
- Плагин целиком: отключите бандл в Plugin Manager; хранилище MCP остаётся на
  диске, уже записанные в чатах пресеты не переписываются.

## Использование MCP-хаба

Примеры для инструмента `mcp_manage`:

```json
{ "action": "add", "name": "filesystem", "transport": "stdio",
  "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\work"] }
```

```json
{ "action": "add", "name": "remote", "transport": "http",
  "url": "http://127.0.0.1:8090/mcp" }
```

```json
{ "action": "connect", "server": "filesystem" }
{ "action": "call", "server": "filesystem", "tool": "list_directory", "callArgs": { "path": "C:\\work" } }
```

Встроенный desktop-сервер всегда настроен как `desktop` и подключается при
старте. Пример вызова: `{ "action": "call", "server": "desktop", "tool": "apps" }`.

Идентификаторы серверов — безопасные имена; хранилище — обычный JSON, его можно
скопировать или отредактировать при остановленном Harness.

## HTTP API (контракт панели)

Все маршруты возвращают JSON (`content-type: application/json; charset=utf-8`) в
конверте `{ "ok": true, "data": ... }` или
`{ "ok": false, "error": { "message": "...", "code": "..." } }`.

| метод | маршрут | тело / query | результат |
|---|---|---|---|
| GET | `/api/superuser/state?sessionId=<id>` | — | `{sessionId, session:{title?}, permission:{preset,sandbox,approval,enabled}, servers:[ServerView]}`; без `sessionId` → `permission: null` |
| POST | `/api/superuser/permission` | `{sessionId, enabled}` | те же данные состояния |
| GET | `/api/superuser/mcp/servers` | — | `{servers:[ServerView]}` |
| POST | `/api/superuser/mcp/servers` | `{action:'add'\|'update'\|'remove'\|'connect'\|'disconnect', server:{id?,name,label?,transport,command?,args?,env?,url?,autoConnect?}}` | `{server:ServerView}` |
| POST | `/api/superuser/mcp/call` | `{server, tool, args}` | `{result}` (сырой результат MCP-вызова) |

`ServerView` —
`{id,name,label,transport,command?,args?,url?,autoConnect,status:'connected'|'disconnected'|'starting'|'error',tools:[{name,title?,description,inputSchema}],lastError?}`.

Ошибки: `404` неизвестная сессия или сервер, `409` чат не активен (сессия есть, но
живого агента в этом процессе нет — откройте чат и повторите), `400` битый JSON
или неверные поля, `405` неверный метод (отдаёт транспорт).

## Настройки

Конфиг строки в `cordis.patch.yml`:

| ключ | по умолчанию | смысл |
|---|---|---|
| `autoEnable` | `true` | включать суперпользователя новым и уже живым агентам |
| `mcpStorePath` | `""` → `<DSH_HOME>/superuser/mcp-servers.json` | хранилище MCP-серверов |
| `connectTimeoutMs` | `20000` | бюджет рукопожатия MCP + `tools/list` |
| `callTimeoutMs` | `90000` | бюджет одного вызова удалённого MCP-инструмента |

## Ограничения

- Запросы ОС (UAC, SmartScreen, диалоги разрешений доступности) не обходятся.
- Инструмент, зарегистрированный в момент подключения сервера, может стать
  доступен на один шаг модели позже; `mcp_manage` доступен сразу.
- Переключение разрешений требует живого чата (сохранённый, но не открытый чат
  отвечает `409`).
- Встроенному desktop-серверу нужен npm-пакет `agent-desktop` в активном профиле
  (та же зависимость, что у `dsh-agent-desktop`).
