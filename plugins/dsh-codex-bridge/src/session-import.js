/**
 * Import an OpenAI Codex transcript into DeepSeek Harness as a new durable chat
 * Session (Host side of the Codex bridge).
 *
 * `createImportedSession(ctx, { cwd, title, messages, source })` allocates a
 * fresh `session-<uuid>` identity, writes a current-format (v4) Session log
 * through `ctx.sessionPersistence`, and returns the identity so the caller can
 * open it in the Web UI. Because the log is written straight through the
 * persistence seam (not through a live Agent), the session is durable and
 * listable immediately, and the Web UI resumes it by replaying the stored log.
 *
 * ## Why the event plan is what it is (verified against the shipped readers)
 *
 * The event sequence mirrors what the agent loop records for a tool-free turn,
 * because a stored log is re-validated on every cold read:
 *
 *   - `dsh-session` (`Session`/`SurfaceManager`) validates event envelopes,
 *     message shapes, surface markers and message projection ownership.
 *   - the JSONL backend's scanner (`SessionLogScanner.finish()` in
 *     `@deepseek-ai/dsh-session-persistence-jsonl`) additionally runs
 *     `assertReleasedV4Relationships(...)` from
 *     `@deepseek-ai/dsh-session-format-v3-to-v4` on EVERY cold read. That
 *     validator enforces the turn/step state machine, the "system/message is
 *     the protected first surface node" rule, and `session/title` source rules.
 *
 * Consequences encoded here (see `buildSessionEvents`):
 *
 *   1. The very first turn opens a `system/message` surface node with EMPTY
 *      content. It is required: the v4 relationship validator rejects any
 *      `system/message` appended while the surface is non-empty and no
 *      protected system head exists (`system/message requires a protected
 *      first surface head`). Without it, the first post-import model request
 *      would append the real system prompt at the tail and the stored log
 *      would become unreadable on the next cold resume. Empty content projects
 *      to no model message (`deriveEventMessage` returns null), so no fake
 *      system prompt is injected into history; on resume the loop's
 *      `SystemPromptProjection` either replaces this node (non-`in-history`
 *      routes) or appends the real rendered prompt as an `in-history` series
 *      update (preserving the node-0 rule).
 *   2. Each exchange becomes one turn: `turn/start`, `step/start`,
 *      `user/message`, `assistant/message`, `step/end`, `turn/end`. The v4
 *      validator requires `turn/start` to open exactly the next turn number,
 *      `step/start` to open `step === nextStep` (reset to 1 by `turn/start`),
 *      `assistant/message` to name the open turn+step, `step/end`/`turn/end`
 *      to close exactly what is open. Turn numbers start at 1 and increase.
 *   3. `request/header` and `request/context` are deliberately NOT written.
 *      They are optional for replay; the resumed loop logs a fresh
 *      `request/header` (`reason: "initial"` when no baseline exists) before
 *      its next model request, so the imported history does not claim a
 *      provider/model envelope it was never built with.
 *   4. `session/title` uses `source: { kind: "user" }` with
 *      `messageSeqs: []`. The v4 title rule permits exactly that pairing
 *      (`messageSeqs` empty iff the source is `"user"`), and a user-sourced
 *      title pins the imported title against later automatic generation.
 *
 * The physical storage encoding (concatenated checksummed Zstandard frames,
 * header line + one frame per append batch) is owned by the JSONL backend; this
 * module only hands logical current-format events to `handle.append`.
 *
 * @module dsh-codex-bridge/session-import
 */

import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

/** Title used when neither the caller nor the transcript supplies one. */
const FALLBACK_TITLE = 'Imported chat';
/** Default byte cap, used when the mounted session-title service is unavailable. */
const DEFAULT_TITLE_MAX_BYTES = 120;
/** Words of the first user message used by the derived fallback title. */
const FALLBACK_TITLE_MAX_WORDS = 8;
/** Assistant attribution when the caller supplies no `source.provider`. */
const DEFAULT_PROVIDER = 'codex';
/** Assistant attribution when the caller supplies no `source.model`. */
const DEFAULT_MODEL = 'openai-codex';

