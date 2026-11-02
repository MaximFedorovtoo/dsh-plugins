# dsh-unslop — de-AI writing for DSH agents

Vendors the [theclaymethod/unslop](https://github.com/theclaymethod/unslop) skill (MIT) as DSH tools. It finds formulaic AI-writing tells, protects facts and register, and rewrites prose only where something is actually wrong. It also teaches a reusable voice and writes or scores drafts against it.

The scanners are deterministic and standard-library Python. They suggest candidates; the agent checks each use in context. Neither a clean scan nor a familiar phrase proves who wrote the text, and a good voice score does not excuse a failed removal gate.

## Tools

| Tool | What it does |
|---|---|
| `unslop_scan` | Three layers: `phrase` (16 literal triggers, contextual gating), `structure` (36 structural patterns + rhythm metrics), `silhouette` (idea arrangement, recap loops, templated roles) |
| `unslop_constraints` | Extract protected facts: numbers, names, dates, units, references, `and/or` |
| `unslop_validate` | `validate_preservation.py` between original and rewrite; `strict` for regulated text |
| `unslop_suggest` | Co-writer suggestions with span/severity/category/rationale; `check:true` runs the four contract gates (span-minimality, replacement-scanner, accept-all, span-overlap) |
| `unslop_rewrite` | scan → constraints → LLM rewrite → preservation gate → re-scan; returns the rewritten text plus before/after findings. Nothing is applied automatically |
| `unslop_voice_teach` | Build a voice from `.txt`/`.md` samples: `profile.json`, layered `card.md` + `card/<situation>.md`, `provenance.json`. Dry-run by default; writes only with `apply:true` + `confirm:true` |
| `unslop_voice_mimic` | Draft or rewrite in a taught voice, score it against a same-genre impostor pool, run the unslop gates. `dryRun:true` returns the prompt without calling the LLM. Never writes without `apply:true` + `confirm:true` + `outputPath` |
| `unslop_voice_score` | "Does this sound like me?" — composite, GI rank, z-scores and copy gate; changes nothing |
| `unslop_voice_list` | List taught voices in project or chat scope |
| `unslop_guide` | The vendored `SKILL.md` doctrine |

## Voice: teach and mimic

### Layout

A voice is a directory, not one file:

```text
.unslop/voice/<name>/
├── samples/            # approved .txt/.md sources, copied by teach
├── profile.json        # voice_profile.py fingerprint the scorer uses
├── card.md             # always-loaded core, <= 300 words, with an index table
├── card/<situation>.md # one sheet per covered situation; uncovered ones are named, never fabricated
└── provenance.json     # per-sample sha256, word counts, genre note, low-confidence flag
```

**Project scope** stores the voice in `<cwd>/.unslop/voice/`. **Chat scope** keeps it in a per-session cache directory (`<DSH_HOME>/cache/unslop/chats/<session>/.unslop/voice/`) so chats never share a voice unless it is copied. Neither location is committed by this plugin.

### Teach

`unslop_voice_teach` is the deterministic half of `/unslop teach`. It reads at least one `.txt`/`.md` document recursively, builds the profile with `voice_profile.py`, then writes the layered card and provenance with `voice_card.py`.

- Dry-run is the default and writes nothing. It returns the document count, word count, `low_confidence`, the coverage matrix and the exact files apply would write.
- Writing requires **both** `apply:true` and `confirm:true` in the tool, or `--apply --yes` in the CLI.
- Replacing an existing voice additionally requires `overwrite:true` / `--overwrite`.
- Source samples are copied, never edited. The build is staged and swapped into place, so a failed teach does not leave a half-built voice.
- Prefer at least 5 same-genre documents and 2–3k words. Fewer than 2,000 words sets `low_confidence`; surface that to the user before trusting mimic scores. Only `.txt` and `.md` are read.

```powershell
python python/scripts/voice_teach.py me --samples ./samples
python python/scripts/voice_teach.py me --samples ./samples --apply --yes
python python/scripts/voice_teach.py me --samples ./samples --apply --yes --overwrite
```

### Mimic

`unslop_voice_mimic` loads `card.md` plus one `card/<situation>.md` sheet (the levers the generator follows), asks the LLM for a draft, then scores it with `voice_score.py` against the vendored impostor pool. It also runs the phrase/structure/silhouette scanners; in rewrite mode it runs preservation and diff gates.

The rule is absolute: a mimic that scores well on voice but trips a slop gate is rejected. Voice never buys an exemption from the constitution, and meaning preservation is a separate hard check.

- `dryRun:true` returns the assembled card, sheet and prompt; no model call, no writes.
- A normal call returns `draft`, `score`, `gates`, `applied` (always `null` unless writing) and `blocked` when a preservation/copy gate stopped the write.
- Writing needs `apply:true` + `confirm:true` + `outputPath`; existing files need `overwrite:true`. `force:true` bypasses the preservation/copy gate and should be used only on an explicit user decision.
- For a score-only check, use `unslop_voice_score` (no LLM, no writes).

```powershell
python python/scripts/voice_mimic.py prepare --name me --situation anecdote --instruction "Tell the story of the failed launch."
python python/scripts/voice_mimic.py prepare --name me --draft draft.md
python python/scripts/voice_mimic.py score --name me --candidate draft.md
```

### Impostor corpus

`voice_score.py` needs a same-genre impostor pool. The plugin ships the upstream pool at `python/evals/fixtures/voice/impostors/` (12 documents, MIT, vendored from `theclaymethod/unslop`). Override it per call with the tool's `impostors` argument / CLI `--impostors DIR`, or globally with `impostorsRoot`.

The composite is `0.5·(1−GI) + 0.5·` a clipped, weighted impostor-z distance. Lower is more author-like, but it is a guide, not an oracle — read the GI, the per-feature z-scores and the gates together.

## Install

```powershell
dsh plugin --profile desktop add https://github.com/MaximFedorovtoo/dsh-plugins/tree/main/plugins/dsh-unslop
```

Restart DSH. Python is the bundled DSH runtime; no npm or pip dependencies. The vendored upstream code is MIT, © theclaymethod.

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
    voiceRoot: ""         # '' = <cwd>/.unslop/voice (project scope)
    chatRoot: ""          # '' = <DSH_HOME>/cache/unslop/chats
    impostorsRoot: ""     # '' = <plugin>/python/evals/fixtures/voice/impostors
    voiceSeed: 7
    voiceTimeoutMs: 120000
```

`unslop_voice_mimic` uses the same `llmProvider`/`llmModel`/`maxTokens` route as `unslop_rewrite`.

## Tests

```powershell
python python/evals/smoke_voice.py   # deterministic teach/mimic/score smoke tests
node test/voice.test.mjs             # tool contracts: dry-run, confirmation, gates
```

The Python smoke test uses the vendored silhouette corpus (`python/evals/fixtures/silhouette/`) and the vendored impostor pool. The Node test uses a mock LLM, so neither needs network access.

## Notes and limits

- **English only** — non-English input gets a cheap detection decline (`non_english: true`).
- The scanners are reviewers, not judges: literal domain usage, quoted examples, register hedges and clean prose must survive; never “fix” text that was not broken.
- `voice_card.py` is deterministic: same inputs give byte-identical cards. The wrapper stores generated cards as UTF-8 even where the platform default encoding differs.
- The card never fabricates an uncovered situation. If `praise` has no sample evidence, the card names it as uncovered and the mimic warns instead of inventing it.
- A `voice_score` composite is not proof of authorship. It compares a candidate with one profile and one impostor pool; treat deltas as the signal and under-claim.
- `unslop_rewrite` and `unslop_voice_mimic` depend on the configured LLM route; treat their output as a draft and verify `preservation` before using it.
- Vendored upstream code: MIT, © theclaymethod. Fixtures live in `python/evals/fixtures/`.
