/**
 * dsh-voice-ru — host half.
 *
 * 1. Registers a local Russian speech-to-text provider (`gigaam-ru`) built on
 *    GigaAM-v3 ONNX through sherpa-onnx. Recognition runs in a separate plain
 *    Node process because the Electron host forbids sherpa's external buffers.
 * 2. Serves `POST /api/voice-ru/task`, which turns dictated theses into one
 *    structured task with the open project (cwd, instructions, recent chat)
 *    as context, using the configured LLM route.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Plugin row name in `cordis.patch.yml`. */
export const name = 'voice-ru';
/** Host services this plugin uses. */
export const inject = ['connection', 'webServer', 'sessionQuery', 'llm', 'tools'];

/** Model files mirrored from Hugging Face (GigaAM-v3 NeMo CTC). */
const MODEL_REPO = 'csukuangfj/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16';
const MODEL_FILES = [
  { name: 'model.int8.onnx', bytes: 224721476 },
  { name: 'tokens.txt', bytes: 196 },
];
/** Absolute path of the worker script shipped with this package. */
const WORKER_PATH = fileURLToPath(new URL('./worker.cjs', import.meta.url));
/** Absolute path of the Python e2e worker shipped with this package. */
const E2E_WORKER_PATH = fileURLToPath(new URL('./worker_e2e.py', import.meta.url));

/** `DSH_HOME` as the host sees it. */
function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh');
}

/**
 * Whether a path can be handed to libraries that reject non-ASCII paths
 * (sentencepiece on Windows).
 * @param {string} value - path.
 * @returns {boolean} true for ASCII-only paths.
 */
function isAsciiPath(value) {
  return /^[\x20-\x7e]+$/.test(value);
}

/**
 * Normalize row config.
 * @param {Record<string, unknown>} [raw] - plugin row config.
 * @returns {object} resolved config.
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const dataRoot = typeof source.dataRoot === 'string' && source.dataRoot.trim() !== '' ? source.dataRoot.trim() : join(dshHome(), 'speech-to-text', 'gigaam');
  const modelDirectory = typeof source.modelDirectory === 'string' ? source.modelDirectory.trim() : '';
  if (!isAbsolute(dataRoot)) throw new Error(`dsh-voice-ru: dataRoot must be absolute: ${dataRoot}`);
  if (modelDirectory !== '' && !isAbsolute(modelDirectory)) throw new Error(`dsh-voice-ru: modelDirectory must be absolute: ${modelDirectory}`);
  const origins = Array.isArray(source.modelOrigins) && source.modelOrigins.length > 0 ? source.modelOrigins.filter((origin) => typeof origin === 'string') : ['https://huggingface.co', 'https://hf-mirror.com'];
  const engine = source.engine === 'e2e' ? 'e2e' : 'ctc';
  const defaultE2ePython = join(dshHome(), 'speech-to-text', 'gigaam-e2e', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
  // sentencepiece cannot open tokenizer.model under a Cyrillic path, so the
  // e2e HF cache must live in an ASCII-only directory.
  const defaultE2eHfHome = isAsciiPath(dshHome())
    ? join(dshHome(), 'speech-to-text', 'hf-cache')
    : join(process.env.ProgramData || 'C:\\ProgramData', 'dsh-voice-ru', 'hf-cache');
  return {
    dataRoot,
    modelDirectory,
    providerId: typeof source.providerId === 'string' && source.providerId !== '' ? source.providerId : 'gigaam-ru',
    threads: Number.isSafeInteger(source.threads) && source.threads > 0 ? source.threads : 2,
    modelOrigins: origins,
    engine,
    e2ePython: typeof source.e2ePython === 'string' && source.e2ePython !== '' ? source.e2ePython : defaultE2ePython,
    e2eHfHome: typeof source.e2eHfHome === 'string' && source.e2eHfHome !== '' ? source.e2eHfHome : defaultE2eHfHome,
    e2eModel: typeof source.e2eModel === 'string' && source.e2eModel !== '' ? source.e2eModel : 'ai-sage/GigaAM-v3',
    e2eRevision: typeof source.e2eRevision === 'string' && source.e2eRevision !== '' ? source.e2eRevision : 'e2e_rnnt',
    llmProvider: typeof source.llmProvider === 'string' && source.llmProvider !== '' ? source.llmProvider : 'deepseek-account',
    llmModel: typeof source.llmModel === 'string' && source.llmModel !== '' ? source.llmModel : 'deepseek-flash',
    maxTokens: Number.isSafeInteger(source.maxTokens) && source.maxTokens > 0 ? source.maxTokens : 1200,
    contextMessages: Number.isSafeInteger(source.contextMessages) && source.contextMessages >= 0 ? source.contextMessages : 8,
    enableDebug: source.enableDebug === true,
  };
}

/**
 * Plain Node executable for the recognition worker.
 * @param {object} config - resolved config.
 * @returns {string} absolute executable path or `node` as a fallback.
 */
