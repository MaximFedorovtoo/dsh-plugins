/**
 * Built-in Kimi route presets and the catalog metadata derived from them.
 *
 * Two distinct Kimi products exist, with different billing and different
 * endpoints; both speak the Anthropic Messages protocol:
 *
 * - `kimi-code`  — the Kimi Code subscription plan (kimi.com/code). The
 *   endpoint is `https://api.kimi.ai/coding` internationally and
 *   `https://api.kimi.com/coding` in mainland China. The API key is created in
 *   the Kimi Code console and is authenticated with the Anthropic `x-api-key`
 *   header, exactly like Claude Code's `ANTHROPIC_API_KEY`.
 * - `moonshot`   — the pay-per-token Kimi API platform (platform.kimi.ai).
 *   The Anthropic-compatible root is `https://api.moonshot.ai/anthropic`
 *   (`https://api.moonshot.cn/anthropic` in China) and the key is sent as a
 *   bearer token, like Claude Code's `ANTHROPIC_AUTH_TOKEN`.
 *
 * Model list, context windows and reasoning rules come from the vendor docs:
 * - https://www.kimi.com/code/docs/kimi-code/models.html
 * - https://www.kimi.com/code/docs/third-party-tools/claude-code.html
 * - https://platform.kimi.ai/docs/api/messages
 * - https://platform.kimi.ai/docs/models
 *
 * Plan tiers change the available context window of the subscription models
 * (e.g. `k3.1-pro` is 256K on Plus and 1M on Pro+); the preset uses the
 * conservative value that every paid tier can serve. A deployment with a
 * higher tier raises `contextWindow` in the provider's `models` override.
 */

/** Route owned by the Kimi Code subscription plan. */
export const KIMI_CODE = 'kimi-code'

/** Route owned by the pay-per-token Kimi API platform. */
export const MOONSHOT = 'moonshot'

/** Provider routes served by this plugin, in display order. */
export const PROVIDER_IDS = Object.freeze([KIMI_CODE, MOONSHOT])

/** International Kimi Code endpoint (Anthropic-compatible root). */
export const KIMI_CODE_BASE_URL = 'https://api.kimi.ai/coding'

/** Mainland-China Kimi Code endpoint. */
export const KIMI_CODE_CN_BASE_URL = 'https://api.kimi.com/coding'

/** International pay-per-token Anthropic-compatible endpoint. */
export const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/anthropic'

/** Mainland-China pay-per-token Anthropic-compatible endpoint. */
export const MOONSHOT_CN_BASE_URL = 'https://api.moonshot.cn/anthropic'

/** Reasoning levels shared by every model that exposes an `effort` control. */
export const EFFORT_LEVELS = Object.freeze([
  { id: 'low', name: 'Low', description: 'Fastest answers; the least reasoning depth.' },
  { id: 'high', name: 'High', description: 'The recommended balance for most coding work.' },
  { id: 'max', name: 'Max', description: 'Reserve for the hardest, quality-first tasks.' },
])

/** The only selectable level of a model whose thinking cannot be switched off. */
const ALWAYS_ON_EFFORTS = Object.freeze([
  { id: 'on', name: 'Thinking on', description: 'This model always reasons before answering.' },
])

const model = (id, name, contextWindow, reasoning, extra = {}) => Object.freeze({
  id,
  name,
  contextWindow,
  reasoning,
  inputModalities: Object.freeze(['text', 'image']),
  ...extra,
})

/**
 * Kimi Code subscription models.
 *
 * `kimi-for-coding` is K2.8 Preview under the hood and defaults to `max`
 * effort; `kimi-for-coding-highspeed` is thinking-always-on with no effort
 * control; the K3 family defaults to `high`.
 */
export const KIMI_CODE_MODELS = Object.freeze([
  model('k3.1-pro', 'Kimi K3.1 Pro', 262144, 'efforts', {
    description: '3T-class flagship, thinking-only. Raise contextWindow to 1048576 on Pro+ plans.',
    defaultReasoningEffort: 'high',
  }),
  model('k3.1-pro-highspeed', 'Kimi K3.1 Pro HighSpeed', 262144, 'always', {
    description: 'Same intelligence as K3.1 Pro at roughly 2-3x output speed. Raise contextWindow to 1048576 on Pro+ plans.',
  }),
  model('k3', 'Kimi K3', 262144, 'efforts', {
    description: 'Previous-generation 2.8T flagship. Raise contextWindow to 1048576 on Pro+ plans.',
    defaultReasoningEffort: 'high',
  }),
  model('k3-256k', 'Kimi K3 256K', 262144, 'efforts', {
    description: 'The 256K-context K3 variant.',
    defaultReasoningEffort: 'high',
  }),
  model('kimi-for-coding', 'Kimi for Coding (K2.8)', 1048576, 'efforts', {
    description: 'Coding-tuned general model with a 1M-token context window.',
    defaultReasoningEffort: 'max',
  }),
  model('kimi-for-coding-highspeed', 'Kimi for Coding HighSpeed', 262144, 'always', {
    description: 'Coding model with always-on thinking and faster output.',
  }),
])

