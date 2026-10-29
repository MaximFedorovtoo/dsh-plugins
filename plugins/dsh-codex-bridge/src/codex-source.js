/**
 * src/codex-source.js — read-only access to a Codex home (`~/.codex`):
 * projects, their threads, and a chat transcript of one thread.
 *
 * Contract: see `API.md` → «src/codex-source.js (teammate A)».
 *
 *   resolveCodexHome(explicit) -> string
 *   readCodexCatalog({ codexHome, ... }) -> { projects: [...] }
 *   readThreadTranscript({ codexHome, thread, ... }) ->
 *     { threadId, cwd, title, createdAt, messages: [{ role, text, time }], stats }
 *
 * Pure ESM, Node >= 22 (needs `zlib.createZstdDecompress`, Node 24 tested), no npm deps.
 * Everything here only reads files; nothing under the Codex home is ever written.
 *
 * ── Data sources ────────────────────────────────────────────────────────────────
 * `~/.codex/.codex-global-state.json`
 *   - `local-projects`               { [id]: { id, name, rootPaths[], createdAt, updatedAt } }
 *   - `thread-project-assignments`   { [threadId]: { projectId, projectKind } }
 *   - `thread-workspace-root-hints`  { [threadId]: cwd }   (used as the thread cwd, if present)
 *   - `project-order`                [projectId, ...]      (display order)
 * `~/.codex/session_index.jsonl` — one JSON per line: { id, thread_name, updated_at }
 *   (the same thread may appear several times; the newest record wins).
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl[.zst]` — the thread log.
 *   The thread id is in the file name, so the catalogue locates rollouts by walking
 *   `sessions/` **names only** (never by opening the files).
 *   `.zst` files are zstd — usually a single frame; the decoder below handles
 *   concatenated frames as well (same approach as `research/decode-frames.mjs`).
 *
 * ── Rollout line format ─────────────────────────────────────────────────────────
 *   1st line      { "type": "session_meta", "payload": { id, cwd, timestamp, ... } }
 *   chat messages { "type": "response_item", "payload": { type: "message",
 *                    role: "user" | "assistant" | "developer",
 *                    content: [{ type: "input_text" | "output_text" | "text", text }] } }
 *   plus event_msg / reasoning / tool-call / token records, which are ignored here.
 *
 * ── Transcript filtering (heuristics) ───────────────────────────────────────────
 * Only textual `role: user | assistant` replays are returned.
 *  - `developer` / `system` roles are dropped: they carry app context, agent-mode
 *    switches and subagent plumbing, not human/assistant chat.
 *  - Messages with no text (tool calls, screenshots only) are dropped.
 *  - Codex injects synthetic *user* messages into the rollout. They are dropped when
 *    the text (after whitespace trim) starts with one of the known service markers:
 *      `# AGENTS.md instructions`, `<INSTRUCTIONS>`, `<environment_context>`,
 *      `<user_instructions>`, `<in-app-browser-context …>` (ambient browser state),
 *      `<external_codex_apps_open_page>`, `<recommended_plugins>`, `<app-context>`,
 *      `<turn_aborted>`, `<user_shell_command>`, `<permissions instructions>`,
 *      `<developer_instructions>`, `<collaboration_mode>`, `<model_switch>`,
 *      `<subagent_notification>`, `<agent_context>`, `The following is the Codex
 *      agent history …` (approval/reviewer prompts).
 *    Inline `<in-app-browser-context>…</…>`, `<image …>…</image>` and
 *    `<external_codex_apps_open_page>` blocks are stripped first, so a real user
 *    message with an ambient bubble appended is kept (only the user's own words).
 *  - `# Files mentioned by the user: … ## My request: <text>` wrappers (attachments)
 *    are unwrapped: `<text>` is the user's own words, an empty `<text>` means the
 *    message was an image-only attachment and is dropped.
 *  - Ambient app state (browser tab, attached screenshots) is followed by a
 *    `## My request:` heading; only the text after the last such heading is kept
 *    (so a real user message with an ambient bubble appended keeps its own words).
 *  - `<send_user_message_question_reply>[{"question":…,"answer":…}]</…>` (the user's
 *    answer to a `request_user_input` card) is unwrapped to the answer text.
 *  - Assistant messages are kept as-is when they contain text; Codex splits a turn
 *    into `commentary` and `final_answer` messages and both are user-visible chat.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createInterface } from 'node:readline';

/* ─────────────────────────────── constants ─────────────────────────────────── */

