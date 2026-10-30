# dsh-voice-ru — Russian voice input for DeepSeek Harness

One microphone button in the composer input row, where the built-in microphone used to be turns a dictation into a coherent,
project-aware task:

1. Click **Voice** and dictate your theses in Russian.
2. After ~1.2 s of silence the recording stops by itself (click again to stop
   manually).
3. Speech is recognized locally (GigaAM-v3), the theses are reshaped into one
   coherent task — goal, requirements, constraints, acceptance criteria — using
   the open project context (working directory, `AGENTS.md`, root files, recent
   chat messages).
4. The task is inserted into the composer. You review it, edit if needed, and
   **send it yourself**. Nothing is sent automatically.

A second action, **Make task**, does the same for a draft that is already typed
or dictated: it shapes the draft into a task and leaves it in the composer for
review.

## Engines

| Engine | Model | Size | Punctuation | Speed |
|---|---|---|---|---|
| `ctc` (default) | GigaAM-v3 CTC int8 via sherpa-onnx | ~214 MB | no | very fast on CPU |
| `e2e` | GigaAM-v3 e2e_rnnt via Python/PyTorch | ~2.5 GB env + cache | yes, with normalization | slower, needs Python |

Both engines run fully offline. The e2e engine needs a separate Python
environment (PyTorch + transformers) — see [INSTALL.md](INSTALL.md) for
step-by-step setup; the CTC engine only needs the `sherpa-onnx-node` dependency
and downloads its model into `%USERPROFILE%\.dsh\speech-to-text\gigaam`.

The e2e engine falls back to CTC automatically if the Python environment is
missing or fails, so voice input keeps working.

## Install

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-voice-ru
dsh plugin --profile desktop add sherpa-onnx-node
```

Restart DSH. Optionally remove the built-in voice-input bundle to keep exactly
one microphone button (see INSTALL.md).

## Configuration

```yaml
- id: voice-ru
  config:
    engine: ctc            # 'ctc' or 'e2e'
    dataRoot: ""           # CTC model dir, default <DSH_HOME>/speech-to-text/gigaam
    modelDirectory: ""     # existing dir with model.int8.onnx + tokens.txt
    e2ePython: ""          # python.exe of the e2e venv
    e2eHfHome: ""          # ASCII-only HF cache for the e2e model
    e2eModel: ai-sage/GigaAM-v3
    e2eRevision: e2e_rnnt
    llmProvider: deepseek-account
    llmModel: deepseek-flash
    maxTokens: 1200
    contextMessages: 8
    enableDebug: false
```

## Limitations

- GigaAM is a Russian-only model.
- The e2e model is CPU-heavy and needs an ASCII-only HF cache path on Windows
  (sentencepiece cannot open `tokenizer.model` under a Cyrillic path).
- The shaped task depends on the configured LLM route.
- Recording permission is requested by the browser; only recordings are sent
  to the local Host, never to a cloud service.

## License

MIT.