/**
 * Create a durable DSH chat Session from an imported Codex transcript.
 *
 * @param {object} ctx - Host plugin context carrying `sessions` and
 *   `sessionPersistence` (the same Cordis context the plugin's `apply()` gets).
 * @param {object} input - import payload.
 * @param {string} input.cwd - absolute project directory stored in the Session
 *   header; the Web UI lists Sessions under this project.
 * @param {string} [input.title] - session title to store.
 * @param {Array<{role: 'user'|'assistant', text: string, time?: number}>} input.messages
 *   transcript in chronological order. Empty/whitespace text and unknown roles
 *   are skipped.
 * @param {{ provider?: string, model?: string, [key: string]: unknown }} [input.source]
 *   provenance hint; `provider`/`model` label the imported assistant messages.
 *   Remaining fields are accepted and ignored (they are not model history).
 * @returns {Promise<{ sessionId: string, title: string, eventCount: number }>}
 *   `sessionId` is the new `session-<uuid>`; `eventCount` counts the persisted
 *   events (header excluded).
 */
export async function createImportedSession(ctx, input = {}) {
  if (ctx === null || ctx === undefined) throw new TypeError('createImportedSession(ctx, input): ctx is required');
  const { cwd, title, messages, source } = input;

  assertAbsoluteCwd(cwd);
  const persistence = getService(ctx, 'sessionPersistence');
  if (persistence === undefined || typeof persistence.create !== 'function') {
    throw new Error('createImportedSession: ctx.sessionPersistence is required; mount a Session persistence backend (e.g. @deepseek-ai/dsh-session-persistence-jsonl)');
  }

  const normalizedMessages = normalizeMessages(messages);
  const maxTitleBytes = resolveTitleMaxBytes(ctx);
  const resolvedTitle = resolveTitle(title, normalizedMessages, maxTitleBytes);
  const events = buildSessionEvents({ messages: normalizedMessages, title: resolvedTitle, source, now: Date.now() });

  const sessionId = `session-${randomUUID()}`;
  const header = buildImportedHeader(ctx, { sessionId, cwd, createdAt: Date.now() });

  const handle = await persistence.create(header);
  try {
    await handle.append(events);
    if (typeof handle.flush === 'function') await handle.flush();
  } catch (error) {
    await closeQuietly(handle);
    throw error;
  }
  await handle.close();

  await assertStored(persistence, sessionId);
  warmProjectionCache(ctx, header, events);

  return { sessionId, title: resolvedTitle, eventCount: events.length };
}

/**
 * Build the current-format (v4) Session event log for one imported transcript.
 *
 * Pure: no I/O, no clock except the supplied `now`. Exported so the research
 * harness (`research/session/build-test-log.mjs`) encodes the exact same plan
 * the importer writes, and so callers can inspect the plan without a backend.
 *
 * @param {object} input - plan inputs.
 * @param {Array<{role: 'user'|'assistant', text: string, time?: number}>} input.messages
 *   normalized transcript messages.
 * @param {string} [input.title] - non-empty title; when present a
 *   `session/title` event is appended.
 * @param {{ provider?: string, model?: string }} [input.source] - assistant
 *   attribution overrides.
 * @param {number} [input.now] - fallback wall-clock value in epoch milliseconds
 *   for events without a usable transcript time; defaults to `Date.now()`.
 * @returns {Array<object>} events with contiguous `seq` starting at 0.
 */