const STATE_FILE = '.codex-global-state.json';
const INDEX_FILE = 'session_index.jsonl';
const SESSIONS_DIR = 'sessions';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** `rollout-2026-10-01T16-01-10-<threadId>.jsonl[.zst]` */
const ROLLOUT_FILE_RE = new RegExp(`^rollout-.*?(${UUID_RE.source})\\.(jsonl|jsonl\\.zst)$`, 'i');

/**
 * Default budget for reading a rollout while building the catalogue.
 * Threads whose rollout is bigger are listed without `messageCount`
 * (`messageCountOmitted: 'rollout-too-large:<bytes>'`) so that opening the catalogue
 * never pulls gigabytes of chat history into memory.
 */
const DEFAULT_MAX_SCAN_BYTES = 16 * 1024 * 1024;

/** Safety cap for a single `.zst` buffer we decompress in memory. */
const DEFAULT_MAX_ZSTD_BYTES = 256 * 1024 * 1024;

/** A user message starting with one of these markers is Codex service text. */
const USER_NOISE_PREFIX_RES = [
  /^#\s*AGENTS\.md instructions\b/i,
  /^#\s*Context from my IDE setup\b/i,
  /^#\s*Files mentioned by the user:/i,
  /^<environment_context\b/i,
  /^<user_instructions\b/i,
  /^<INSTRUCTIONS\b/i,
  /^<in-app-browser-context\b/i,
  /^<external_codex_apps_open_page\b/i,
  /^<recommended_plugins\b/i,
  /^<app-context\b/i,
  /^<turn_aborted\b/i,
  /^<user_shell_command\b/i,
  /^<permissions instructions\b/i,
  /^<developer_instructions\b/i,
  /^<collaboration_mode\b/i,
  /^<model_switch\b/i,
  /^<subagent_notification\b/i,
  /^<agent_context\b/i,
  /^<image\b/i,
  /^<\/?image\b/i,
  /^the following is the codex agent history\b/i,
];

/** Inline synthetic blocks stripped from an otherwise real user message. */
const USER_NOISE_BLOCK_RES = [
  /<in-app-browser-context\b[\s\S]*?<\/in-app-browser-context>/gi,
  /<environment_context\b[\s\S]*?<\/environment_context>/gi,
  /<user_instructions\b[\s\S]*?<\/user_instructions>/gi,
  /<INSTRUCTIONS\b[\s\S]*?<\/INSTRUCTIONS>/gi,
  /<recommended_plugins\b[\s\S]*?<\/recommended_plugins>/gi,
  /<external_codex_apps_open_page\b[\s\S]*?<\/external_codex_apps_open_page>/gi,
  /<app-context\b[\s\S]*?<\/app-context>/gi,
  /<image\b[\s\S]*?<\/image>/gi,
  /<\/?image\b[^>]*>/gi,
];

const QUESTION_REPLY_OPEN = '<send_user_message_question_reply>';
const QUESTION_REPLY_RE = /<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/i;
/**
 * Codex appends ambient context blocks (`<in-app-browser-context>`, attachment lists)
 * and then the human text under a `## My request:` heading. A message may contain the
 * heading more than once (one inside the injected wrapper, one before the typed text),
 * so the text after the *last* heading is the user's own words.
 */
const MY_REQUEST_HEADING_RE = /(?:^|\n)[ \t]*##[ \t]+My request:[ \t]*/gi;

const MESSAGE_TEXT_BLOCK_TYPES = new Set(['text', 'input_text', 'output_text']);

/* ─────────────────────────────── helpers ───────────────────────────────────── */

