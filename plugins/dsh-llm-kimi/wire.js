/**
 * Wire layer: Kimi's Anthropic-compatible Messages protocol on one side, the
 * harness StreamChunk vocabulary on the other.
 *
 * Request shape follows https://platform.kimi.ai/docs/api/messages:
 * `POST {base}/v1/messages` with `model`, required `max_tokens`, `messages`,
 * an optional top-level `system`, `tools` and `output_config.effort` for the
 * models whose reasoning level is selectable. Thinking is always requested by
 * omitting any switch (the endpoint's models reason by default); the effort is
 * the only control, which matches what the vendor documents for third-party
 * tools.
 *
 * Response `thinking` blocks carry a `signature` that must be passed back
 * unchanged on later turns, so it travels in the harness replay state.
 */
import { LlmError, isContextWindowExceededError, isQuotaExceededError } from '@deepseek-ai/dsh-llm'

const DEFAULT_TOOL_SCHEMA = Object.freeze({ type: 'object', properties: {} })
const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9-_]{0,127}$/u
const REPLAY_KIND = 'kimi-messages'
const REPLAY_VERSION = 1

/** Resolve the Messages endpoint without duplicating an explicit `/v1` segment. */
export function endpointOf(baseURL) {
  const base = String(baseURL).replace(/\/+$/u, '')
  const path = new URL(base).pathname.replace(/\/+$/u, '')
  return path.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
}

/** Build the authentication headers one route uses. */
export function authHeaders(profile, apiKey) {
  return profile.authStyle === 'bearer'
    ? { authorization: `Bearer ${apiKey}` }
    : { 'x-api-key': apiKey }
}

function malformed(detail) {
  throw new LlmError(`Kimi Messages stream: ${detail}`, 'MALFORMED_RESPONSE')
}

function unsupported(detail) {
  throw new LlmError(`Kimi Messages cannot represent ${detail}`, 'UNSUPPORTED_CONTENT')
}

function textOf(message) {
  let text = ''
  for (const block of message.content) if (block.type === 'text') text += block.text
  return text
}

function wireToolName(name, taken) {
  if (TOOL_NAME_PATTERN.test(name) && !taken.has(name)) {
    taken.add(name)
    return name
  }
  let stem = String(name).replace(/[^a-zA-Z0-9-_]/gu, '_').slice(0, 112)
  if (!/^[a-zA-Z_]/u.test(stem)) stem = `tool_${stem}`
  let candidate = stem
  let suffix = 2
  while (taken.has(candidate) || !TOOL_NAME_PATTERN.test(candidate)) {
    const tail = `_${suffix}`
    candidate = `${stem.slice(0, 120 - tail.length)}${tail}`
    suffix += 1
  }
  taken.add(candidate)
  return candidate
}

/**
 * Convert one durable assistant message into Anthropic content blocks.
 * Reasoning signatures come from the adapter-owned replay state; a missing or
 * unusable signature degrades to a signature-less thinking block, which the
 * Kimi endpoint accepts.
 */
function assistantBlocks(message, modelId, wireNamesByName, onReplayDegrade) {
  const replay = readReplay(message, modelId, onReplayDegrade)
  const blocks = []
  for (const [index, block] of message.content.entries()) {
    if (block.type === 'text') {
      if (block.text.length > 0) blocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'reasoning') {
      if (block.text.length === 0) continue
      const signature = replay?.[index]?.signature
      blocks.push({
        type: 'thinking',
        thinking: block.text,
        ...typeof signature === 'string' && signature.length > 0 ? { signature } : {},
      })
    } else if (block.type === 'tool-call') {
      let input = {}
      try {
        const parsed = JSON.parse(block.arguments)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed
      } catch {
        input = {}
      }
      blocks.push({ type: 'tool_use', id: block.id, name: wireNamesByName.get(block.name) ?? block.name, input })
    } else {
      unsupported(`assistant content ${block.type}`)
    }
  }
  return blocks
}

/**
 * Validate the adapter-owned replay envelope for one assistant message.
 * Foreign, cross-model, or misaligned metadata is dropped with a diagnostic
 * instead of failing the request; the durable content is authoritative.
 */
