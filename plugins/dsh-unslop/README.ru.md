# dsh-unslop — де-AI текста для агентов DSH

Вендорит скил [theclaymethod/unslop](https://github.com/theclaymethod/unslop) (MIT) как инструменты DSH: находит шаблонные AI-паттерны, защищает факты и регистр, переписывает только там, где действительно что-то не так. Умеет также обучить переиспользуемый голос и писать/оценивать черновики в нём.

Сканеры детерминированные, только стандартная библиотека Python. Они дают кандидатов — агент проверяет каждое место в контексте. Ни чистый скан, ни знакомая фраза не доказывают авторство, и хороший voice-score не отменяет проваленный removal-гейт.

## Инструменты

| Инструмент | Что делает |
|---|---|
| `unslop_scan` | Три слоя: `phrase` (16 триггеров с контекстными защитами), `structure` (36 паттернов + метрики ритма), `silhouette` (расположение идей, recap-циклы, шаблонные роли абзацев) |
| `unslop_constraints` | Извлекает охраняемые факты: числа, имена, даты, единицы, ссылки, `and/or` |
| `unslop_validate` | `validate_preservation.py` между оригиналом и переписью; `strict` для регулируемых текстов |
| `unslop_suggest` | Co-writer-предложения (span/severity/category/rationale); `check:true` прогоняет четыре контрактных гейта |
| `unslop_rewrite` | scan → constraints → LLM-rewrite → preservation-гейт → повторный scan; возвращает перепись и находки до/после. Сам ничего не применяет |
| `unslop_voice_teach` | Строит голос из `.txt`/`.md` образцов: `profile.json`, слоистый `card.md` + `card/<situation>.md`, `provenance.json`. По умолчанию dry-run; пишет только при `apply:true` + `confirm:true` |
| `unslop_voice_mimic` | Пишет или переписывает в обученном голосе, оценивает по same-genre impostor-пулу и прогоняет гейты unslop. `dryRun:true` возвращает промпт без вызова LLM. Не пишет без `apply:true` + `confirm:true` + `outputPath` |
| `unslop_voice_score` | «Похоже на меня?» — composite, GI, z-scores и copy-gate; ничего не меняет |
| `unslop_voice_list` | Список обученных голосов в области project или chat |
| `unslop_guide` | Вендоренный `SKILL.md` (доктрина) |

## Голос: teach и mimic

### Раскладка

Голос — это каталог:

```text
.unslop/voice/<name>/
├── samples/            # одобренные .txt/.md, teach копирует их
├── profile.json        # отпечаток voice_profile.py, по нему считает scorer
├── card.md             # always-on ядро, <= 300 слов, с таблицей-индексом
├── card/<situation>.md # лист на каждую покрытую ситуацию; непокрытые только называются
└── provenance.json     # sha256 образцов, слова, genre note, low-confidence
```

**Область project** хранит голос в `<cwd>/.unslop/voice/`. **Область chat** — в кэше текущей сессии (`<DSH_HOME>/cache/unslop/chats/<session>/.unslop/voice/`), чтобы чаты не делили голос без явного копирования. Плагин не коммитит ни то, ни другое.

### Teach

`unslop_voice_teach` — детерминированная половина `/unslop teach`: читает `.txt`/`.md` рекурсивно, строит профиль через `voice_profile.py`, затем слоистую карточку и provenance через `voice_card.py`.

- Dry-run по умолчанию: возвращает число документов, слов, `low_confidence`, coverage-матрицу и точный список файлов, которые были бы записаны; на диск ничего не пишет.
- Запись требует **одновременно** `apply:true` и `confirm:true` в инструменте или `--apply --yes` в CLI.
- Замена существующего голоса дополнительно требует `overwrite:true` / `--overwrite`.
- Исходные образцы копируются, а не редактируются. Сборка идёт во временном каталоге и подменяется целиком, поэтому неудачный teach не оставляет полусобранный голос.
- Желательно ≥ 5 документов одного жанра и 2–3k слов. Меньше 2 000 слов → `low_confidence`; покажите это пользователю до доверия к mimic. Читаются только `.txt` и `.md`.

```powershell
python python/scripts/voice_teach.py me --samples ./samples
python python/scripts/voice_teach.py me --samples ./samples --apply --yes
python python/scripts/voice_teach.py me --samples ./samples --apply --yes --overwrite
```

### Mimic

`unslop_voice_mimic` загружает `card.md` и один лист `card/<situation>.md`, просит LLM написать черновик, затем оценивает его через `voice_score.py` по вендоренному impostor-пулу. Дополнительно прогоняет сканеры phrase/structure/silhouette; в режиме rewrite — preservation и diff.

Правило жёсткое: mimic, который хорошо звучит, но валит slop-гейт, отклоняется. Голос не даёт исключения из конституции, а сохранение смысла — отдельный жёсткий гейт.

- `dryRun:true` возвращает собранную карточку, лист и промпт; без вызова модели и без записи.
- Обычный вызов возвращает `draft`, `score`, `gates`, `applied` (`null`, пока не записано) и `blocked`, если preservation/copy-гейт остановил запись.
- Запись требует `apply:true` + `confirm:true` + `outputPath`; существующий файл — ещё и `overwrite:true`. `force:true` обходит preservation/copy-гейт и допустим только по явному решению пользователя.
- Только оценка — `unslop_voice_score` (без LLM и без записи).

```powershell
python python/scripts/voice_mimic.py prepare --name me --situation anecdote --instruction "Расскажи историю провального запуска."
python python/scripts/voice_mimic.py prepare --name me --draft draft.md
python python/scripts/voice_mimic.py score --name me --candidate draft.md
```

### Impostor-корпус

`voice_score.py` нужен same-genre пул «чужих» текстов. Плагин поставляет upstream-пул в `python/evals/fixtures/voice/impostors/` (12 документов, MIT, вендорено из `theclaymethod/unslop`). Переопределить можно аргументом `impostors` / `--impostors DIR` или настройкой `impostorsRoot`.

Composite = `0.5·(1−GI) + 0.5·` клиппированное взвешенное impostor-z расстояние. Меньше — больше похоже на автора, но это ориентир, а не оракул: читайте GI, z-scores по признакам и гейты вместе.

## Установка

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-unslop
```

Перезапустите DSH. Python — встроенный в DSH, npm/pip зависимости не нужны. Вендоренный upstream-код — MIT, © theclaymethod.

## Настройка

```yaml
- id: unslop
  config:
    pythonPath: ""        # '' = встроенный Python DSH
    scriptsRoot: ""       # '' = <plugin>/python/scripts
    timeoutMs: 60000
    maxInputChars: 40000
    maxOutputChars: 40000
    llmProvider: deepseek-account
    llmModel: deepseek-flash
    maxTokens: 4000
    voiceRoot: ""         # '' = <cwd>/.unslop/voice (область project)
    chatRoot: ""          # '' = <DSH_HOME>/cache/unslop/chats
    impostorsRoot: ""     # '' = <plugin>/python/evals/fixtures/voice/impostors
    voiceSeed: 7
    voiceTimeoutMs: 120000
```

`unslop_voice_mimic` использует тот же маршрут `llmProvider`/`llmModel`/`maxTokens`, что и `unslop_rewrite`.

## Тесты

```powershell
python python/evals/smoke_voice.py   # детерминированные smoke-тесты teach/mimic/score
node test/voice.test.mjs             # контракты инструментов: dry-run, подтверждение, гейты
```

Python-тест использует вендоренный корпус silhouette (`python/evals/fixtures/silhouette/`) и impostor-пул. Node-тест подменяет LLM моком; сеть не нужна.

## Ограничения

- **Только английский** — для других языков сканер вернёт `non_english: true` и остановится.
- Сканеры — ревьюеры, не судьи: литературное употребление, цитаты, register-hedges и нормальный текст должны выжить; не «лечите» то, что не болело.
- `voice_card.py` детерминирован: одинаковые входы дают байт-идентичные карточки. Обёртка сохраняет карточки в UTF-8, даже если системная кодировка другая.
- Карточка не выдумывает непокрытую ситуацию: если для `praise` нет образцов, она называет её uncovered, а mimic предупреждает вместо выдумывания.
- Composite `voice_score` не доказывает авторство: он сравнивает кандидата с одним профилем и одним impostor-пулом; смотрите на дельты и не переоценивайте.
- `unslop_rewrite` и `unslop_voice_mimic` зависят от LLM-маршрута; результат — черновик, сверяйте `preservation`.
- Вендоренный код: MIT, © theclaymethod; фикстуры — в `python/evals/fixtures/`.
