# dsh-codex-bridge — контракт между частями плагина

Плагин переносит проект из OpenAI Codex (папка `~/.codex`) в рабочую область DeepSeek Harness.
По умолчанию (`importMode: in-place`) рабочая область указывает на исходную папку проекта и файлы
не копируются; в режиме `copy` проект копируется в `targetRoot` вместе с `.git`. Для каждого треда
создаётся чат-сессия DSH с перепиской из Codex.

Раскладка пакета:

```
dsh-codex-bridge/
  package.json          # bundle-манифест + dsh.client (client.js)
  cordis.patch.yml      # вставка строки плагина (id: codex-import)
  icon.svg
  locale/en.json        # meta.title / meta.description (EN)
  locale/ru.json        # meta.title / meta.description (RU)
  index.js              # Host: apply(ctx, config) — инструмент, HTTP, импорт
  client.js             # Client: панель в Web UI
  src/codex-source.js   # чтение ~/.codex: проекты, треды, транскрипт
  src/session-import.js # запись чат-сессии DSH через ctx.sessionPersistence
```

## Host HTTP API (под `ctx.connection.fetch.register`, префикс `/api`)

Оба маршрута вызываются из клиентской панели обычным `fetch(path, { credentials: 'same-origin' })`.

### `GET /api/codex-import/catalog`

200, JSON:

```json
{
  "ok": true,
  "codexHome": "C:\\Users\\gsdro\\.codex",
  "targetRoot": "C:\\Users\\gsdro\\Documents\\deepseek-harness\\Codex",
  "projects": [
    {
      "id": "4e3573dd-16da-49e7-9df6-bf73d0538c08",
      "name": "сервер",
      "rootPaths": ["C:\\Users\\gsdro\\Documents\\ChatGPT\\сервер"],
      "exists": true,
      "threadCount": 1,
      "imported": true,
      "importedAt": "2026-10-25T19:16:41.417Z",
      "targetDir": "C:\\Users\\gsdro\\Documents\\deepseek-harness\\Codex\\сервер-3",
      "threads": [
        {
          "id": "01a0f78d-f247-7a52-9094-9036debf502c",
          "title": "Проверить доступность сервера",
          "updatedAt": "2026-10-01T13:02:12.045Z",
          "cwd": "C:\\Users\\gsdro\\Documents\\ChatGPT\\сервер",
          "messageCount": 70,
          "importedSessionId": "session-0f719b55-...",
          "importedMessageCount": 70
        }
      ]
    }
  ]
}
```

Ошибка: статус 500, `{ "ok": false, "error": "текст" }`.

### `POST /api/codex-import/import`

Тело (один тред):

```json
{ "projectId": "4e3573dd-...", "threadId": "01a0f78d-..." }
```

`threadId` может отсутствовать/быть `null` — тогда берётся последний тред проекта.

Все чаты одного проекта:

```json
{ "projectId": "4e3573dd-...", "allThreads": true }
```

Все проекты и все их чаты:

```json
{ "allProjects": true }
```

Импорт **идемпотентен по проекту**: повторный вызов для того же проекта обновляет уже
склонированный каталог (файлы перезаписываются новыми версиями) и дописывает в ту же
чат-сессию только новые сообщения Codex. Признак владения — файл `.codex-import.json`
в каталоге проекта (projectId, workspaceId, `sessions` по треду: sessionId, messageCount).

200, JSON:

```json
{
  "ok": true,
  "updated": true,
  "projectName": "сервер",
  "targetDir": "C:\\Users\\gsdro\\Documents\\deepseek-harness\\Codex\\сервер-3",
  "workspaceId": "95836450-...",
  "sessionId": "session-0f719b55-...",
  "sessionTitle": "Codex · сервер · Проверить доступность сервер",
  "sessionCreated": false,
  "appended": 0,
  "messages": 70,
  "copiedFiles": 24,
  "eventCount": 0,
  "attached": true
}
```

- `updated` — каталог найден по манифесту и обновлён (иначе первичный импорт);
- `sessionCreated` — создана новая чат-сессия (false при повторном импорте);
- `appended` — сколько событий дописано в существующую сессию (0, если новых реплик нет);
- `attached` — чат прикреплён к рабочей области; иначе причина в `warning`.

