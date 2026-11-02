# Installing dsh-unslop

## 1. Requirements

- DeepSeek Harness **0.2.x**.
- Python 3.8+ — the DSH bundled runtime is used; no pip packages.
- Network is only needed for the LLM rewrite (`unslop_rewrite`); the scanners are offline.

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
```

## 5. Limits

- English only (`non_english: true` otherwise).
- Scanners surface candidates, not verdicts; check literal/domain uses.
- `unslop_rewrite` is a draft: verify `preservation.passed` and the constraints.
- Voice teach/mimic tools are not wrapped yet (scripts live in `python/scripts`).

## 6. Uninstall

```powershell
dsh plugin --profile desktop remove dsh-unslop
```

## License

MIT. Vendored unslop code is MIT, © theclaymethod.