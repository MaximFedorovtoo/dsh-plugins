# API Spend (`dsh-api-spend`)

A DeepSeek Harness plugin: below the composer, in the same row that already
carries the token counters, a pill shows what the current project (workspace)
spent on API calls. Clicking it opens a breakdown: the sum per project, tokens
spent, the periods Today / 7 days / All time, and the provider platform's own
totals for comparison.

## How it is calculated

1. The host half reads the logs of every stored session (`ctx.sessionQuery`) and
   folds the provider's token reports: uncached input, cache reads, cache
   writes, output. A retried attempt (`llm/retry-started`) is counted once.
   Every step belongs to the day and the price window (peak / off-peak) in which
   it ran.
2. Tokens are multiplied by the official DeepSeek rates from the plugin config
   and summed per project. A project is a workspace; sessions without a
   workspace are grouped by their own directory; subagent sessions belong to the
   parent's project.
3. The official account totals are requested separately (`x-dsh-auth-token`
   from `ctx.deepseekAccount`): balance, all-time spend and today's spend — they
   are shown in the dialog next to the project rows.

## Rates

Defaults are the official DeepSeek rates (USD per 1M tokens, peak hours):

| model | cache hit | cache miss | output |
|---|---|---|---|
| `deepseek-flash` | 0.006 | 0.30 | 1.20 |
| `deepseek-v4-pro` | 0.044 | 1.32 | 3.96 |

Off-peak is half price (`offPeakFactor: 0.5`). Peak is weekdays 01:00–04:00 and
06:00–10:00 UTC; Chinese public holidays can be listed in `holidays`
(`YYYY-MM-DD`, Beijing time), which makes the whole day off-peak.

Values live on the `api-spend` row in the profile's `cordis.patch.yml`:

```yaml
- id: api-spend
  config:
    currency: USD
    symbol: '$'
    priceUnit: 1000000
    offPeakFactor: 0.5
    peakWindows: [{ start: 1, end: 4 }, { start: 6, end: 10 }]
    peakWeekdays: [1, 2, 3, 4, 5]
    holidays: []
    defaultModel: deepseek-flash
    models:
      deepseek-flash: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 }
      deepseek-v4-pro: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 }
    maxSessions: 2000
    platformRefreshMs: 120000
```

- `models` — rates by the model id the provider reports;
- `defaultModel` — whose rate is used for an unknown model;
- `maxSessions` — how many sessions the report covers (live sessions first, then the newest; default 2000). When the store holds more, the dialog states how many sessions were considered — raise the cap to cover the rest;
- `platformRefreshMs` — how often the official totals are re-read.

## Install

Package `dsh-api-spend`, version 1.1.1, DSH 0.2.x. Plain JavaScript, no
dependencies, no build step, works on Windows, macOS and Linux. Installation
methods are in the repository guide: [INSTALL.en.md](../../INSTALL.en.md)
(English) or [INSTALL.md](../../INSTALL.md) (Russian). The short version:

```sh
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-api-spend'
```

or add the repository index to **Plugins → Discover**:

```
https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
```

## Why the platform page can show more

The `platform.deepseek.com/usage` page shows the spend of **every client** of
the API key (other machines and apps sharing the key). The project rows in the
panel count only this Harness's sessions. The platform totals in the dialog
exist for comparison and are labelled as a separate line.

## Limitations

- The account provider (`deepseek-account`) is needed only for the official
  totals; without it the panel shows session-based figures alone.
- Session logs that cannot be read (old format, damaged tail) are skipped.
- The first report after start reads session journals and can take a few
  seconds; afterwards results are cached by log revision.
- Platform data lags by a few minutes, so a fresh turn can appear in the
  session-based calculation before it appears in the official totals.
- The pill is hidden while today has no spend.