export function readReplay(message, modelId, onReplayDegrade) {
  const envelope = message.source?.replayState
  if (envelope === undefined) return undefined
  const fail = (detail) => {
    onReplayDegrade?.(detail)
    return undefined
  }
  if (message.source?.kind !== 'model') return fail('replay state on a non-model source')
  if (envelope === null || typeof envelope !== 'object') return fail('replay state is not an object')
  const response = envelope.response
  if (response === null || typeof response !== 'object') return fail('replay state has no response envelope')
  if (response.kind !== REPLAY_KIND || response.version !== REPLAY_VERSION) return fail('unsupported replay kind or version')
  if (response.model !== message.source.model) return fail('replay model does not match the assistant source model')
  if (response.model !== modelId) return fail('replay model does not match the requested model')
  if (!Array.isArray(envelope.blocks) || envelope.blocks.length !== message.content.length) return fail('replay block count does not match the message')
  const blocks = []
  for (const [index, value] of envelope.blocks.entries()) {
    const type = message.content[index]?.type
    if (value === null || typeof value !== 'object') return fail('replay block is not an object')
    if (value.type !== type) return fail('replay block type does not match the message block')
    if (value.signature !== undefined && (type !== 'reasoning' || typeof value.signature !== 'string')) return fail('invalid replay signature')
    blocks.push({ type, ...typeof value.signature === 'string' ? { signature: value.signature } : {} })
  }
  return blocks
}

function replayEnvelope(modelId, blocks) {
  return {
    response: { kind: REPLAY_KIND, version: REPLAY_VERSION, model: modelId },
    blocks,
  }
}

/**
 * Serialize one request.
 * @param context - profile, provider id, model id, generate options, the
 *   mounted attachment store (or undefined), and cancellation.
 * @returns the JSON body and the wire-to-original tool-name map.
 */
export async function buildRequest(context) {
  const { profile, modelId, options, attachments, signal, onReplayDegrade } = context
  const modelEntry = profile.models.find((candidate) => candidate.id === modelId)
  const reasoning = modelEntry?.reasoning ?? 'none'

  const systemParts = []
  const pushSystem = (text) => {
    if (typeof text !== 'string' || text.length === 0) return
    if (systemParts[systemParts.length - 1] === text) return
    systemParts.push(text)
  }
  pushSystem(options.system)
  const developerTexts = []

  const messages = []
  const pushMessage = (role, blocks) => {
    if (blocks.length === 0) return
    const previous = messages[messages.length - 1]
    if (previous !== undefined && previous.role === role) previous.content.push(...blocks)
    else messages.push({ role, content: blocks })
  }

  const toolNames = new Map()
  const wireNamesByName = new Map()
  const takenWireNames = new Set()
  const tools = []
  for (const tool of options.tools ?? []) {
    const wireName = wireToolName(tool.name, takenWireNames)
    toolNames.set(wireName, tool.name)
    wireNamesByName.set(tool.name, wireName)
    const schema = tool.parameters !== null && typeof tool.parameters === 'object' ? tool.parameters : DEFAULT_TOOL_SCHEMA
    tools.push({
      name: wireName,
      ...typeof tool.description === 'string' && tool.description.length > 0 ? { description: tool.description } : {},
      input_schema: schema.type === 'object' ? schema : { ...schema, type: 'object' },
    })
  }

  const resolveImage = async (block) => {
    if (attachments === undefined) unsupported('image content without an attachment provider')
    const ref = block.attachment
    const version = await attachments.readImageRequest(ref, {
      width: ref.width,
      height: ref.height,
      maxBytes: ref.bytes,
    }, signal)
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: version.mediaType,
        data: Buffer.from(version.data).toString('base64'),
      },
    }
  }

  const userBlocks = async (content) => {
    const blocks = []
    for (const block of content) {
      if (block.type === 'text') {
        if (block.text.length > 0) blocks.push({ type: 'text', text: block.text })
      } else if (block.type === 'image') {
        blocks.push(await resolveImage(block))
      } else if (block.type === 'tool-addition' || block.type === 'tool-removal') {
        // Tool availability travels as the request's whole tool list.
        continue
      } else {
        unsupported(`user content ${block.type}`)
      }
    }
    return blocks
  }

  const toolResultBlocks = async (message) => {
    const content = []
    for (const block of message.content) {
      if (block.type === 'text') {
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
      } else if (block.type === 'image') {
        content.push(await resolveImage(block))
      } else {
        unsupported(`tool result content ${block.type}`)
      }
    }
    return [{ type: 'tool_result', tool_use_id: message.toolCallId, content: content.length === 0 ? '' : content }]
  }

  let historySystem
  for (const message of options.messages) {
    if (message.role === 'system') {
      const text = textOf(message)
      if (text.length > 0) historySystem = text
      continue
    }
    if (message.role === 'developer') {
      for (const block of message.content) {
        if (block.type === 'text' && block.text.length > 0) developerTexts.push(block.text)
      }
      continue
    }
    if (message.role === 'user') {
      pushMessage('user', await userBlocks(message.content))
    } else if (message.role === 'assistant') {
      pushMessage('assistant', assistantBlocks(message, modelId, wireNamesByName, onReplayDegrade))
    } else if (message.role === 'tool') {
      pushMessage('user', await toolResultBlocks(message))
    } else {
      unsupported(`message role ${message.role}`)
    }
  }
  // The loop keeps the effective prompt in the newest system snapshot; a route
  // without in-history system support reads one leading system message, so the
  // current rendered prompt and that newest snapshot are joined once, followed
  // by developer updates that arrived mid-conversation.
  if (historySystem !== undefined) pushSystem(historySystem)
  for (const text of developerTexts) pushSystem(text)

  if (tools.length === 0 && messages.some((message) => message.content.some((block) => block.type === 'tool_use' || block.type === 'tool_result'))) {
    // Kimi rejects tool history without a tool list; keep the current list.
    unsupported('tool history without declared tools')
  }

  // Anthropic-family endpoints expect tool results first in a user turn and
  // thinking before visible content in an assistant turn.
  for (const message of messages) {
    if (message.role === 'user') {
      message.content.sort((left, right) => Number(right.type === 'tool_result') - Number(left.type === 'tool_result'))
    } else {
      const order = { thinking: 0, text: 1, tool_use: 2 }
      message.content.sort((left, right) => (order[left.type] ?? 3) - (order[right.type] ?? 3))
    }
  }

  const maxTokens = options.maxTokens ?? modelEntry?.maxTokens ?? profile.maxTokens
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) malformed('request has no valid max_tokens')
  const effort = options.reasoningEffort
  if (reasoning === 'efforts' && effort !== undefined && !['low', 'high', 'max'].includes(effort)) {
    throw new LlmError(`Kimi model "${modelId}" does not support reasoning effort "${effort}"`, 'UNSUPPORTED_REASONING_EFFORT')
  }

  const body = {
    model: modelId,
    max_tokens: maxTokens,
    stream: true,
    messages,
    ...systemParts.length === 0 ? {} : { system: systemParts.join('\n\n') },
    ...tools.length === 0 ? {} : { tools },
    ...reasoning === 'efforts' && effort !== undefined ? { output_config: { effort } } : {},
    ...options.sessionId === undefined ? {} : { metadata: { user_id: String(options.sessionId) } },
  }
  if (Array.isArray(options.stop) && options.stop.length > 0) {
    const sequences = options.stop.filter((value) => typeof value === 'string' && value.length > 0).slice(0, 5)
    if (sequences.length > 0) body.stop_sequences = sequences
  }
  return { body, toolNames }
}