/** Convert a Codex timestamp (ISO string or epoch ms) to a canonical ISO string. */
function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** Strip a UTF-8 BOM the Codex JSON files may start with. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function readJsonFile(file) {
  const text = stripBom(await fsp.readFile(file, 'utf8'));
  return JSON.parse(text);
}

async function readJsonFileOr(file, fallback) {
  try {
    return await readJsonFile(file);
  } catch {
    return fallback;
  }
}

/** `objectById` may be stored as an object keyed by id (current Codex) or as an array. */
function toIdMap(value) {
  const map = new Map();
  if (!value) return map;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && typeof item.id === 'string') map.set(item.id, item);
    }
    return map;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' && item.id ? item.id : key;
      map.set(id, item);
    }
  }
  return map;
}

/* ─────────────────────────── resolveCodexHome ──────────────────────────────── */

/**
 * Resolve the Codex home directory.
 * @param {string} [explicit] explicit path (e.g. plugin config `codexHome`)
 * @returns {string} explicit → `$CODEX_HOME` → `~/.codex`
 */
export function resolveCodexHome(explicit) {
  const fromArg = typeof explicit === 'string' ? explicit.trim() : '';
  if (fromArg) return fromArg;
  const fromEnv = typeof process.env.CODEX_HOME === 'string' ? process.env.CODEX_HOME.trim() : '';
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), '.codex');
}

/* ─────────────────────────── session index ─────────────────────────────────── */

/**
 * Read `session_index.jsonl` into `id -> { title, updatedAt }`.
 * Several lines may describe the same thread; the newest `updated_at` wins.
 */
async function readSessionIndex(codexHome) {
  const map = new Map();
  let text;
  try {
    text = stripBom(await fsp.readFile(path.join(codexHome, INDEX_FILE), 'utf8'));
  } catch {
    return map;
  }
  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (!rec || typeof rec.id !== 'string') continue;
    const id = rec.id.trim();
    if (!id) continue;
    const entry = {
      title: typeof rec.thread_name === 'string' ? rec.thread_name.trim() : '',
      updatedAt: toIso(rec.updated_at),
    };
    const prev = map.get(id);
    if (!prev || (entry.updatedAt && (!prev.updatedAt || entry.updatedAt > prev.updatedAt))) {
      map.set(id, entry);
    }
  }
  return map;
}

/* ───────────────────────── rollout file discovery ──────────────────────────── */

/**
 * Walk `<codexHome>/sessions` **by file names only** and map threadId -> rollout file.
 * Nothing is read, only directory entries and `stat`.
 *
 * @returns {Promise<Map<string, {path:string,sizeBytes:number,mtimeMs:number,compressed:boolean}>>}
 */
async function indexRolloutFiles(codexHome) {
  const map = new Map();
  const root = path.join(codexHome, SESSIONS_DIR);

  /** @param {string} dir @param {number} depth */
  async function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const match = ROLLOUT_FILE_RE.exec(entry.name);
      if (!match) continue;
      const id = match[1].toLowerCase();
      let stat;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      const rec = {
        path: full,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        compressed: /\.zst$/i.test(entry.name),
      };
      const prev = map.get(id);
      if (!prev || preferRollout(rec, prev)) map.set(id, rec);
    }
  }

  await walk(root, 0);
  return map;
}

function preferRollout(next, prev) {
  // Uncompressed logs can be streamed line by line and are cheaper in memory.
  if (next.compressed !== prev.compressed) return !next.compressed;
  return next.sizeBytes > prev.sizeBytes;
}

/* ─────────────────────────── rollout line reader ───────────────────────────── */

/** @returns {AsyncGenerator<string, void, void>} */
async function* readRolloutLines(filePath, options) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.zst')) {
    const buf = await fsp.readFile(filePath);
    const text = await decompressZstdFrames(buf, options);
    yield* splitLines(text);
    return;
  }
  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 16 });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

function* splitLines(text) {
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      yield text.slice(start, i);
      start = i + 1;
    }
  }
  if (start < text.length) yield text.slice(start);
}

function decompressOneZstdFrame(buf) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = zlib.createZstdDecompress();
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve({ data: Buffer.concat(chunks), consumed: stream.bytesWritten }));
    stream.on('error', reject);
    stream.end(buf);
  });
}