function nodeExecutable(config) {
  if (typeof config.nodePath === 'string' && config.nodePath !== '' && existsSync(config.nodePath)) return config.nodePath;
  const fromEnv = process.env.DSH_DESKTOP_NODE_EXECUTABLE;
  if (typeof fromEnv === 'string' && fromEnv !== '' && existsSync(fromEnv)) return fromEnv;
  if (typeof process.resourcesPath === 'string') {
    const candidate = join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe');
    if (existsSync(candidate)) return candidate;
    const posix = join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node');
    if (existsSync(posix)) return posix;
  }
  return 'node';
}

/**
 * Directory where the sherpa-onnx Node package is installed for this profile.
 * @returns {string} absolute package directory or the bare module name.
 */
function sherpaModulePath() {
  const candidates = [];
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    candidates.push(join(process.env.DSH_PROFILE_DIR, 'node_modules', 'sherpa-onnx-node'));
  }
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') {
    candidates.push(join(process.env.DSH_HOME, 'profiles', process.env.DSH_PROFILE || 'desktop', 'node_modules', 'sherpa-onnx-node'));
  }
  candidates.push(join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'desktop', 'node_modules', 'sherpa-onnx-node'));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'sherpa-onnx-node';
}

/**
 * Run one op in the recognition worker; one worker serves the whole plugin.
 */
