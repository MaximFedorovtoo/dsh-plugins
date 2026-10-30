# Установка dsh-voice-ru

## 1. Требования

- DeepSeek Harness **0.2.x** (Desktop или CLI), Windows/macOS/Linux.
- Для движка `ctc`: ничего ставить не нужно, кроме зависимости плагина
  `sherpa-onnx-node` (pnpm поставит её сам).
- Для движка `e2e`: Python 3.12 с PyTorch/Transformers (см. раздел 4).

## 2. Установка плагина

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-voice-ru
dsh plugin --profile desktop add sherpa-onnx-node
```

`sherpa-onnx-node` — обычная зависимость (у неё нет `dsh.bundle`), поэтому
второй командой она ставится в профиль.

Перезапустите DSH: host-часть плагина загружается при старте, клиентская часть
(кнопки) — после перезапуска или Ctrl+R.

## 3. Одна кнопка вместо двух

Плагин добавляет свою кнопку **«Голосом»**. Встроенный микрофон входит в
экспериментальный bundle; если он тоже включён, кнопок будет две. Чтобы
оставить только одну, уберите bundle из композиции профиля:

`%USERPROFILE%\.dsh\profiles\desktop\package.json` → `dsh.profile.bundles`:

```json
"dsh.profile.bundles": [
  "...остальные...",
  "dsh-voice-ru"
]
```

Удалите строку `@deepseek-ai/dsh-experimental-voice-input-bundle` и перезапустите
DSH. Ручной микрофон после этого не нужен: плагин записывает и распознаёт сам,
настройки голоса в интерфейсе для него не требуются.

Если встроенный микрофон нужен как альтернатива, его можно не отключать —
кнопка плагина просто добавится рядом.

## 4. Движок с пунктуацией (e2e, опционально)

Нужен Python 3.12 (подойдёт встроенный Python DSH или свой) и ~2,5 ГБ диска:

```powershell
# путь к python.exe замените на свой
$py = "C:\Python312\python.exe"
$venv = "$env:USERPROFILE\.dsh\speech-to-text\gigaam-e2e\venv"
& $py -m venv $venv
& "$venv\Scripts\python.exe" -m pip install --upgrade pip
& "$venv\Scripts\python.exe" -m pip install torch torchaudio transformers==4.57.1 sentencepiece hydra-core omegaconf "pyannote.audio==4.0.0" torchcodec
```

Кэш модели должен лежать по **ASCII-пути** (sentencepiece не открывает
`tokenizer.model` по пути с кириллицей), например `C:\hf-cache`. Модель
скачается при первой диктовке (~450 МБ).

Включите движок в патче профиля
`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`:

```yaml
- id: voice-ru
  config:
    engine: e2e
    e2ePython: C:\Users\<user>\.dsh\speech-to-text\gigaam-e2e\venv\Scripts\python.exe
    e2eHfHome: C:\hf-cache
    e2eRevision: e2e_rnnt
```

Перезапустите DSH. Если окружение e2e сломается, плагин сам откатится на CTC.

## 5. Проверка

- В строке ввода (на месте прежнего микрофона) видна кнопка **«Голосом»**.
- Нажмите её, надиктуйте фразу, помолчите — задача появится в поле ввода.
- Проверьте текст, отправьте сами.

Диагностика: при `enableDebug: true` доступен инструмент `voice_stt_check`
(распознать локальный WAV 16 кГц моно PCM16).

## 6. Удаление

```powershell
dsh plugin --profile desktop remove dsh-voice-ru
```

Модели в `%USERPROFILE%\.dsh\speech-to-text\` можно удалить вручную.