/**
 * Decompress a (possibly concatenated) zstd buffer.
 * Codex writes one frame per rollout, but frame-by-frame decoding keeps the reader
 * correct if that changes (same technique as `research/decode-frames.mjs`).
 */
async function decompressZstdFrames(buf, options = {}) {
  if (typeof zlib.createZstdDecompress !== 'function') {
    throw new Error('This Node.js build has no zstd support (need Node >= 22 with zlib zstd APIs)');
  }
  const maxBytes = options.maxZstdBytes ?? DEFAULT_MAX_ZSTD_BYTES;
  const chunks = [];
  let rest = buf;
  let guard = 0;
  while (rest.length > 0) {
    guard += 1;
    if (guard > 100000) throw new Error('Too many zstd frames in rollout');
    if (rest.length > maxBytes) {
      throw new Error(`zstd rollout too large to decompress in memory (${rest.length} bytes > ${maxBytes})`);
    }
    const frame = await decompressOneZstdFrame(rest);
    chunks.push(frame.data);
    const consumed = Number(frame.consumed) > 0 ? Number(frame.consumed) : 0;
    if (consumed <= 0 || consumed >= rest.length) break;
    rest = rest.subarray(consumed);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/* ───────────────────────────── text extraction ─────────────────────────────── */

/** Join the textual blocks of a `response_item` message payload. */
function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type && MESSAGE_TEXT_BLOCK_TYPES.has(block.type) && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function stripNoiseBlocks(text) {
  let out = text;
  for (const re of USER_NOISE_BLOCK_RES) out = out.replace(re, '');
  return out;
}

/** Keep only the text after the last `## My request:` heading (see MY_REQUEST_HEADING_RE). */
function unwrapMyRequest(text) {
  let lastEnd = -1;
  MY_REQUEST_HEADING_RE.lastIndex = 0;
  let match;
  while ((match = MY_REQUEST_HEADING_RE.exec(text)) !== null) {
    lastEnd = match.index + match[0].length;
    if (match[0].length === 0) break; // defensive: never loop forever on an empty match
  }
  return lastEnd >= 0 ? text.slice(lastEnd) : text;
}

/**
 * Unwrap the Answer card of `request_user_input`:
 * `<send_user_message_question_reply>[{question, answer}]</…>` → plain answer text.
 * @returns {string|null}
 */
function parseQuestionReply(text) {
  const match = QUESTION_REPLY_RE.exec(text);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const answers = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const answer = item.answer;
    let value = '';
    if (typeof answer === 'string') value = answer.trim();
    else if (Array.isArray(answer)) value = answer.map((a) => String(a).trim()).filter(Boolean).join(', ');
    else if (answer !== undefined && answer !== null) value = String(answer).trim();
    if (value) answers.push(value);
  }
  return answers.length > 0 ? answers.join('\n\n') : null;
}

/**
 * @param {string} rawText
 * @returns {{ text: string, reason: 'kept'|'service'|'empty' }}
 */
function cleanUserText(rawText) {
  let text = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return { text: '', reason: 'empty' };

  // Answer cards of request_user_input: keep the human answer, drop the wrapper.
  if (text.startsWith(QUESTION_REPLY_OPEN)) {
    const answer = parseQuestionReply(text);
    return answer ? { text: answer, reason: 'kept' } : { text: '', reason: 'service' };
  }

  // Attachment wrapper: "# Files mentioned by the user: … ## My request: <user text>".
  if (/^#\s*Files mentioned by the user:/i.test(text)) {
    const marker = '## My request:';
    const at = text.lastIndexOf(marker);
    text = at >= 0 ? text.slice(at + marker.length) : '';
  }

  text = stripNoiseBlocks(text).trim();
  // Ambient context may leave "## My request:" before the human text (see MY_REQUEST_HEADING_RE).
  text = unwrapMyRequest(text).trim();
  if (!text) return { text: '', reason: 'service' };

  for (const re of USER_NOISE_PREFIX_RES) {
    if (re.test(text)) return { text: '', reason: 'service' };
  }
  return { text, reason: 'kept' };
}

/* ─────────────────────────── rollout scanning ──────────────────────────────── */

function emptyStats() {
  return {
    lines: 0,
    badLines: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    chars: 0,
    droppedEmpty: 0,
    droppedService: 0,
    duplicateIds: 0,
    truncated: false,
  };
}

/**
 * Parse one rollout file. Only `response_item` → `message` lines are used for the
 * transcript; everything else is counted/ignored.
 *
 * @param {string} filePath
 * @param {{ collect?: boolean, maxChars?: number, maxZstdBytes?: number }} [options]
 * @returns {Promise<{ meta: object, messages: Array<{role:string,text:string,time:string|null}>, stats: object }>}
 */
async function scanRollout(filePath, options = {}) {
  const collect = options.collect !== false;
  const maxChars = Number.isFinite(options.maxChars) ? Number(options.maxChars) : Infinity;
  const stats = emptyStats();
  const messages = [];
  const seenIds = new Set();
  let budget = maxChars;
  let meta = { id: null, cwd: null, timestamp: null, originator: null, cliVersion: null };
  let firstTimestamp = null;

  for await (const rawLine of readRolloutLines(filePath, options)) {
    stats.lines += 1;
    const line = rawLine.trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      stats.badLines += 1;
      continue;
    }
    if (!record || typeof record !== 'object') continue;

    const lineTime = toIso(record.timestamp);
    if (!firstTimestamp && lineTime) firstTimestamp = lineTime;

    if (record.type === 'session_meta') {
      const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
      if (!meta.id && typeof payload.id === 'string') meta.id = payload.id;
      if (!meta.cwd && typeof payload.cwd === 'string') meta.cwd = payload.cwd;
      if (!meta.timestamp) meta.timestamp = toIso(payload.timestamp) || lineTime;
      if (!meta.originator && typeof payload.originator === 'string') meta.originator = payload.originator;
      if (!meta.cliVersion && typeof payload.cli_version === 'string') meta.cliVersion = payload.cli_version;
      continue;
    }
    if (record.type !== 'response_item') continue;

    const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
    if (payload.type !== 'message') continue;
    const role = payload.role;
    if (role !== 'user' && role !== 'assistant') continue;

    if (typeof payload.id === 'string' && payload.id) {
      if (seenIds.has(payload.id)) {
        stats.duplicateIds += 1;
        continue;
      }
      seenIds.add(payload.id);
    }

    const rawText = extractMessageText(payload.content);
    let text;
    if (role === 'user') {
      const cleaned = cleanUserText(rawText);
      if (cleaned.reason !== 'kept') {
        if (cleaned.reason === 'service') stats.droppedService += 1;
        else stats.droppedEmpty += 1;
        continue;
      }
      text = cleaned.text;
    } else {
      text = String(rawText ?? '').trim();
      if (!text) {
        stats.droppedEmpty += 1;
        continue;
      }
    }

    stats.messages += 1;
    if (role === 'user') stats.userMessages += 1;
    else stats.assistantMessages += 1;

    if (!collect) continue;

    if (budget <= 0) {
      stats.truncated = true;
      break;
    }
    if (text.length > budget) {
      text = text.slice(0, budget);
      stats.truncated = true;
    }
    budget -= text.length;
    stats.chars += text.length;
    messages.push({ role, text, time: lineTime });
  }

  if (!collect) stats.chars = 0;
  meta.firstTimestamp = firstTimestamp;
  return { meta, messages, stats };
}