class RecognitionWorker {
  /** @param {object} ctx - host plugin context. @param {object} config - resolved config. */
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.loaded = false;
    this.starting = null;
    this.tail = Promise.resolve();
    this.lifetime = new AbortController();
  }

  /** Start the worker once. */
  async ensureStarted() {
    if (this.child !== null) return this.child;
    if (this.starting !== null) return this.starting;
    this.starting = (async () => {
      const child = spawn(nodeExecutable(this.config), [WORKER_PATH], {
        cwd: dirname(WORKER_PATH),
        env: { ...process.env, SHERPA_MODULE_PATH: sherpaModulePath() },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this.onData(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text !== '') this.ctx.logger?.warn?.(`voice-ru worker: ${text}`);
      });
      child.on('exit', (code) => {
        this.child = null;
        this.loaded = false;
        for (const pending of this.pending.values()) pending.reject(new Error(`voice-ru worker exited (${String(code)})`));
        this.pending.clear();
        this.starting = null;
      });
      child.on('error', (error) => {
        this.ctx.logger?.warn?.('voice-ru worker failed', error);
        this.child = null;
        this.starting = null;
        this.loaded = false;
        for (const pending of this.pending.values()) pending.reject(error instanceof Error ? error : new Error(String(error)));
        this.pending.clear();
      });
      this.child = child;
      return child;
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  /** @param {string} chunk - stdout chunk. */
  onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = message.id === null ? undefined : this.pending.get(message.id);
      if (pending === undefined) continue;
      this.pending.delete(message.id);
      if (message.ok === true) pending.resolve(message);
      else pending.reject(new Error(String(message.error ?? 'worker error')));
    }
  }

  /**
   * Send one request and await its reply.
   * @param {object} payload - request; an id is added.
   * @returns {Promise<object>} worker reply.
   */
  async request(payload) {
    const child = await this.ensureStarted();
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    return await reply;
  }

  /** Load the model once in the worker. */
  async ensureLoaded() {
    if (this.loaded) return;
    const { model, tokens } = this.modelFiles();
    await this.request({ op: 'load', model, tokens, threads: this.config.threads });
    this.loaded = true;
  }

  /**
   * Resolve model and tokens paths for the worker.
   * @returns {{model: string, tokens: string}} absolute paths.
   */
  modelFiles() {
    const root = this.config.modelDirectory !== '' ? this.config.modelDirectory : this.config.dataRoot;
    return { model: join(root, 'model.int8.onnx'), tokens: join(root, 'tokens.txt') };
  }

  /**
   * Transcribe one WAV recording.
   * @param {Buffer} wav - 16 kHz mono PCM16 WAV bytes.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<string>} transcript.
   */
  async transcribe(wav, signal) {
    signal?.throwIfAborted();
    const run = async () => {
      await this.ensureLoaded();
      signal?.throwIfAborted();
      const file = join(tmpdir(), `dsh-voice-ru-${randomUUID()}.wav`);
      await writeFile(file, wav);
      try {
        const { model, tokens } = this.modelFiles();
        const reply = await this.request({ op: 'transcribe', wavPath: file, model, tokens, threads: this.config.threads });
        return String(reply.text ?? '').trim();
      } finally {
        await rm(file, { force: true }).catch(() => {});
      }
    };
    const queued = this.tail.then(run, run);
    this.tail = queued.then(() => undefined, () => undefined);
    return await queued;
  }

  /** Stop the worker process. */
  async dispose() {
    this.lifetime.abort();
    const child = this.child;
    this.child = null;
    this.loaded = false;
    if (child !== null) {
      child.stdin.end();
      child.kill();
    }
    for (const pending of this.pending.values()) pending.reject(new Error('voice-ru worker disposed'));
    this.pending.clear();
  }
}

/**
 * Python worker for the GigaAM-v3 e2e model (punctuation and normalization).
 * One process keeps the loaded model for repeated dictations.
 */
class E2eWorker {
  /** @param {object} ctx - host plugin context. @param {object} config - resolved config. */
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.starting = null;
    this.tail = Promise.resolve();
  }

  /** Start the Python worker once. */
  async ensureStarted() {
    if (this.child !== null) return this.child;
    if (this.starting !== null) return this.starting;
    this.starting = (async () => {
      if (!existsSync(this.config.e2ePython)) throw new Error(`e2e Python не найден: ${this.config.e2ePython}`);
      const child = spawn(this.config.e2ePython, [E2E_WORKER_PATH], {
        cwd: dirname(E2E_WORKER_PATH),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this.onData(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text !== '') this.ctx.logger?.warn?.(`voice-ru e2e: ${text}`);
      });
      child.on('exit', (code) => {
        this.child = null;
        for (const pending of this.pending.values()) pending.reject(new Error(`e2e worker exited (${String(code)})`));
        this.pending.clear();
        this.starting = null;
      });
      child.on('error', (error) => {
        this.ctx.logger?.warn?.('voice-ru e2e worker failed', error);
        this.child = null;
        this.starting = null;
        for (const pending of this.pending.values()) pending.reject(error instanceof Error ? error : new Error(String(error)));
        this.pending.clear();
      });
      this.child = child;
      return child;
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  /** @param {string} chunk - stdout chunk. */
  onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = message.id === null || message.id === undefined ? undefined : this.pending.get(message.id);
      if (pending === undefined) continue;
      this.pending.delete(message.id);
      if (message.ok === true) pending.resolve(message);
      else pending.reject(new Error(String(message.error ?? 'e2e worker error')));
    }
  }

  /**
   * Send one request and await its reply.
   * @param {object} payload - request payload.
   * @returns {Promise<object>} worker reply.
   */
  async request(payload) {
    const child = await this.ensureStarted();
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    return await reply;
  }

  /**
   * Transcribe one 16 kHz mono PCM16 WAV file.
   * @param {string} wavPath - absolute WAV path.
   * @returns {Promise<{text: string, audioSeconds: number, inferenceSeconds: number}>} transcript.
   */
  async transcribe(wavPath) {
    const run = async () => {
      const reply = await this.request({
        op: 'transcribe',
        wavPath,
        model: this.config.e2eModel,
        revision: this.config.e2eRevision,
        hfHome: this.config.e2eHfHome,
      });
      return {
        text: String(reply.text ?? '').trim(),
        audioSeconds: Number(reply.audioSeconds ?? 0),
        inferenceSeconds: Number(reply.inferenceSeconds ?? 0),
      };
    };
    const queued = this.tail.then(run, run);
    this.tail = queued.then(() => undefined, () => undefined);
    return await queued;
  }

  /** Stop the worker process. */
  async dispose() {
    const child = this.child;
    this.child = null;
    if (child !== null) {
      child.stdin.end();
      child.kill();
    }
    for (const pending of this.pending.values()) pending.reject(new Error('e2e worker disposed'));
    this.pending.clear();
  }
}

