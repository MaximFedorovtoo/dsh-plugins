/**
 * The provider adapter registered with the harness `llm` service.
 *
 * One adapter instance serves both Kimi routes. A prepared call captures the
 * resolved route profile, so a settings change between preparation and
 * dispatch cannot mix one generation's endpoint with another's catalog; the
 * key and the request body are resolved at dispatch time.
 */
import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm'

import { catalogModelInfo, modelInfo } from './catalog.js'
import { authHeaders, buildRequest, endpointOf, parseSse, providerFailure, translate } from './wire.js'

function httpFailure(profile, response, text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  const detail = parsed !== null && typeof parsed === 'object'
    ? parsed
    : { error: { message: text.slice(0, 500) } }
  const failure = providerFailure(detail, response.status, response.headers)
  const facts = failure.failure ?? {}
  return new LlmError(
    `Kimi (${profile.id}): ${failure.message}`,
    failure.code,
    {
      cause: new Error(text),
      ...facts.status === undefined ? {} : { status: facts.status },
      ...facts.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: facts.providerRetryAfterMs },
      ...facts.requestId === undefined ? {} : { requestId: facts.requestId },
    },
  )
}

export class KimiAdapter extends LlmAdapter {
  constructor(dependencies) {
    super()
    this.dependencies = dependencies
  }

  profile(provider) {
    const profile = this.dependencies.profiles().get(provider)
    if (profile === undefined) throw new LlmError(`llm-kimi: no route "${provider}" is registered by this adapter`, 'NO_ADAPTER')
    return profile
  }

  /** Downgrade to text-only when no attachment provider is mounted. */
  modelMetadata(profile, modelId) {
    const info = modelInfo(profile, modelId)
    if (this.dependencies.resolveAttachments() === undefined && info.inputModalities?.includes('image') === true) {
      return { ...info, inputModalities: ['text'] }
    }
    return info
  }

  providerInfo(provider) {
    return { id: provider, name: this.profile(provider).displayName }
  }

  async listModels(provider) {
    return this.profile(provider).models.map((entry) => catalogModelInfo(provider, entry))
  }

  async resolveModel(provider, model) {
    return this.modelMetadata(this.profile(provider), model)
  }

  async prepareCall(provider, model, signal) {
    signal?.throwIfAborted()
    const profile = this.profile(provider)
    const info = this.modelMetadata(profile, model)
    // Surface a missing or malformed credential before the loop starts a turn.
    await this.dependencies.resolveAuth(profile)
    return {
      model: info,
      stream: (options) => this.generate(options, profile),
    }
  }

  async *generate(options, profile) {
    const outer = options.signal
    const controller = new AbortController()
    const signal = outer === undefined
      ? controller.signal
      : AbortSignal.any([outer, controller.signal])
    let idle = false
    let timer
    const arm = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        idle = true
        controller.abort(new Error('Kimi stream idle timeout'))
      }, profile.streamIdleTimeoutMs)
    }
    try {
      const apiKey = await this.dependencies.resolveAuth(profile)
      arm()
      const attachments = this.dependencies.resolveAttachments()
      const { body, toolNames } = await buildRequest({
        profile,
        modelId: options.model,
        options,
        attachments,
        signal,
        onReplayDegrade: (reason) => this.dependencies.onReplayDegrade?.(profile.id, options.model, reason),
      })
      arm()
      let response
      try {
        response = await fetch(endpointOf(profile.baseURL), {
          method: 'POST',
          signal,
          redirect: 'error',
          headers: {
            ...attributionHeaders(),
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'anthropic-version': '2023-06-01',
            ...authHeaders(profile, apiKey),
          },
          body: JSON.stringify(body),
        })
      } catch (error) {
        if (idle || outer?.aborted === true) throw error
        throw new LlmError(`Kimi (${profile.id}) request to ${endpointOf(profile.baseURL)} failed`, 'TRANSPORT', { cause: error })
      }
      arm()
      if (!response.ok) {
        let text = ''
        try {
          text = await response.text()
        } catch {
          text = ''
        }
        throw httpFailure(profile, response, text)
      }
      if (response.body === null) throw new LlmError('Kimi API returned no response body', 'EMPTY_RESPONSE')
      yield* translate(parseSse(response.body, arm), options.model, toolNames)
    } catch (error) {
      if (idle) throw new LlmError('Kimi stream idle timeout', 'TIMEOUT', { cause: error })
      if (outer?.aborted === true) throw new LlmError('Kimi request aborted', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError('Kimi transport failed', 'TRANSPORT', { cause: error })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