/* ─────────────────────────── readCodexCatalog ──────────────────────────────── */

/** Comparison key for a directory path (case-insensitive on Windows). */
function normalizePathKey(value) {
  const text = String(value).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? text.toLowerCase() : text;
}

/** Whether a path exists, tolerating permission errors. */
function pathExists(value) {
  try {
    return fs.existsSync(value);
  } catch {
    return false;
  }
}

/** First read sizes tried when only the rollout header is needed. */
const HEAD_READ_SIZES = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];

/**
 * Read only the `session_meta` record of a rollout (id, cwd, timestamp).
 * Old chats often have no entry in the Codex state file, but the first line of
 * their rollout still names the project folder; reading a bounded head keeps
 * the catalogue cheap even for multi-megabyte logs.
 * @param {string} filePath - rollout path (`.jsonl` or `.jsonl.zst`).
 * @returns {Promise<{ id: string|null, cwd: string|null, timestamp: string|null } | null>}
 */
async function readRolloutHeadMeta(filePath) {
  let handle;
  try {
    handle = await fsp.open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const compressed = /\.zst$/i.test(filePath);
    for (const size of HEAD_READ_SIZES) {
      let bytesRead = 0;
      const buffer = Buffer.alloc(size);
      try {
        ({ bytesRead } = await handle.read(buffer, 0, size, 0));
      } catch {
        return null;
      }
      const chunk = buffer.subarray(0, bytesRead);
      let text;
      if (compressed) {
        try {
          const frame = await decompressOneZstdFrame(chunk);
          text = frame.data.toString('utf8');
        } catch {
          continue; // the head cut the frame; retry with a larger read
        }
      } else {
        text = chunk.toString('utf8');
      }
      for (const line of text.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let record;
        try {
          record = JSON.parse(trimmed);
        } catch {
          if (!compressed) break;
          continue;
        }
        if (record && record.type === 'session_meta') {
          const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
          return {
            id: typeof payload.id === 'string' ? payload.id : null,
            cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
            timestamp: toIso(payload.timestamp) || toIso(record.timestamp),
          };
        }
        if (!compressed) break;
      }
      if (!compressed) break;
    }
    return null;
  } finally {
    try {
      await handle.close();
    } catch {
      // closing a read handle never changes the catalogue result
    }
  }
}
/**
 * Read the project/thread catalogue.
 *
 * @param {{
 *   codexHome?: string,
 *   maxScanBytes?: number,
 *   countMessages?: boolean,
 * }} [options]
 * @returns {Promise<{ projects: Array<{
 *   id: string, name: string, rootPaths: string[], exists: boolean,
 *   threadCount: number,
 *   threads: Array<{
 *     id: string, title: string, updatedAt: string|null, cwd: string|null,
 *     rolloutPath: string|null, messageCount: number|null, messageCountOmitted: string|null,
 *   }>,
 * }> }>}
 */