export function buildSessionEvents({ messages, title, source, now } = {}) {
  const fallbackTime = Number.isSafeInteger(now) && now >= 0 ? now : Date.now();
  const provider = nonEmptyString(source?.provider) ? source.provider : DEFAULT_PROVIDER;
  const model = nonEmptyString(source?.model) ? source.model : DEFAULT_MODEL;

  /** @type {Array<object>} */
  const events = [];
  let seq = 0;
  let lastTime = 0;
  /** Monotonic, non-negative event time derived from transcript times. */
  const clock = (candidate) => {
    const value = Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : fallbackTime;
    lastTime = Math.max(lastTime, value);
    return lastTime;
  };
  const push = (type, data, when, surfaceOp) => {
    const event = { type, seq: seq++, time: clock(when), data };
    if (surfaceOp !== undefined) event.surfaceOp = surfaceOp;
    events.push(event);
    return event;
  };

  let turn = 0;
  /** Currently open turn/step: `{ turn, step, hasUser, hasAssistant }` or null. */
  let open = null;

  const openTurn = (when) => {
    turn += 1;
    open = { turn, step: 1, hasUser: false, hasAssistant: false };
    push('turn/start', { turn }, when);
    push('step/start', { turn, step: 1 }, when);
    if (turn === 1) {
      // Protected surface node 0. Empty content derives no model message, but
      // the v4 relationship validator requires it to exist before any other
      // surface node and needs it as the protected head for later live
      // system-prompt updates.
      push('system/message', {
        turn,
        step: 1,
        message: {
          role: 'system',
          content: [],
          source: { kind: 'system-prompt' },
          id: randomUUID(),
        },
      }, when, 'append');
    }
  };

  const closeTurn = (when) => {
    if (open === null) return;
    push('step/end', { turn: open.turn, step: open.step }, when);
    push('turn/end', { turn: open.turn, reason: { kind: 'completed' } }, when);
    open = null;
  };

  for (const message of Array.isArray(messages) ? messages : []) {
    if (message === null || typeof message !== 'object') continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = typeof message.text === 'string' ? message.text : '';
    if (text.trim().length === 0) continue;
    const time = Number.isSafeInteger(message.time) && message.time >= 0 ? message.time : undefined;

    if (open === null) openTurn(time);
    else if (message.role === 'user' && open.hasAssistant) {
      // A new human prompt after a settled assistant reply starts a new turn,
      // exactly like the live loop's follow-up turns.
      closeTurn(time);
      openTurn(time);
    }

    if (message.role === 'user') {
      push('user/message', {
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
        role: 'user',
        id: randomUUID(),
      }, time, 'append');
      open.hasUser = true;
    } else {
      push('assistant/message', {
        turn: open.turn,
        step: open.step,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text }],
          source: { kind: 'model', provider, model },
          id: randomUUID(),
        },
        // Required by the settlement shape check; the imported text is the
        // final block content, so no replay stream is embedded.
        stream: [],
      }, time, 'append');
      open.hasAssistant = true;
    }
  }
  closeTurn(lastTime);

  if (typeof title === 'string' && title.trim().length > 0) {
    push('session/title', {
      title: title.trim(),
      messageSeqs: [],
      source: { kind: 'user' },
    }, lastTime);
  }

  return events;
}

/**
 * Normalize a title the way `dsh-session-title` does at its acceptance
 * boundary: strip control and bidi/invisible code points, collapse whitespace,
 * trim, and truncate to a UTF-8 byte budget without splitting a code point.
 *
 * @param {string} value - raw title text.
 * @param {number} [maxBytes] - byte cap; defaults to 120.
 * @returns {string} normalized title, possibly empty.
 */
export function normalizeImportedTitle(value, maxBytes = DEFAULT_TITLE_MAX_BYTES) {
  const raw = typeof value === 'string' ? value : '';
  // C0/C1 controls and invisible/bidi formatting characters become spaces.
  const cleaned = raw.replace(CONTROL_AND_INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return '';
  return truncateUtf8(cleaned, resolveByteBudget(maxBytes));
}

/** Code points that never belong in a display title. */
const CONTROL_AND_INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

/**
 * Build the Session header for the current format from the live Session store,
 * so `version`, `id` and `cwd` validation stay owned by `dsh-session`.
 *
 * @param {object} ctx - Host context with the `sessions` service.
 * @param {{ sessionId: string, cwd: string, createdAt: number }} input - header facts.
 * @returns {object} frozen logical `SessionHeader`.
 */
export function buildImportedHeader(ctx, { sessionId, cwd, createdAt }) {
  const sessions = getService(ctx, 'sessions');
  if (sessions === undefined || typeof sessions.prepare !== 'function') {
    throw new Error('createImportedSession: ctx.sessions is required to build the Session header; mount @deepseek-ai/dsh-session');
  }
  // `prepare` builds (but does not enter or announce) a Session; we consume its
  // immutable header only. It validates the id and the absolute cwd and stamps
  // the current SESSION_FORMAT_VERSION.
  const prepared = sessions.prepare(sessionId, { meta: { cwd, createdAt } });
  const header = prepared?.header;
  if (header === undefined || typeof header !== 'object') throw new Error('createImportedSession: ctx.sessions.prepare() returned no Session header');
  return header;
}

/** Throw unless `cwd` is a non-empty absolute directory path string. */
function assertAbsoluteCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new TypeError('createImportedSession: cwd must be a non-empty absolute path string');
  if (!isAbsolute(cwd)) throw new TypeError(`createImportedSession: cwd must be an absolute path, got ${JSON.stringify(cwd)}`);
}

