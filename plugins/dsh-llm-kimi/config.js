/**
 * Live configuration: the schemastery schema mounted by the loader plus the
 * resolution pass that turns a patch-layer override into detached route
 * profiles.
 *
 * The only configuration key is `providers`, a dictionary keyed by route name.
 * A route missing from the dictionary uses its built-in preset, so a bare
 * plugin mount is fully serviceable and a deployment only overrides the facts
 * it wants to change (endpoint, key reference, model catalog, caps).
 */
import z from '@deepseek-ai/schemastery'

import {
  PROVIDER_IDS,
  PRESETS,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from './catalog.js'

const MAX_TIMER_DELAY_MS = 2147483647

const modelSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(['text', 'image'])).min(1),
  reasoning: z.union(['efforts', 'always', 'none']),
  defaultReasoningEffort: z.string(),
})

const providerSchema = z.object({
  displayName: z.string(),
  baseURL: z.string(),
  apiKeyEnv: z.string(),
  authStyle: z.union(['x-api-key', 'bearer']),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  defaultContextWindow: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS),
  models: z.array(modelSchema),
})

/** Runtime schema for the plugin configuration. */
export const Config = z.object({
  providers: z.dict(providerSchema).default({}).volatile(),
})

/** Read the live configuration references as plain data. */
export function plainOptions(config) {
  return {
    providers: config.providers?.get?.() ?? {},
  }
}

const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u

function fail(message) {
  throw new Error(`llm-kimi: ${message}`)
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive integer`)
  return value
}

function normalizeModel(provider, raw, presetEntry) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(`provider "${provider}" model entries must be objects`)
  if (typeof raw.id !== 'string' || raw.id.length === 0) fail(`provider "${provider}" has a model entry without a non-empty id`)
  const id = raw.id
  const merged = {
    id,
    name: raw.name ?? presetEntry?.name ?? id,
    ...(raw.description ?? presetEntry?.description) === undefined
      ? {}
      : { description: raw.description ?? presetEntry.description },
    contextWindow: raw.contextWindow ?? presetEntry?.contextWindow ?? undefined,
    ...(raw.maxTokens ?? presetEntry?.maxTokens) === undefined
      ? {}
      : { maxTokens: raw.maxTokens ?? presetEntry.maxTokens },
    inputModalities: [...(raw.inputModalities?.length > 0 ? raw.inputModalities : presetEntry?.inputModalities ?? ['text'])],
    reasoning: raw.reasoning ?? presetEntry?.reasoning ?? 'efforts',
    ...(raw.defaultReasoningEffort ?? presetEntry?.defaultReasoningEffort) === undefined
      ? {}
      : { defaultReasoningEffort: raw.defaultReasoningEffort ?? presetEntry.defaultReasoningEffort },
  }
  if (typeof merged.name !== 'string' || merged.name.length === 0) fail(`provider "${provider}" model "${id}" has an empty name`)
  if (merged.contextWindow !== undefined) positiveInteger(merged.contextWindow, `provider "${provider}" model "${id}" contextWindow`)
  if (merged.maxTokens !== undefined) positiveInteger(merged.maxTokens, `provider "${provider}" model "${id}" maxTokens`)
  if (!Array.isArray(merged.inputModalities) || merged.inputModalities.length === 0) fail(`provider "${provider}" model "${id}" needs at least one input modality`)
  if (!['efforts', 'always', 'none'].includes(merged.reasoning)) fail(`provider "${provider}" model "${id}" has unsupported reasoning "${merged.reasoning}"`)
  return merged
}

function resolveBaseURL(provider, value) {
  if (typeof value !== 'string' || value.length === 0) fail(`provider "${provider}" needs a non-empty baseURL`)
  let url
  try {
    url = new URL(value)
  } catch {
    fail(`provider "${provider}" baseURL "${value}" is not a valid URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(`provider "${provider}" baseURL must be an http(s) URL`)
  if (url.search !== '' || url.hash !== '') fail(`provider "${provider}" baseURL must not carry a query or fragment`)
  return value.replace(/\/+$/u, '')
}

/** Resolve one route profile from its preset and the deployment override. */
function resolveProfile(provider, raw) {
  const preset = PRESETS[provider]
  if (preset === undefined) {
    fail(`unknown provider route "${provider}"; this plugin serves ${PROVIDER_IDS.map((id) => `"${id}"`).join(', ')}`)
  }
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) fail(`provider "${provider}" configuration must be an object`)
  const override = raw ?? {}
  // Schemastery materializes a missing array field as `[]`, so an empty list
  // means "not overridden" here; a route without any model is refused below.
  const models = override.models === undefined || override.models.length === 0
    ? preset.models.map((entry) => normalizeModel(provider, entry, undefined))
    : override.models.map((entry) => normalizeModel(provider, entry, preset.models.find((candidate) => candidate.id === entry?.id)))
  if (models.length === 0) fail(`provider "${provider}" needs at least one model`)
  const seen = new Set()
  for (const entry of models) {
    if (seen.has(entry.id)) fail(`provider "${provider}" declares model "${entry.id}" twice`)
    seen.add(entry.id)
  }
  const apiKeyEnv = override.apiKeyEnv ?? preset.apiKeyEnv
  if (typeof apiKeyEnv !== 'string' || !CREDENTIAL_REF_PATTERN.test(apiKeyEnv)) {
    fail(`provider "${provider}" apiKeyEnv "${apiKeyEnv}" is not a credential reference (expected e.g. KIMI_CODE_API_KEY)`)
  }
  const authStyle = override.authStyle ?? preset.authStyle
  if (authStyle !== 'x-api-key' && authStyle !== 'bearer') fail(`provider "${provider}" authStyle must be "x-api-key" or "bearer"`)
  const displayName = override.displayName ?? preset.displayName
  if (typeof displayName !== 'string' || displayName.length === 0) fail(`provider "${provider}" has an empty displayName`)
  const maxTokens = positiveInteger(override.maxTokens ?? preset.maxTokens ?? DEFAULT_MAX_TOKENS, `provider "${provider}" maxTokens`)
  const defaultContextWindow = positiveInteger(
    override.defaultContextWindow ?? preset.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    `provider "${provider}" defaultContextWindow`,
  )
  const streamIdleTimeoutMs = override.streamIdleTimeoutMs ?? preset.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    fail(`provider "${provider}" streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return Object.freeze({
    id: provider,
    displayName,
    baseURL: resolveBaseURL(provider, override.baseURL ?? preset.baseURL),
    apiKeyEnv,
    authStyle,
    maxTokens,
    defaultContextWindow,
    streamIdleTimeoutMs,
    models: Object.freeze(models),
  })
}

/**
 * Resolve every route this plugin serves. Missing configuration uses presets;
 * a deployment overrides individual fields without restating the rest.
 * @param options - plain configuration data.
 * @returns detached route profiles keyed by provider id, in display order.
 */
export function resolveProfiles(options) {
  const raw = options.providers ?? {}
  for (const key of Object.keys(raw)) {
    if (!PROVIDER_IDS.includes(key)) {
      fail(`unknown provider route "${key}" in config.providers; this plugin serves ${PROVIDER_IDS.map((id) => `"${id}"`).join(', ')}`)
    }
  }
  const profiles = new Map()
  for (const provider of PROVIDER_IDS) profiles.set(provider, resolveProfile(provider, raw[provider]))
  return profiles
}
