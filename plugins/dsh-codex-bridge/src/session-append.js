/**
 * Append newly arrived Codex messages to an already imported DSH Session.
 *
 * The importer writes a stored Session log through `sessionPersistence`; a later
 * re-import of the same Codex thread must extend that chat instead of creating a
 * second Session. Appending is only legal while no Agent owns the write handle,
 * so a busy (open) Session reports `skipped` and the caller keeps the old chat.
 *
 * The emitted plan mirrors `src/session-import.js`: turn/start → step/start →
 * user/message → assistant/message → step/end → turn/end, with contiguous `seq`
 * continuing the stored log. The protected empty `system/message` head already
 * exists from the first import and is never re-emitted.
 *
 * @module dsh-codex-bridge/session-append
 */
import { randomUUID } from 'node:crypto';

/** Assistant attribution when the caller supplies no `source.provider`. */
const DEFAULT_PROVIDER = 'codex';
/** Assistant attribution when the caller supplies no `source.model`. */
const DEFAULT_MODEL = 'openai-codex';

/**
 * Build the event plan that continues an existing stored log.
 *
 * @param {object} input - plan inputs.
 * @param {Array<{role: 'user'|'assistant', text: string, time?: number}>} input.messages
 *   new transcript messages, chronological.
 * @param {number} input.startSeq - first free sequence number.
 * @param {number} input.startTurn - first turn number to open.
 * @param {{ provider?: string, model?: string }} [input.source] - attribution overrides.
 * @param {number} [input.now] - fallback wall-clock value in epoch milliseconds.
 * @returns {Array<object>} contiguous events ready for `SessionHandle.append`.
 */
export function buildAppendedEvents({ messages, startSeq, startTurn, source, now } = {}) {
  if (!Number.isSafeInteger(startSeq) || startSeq < 0) throw new TypeError('buildAppendedEvents: startSeq must be a non-negative integer');
  if (!Number.isSafeInteger(startTurn) || startTurn < 1) throw new TypeError('buildAppendedEvents: startTurn must be a positive integer');
  const fallbackTime = Number.isSafeInteger(now) && now >= 0 ? now : Date.now();
  const provider = typeof source?.provider === 'string' && source.provider.length > 0 ? source.provider : DEFAULT_PROVIDER;
  const model = typeof source?.model === 'string' && source.model.length > 0 ? source.model : DEFAULT_MODEL;

  /** @type {Array<object>} */
  const events = [];
  let seq = startSeq;
  let turn = startTurn - 1;
  let lastTime = 0;
  const clock = (candidate) => {
    const value = Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : fallbackTime;
    lastTime = Math.max(lastTime, value);
    return lastTime;
  };
  const push = (type, data, when, surfaceOp) => {
    const event = { type, seq: seq++, time: clock(when), data };
    if (surfaceOp !== undefined) event.surfaceOp = surfaceOp;
    events.push(event);
  };

  let open = null;
  const openTurn = (when) => {
    turn += 1;
    open = { turn, step: 1, hasAssistant: false };
    push('turn/start', { turn }, when);
    push('step/start', { turn, step: 1 }, when);
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
        stream: [],
      }, time, 'append');
      open.hasAssistant = true;
    }
  }
  closeTurn(lastTime);
  return events;
}

/**
 * Whether a stored log's tail is a legal place for a new turn.
 * @param {ReadonlyArray<object>} events - complete stored log.
 * @returns {{ safe: boolean, startSeq: number, startTurn: number, reason?: string }}
 */
export function inspectAppendPoint(events) {
  if (!Array.isArray(events) || events.length === 0) return { safe: false, startSeq: 0, startTurn: 1, reason: 'session log is empty' };
  const lastSeq = Number(events[events.length - 1]?.seq);
  if (!Number.isSafeInteger(lastSeq)) return { safe: false, startSeq: 0, startTurn: 1, reason: 'session log has no numeric seq' };
  const startSeq = lastSeq + 1;
  let lastTurnStart = 0;
  let openTurn = 0;
  for (const event of events) {
    if (event?.type === 'turn/start') {
      const turn = Number(event.data?.turn);
      if (Number.isSafeInteger(turn) && turn > lastTurnStart) lastTurnStart = turn;
      openTurn = turn;
    } else if (event?.type === 'turn/end') {
      openTurn = 0;
    }
  }
  const tail = events[events.length - 1];
  const closedTail = tail.type === 'turn/end' || tail.type === 'session/title' || tail.type === 'session/end-seed';
  if (openTurn !== 0 && !closedTail) return { safe: false, startSeq, startTurn: lastTurnStart + 1, reason: `session log ends inside turn ${openTurn}` };
  return { safe: true, startSeq, startTurn: lastTurnStart + 1 };
}

/**
 * Append new transcript messages to an existing stored Session.
 *
 * @param {object} ctx - Host plugin context with `sessionPersistence`.
 * @param {object} input - append payload.
 * @param {string} input.sessionId - target `session-<uuid>`.
 * @param {Array<{role: 'user'|'assistant', text: string, time?: number}>} input.messages - new messages.
 * @param {{ provider?: string, model?: string }} [input.source] - attribution overrides.
 * @returns {Promise<{ appended: number, eventCount: number, skipped?: string }>}
 */
export async function appendImportedMessages(ctx, { sessionId, messages, source } = {}) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('appendImportedMessages: sessionId is required');
  const persistence = readService(ctx, 'sessionPersistence');
  if (persistence === undefined || typeof persistence.open !== 'function') {
    return { appended: 0, eventCount: 0, skipped: 'sessionPersistence is unavailable' };
  }
  let handle;
  try {
    handle = await persistence.open(sessionId, 'write');
  } catch (error) {
    return { appended: 0, eventCount: 0, skipped: `cannot take the Session write handle: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const stored = await handle.read();
    const events = Array.isArray(stored?.events) ? stored.events : [];
    const point = inspectAppendPoint(events);
    if (!point.safe) return { appended: 0, eventCount: events.length, skipped: point.reason ?? 'session log is not appendable' };
    const appendedEvents = buildAppendedEvents({
      messages,
      startSeq: point.startSeq,
      startTurn: point.startTurn,
      source,
      now: Date.now(),
    });
    if (appendedEvents.length === 0) return { appended: 0, eventCount: events.length, skipped: 'no new text messages to append' };
    await handle.append(appendedEvents);
    if (typeof handle.flush === 'function') await handle.flush();
    return { appended: appendedEvents.length, eventCount: events.length + appendedEvents.length };
  } finally {
    try {
      await handle.close();
    } catch {
      // The caller still owns the reported outcome; close failures must not mask it.
    }
  }
}

/**
 * Resolve a Host service by Cordis name without assuming `ctx.get` exists.
 * @param {object} ctx - Host context.
 * @param {string} name - service name.
 * @returns {unknown} the service or undefined.
 */
function readService(ctx, name) {
  if (ctx === null || ctx === undefined) return undefined;
  if (typeof ctx.get === 'function') {
    try {
      const service = ctx.get(name);
      if (service !== undefined) return service;
    } catch {
      // Fall through to the direct property accessor.
    }
  }
  try {
    return ctx[name];
  } catch {
    return undefined;
  }
}