/** Filter and validate transcript messages, keeping only role/text/time. */
function normalizeMessages(messages) {
  if (messages === undefined) throw new TypeError('createImportedSession: messages must be an array');
  if (!Array.isArray(messages)) throw new TypeError('createImportedSession: messages must be an array');
  const normalized = [];
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue;
    const role = message.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = typeof message.text === 'string' ? message.text : '';
    if (text.trim().length === 0) continue;
    normalized.push({
      role,
      text,
      ...Number.isSafeInteger(message.time) && message.time >= 0 ? { time: message.time } : {},
    });
  }
  return normalized;
}

/** Resolve the final title: caller title → first-prompt fallback → constant. */
function resolveTitle(title, messages, maxBytes) {
  const declared = normalizeImportedTitle(title, maxBytes);
  if (declared.length > 0) return declared;
  const firstUser = messages.find((message) => message.role === 'user');
  if (firstUser !== undefined) {
    const words = firstUser.text.replace(/\s+/g, ' ').trim().split(' ').filter((word) => word.length > 0).slice(0, FALLBACK_TITLE_MAX_WORDS).join(' ');
    const derived = normalizeImportedTitle(words, maxBytes);
    if (derived.length > 0) return derived;
  }
  return truncateUtf8(FALLBACK_TITLE, resolveByteBudget(maxBytes));
}

/** Byte budget from the mounted title service's configured cap, else 120. */
function resolveTitleMaxBytes(ctx) {
  const titleService = getService(ctx, 'sessionTitle');
  const configured = titleService?.config?.maxTitleBytes;
  return resolveByteBudget(configured);
}

/** Clamp a candidate byte budget to a positive integer. */
function resolveByteBudget(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_TITLE_MAX_BYTES;
}

/** Truncate a string to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let bytes = 0;
  let out = '';
  for (const codePoint of text) {
    const size = Buffer.byteLength(codePoint, 'utf8');
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += codePoint;
  }
  return out.trim();
}

/** Whether a value is a non-empty string. */
function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Resolve a Host service by Cordis name, tolerating contexts where the service
 * accessor is a property rather than `ctx.get(name)`.
 *
 * @param {object} ctx - Host context.
 * @param {string} name - service name, e.g. `'sessionPersistence'`.
 * @returns {unknown} the service or undefined.
 */
function getService(ctx, name) {
  if (ctx === null || ctx === undefined) return undefined;
  if (typeof ctx.get === 'function') {
    try {
      const service = ctx.get(name);
      if (service !== undefined) return service;
    } catch {
      // A context without the service registered throws instead of returning
      // undefined; fall through to the direct property when it exists.
    }
  }
  try {
    return ctx[name];
  } catch {
    return undefined;
  }
}

/** Close a write handle without masking the failure that caused the close. */
async function closeQuietly(handle) {
  if (handle === undefined || typeof handle.close !== 'function') return;
  try {
    await handle.close();
  } catch {
    // The original failure is the one worth reporting.
  }
}

/** Fail loudly when the just-written session is not observable to the backend. */
async function assertStored(persistence, sessionId) {
  if (typeof persistence.stat !== 'function') return;
  const snapshot = await persistence.stat(sessionId);
  if (snapshot === undefined) throw new Error(`createImportedSession: session "${sessionId}" was written but the persistence backend does not report it`);
}

/**
 * Refresh the durable session-projection cache for the new cold session, so the
 * Web UI's zero-I/O Session list can show the imported title (and list
 * metadata) before the session is first opened. Best-effort: the projection
 * registry is authoritative and will refold on open anyway.
 *
 * @param {object} ctx - Host context.
 * @param {object} header - stored logical Session header.
 * @param {Array<object>} events - the complete stored event log.
 */
function warmProjectionCache(ctx, header, events) {
  const cache = getService(ctx, 'sessionProjectionCache');
  if (cache === undefined || typeof cache.coldSnapshot !== 'function') return;
  try {
    cache.coldSnapshot(header, 0, events);
  } catch (error) {
    const logger = ctx?.logger;
    const message = `codex-import: projection-cache warm-up for "${header.id}" failed (list title will appear after the session is opened): ${String(error)}`;
    if (typeof logger?.warn === 'function') logger.warn(message);
    else console.warn(message);
  }
}