/** Update the harness usage record from one provider usage object. */
function updateUsage(usage, raw) {
  if (raw === null || typeof raw !== 'object') return
  const map = {
    input_tokens: 'inputTokens',
    output_tokens: 'outputTokens',
    cache_read_input_tokens: 'cacheReadTokens',
    cache_creation_input_tokens: 'cacheWriteTokens',
  }
  for (const [wire, local] of Object.entries(map)) {
    const value = raw[wire]
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 0) malformed(`invalid usage.${wire}`)
    usage[local] = value
  }
}

function stopReason(raw) {
  switch (raw) {
    case 'end_turn':
    case 'refusal':
      return { kind: 'stop' }
    case 'tool_use':
      return { kind: 'tool-calls' }
    case 'max_tokens':
      return { kind: 'max-tokens' }
    default:
      return malformed(`unsupported stop reason ${String(raw)}`)
  }
}

function startBlock(wireIndex, start) {
  const native = start.content_block
  if (native === null || typeof native !== 'object') malformed('content_block_start has no content block')
  switch (native.type) {
    case 'text':
      return {
        content: { type: 'text', text: typeof native.text === 'string' ? native.text : '' },
        replay: { type: 'text' },
      }
    case 'thinking':
      return {
        content: { type: 'reasoning', text: typeof native.thinking === 'string' ? native.thinking : '' },
        replay: { type: 'reasoning', ...typeof native.signature === 'string' ? { signature: native.signature } : {} },
      }
    case 'tool_use': {
      if (typeof native.id !== 'string' || native.id.length === 0) malformed('tool_use block has no id')
      if (typeof native.name !== 'string' || native.name.length === 0) malformed('tool_use block has no name')
      const input = native.input === null || typeof native.input !== 'object' ? {} : native.input
      return {
        content: {
          type: 'tool-call',
          id: native.id,
          name: native.name,
          arguments: JSON.stringify(input),
        },
        replay: { type: 'tool-call' },
        json: '',
      }
    }
    default:
      return unsupported(`response block ${String(native.type)}`)
  }
}

