/**
 * `@local/dsh-llm-kimi` — Kimi provider routes for the DeepSeek Harness LLM
 * seam.
 *
 * The plugin mounts one adapter serving two routes:
 *
 * - `kimi-code` — the paid Kimi Code subscription plan, which Kimi officially
 *   supports in third-party tools (Claude Code, OpenCode, Codex, Hermes). The
 *   key is created in the Kimi Code console and the route defaults to the
 *   international Anthropic-compatible endpoint.
 * - `moonshot` — the pay-per-token Kimi API platform at
 *   `https://api.moonshot.ai/anthropic`.
 *
 * Both routes declare themselves in the configurable-provider directory, so
 * Settings -> Models shows a row per route where the API key is typed once
 * (stored write-only in the harness credential store), and the model picker
 * offers the route's catalog.
 */
import { KimiAdapter } from './adapter.js'
import { resolveApiKey } from './auth.js'
import { PROVIDER_IDS } from './catalog.js'
import { Config, plainOptions, resolveProfiles } from './config.js'

export { Config }

/** Plugin name used in loader diagnostics. */
export const name = 'llm-kimi'

/** The adapter registers routes on the LLM service. */
export const inject = ['llm']

/** Expose the route ids for tests and tooling. */
export { PROVIDER_IDS }

/**
 * Mount the plugin.
 * @param ctx - application context with the `llm` service injected.
 * @param config - live plugin configuration.
 */
export function apply(ctx, config) {
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  const profiles = () => resolveProfiles(plainOptions(config))

  const adapter = new KimiAdapter({
    profiles,
    resolveAuth: (profile) => resolveApiKey(ctx, profile),
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: (provider, model, reason) => {
      ctx.logger.warn(`llm-kimi: ignoring unusable reasoning replay metadata for "${provider}/${model}": ${reason}`)
    },
  })

  // A mounted settings service makes this entry writable from the Models page.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  const entries = [...profiles().values()].map((profile) => ({
    provider: profile.id,
    displayName: profile.displayName,
    settingsNs,
    settingsPath: ['providers', profile.id],
    declared: true,
    defaultBaseURL: profile.baseURL,
    nativeAuth: { env: [profile.apiKeyEnv] },
  }))
  ctx.llm.registerConfigurableProviders(entries)
  ctx.llm.registerAdapter(PROVIDER_IDS, adapter)
}