export async function readCodexCatalog(options = {}) {
  const codexHome = resolveCodexHome(options.codexHome);
  const maxScanBytes = Number.isFinite(options.maxScanBytes) ? Number(options.maxScanBytes) : DEFAULT_MAX_SCAN_BYTES;
  const countMessages = options.countMessages !== false;

  const [state, sessionIndex, rolloutFiles] = await Promise.all([
    readJsonFileOr(path.join(codexHome, STATE_FILE), {}),
    readSessionIndex(codexHome),
    indexRolloutFiles(codexHome),
  ]);

  const projectsById = toIdMap(state && state['local-projects']);
  const assignments = toIdMap(state && state['thread-project-assignments']);
  const cwdHints = state && typeof state['thread-workspace-root-hints'] === 'object' && state['thread-workspace-root-hints']
    ? state['thread-workspace-root-hints']
    : {};
  const projectOrder = Array.isArray(state && state['project-order']) ? state['project-order'] : [];

  const threadsByProject = new Map();
  for (const [threadId, assignment] of assignments) {
    const projectId = assignment && typeof assignment === 'object' ? assignment.projectId : undefined;
    if (typeof projectId !== 'string' || !projectId) continue;
    if (!threadsByProject.has(projectId)) threadsByProject.set(projectId, []);
    threadsByProject.get(projectId).push(threadId);
  }

  const projectRecords = [...projectsById.values()];
  const orderIndex = new Map(projectOrder.map((id, index) => [id, index]));
  projectRecords.sort((a, b) => {
    const ai = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru');
  });

  const projects = [];
  for (const project of projectRecords) {
    const id = typeof project.id === 'string' ? project.id : '';
    if (!id) continue;
    const rootPaths = Array.isArray(project.rootPaths)
      ? project.rootPaths.filter((p) => typeof p === 'string' && p)
      : [];
    const exists = rootPaths.some((root) => {
      try {
        return fs.existsSync(root);
      } catch {
        return false;
      }
    });

    const threadIds = threadsByProject.get(id) || [];
    const threads = [];
    for (const threadId of threadIds) {
      const rollout = rolloutFiles.get(threadId.toLowerCase()) || null;
      const indexEntry = sessionIndex.get(threadId);
      let messageCount = null;
      let messageCountOmitted = null;

      if (!rollout) {
        messageCountOmitted = 'rollout-not-found';
      } else if (!countMessages) {
        messageCountOmitted = 'counting-disabled';
      } else if (rollout.sizeBytes > maxScanBytes) {
        messageCountOmitted = `rollout-too-large:${rollout.sizeBytes}`;
      } else {
        try {
          const scan = await scanRollout(rollout.path, { collect: false });
          messageCount = scan.stats.messages;
        } catch (error) {
          messageCountOmitted = `error:${error && error.message ? error.message : String(error)}`;
        }
      }

      const hint = cwdHints && typeof cwdHints[threadId] === 'string' ? cwdHints[threadId] : null;
      threads.push({
        id: threadId,
        title: (indexEntry && indexEntry.title) || `Untitled thread ${threadId.slice(0, 8)}`,
        updatedAt: (indexEntry && indexEntry.updatedAt) || (rollout ? new Date(rollout.mtimeMs).toISOString() : null),
        cwd: hint || rootPaths[0] || null,
        rolloutPath: rollout ? rollout.path : null,
        messageCount,
        messageCountOmitted,
      });
    }

    threads.sort((a, b) => {
      const at = a.updatedAt || '';
      const bt = b.updatedAt || '';
      if (at !== bt) return bt.localeCompare(at);
      return a.title.localeCompare(b.title, 'ru');
    });

    projects.push({
      id,
      name: typeof project.name === 'string' && project.name ? project.name : id,
      rootPaths,
      exists,
      threadCount: threads.length,
      threads,
    });
  }

  // Old Codex chats can survive only as rollout files: the desktop app may
  // rewrite its local state, leaving threads with no project assignment and no
  // session-index entry. Surface them from `session_meta.cwd` instead of hiding
  // them, otherwise the import silently misses exactly the oldest chats.
  const assignedThreads = new Set();
  for (const threadIds of threadsByProject.values()) {
    for (const threadId of threadIds) assignedThreads.add(threadId.toLowerCase());
  }
  const projectByRoot = new Map();
  for (const record of projects) {
    for (const root of record.rootPaths) projectByRoot.set(normalizePathKey(root), record);
  }
  const synthetic = new Map();
  for (const [threadId, rollout] of rolloutFiles) {
    if (assignedThreads.has(threadId.toLowerCase())) continue;
    const indexEntry = sessionIndex.get(threadId);
    const meta = await readRolloutHeadMeta(rollout.path);
    const hint = typeof cwdHints[threadId] === 'string' ? cwdHints[threadId] : null;
    const cwd = hint || (meta && meta.cwd) || null;
    let messageCount = null;
    let messageCountOmitted = null;
    if (rollout.sizeBytes > maxScanBytes) {
      messageCountOmitted = `rollout-too-large:${rollout.sizeBytes}`;
    } else {
      try {
        const scan = await scanRollout(rollout.path, { collect: false });
        messageCount = scan.stats.messages;
      } catch (error) {
        messageCountOmitted = `error:${error && error.message ? error.message : String(error)}`;
      }
    }
    const threadEntry = {
      id: threadId,
      title: (indexEntry && indexEntry.title) || `Untitled thread ${threadId.slice(0, 8)}`,
      updatedAt: (indexEntry && indexEntry.updatedAt) || new Date(rollout.mtimeMs).toISOString(),
      cwd,
      rolloutPath: rollout.path,
      messageCount,
      messageCountOmitted,
    };
    const realProject = cwd !== null ? projectByRoot.get(normalizePathKey(cwd)) : undefined;
    if (realProject !== undefined) {
      realProject.threads.push(threadEntry);
      realProject.threadCount = realProject.threads.length;
      continue;
    }
    const key = cwd !== null ? `cwd:${normalizePathKey(cwd)}` : 'orphans';
    let bucket = synthetic.get(key);
    if (bucket === undefined) {
      bucket = {
        id: key,
        name: cwd !== null ? path.basename(cwd) || cwd : 'Unassigned chats',
        rootPaths: cwd !== null ? [cwd] : [],
        exists: cwd !== null ? pathExists(cwd) : false,
        threadCount: 0,
        threads: [],
      };
      synthetic.set(key, bucket);
    }
    bucket.threads.push(threadEntry);
    bucket.threadCount = bucket.threads.length;
  }
  const syntheticProjects = [...synthetic.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  for (const record of syntheticProjects) {
    record.threads.sort((a, b) => {
      const at = a.updatedAt || '';
      const bt = b.updatedAt || '';
      if (at !== bt) return bt.localeCompare(at);
      return a.title.localeCompare(b.title, 'ru');
    });
    record.threadCount = record.threads.length;
    projects.push(record);
  }

  return { projects };
}

/* ──────────────────────── readThreadTranscript ─────────────────────────────── */

/**
 * Read one thread transcript.
 *
 * @param {{
 *   codexHome?: string,
 *   thread: { id: string, rolloutPath?: string|null, title?: string, cwd?: string|null },
 *   maxChars?: number,
 *   maxZstdBytes?: number,
 * }} params
 * @returns {Promise<{
 *   threadId: string,
 *   cwd: string|null,
 *   title: string,
 *   createdAt: string|null,
 *   messages: Array<{ role: 'user'|'assistant', text: string, time: string|null }>,
 *   stats: object,
 * }>}
 */
export async function readThreadTranscript({ codexHome, thread, maxChars, maxZstdBytes } = {}) {
  if (!thread) throw new TypeError('readThreadTranscript: `thread` is required');
  const threadId = typeof thread === 'string' ? thread : typeof thread.id === 'string' ? thread.id.trim() : '';
  if (!threadId) throw new TypeError('readThreadTranscript: `thread.id` is required');

  const home = resolveCodexHome(codexHome);
  const sessionIndex = await readSessionIndex(home);

  let rolloutPath = null;
  if (typeof thread === 'object' && typeof thread.rolloutPath === 'string' && thread.rolloutPath) {
    try {
      const stat = await fsp.stat(thread.rolloutPath);
      if (stat.isFile()) rolloutPath = thread.rolloutPath;
    } catch {
      rolloutPath = null; // stale path from the catalogue → re-locate by name below
    }
  }
  if (!rolloutPath) {
    const rolloutFiles = await indexRolloutFiles(home);
    const found = rolloutFiles.get(threadId.toLowerCase());
    rolloutPath = found ? found.path : null;
  }
  if (!rolloutPath) {
    throw new Error(`Codex rollout for thread ${threadId} was not found under ${path.join(home, SESSIONS_DIR)}`);
  }

  const stat = await fsp.stat(rolloutPath);
  const scan = await scanRollout(rolloutPath, { collect: true, maxChars, maxZstdBytes });

  const indexEntry = sessionIndex.get(threadId);
  const threadObject = typeof thread === 'object' ? thread : {};
  const title = (typeof threadObject.title === 'string' && threadObject.title)
    || (indexEntry && indexEntry.title)
    || `Untitled thread ${threadId.slice(0, 8)}`;
  const createdAt = scan.meta.timestamp || scan.meta.firstTimestamp || (indexEntry && indexEntry.updatedAt) || null;
  const cwd = scan.meta.cwd || (typeof threadObject.cwd === 'string' && threadObject.cwd) || null;

  return {
    threadId,
    cwd,
    title,
    createdAt,
    messages: scan.messages,
    stats: {
      ...scan.stats,
      rolloutPath,
      sizeBytes: stat.size,
      compressed: /\.zst$/i.test(rolloutPath),
    },
  };
}