function deltaOf(block, delta) {
  if (delta === null || typeof delta !== 'object') malformed('content_block_delta has no delta object')
  const content = block.content
  if (delta.type === 'text_delta' && content.type === 'text') {
    const text = typeof delta.text === 'string' ? delta.text : ''
    content.text += text
    return { type: 'text-delta', index: block.index, text }
  }
  if (delta.type === 'thinking_delta' && content.type === 'reasoning') {
    const text = typeof delta.thinking === 'string' ? delta.thinking : ''
    content.text += text
    return { type: 'reasoning-delta', index: block.index, text }
  }
  if (delta.type === 'signature_delta' && content.type === 'reasoning') {
    block.replay.signature = `${block.replay.signature ?? ''}${typeof delta.signature === 'string' ? delta.signature : ''}`
    return undefined
  }
  if (delta.type === 'input_json_delta' && content.type === 'tool-call') {
    const argumentsDelta = typeof delta.partial_json === 'string' ? delta.partial_json : ''
    block.json += argumentsDelta
    return { type: 'tool-call-delta', index: block.index, id: content.id, argumentsDelta }
  }
  return malformed(`unsupported delta ${String(delta.type)} for ${content.type}`)
}

/**
 * Decode SSE frames from a response body.
 * @param body - provider response byte stream.
 * @param onActivity - called for every received chunk and comment.
 * @returns `{event, data}` frames in arrival order.
 */
export async function* parseSse(body, onActivity) {
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName
  let dataLines = []
  const flush = () => {
    if (dataLines.length === 0) return undefined
    const data = dataLines.join('\n')
    dataLines = []
    const frame = { data, ...eventName === undefined ? {} : { event: eventName } }
    eventName = undefined
    return frame
  }
  for await (const chunk of body) {
    onActivity?.()
    buffer += decoder.decode(chunk, { stream: true })
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/u, '')
      buffer = buffer.slice(index + 1)
      if (line === '') {
        const frame = flush()
        if (frame !== undefined) yield frame
        continue
      }
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        let value = line.slice(5)
        if (value.startsWith(' ')) value = value.slice(1)
        dataLines.push(value)
      }
    }
  }
  buffer += decoder.decode()
  if (buffer.length > 0) {
    const line = buffer.replace(/\r$/u, '')
    if (line.startsWith('data:')) {
      let value = line.slice(5)
      if (value.startsWith(' ')) value = value.slice(1)
      dataLines.push(value)
    }
  }
  const frame = flush()
  if (frame !== undefined) yield frame
}

/** Normalize an in-band or HTTP provider error into an `LlmError`. */
export function providerFailure(detail, status, headers) {
  const fields = detail?.error ?? detail ?? {}
  const type = typeof fields.type === 'string' ? fields.type : ''
  const message = typeof fields.message === 'string' && fields.message.length > 0
    ? fields.message
    : `Kimi API request failed (${status === undefined ? 'stream error' : `HTTP ${status}`})`
  const text = `${type} ${typeof fields.code === 'string' ? fields.code : ''} ${message}`
  let code
  if (status === 401 || type === 'authentication_error') code = 'AUTH'
  else if (status === 403 || type === 'permission_error') code = 'AUTH'
  else if (isQuotaExceededError(text) || status === 402) code = 'QUOTA'
  else if (status === 429 || type === 'rate_limit_error') code = 'RATE_LIMIT'
  else if (isContextWindowExceededError(text)) code = 'CONTEXT_WINDOW_EXCEEDED'
  else if (status === 400 || status === 413 || status === 422 || type === 'invalid_request_error') code = 'INVALID_REQUEST'
  else if (status !== undefined && status >= 500 || type === 'api_error' || type === 'overloaded_error') code = 'SERVER'
  else code = status === undefined ? 'SERVER' : `HTTP_${status}`
  const retry = headers?.get?.('retry-after')
  const delay = retry === null || retry === undefined || !/^\d+(?:\.\d+)?$/u.test(retry) ? NaN : Number(retry) * 1000
  const requestId = headers?.get?.('x-request-id') ?? headers?.get?.('request-id')
  return new LlmError(message, code, {
    ...status === undefined ? {} : { status },
    ...Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {},
    ...typeof requestId === 'string' && requestId.length > 0 ? { requestId } : {},
  })
}