/**
 * Pay-per-token Kimi API platform models reachable through the
 * Anthropic-compatible endpoint. The Messages endpoint documents the K3 family;
 * older K2 models stay off this route on purpose.
 */
export const MOONSHOT_MODELS = Object.freeze([
  model('kimi-k3.1-pro', 'Kimi K3.1 Pro', 1048576, 'efforts', {
    description: '3T-class flagship with a 1M-token context window.',
    defaultReasoningEffort: 'high',
  }),
  model('kimi-k3.1-pro-highspeed', 'Kimi K3.1 Pro HighSpeed', 1048576, 'efforts', {
    description: 'K3.1 Pro at roughly 2-3x output speed.',
    defaultReasoningEffort: 'high',
  }),
  model('kimi-k3', 'Kimi K3', 1048576, 'efforts', {
    description: '2.8T open-weight flagship with a 1M-token context window.',
    defaultReasoningEffort: 'high',
  }),
])

/** Default output cap per request; the docs recommend at least 16000 for thinking models. */
export const DEFAULT_MAX_TOKENS = 32768

/** Default capacity fallback for a model the catalog does not describe. */
export const DEFAULT_CONTEXT_WINDOW = 262144

/** Default idle bound: a stream that produces nothing for this long is failed. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

/** Built-in provider presets, merged under a deployment's configuration. */
export const PRESETS = Object.freeze({
  [KIMI_CODE]: Object.freeze({
    id: KIMI_CODE,
    displayName: 'Kimi Code (подписка)',
    baseURL: KIMI_CODE_BASE_URL,
    apiKeyEnv: 'KIMI_CODE_API_KEY',
    authStyle: 'x-api-key',
    maxTokens: DEFAULT_MAX_TOKENS,
    defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    models: KIMI_CODE_MODELS,
  }),
  [MOONSHOT]: Object.freeze({
    id: MOONSHOT,
    displayName: 'Kimi API (оплата по токенам)',
    baseURL: MOONSHOT_BASE_URL,
    apiKeyEnv: 'MOONSHOT_API_KEY',
    authStyle: 'bearer',
    maxTokens: DEFAULT_MAX_TOKENS,
    defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    models: MOONSHOT_MODELS,
  }),
})

/** The API-key environment variable the Models page suggests first. */
export function suggestedKeyEnv(provider) {
  const preset = PRESETS[provider]
  if (preset !== undefined) return preset.apiKeyEnv
  const stem = String(provider).toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return `${stem === '' ? 'KIMI' : stem}_API_KEY`
}

/** Advertise one catalog entry to selector surfaces (no reasoning metadata). */
export function catalogModelInfo(provider, entry) {
  return {
    provider,
    id: entry.id,
    name: entry.name ?? entry.id,
    ...entry.description === undefined ? {} : { description: entry.description },
    inputModalities: [...(entry.inputModalities ?? ['text'])],
  }
}

/** Reasoning metadata for one catalog entry, or undefined when it cannot think. */
export function reasoningInfo(provider, entry) {
  const style = entry.reasoning ?? 'efforts'
  if (style === 'none') return undefined
  if (style === 'always') {
    return { efforts: ALWAYS_ON_EFFORTS.map((effort) => ({ ...effort })), defaultEffort: 'on' }
  }
  const defaultEffort = entry.defaultReasoningEffort ?? 'high'
  if (!EFFORT_LEVELS.some((effort) => effort.id === defaultEffort)) {
    throw new Error(`llm-kimi: provider "${provider}" model "${entry.id}" has an unknown defaultReasoningEffort "${defaultEffort}"`)
  }
  return { efforts: EFFORT_LEVELS.map((effort) => ({ ...effort })), defaultEffort }
}

/**
 * Resolve one exact model's metadata against the current provider profile.
 * Unknown ids remain routable, mirroring the provider-neutral contract; they
 * carry the route fallbacks and no reasoning selector.
 */
export function modelInfo(profile, modelId) {
  const provider = profile.id
  const entry = profile.models.find((candidate) => candidate.id === modelId)
  const base = entry === undefined
    ? { provider, id: modelId, name: modelId, inputModalities: ['text'] }
    : catalogModelInfo(provider, entry)
  const contextWindow = entry?.contextWindow ?? profile.defaultContextWindow
  const defaultMaxTokens = entry?.maxTokens ?? profile.maxTokens
  const reasoning = entry === undefined ? undefined : reasoningInfo(provider, entry)
  return {
    ...base,
    context: { contextWindow },
    defaultMaxTokens,
    ...reasoning === undefined ? {} : { reasoning },
  }
}

/**
 * The reasoning style an exact model speaks: `efforts` (selectable
 * low/high/max), `always` (fixed thinking), or `none`.
 */
export function reasoningStyle(profile, modelId) {
  const entry = profile.models.find((candidate) => candidate.id === modelId)
  return entry?.reasoning ?? 'none'
}

/** Resolve one entry from the profile catalog, falling back to route defaults. */
export function modelEntry(profile, modelId) {
  return profile.models.find((candidate) => candidate.id === modelId)
}
