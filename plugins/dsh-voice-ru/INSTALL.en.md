# Installing dsh-voice-ru

## 1. Requirements

- DeepSeek Harness **0.2.x** (Desktop or CLI), Windows/macOS/Linux.
- `ctc` engine: nothing beyond the plugin's `sherpa-onnx-node` dependency
  (pnpm installs it).
- `e2e` engine: Python 3.12 with PyTorch/Transformers (section 4).

## 2. Install the plugin

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-voice-ru
dsh plugin --profile desktop add sherpa-onnx-node
```

`sherpa-onnx-node` is a plain dependency (it has no `dsh.bundle`), so add it as a
separate package.

Restart DSH: the host half loads at startup, the client half (buttons) after a
restart or Ctrl+R.

## 3. One button instead of two

The plugin adds its own **Voice** button. The built-in microphone belongs to the
experimental voice-input bundle; if that bundle stays enabled you get two
buttons. To keep one, remove it from the profile composition in
`%USERPROFILE%\.dsh\profiles\desktop\package.json` → `dsh.profile.bundles`:

```json
"dsh.profile.bundles": [
  "...other bundles...",
  "dsh-voice-ru"
]
```

Delete `@deepseek-ai/dsh-experimental-voice-input-bundle`, restart DSH. The
plugin records and recognizes by itself and needs no voice settings UI.

## 4. Punctuation engine (e2e, optional)

Requires Python 3.12 (the DSH bundled Python works) and ~2.5 GB of disk:

```powershell
$py = "C:\Python312\python.exe"   # your python.exe
$venv = "$env:USERPROFILE\.dsh\speech-to-text\gigaam-e2e\venv"
& $py -m venv $venv
& "$venv\Scripts\python.exe" -m pip install --upgrade pip
& "$venv\Scripts\python.exe" -m pip install torch torchaudio transformers==4.57.1 sentencepiece hydra-core omegaconf "pyannote.audio==4.0.0" torchcodec
```

The model cache must use an **ASCII-only path** on Windows (sentencepiece cannot
open `tokenizer.model` under a Cyrillic path), for example `C:\hf-cache`. The
model downloads on the first dictation (~450 MB).

Enable the engine in
`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`:

```yaml
- id: voice-ru
  config:
    engine: e2e
    e2ePython: C:\Users\<user>\.dsh\speech-to-text\gigaam-e2e\venv\Scripts\python.exe
    e2eHfHome: C:\hf-cache
    e2eRevision: e2e_rnnt
```

Restart DSH. If the e2e environment breaks, the plugin falls back to CTC.

## 5. Verify

- A **Voice** button appears in the composer input row (the built-in microphone spot).
- Click it, dictate, pause: the task appears in the composer.
- Review the text and send it yourself.

Diagnostics: with `enableDebug: true` the `voice_stt_check` tool transcribes a
local 16 kHz mono PCM16 WAV.

## 6. Uninstall

```powershell
dsh plugin --profile desktop remove dsh-voice-ru
```

Model directories under `%USERPROFILE%\.dsh\speech-to-text\` can be removed
manually.