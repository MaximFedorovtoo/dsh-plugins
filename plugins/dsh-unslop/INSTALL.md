# Установка dsh-unslop

## 1. Требования

- DeepSeek Harness **0.2.x**.
- Python 3.8+ — используется встроенный Python DSH; отдельных pip-пакетов нет.
- Интернет нужен только для LLM-переписывания (`unslop_rewrite`) и `unslop_voice_mimic`; сканеры, teach и scoring работают офлайн.

## 2. Установка

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-unslop
```

Перезапустите DSH.

## 3. Проверка

Попросите агента: «прогони unslop_scan по этому тексту». Инструмент вернёт JSON по слоям:
`phrase` (violations, severity), `structure` (метрики ритма), `silhouette` (расположение идей
или note для коротких текстов).

Дальше связка:

```text
unslop_scan        → найти кандидатов
unslop_constraints → понять, что обязано сохраниться
unslop_suggest     → предложения с гейтами (check:true)
unslop_rewrite     → перепись + preservation + scan до/после
unslop_validate    → проверить сохранение между оригиналом и переписью

unslop_voice_teach → собрать .unslop/voice/<name>/ (по умолчанию dry-run)
unslop_voice_score → «похоже на меня?»
unslop_voice_mimic → черновик/перепись в голосе под гейтами
unslop_voice_list  → какие голоса есть в области project или chat
```

### Быстрая проверка голоса

Обучите голос на папке `.txt`/`.md` (сначала dry-run):

```powershell
python python/scripts/voice_teach.py me --samples ./samples
python python/scripts/voice_teach.py me --samples ./samples --apply --yes
```

Голос появится в `<cwd>/.unslop/voice/me/` (область project) или в кэше текущей
сессии (область chat). Для записи нужен `--yes`; для замены существующего голоса —
ещё и `--overwrite`. В инструменте это `apply:true` **и** `confirm:true`.

Оценить черновик, ничего не меняя:

```powershell
python python/scripts/voice_mimic.py score --name me --candidate draft.md
```

## 4. Настройка

```yaml
- id: unslop
  config:
    pythonPath: ""
    scriptsRoot: ""
    timeoutMs: 60000
    maxInputChars: 40000
    maxOutputChars: 40000
    llmProvider: deepseek-account
    llmModel: deepseek-flash
    maxTokens: 4000
    voiceRoot: ""         # '' = <cwd>/.unslop/voice (область project)
    chatRoot: ""          # '' = <DSH_HOME>/cache/unslop/chats
    impostorsRoot: ""     # '' = вендоренный upstream impostor-пул
    voiceSeed: 7
    voiceTimeoutMs: 120000
```

`unslop_voice_mimic` использует тот же маршрут `llmProvider`/`llmModel`/`maxTokens`,
что и `unslop_rewrite`.

## 5. Тесты

```powershell
python python/evals/smoke_voice.py
node test/voice.test.mjs
```

Python-тест работает на вендоренном корпусе silhouette и impostor-пуле. Node-тест
подменяет LLM моком и проверяет контракты dry-run/подтверждения/гейтов. Сеть не
нужна.

## 6. Ограничения

- Только английский (`non_english: true` для остальных языков).
- Сканеры — кандидаты, не приговор; проверяйте литературные и доменные употребления.
- `unslop_rewrite` и `unslop_voice_mimic` — черновики: сверяйте `preservation.passed` и constraints.
- Teach предпочитает ≥ 5 same-genre документов `.txt`/`.md` и 2–3k слов; меньше 2 000 слов — `low_confidence`.
- Без явного подтверждения ничего не пишется: teach — `apply` + `confirm`; mimic — `apply` + `confirm` + `outputPath`; `force:true` — только осознанный обход гейта.
- `unslop_voice_mimic` нужен same-genre impostor-пул; вендоренный лежит в `python/evals/fixtures/voice/impostors/`.

## 7. Удаление

```powershell
dsh plugin --profile desktop remove dsh-unslop
```

## Лицензия

MIT. Вендоренный код unslop — MIT, © theclaymethod.
