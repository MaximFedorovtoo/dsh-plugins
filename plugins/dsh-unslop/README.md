# dsh-unslop — de-AI writing for DSH agents

Vendors the [theclaymethod/unslop](https://github.com/theclaymethod/unslop) skill (MIT) as DSH tools. It finds formulaic AI-writing tells, protects facts and register, and rewrites prose only where something is actually wrong.

The scanners are deterministic and standard-library Python. They suggest candidates; the agent checks each use in context. Neither a clean scan nor a familiar phrase proves who wrote the text.

## Tools

| Tool | What it does |
|---|---|
| `unslop_scan` | Three layers: `phrase` (16 literal triggers, contextual gating), `structure` (36 structural patterns + rhythm metrics), `silhouette` (idea arrangement, recap loops, templated roles) |
| `unslop_constraints` | Extract protected facts: numbers, names, dates, units, references, `and/or` |
| `unslop_validate` | `validate_preservation.py` between original and rewrite; `strict` for regulated text |
| `unslop_suggest` | Co-writer suggestions with span/severity/category/rationale; `check:true` runs the four contract gates (span-minimality, replacement-scanner, accept-all, span-overlap) |
| `unslop_rewrite` | scan → constraints → LLM rewrite → preservation gate → re-scan; returns the rewritten text plus before/after findings. Nothing is applied automatically |
| `unslop_guide` | The vendored `SKILL.md` doctrine |

## Install

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-unslop
```

Restart DSH. Python is the bundled DSH runtime; no npm or pip dependencies.

## Configuration

```yaml
- id: unslop
  config:
    pythonPath: ""        # '' = DSH bundled Python
    scriptsRoot: ""       # '' = <plugin>/python/scripts
    timeoutMs: 60000
    maxInputChars: 40000
    maxOutputChars: 40000
    llmProvider: deepseek-account
    llmModel: deepseek-flash
    maxTokens: 4000
```

## Notes and limits

- **English only** — non-English input gets a cheap detection decline (`non_english: true`).
- The scanners are reviewers, not judges: literal domain usage, quoted examples, register hedges and clean prose must survive; never “fix” text that was not broken.
- `unslop_rewrite` depends on the configured LLM route; treat its output as a draft, verify `preservation` before using it.
- Voice teach/mimic tools (`voice_profile.py`, `voice_card.py`, `voice_score.py`) are shipped in `python/scripts` but not wrapped yet — that is the next iteration of this plugin.
- Vendored upstream code: MIT, © theclaymethod. The vendored fixtures live in `python/evals/fixtures/silhouette/`.