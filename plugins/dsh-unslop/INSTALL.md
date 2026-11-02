# Установка dsh-unslop

## 1. Требования

- DeepSeek Harness **0.2.x**.
- Python 3.8+ — используется встроенный Python DSH; отдельных pip-пакетов нет.
- Интернет нужен только для LLM-переписывания (`unslop_rewrite`); сканеры полностью офлайн.

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
```

## 5. Ограничения

- Только английский (`non_english: true` для остальных языков).
- Сканеры — кандидаты, не приговор; проверяйте литературные и доменные употребления.
- `unslop_rewrite` — черновик: сверяйте `preservation.passed` и constraints.
- Голосовые teach/mimic пока не обёрнуты (скрипты лежат в `python/scripts`).

## 6. Удаление

```powershell
dsh plugin --profile desktop remove dsh-unslop
```

## Лицензия

MIT. Вендоренный код unslop — MIT, © theclaymethod.