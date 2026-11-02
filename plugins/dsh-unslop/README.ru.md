# dsh-unslop — де-AI текста для агентов DSH

Вендорит скил [theclaymethod/unslop](https://github.com/theclaymethod/unslop) (MIT) как инструменты DSH: находит шаблонные AI-паттерны, защищает факты и регистр, переписывает только там, где действительно что-то не так.

Сканеры детерминированные, только стандартная библиотека Python. Они дают кандидатов — агент проверяет каждое место в контексте. Ни чистый скан, ни знакомая фраза не доказывают авторство.

## Инструменты

| Инструмент | Что делает |
|---|---|
| `unslop_scan` | Три слоя: `phrase` (16 триггеров с контекстными защитами), `structure` (36 паттернов + метрики ритма), `silhouette` (расположение идей, recap-циклы, шаблонные роли абзацев) |
| `unslop_constraints` | Извлекает охраняемые факты: числа, имена, даты, единицы, ссылки, `and/or` |
| `unslop_validate` | `validate_preservation.py` между оригиналом и переписью; `strict` для регулируемых текстов |
| `unslop_suggest` | Co-writer-предложения (span/severity/category/rationale); `check:true` прогоняет четыре контрактных гейта |
| `unslop_rewrite` | scan → constraints → LLM-rewrite → preservation-гейт → повторный scan; возвращает перепись и находки до/после. Сам ничего не применяет |
| `unslop_guide` | Вендоренный `SKILL.md` (доктрина) |

## Установка

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-unslop
```

Перезапустите DSH. Python — встроенный в DSH, npm/pip зависимости не нужны.

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
```

## Ограничения

- **Только английский** — для других языков сканер вернёт `non_english: true` и остановится.
- Сканеры — ревьюеры, не судьи: литературное употребление, цитаты, register-hedges и нормальный текст должны выжить; не «лечите» то, что не болело.
- `unslop_rewrite` зависит от LLM-маршрута; результат — черновик, сверяйте `preservation`.
- Инструменты голоса (`voice_profile.py`, `voice_card.py`, `voice_score.py`) лежат в `python/scripts`, но пока не обёрнуты — это следующий шаг плагина.
- Вендоренный код: MIT, © theclaymethod; фикстуры — в `python/evals/fixtures/silhouette/`.