/**
 * Translate decoded Messages events into harness stream chunks.
 * @param frames - `{event, data}` frames from {@link parseSse}.
 * @param modelId - requested model identity stored in replay state.
 * @param toolNames - wire-to-original tool-name map produced by the request.
 * @returns blocks, one usage record, and exactly one terminal finish.
 */
export async function* translate(frames, modelId, toolNames = new Map()) {
  const blocks = new Map()
  const usage = { inputTokens: 0, outputTokens: 0 }
  let started = false
  let reason

  for await (const frame of frames) {
    if (frame.data === '' || frame.data === '[DONE]') continue
    let raw
    try {
      raw = JSON.parse(frame.data)
    } catch {
      throw new LlmError('Kimi Messages SSE contains invalid JSON', 'MALFORMED_RESPONSE')
    }
    if (raw === null || typeof raw !== 'object') malformed('SSE data is not an object')
    if (frame.event !== undefined && typeof raw.type === 'string' && frame.event !== raw.type) {
      malformed(`SSE event name ${frame.event} does not match data.type ${raw.type}`)
    }
    if (raw.type === 'error') throw providerFailure(raw)
    if (raw.type === 'ping') continue
    if (raw.type === 'message_start') {
      if (started) malformed('duplicate message_start')
      started = true
      updateUsage(usage, raw.message?.usage)
      continue
    }
    if (!['content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'].includes(raw.type)) continue
    if (!started) malformed('event precedes message_start')
    if (raw.type === 'content_block_start') {
      const wireIndex = raw.index
      if (!Number.isSafeInteger(wireIndex) || wireIndex < 0) malformed('invalid content block index')
      if (blocks.has(wireIndex) || reason !== undefined) malformed('block starts after settlement or repeats an index')
      const block = { index: blocks.size, ...startBlock(wireIndex, raw) }
      blocks.set(wireIndex, block)
      yield { type: 'block-start', index: block.index, blockType: block.content.type }
      if (block.content.type === 'text' || block.content.type === 'reasoning') {
        if (block.content.text.length > 0) {
          yield {
            type: block.content.type === 'text' ? 'text-delta' : 'reasoning-delta',
            index: block.index,
            text: block.content.text,
          }
        }
      } else {
        yield { type: 'tool-call-delta', index: block.index, id: block.content.id, name: block.content.name, argumentsDelta: '' }
      }
    } else if (raw.type === 'content_block_delta' || raw.type === 'content_block_stop') {
      const block = blocks.get(raw.index)
      if (block === undefined || block.closed === true) malformed('delta or stop without an open block')
      if (raw.type === 'content_block_delta') {
        const chunk = deltaOf(block, raw.delta)
        if (chunk !== undefined) yield chunk
      } else {
        block.closed = true
        if (block.content.type === 'tool-call' && block.json.length > 0) block.content.arguments = block.json
        const wireName = block.content.name
        yield {
          type: 'block-end',
          index: block.index,
          block: { ...block.content, ...block.content.type === 'tool-call' ? { name: toolNames.get(wireName) ?? wireName } : {} },
        }
      }
    } else if (raw.type === 'message_delta') {
      const delta = raw.delta
      if (delta !== null && typeof delta === 'object' && delta.stop_reason !== null && delta.stop_reason !== undefined) {
        reason = stopReason(delta.stop_reason)
      }
      updateUsage(usage, raw.usage)
    } else {
      if (reason === undefined) malformed('message_stop without a stop reason')
      for (const block of blocks.values()) {
        if (block.closed !== true) malformed('message_stop with an open block')
        if (block.content.type === 'tool-call' && block.content.arguments.length > 0) {
          try {
            const parsed = JSON.parse(block.content.arguments)
            if (parsed === null || typeof parsed !== 'object') malformed('tool input is not a JSON object')
          } catch {
            malformed('tool input is invalid JSON')
          }
        }
      }
      if (blocks.size === 0 && reason.kind === 'stop') {
        throw new LlmError('Kimi returned no content', 'EMPTY_RESPONSE')
      }
      usage.totalTokens = usage.inputTokens + usage.outputTokens
        + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      yield { type: 'usage', usage }
      yield { type: 'finish', reason, replayState: replayEnvelope(modelId, [...blocks.values()].map((block) => block.replay)) }
      return
    }
  }
  throw new LlmError('Kimi Messages stream ended before message_stop', 'STREAM_CLOSED')
}