/**
 * Coerce provider audio input into WAV bytes.
 * @param {unknown} audio - Buffer, Uint8Array, ArrayBuffer or base64 string.
 * @returns {Buffer} WAV bytes.
 */
function toWavBytes(audio) {
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof Uint8Array) return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  if (typeof audio === 'string') return Buffer.from(audio, 'base64');
  throw new Error('voice-ru: unsupported audio payload');
}

/** @param {unknown} error - caught value. @returns {string} code. */
function errorCode(error) {
  return error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'ERROR';
}

/** Escape control characters for a prompt line. */
function cleanText(value, limit) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim() : '';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Collect the project context used to shape a task.
 * @param {object} ctx - host plugin context.
 * @param {object} config - resolved config.
 * @param {string | undefined} sessionId - open chat identity.
 * @returns {Promise<{sessionId?: string, cwd?: string, title?: string, instructions?: string, entries?: string[], recent?: string[]}>} context facts.
 */
async function projectContext(ctx, config, sessionId) {
  const context = {};
  let cwd;
  if (typeof sessionId === 'string' && sessionId !== '') {
    try {
      const snapshot = await ctx.sessionQuery.readSession(sessionId);
      context.title = deriveTitle(snapshot.events);
      cwd = snapshot.session?.cwd;
      context.recent = recentMessages(snapshot.events, config.contextMessages);
    } catch {
      // A missing session is not fatal: the task is still formed from the text.
    }
  }
  if (typeof cwd === 'string' && cwd !== '') {
    context.cwd = cwd;
    const instructionsFile = join(cwd, 'AGENTS.md');
    try {
      context.instructions = cleanText(await readFile(instructionsFile, 'utf8'), 4000);
    } catch {
      try {
        context.instructions = cleanText(await readFile(join(dshHome(), 'AGENTS.md'), 'utf8'), 4000);
      } catch {
        context.instructions = undefined;
      }
    }
    try {
      const entries = await import('node:fs/promises').then((module) => module.readdir(cwd));
      context.entries = entries.slice(0, 40);
    } catch {
      context.entries = undefined;
    }
  }
  return context;
}

/** @param {Array<object>} events - session events. @returns {string} title. */
function deriveTitle(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim() !== '') return event.data.title.trim();
  }
  return '';
}

/**
 * Render the last chat messages as short context lines.
 * @param {Array<object>} events - session events.
 * @param {number} limit - message count.
 * @returns {string[]} context lines.
 */
function recentMessages(events, limit) {
  if (limit <= 0) return [];
  /** @type {Array<{role: string, text: string}>} */
  const messages = [];
  for (const event of events) {
    if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue;
    const role = event.type === 'user/message' ? 'user' : 'assistant';
    const content = event.type === 'assistant/message' ? event.data?.message?.content : event.data?.content;
    let text = '';
    if (Array.isArray(content)) {
      for (const block of content) if (block?.type === 'text' && typeof block.text === 'string') text += block.text;
    }
    text = cleanText(text, 700);
    if (text !== '') messages.push({ role, text });
  }
  return messages.slice(-limit).map((message) => `${message.role}: ${message.text}`);
}

