# Installing dsh-unslop

## 1. Requirements

- DeepSeek Harness **0.2.x**.
- Python 3.8+ — the DSH bundled runtime is used; no pip packages.
- Network is only needed for the LLM rewrite and `unslop_voice_mimic`; scanners, teach and scoring are offline.

## 2. Install

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-unslop
```

Restart DSH.

## 3. Verify

Ask the agent to run `unslop_scan` on a text. It returns JSON per layer: `phrase`
(violations, severity), `structure` (rhythm metrics), `silhouette` (idea arrangement or a
note for short texts).

Typical flow:

```text
unslop_scan        → find candidates
unslop_constraints → what must survive
unslop_suggest     → suggestions plus the four gates (check:true)
unslop_rewrite     → rewrite + preservation + before/after scans
unslop_validate    → preservation between original and rewrite

unslop_voice_teach → build .unslop/voice/<name>/ (dry-run by default)
unslop_voice_score → "does this sound like me?"
unslop_voice_mimic → draft/rewrite in that voice under the gates
unslop_voice_list  → what voices exist in project or chat scope
```

### Voice quick check

Teach a voice from a folder of `.txt`/`.md` samples (dry-run first):

```powershell
python python/scripts/voice_teach.py me --samples ./samples
python python/scripts/voice_teach.py me --samples ./samples --apply --yes
```

The voice lands in `<cwd>/.unslop/voice/me/` (project scope) or in the per-session
cache for chat scope. `apply` needs `--yes`; replacing an existing voice needs
`--overwrite` as well. In the tool, the equivalent is `apply:true` **and**
`confirm:true`.

Score a draft without changing it:

```powershell
python python/scripts/voice_mimic.py score --name me --candidate draft.md
```

## 4. Configuration

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
    voiceRoot: ""         # '' = <cwd>/.unslop/voice (project scope)
    chatRoot: ""          # '' = <DSH_HOME>/cache/unslop/chats
    impostorsRoot: ""     # '' = vendored upstream impostor pool
    voiceSeed: 7
    voiceTimeoutMs: 120000
```

`unslop_voice_mimic` uses the same `llmProvider`/`llmModel`/`maxTokens` route as
`unslop_rewrite`.

## 5. Tests

```powershell
python python/evals/smoke_voice.py
node test/voice.test.mjs
```

The Python test runs on the vendored silhouette corpus and impostor pool. The
Node test mocks the LLM and checks the dry-run/confirmation/gate contracts. No
network access is required.

## 6. Limits

- English only (`non_english: true` otherwise).
- Scanners surface candidates, not verdicts; check literal/domain uses.
- `unslop_rewrite` and `unslop_voice_mimic` are drafts: verify `preservation.passed` and the constraints.
- Voice teach prefers at least 5 same-genre `.txt`/`.md` documents and 2–3k words; under 2,000 words is `low_confidence`.
- Nothing is written without explicit confirmation: teach needs `apply` + `confirm`; mimic needs `apply` + `confirm` + `outputPath`; `force:true` is only for a user-approved override.
- `unslop_voice_mimic` requires a same-genre impostor pool; the vendored one is at `python/evals/fixtures/voice/impostors/`.

## 7. Uninstall

```powershell
dsh plugin --profile desktop remove dsh-unslop
```

## License

MIT. Vendored unslop code is MIT, © theclaymethod.
