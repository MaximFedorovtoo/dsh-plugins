# Установка dsh-ruflo

## 1. Требования

- DeepSeek Harness **0.2.x**.
- Зависимость `ruflo` (npm-пакет, ставится в профиль). Встроенный Node DSH
  используется для запуска CLI, глобальный npm не нужен.

## 2. Установка

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-ruflo
dsh plugin --profile desktop add ruflo
```

Перезапустите DSH.

## 3. Области: проект или чат

Каждый инструмент требует `scope`:

- `project` — рабочая папка текущего проекта (или `projectRoot` из конфига).
  Память проекта общая для всех чатов.
- `chat` — изолированная папка сессии
  `<DSH_HOME>/cache/ruflo/chats/<id-сессии>`. Приватная память конкретного чата.

Переключить область можно в любой момент — это просто разные папки состояния.

## 4. Проверка

```text
ruflo_memory {scope:"chat", action:"store", key:"chat/hello", value:"тест"}
ruflo_memory {scope:"chat", action:"search", query:"тест"}
```

Первый вызов сам создаст `.swarm/memory.db` в папке области и вернёт JSON с
результатами поиска (`score`, `preview`).

`ruflo_status {scope:"project"}` до инициализации вернёт «not initialized» —
это нормально, вызовите `ruflo_init {scope:"project"}`.

## 5. Настройка

```yaml
- id: ruflo
  config:
    cliPath: ""
    projectRoot: ""
    scopeRoot: ""
    timeoutMs: 60000
    initTimeoutMs: 180000
    allowRaw: true
```

## 6. Сброс состояния

- Чат: удалить `<DSH_HOME>/cache/ruflo/chats/<id-сессии>`.
- Проект: удалить `.swarm/` и `.claude-flow/` в проекте (осторожно: там же
  задачи/swarm, если использовались).

## 7. Удаление

```powershell
dsh plugin --profile desktop remove dsh-ruflo
```

Зависимость `ruflo` можно оставить для CLI или удалить отдельно.

## 8. Безопасность

Память Ruflo хранит тексты задач и заметок локально. Не сохраняйте секреты и
учётные данные. `ruflo_init` в проекте создаёт служебные файлы и меняет
`.gitignore` — вызывайте его осознанно.