Ответ массового импорта (`allThreads` или `allProjects`):

```json
{
  "ok": true,
  "bulk": true,
  "projectId": "4e3573dd-...",
  "projectName": "сервер",
  "targetDir": "D:\\projects\\сервер",
  "importMode": "in-place",
  "firstSessionId": "session-...",
  "threads": [
    { "threadId": "01a0f78d-...", "sessionId": "session-...", "sessionCreated": true, "appended": 0, "messages": 70 }
  ],
  "totals": { "threads": 7, "created": 5, "updated": 2, "appended": 40, "messages": 320, "errors": 0 }
}
```

Для `allProjects` добавляется `"scope": "all"` и массив `projects` с такими же ответами по проектам,
а `totals` дополняется `projects` и `projectsOk`. Ошибки отдельных тредов не прерывают импорт:
они перечислены в `threads[].error`, а счётчик — в `totals.errors`.

Ошибка: статус 400/500, `{ "ok": false, "error": "текст" }`.

## Инструмент модели `codex_import`

```
{
  action: 'catalog' | 'import' | 'import-all',
  project?: string,   // имя проекта или его id
  thread?: string,    // id треда или подстрока заголовка (опционально)
  allThreads?: boolean, // true — все чаты выбранного проекта
  targetName?: string // имя папки в targetRoot (опционально)
}
```

`catalog` → JSON-каталог (как `projects` выше, кратко).
`import` → результат импорта (как ответ POST); с `allThreads: true` — сводка по всем чатам проекта.
`import-all` → сводка по всем проектам и всем их чатам.

## Клиентская панель (client.js)

- Регистрирует иконку в слоте `sidebar.panellist`: `{ name: 'sidebar.panellist', id: 'codex-import', order: 25, locale: NS, label: () => t('panel') }`.
- Регистрирует страницу в слоте `main`: `{ name: 'main', key: 'codex-import', locale: NS }`.
- Регистрирует словари локали через `ctx.get('locale').register(NS, '<locale>', dict)` для `ru` и `en`,
  `const locale = ctx.get('locale'); const t = locale.bind(NS)`.
- Данные берёт из `GET /api/codex-import/catalog`; импорт — `POST /api/codex-import/import`.
- После успешного импорта показывает кнопку «Открыть чат»: открывает созданную сессию в Web UI
  (`ctx.get('uiWorkspace').openSession(sessionId)`; при необходимости сначала `ctx.get('layout').selectPanel('conversation')`).
- Никаких импортов из `@deepseek-ai/*`, только `require('react')` из таблицы модулей браузера.
- Стили — инлайн, только токены `var(--dsw-alias-*)`.

## Модули

### src/codex-source.js (teammate A)

```js
export function resolveCodexHome(explicit) // '' -> env CODEX_HOME -> ~/.codex
export async function readCodexCatalog({ codexHome }) // -> { projects: [...] } см. API выше
export async function readThreadTranscript({ codexHome, thread }) // thread = элемент threads[]
// -> { threadId, cwd, title, createdAt, messages: [{ role: 'user'|'assistant', text, time }], stats }
```

### src/session-import.js (teammate B)

```js
export async function createImportedSession(ctx, { cwd, title, messages, source })
// -> { sessionId, title, eventCount }
```

`ctx` — Host-контекст плагина (нужны `ctx.sessionPersistence`, `ctx.sessions`).
События/формат — по образцу реального лога `research/sample-session.jsonl` (фреймы zstd декодируются
`research/decode-frames.mjs`).

### index.js (Lead)

- Config: `importMode` (`in-place` | `copy`), `codexHome` ('' = автопоиск), `targetRoot`, `maxTranscriptChars` (0 = вся переписка), `excludeNames`.
- `apply(ctx, config)`: инструмент `codex_import`, два fetch-маршрута, сервис импорта
  (`resolveProjectTarget` → на каждый выбранный тред `importThread`: чтение транскрипта → создание/дописывание сессии → манифест).