/**
 * Turn dictated theses into one structured task for the open project.
 * @param {object} ctx - host plugin context.
 * @param {object} config - resolved config.
 * @param {{ text: string, sessionId?: string }} input - dictated text and chat identity.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<{task: string, raw: string, context: object}>} formed task.
 */
async function formTask(ctx, config, input, signal) {
  const raw = cleanText(input.text, 8000);
  if (raw === '') throw new Error('Нечего преобразовывать: пустой текст');
  const context = await projectContext(ctx, config, input.sessionId);
  const contextLines = [];
  if (context.cwd !== undefined) contextLines.push(`Проект (рабочая папка): ${context.cwd}`);
  if (context.title !== undefined && context.title !== '') contextLines.push(`Текущий чат: ${context.title}`);
  if (context.entries !== undefined && context.entries.length > 0) contextLines.push(`Файлы в корне проекта: ${context.entries.join(', ')}`);
  if (context.recent !== undefined && context.recent.length > 0) contextLines.push(`Последние сообщения чата:\n${context.recent.join('\n')}`);
  if (context.instructions !== undefined && context.instructions !== '') contextLines.push(`Инструкции проекта:\n${context.instructions}`);

  const system =
    'Ты — помощник, который превращает надиктованные голосом тезисы в одну ясную, выполнимую задачу ' +
    'для агента-разработчика в текущем проекте. Верни ТОЛЬКО текст задачи на русском языке, без вступлений и пояснений. ' +
    'Структура: 1) что нужно сделать (одна-две строки); 2) конкретные требования списком; 3) ограничения и что не трогать, ' +
    'если это следует из контекста; 4) критерии готовности. Не выдумывай детали, которых нет в тезисах или контексте; ' +
    'если чего-то не хватает — так и напиши в критериях. Сохраняй технические слова и имена файлов как есть.';
  const user = `${contextLines.length > 0 ? `Контекст проекта:\n${contextLines.join('\n\n')}\n\n` : ''}Надиктованные тезисы:\n${raw}`;

  const llm = ctx.get('llm');
  if (llm === undefined || typeof llm.stream !== 'function') throw new Error('Сервис llm недоступен');
  const stream = llm.stream({
    provider: config.llmProvider,
    model: config.llmModel,
    messages: [
      { role: 'system', content: [{ type: 'text', text: system }], source: { kind: 'system-prompt' } },
      { role: 'user', content: [{ type: 'text', text: user }], source: { kind: 'user' } },
    ],
    maxTokens: config.maxTokens,
    signal,
  });
  let task = '';
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') task += chunk.text;
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'LLM stream failed');
    }
  }
  task = task.trim();
  if (task === '') throw new Error('Модель вернула пустой ответ');
  return { task, raw, context };
}

