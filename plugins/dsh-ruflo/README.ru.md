# dsh-ruflo — Ruflo (память, задачи, swarm) для агентов DSH

Обёртка CLI [ruvnet/ruflo](https://github.com/ruvnet/ruflo) в инструменты DSH с явной **областью**:

- **`project`** — рабочая папка открытого проекта. Память/задачи/swarm Ruflo живут рядом с проектом (`.swarm/`, `.claude-flow/`).
- **`chat`** — изолированная папка текущей сессии DSH (`<DSH_HOME>/cache/ruflo/chats/<id-сессии>`). Один чат не видит память, задачи и swarm другого.

Так Ruflo можно применить к проекту (общая память между чатами) или к отдельному чату (приватная рабочая память), не смешивая их.

## Команда в меню ввода

Наберите `/ruflo` в поле ввода или откройте меню `+` и выберите **Ruflo** в разделе «Команды». Откроется попап с быстрыми действиями:

- статус области «проект» или «этот чат»;
- запомнить/найти в памяти проекта, запомнить/найти/статистика памяти чата;
- список задач проекта или чата;
- инициализация Ruflo в проекте или в этом чате;
- статус и инициализация swarm в чате.

Выбор действия добавляет в поле ввода готовый промпт (с явно указанной областью project/chat) — проверьте и отправьте; дальше модель сама вызовет нужный инструмент `ruflo_*`. Из меню ничего не выполняется автоматически.

## Инструменты

| Инструмент | Что делает |
|---|---|
| `ruflo_status` | JSON по агентам/задачам/памяти/производительности в области |
| `ruflo_init` | Явная инициализация Ruflo в области (`.claude-flow/`, `.claude/`, `.swarm/`; без глобальных изменений и модов) |
| `ruflo_memory` | `store`, `search` (semantic/keyword/hybrid), `list`, `stats`, `retrieve`; первый вызов сам создаёт локальную БД памяти |
| `ruflo_task` | `create`, `list`, `status`, `cancel` |
| `ruflo_swarm` | `init` (`--v3-mode`, топология, maxAgents), `status`, `stop` |
| `ruflo_agent` | `spawn` (тип), `list`, `status`, `stop`, `metrics` |
| `ruflo_hooks` | `list`, `route`, `metrics`, `pretrain`, `statusline`, `session-restore/session-end`, `pre-task/post-task`, `pre-edit/post-edit`, `worker` |
| `ruflo_raw` | Прямой вызов для `status, memory, task, swarm, agent, hooks, session, analyze, route, doctor, config, progress, neural, workflow, security, guidance, embeddings` |

Неявно инициализируется только база памяти внутри выбранной области. `ruflo_init` вызывается осознанно, потому что пишет служебные файлы.

## Типичные сценарии

**Память проекта (общая для чатов):**

```text
ruflo_init {scope:"project"}
ruflo_memory {scope:"project", action:"store", key:"arch/auth", value:"JWT + refresh в src/auth", provenance:"agent_output"}
ruflo_memory {scope:"project", action:"search", query:"auth"}
ruflo_task   {scope:"project", action:"create", type:"implementation", description:"Добавить ротацию refresh-токена"}
```

**Память чата (приватная для этого чата):**

```text
ruflo_memory {scope:"chat", action:"store", key:"chat/goal", value:"Проверить плагин"}
ruflo_memory {scope:"chat", action:"search", query:"плагин"}
```

Состояние чата лежит в `<DSH_HOME>/cache/ruflo/chats/<id-сессии>`; удаление папки сбрасывает чат.

## Установка

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-ruflo
dsh plugin --profile desktop add ruflo
```

Перезапустите DSH. CLI запускается встроенным Node из DSH, глобальный npm не нужен.

## Настройка

```yaml
- id: ruflo
  config:
    cliPath: ""          # '' = node_modules/ruflo/bin/ruflo.js из профиля
    projectRoot: ""      # '' = рабочая папка сессии; можно зафиксировать проект
    scopeRoot: ""        # '' = <DSH_HOME>/cache/ruflo
    timeoutMs: 60000
    initTimeoutMs: 180000
    allowRaw: true
```

## Ограничения

- Ruflo — отдельный runtime: его swarm/агенты не являются DSH Agent Teams и не исполняются через инструменты DSH.
- `ruflo_init` пишет `.claude-flow/`, `.claude/settings.json`, `.swarm/memory.db` в выбранную папку и правит `.gitignore`; в области `chat` всё это остаётся в кэше чата.
- CLI может поднять фоновый демон Ruflo для папки области; команда `daemon` намеренно не обёрнута — останавливайте CLI вручную.
- Секреты и данные проекта могут попасть в память Ruflo: выбирайте область осознанно и не храните учётные данные.

## Лицензия

MIT. Ruflo — MIT, © rUv (ruvnet).

## Инициализация под DeepSeek Harness (0.3.0)

`ruflo_init` инициализирует проект под **DSH**, а не Claude Code: вызывается `ruflo init --codex --skip-claude`, поэтому появляются `AGENTS.md` + `.agents/` + `.claude-flow/`, и **никакого** `.claude/`. После init плагин дописывает в `AGENTS.md` секцию «Ruflo in DeepSeek Harness»: DSH-агенту предписано использовать инструменты `ruflo_*` с областями project/chat вместо слэш-команд Claude Code. Для миграции старой Claude-инициализации передайте `force: true` — память и swarm сохраняются.