/**
 * Register the provider, the HTTP route and the tools.
 * @param {object} ctx - host plugin context.
 * @param {Record<string, unknown>} rawConfig - row config.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const worker = new RecognitionWorker(ctx, config);
  const e2eWorker = new E2eWorker(ctx, config);

  /** Current preparation state shared with the voice-input UI. */
  let state = { phase: 'unprepared', steps: [{ kind: 'check', status: 'pending' }] };
  const listeners = new Set();
  const publish = (next) => {
    state = { ...next };
    for (const listener of listeners) listener();
  };
  /** @param {(callback: () => void) => (() => void)} subscribe - readiness observer. */
  const preparation = {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prepare: (options = {}) => {
      if (config.engine === 'e2e') {
        void inspect();
        return;
      }
      const origins = options.downloadSource === undefined ? config.modelOrigins : [options.downloadSource];
      void prepareModels(origins);
    },
    cancel: async () => {
      publish({ phase: 'cancelled' });
    },
  };

  /** Inspect the local model files and publish readiness. */
  async function inspect() {
    if (config.engine === 'e2e') {
      const pythonReady = existsSync(config.e2ePython);
      publish(pythonReady
        ? { phase: 'ready', steps: [{ kind: 'check', status: 'complete' }, { kind: 'load', status: 'complete' }] }
        : { phase: 'failed', message: `Для e2e-движка нужен Python из ${config.e2ePython}. Установите окружение или переключите engine на "ctc".`, steps: [{ kind: 'check', status: 'complete' }, { kind: 'load', status: 'failed' }] });
      return;
    }
    const { modelDirectory } = config;
    const root = modelDirectory !== '' ? modelDirectory : config.dataRoot;
    try {
      for (const file of MODEL_FILES) {
        const info = await stat(join(root, file.name));
        if (!info.isFile() || info.size !== file.bytes) {
          publish({ phase: 'unprepared', steps: [{ kind: 'check', status: 'complete' }, { kind: 'model', status: 'pending' }] });
          return;
        }
      }
      publish({ phase: 'ready', steps: [{ kind: 'check', status: 'complete' }, { kind: 'model', status: 'complete' }] });
    } catch {
      publish({ phase: 'unprepared', steps: [{ kind: 'check', status: 'complete' }, { kind: 'model', status: 'pending' }] });
    }
  }

  /**
   * Download model files from the configured origins.
   * @param {string[]} origins - ordered origins.
   */
  async function prepareModels(origins) {
    const root = config.dataRoot;
    await mkdir(root, { recursive: true });
    for (const file of MODEL_FILES) {
      const target = join(root, file.name);
      try {
        const info = await stat(target);
        if (info.size === file.bytes) continue;
      } catch {
        // Missing: download below.
      }
      let lastError;
      let done = false;
      for (const origin of origins) {
        const url = `${origin.replace(/\/$/, '')}/${MODEL_REPO}/resolve/main/${file.name}`;
        try {
          publish({ phase: 'downloading', step: 'model', resource: file.name, completedBytes: 0, totalBytes: file.bytes, startedAt: Date.now() });
          const response = await fetch(url, { redirect: 'follow' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const part = `${target}.part`;
          await writeFile(part, Buffer.from(await response.arrayBuffer()));
          const written = await stat(part);
          if (written.size !== file.bytes) throw new Error(`size mismatch: ${written.size} != ${file.bytes}`);
          await rename(part, target);
          done = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!done) {
        publish({ phase: 'failed', message: `Не удалось скачать ${file.name} (${errorCode(lastError)}): ${lastError instanceof Error ? lastError.message : String(lastError)}`, download: { name: file.name } });
        return;
      }
    }
    publish({ phase: 'ready', steps: [{ kind: 'check', status: 'complete' }, { kind: 'model', status: 'complete' }] });
  }

  /** Ensure the CTC model files exist, downloading them on demand. */
  async function ensureModels() {
    const root = config.modelDirectory !== '' ? config.modelDirectory : config.dataRoot;
    for (const file of MODEL_FILES) {
      try {
        const info = await stat(join(root, file.name));
        if (info.isFile() && info.size === file.bytes) continue;
      } catch {
        // Missing: download below.
      }
      await prepareModels(config.modelOrigins);
      return;
    }
  }

  /**
   * Transcribe WAV bytes with the configured engine.
   * @param {Buffer} wav - 16 kHz mono PCM16 WAV.
   * @param {AbortSignal | undefined} signal - cancellation.
   * @returns {Promise<{text: string, audioSeconds: number, inferenceSeconds: number}>} transcript.
   */
  async function transcribeWav(wav, signal) {
    if (config.engine === 'e2e') {
      try {
        const file = join(tmpdir(), `dsh-voice-ru-${randomUUID()}.wav`);
        await writeFile(file, wav);
        try {
          const result = await e2eWorker.transcribe(file);
          return {
            text: result.text,
            audioSeconds: result.audioSeconds || Math.max(0, (wav.length - 44) / 32000),
            inferenceSeconds: result.inferenceSeconds,
          };
        } finally {
          await rm(file, { force: true }).catch(() => {});
        }
      } catch (error) {
        ctx.logger?.warn?.(`voice-ru: e2e transcription failed, falling back to CTC: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const started = Date.now();
    await ensureModels();
    const text = await worker.transcribe(wav, signal);
    return {
      text,
      audioSeconds: Math.max(0, (wav.length - 44) / 32000),
      inferenceSeconds: (Date.now() - started) / 1000,
    };
  }

  ctx.effect(() => {
    void inspect();
    const speech = ctx.get('speechToText');
    const unregister = speech !== undefined && typeof speech.register === 'function'
      ? speech.register({
          info: {
            id: config.providerId,
            name: config.engine === 'e2e' ? 'GigaAM v3 e2e — русский, с пунктуацией (локально)' : 'GigaAM v3 — русский (локально)',
            location: 'host-local',
            languages: ['ru'],
            downloadSources: [...new Set(config.modelOrigins.map((origin) => {
              try {
                return new URL(origin).origin;
              } catch {
                return origin;
              }
            }))],
            setupEstimate: config.engine === 'e2e'
              ? { recommendedDiskBytes: 2600000000, expectedMemoryBytes: 2000000000, minimumMinutes: 2, maximumMinutes: 30 }
              : { recommendedDiskBytes: 240000000, expectedMemoryBytes: 500000000, minimumMinutes: 1, maximumMinutes: 10 },
          },
          preparation,
          transcribe: async (input, signal) => await transcribeWav(toWavBytes(input.audio), signal),
        })
      : undefined;
    return async () => {
      const removing = unregister === undefined ? undefined : unregister();
      await worker.dispose();
      await e2eWorker.dispose();
      if (removing !== undefined) await removing;
    };
  }, 'voice-ru: gigaam provider');

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/voice-ru/task',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await request.json();
          if (body === null || typeof body !== 'object' || typeof body.text !== 'string') {
            return Response.json({ ok: false, error: 'text is required' }, { status: 400 });
          }
          const result = await formTask(ctx, config, { text: body.text, sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined });
          return Response.json({ ok: true, task: result.task, raw: result.raw });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
        }
      },
    }),
    'voice-ru: task route',
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/voice-ru/dictate',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await request.json();
          if (body === null || typeof body !== 'object' || typeof body.audioBase64 !== 'string' || body.audioBase64 === '') {
            return Response.json({ ok: false, error: 'audioBase64 is required' }, { status: 400 });
          }
          const wav = Buffer.from(body.audioBase64, 'base64');
          if (wav.length < 44) throw new Error('Аудио слишком короткое');
          const transcript = await transcribeWav(wav, undefined);
          const raw = String(transcript.text ?? '').trim();
          if (raw === '') throw new Error('Не удалось распознать речь — попробуйте ещё раз');
          const result = await formTask(ctx, config, { text: raw, sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined });
          return Response.json({ ok: true, raw, task: result.task });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
        }
      },
    }),
    'voice-ru: dictate route',
  );

  ctx.effect(() =>
    ctx.tools.register({
      name: 'voice_task_form',
      description:
        'Turn dictated theses (or any rough notes) into one structured, executable task for the current project. ' +
        'Uses the open project context (working directory, AGENTS.md, recent chat) and returns only the task text.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Rough dictated theses or notes to shape into a task.' } },
        required: ['text'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args, exec) {
        const sessionId = exec.agent?.session?.id;
        const result = await formTask(ctx, config, { text: args.text, sessionId }, exec.signal);
        return result.task;
      },
    }),
    'voice-ru: task tool',
  );

  if (config.enableDebug) {
    ctx.effect(() =>
      ctx.tools.register({
        name: 'voice_stt_check',
        description: 'Diagnostic: transcribe one local WAV file (16 kHz mono PCM16) with the Russian provider.',
        parameters: {
          type: 'object',
          properties: { wavPath: { type: 'string' } },
          required: ['wavPath'],
          additionalProperties: false,
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        async execute(args) {
          const wav = await readFile(args.wavPath);
          const result = await transcribeWav(wav, undefined);
          return JSON.stringify(result, null, 2);
        },
      }),
      'voice-ru: stt self-check',
    );
  }
}
