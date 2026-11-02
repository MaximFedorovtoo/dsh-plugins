/**
 * dsh-ruflo — Ruflo (ruvnet/ruflo) for DSH agents.
 *
 * Exposes the Ruflo CLI as native tools with an explicit scope:
 *   scope=project — the open project's working directory;
 *   scope=chat    — an isolated directory per DSH session
 *                   (<DSH_HOME>/cache/ruflo/chats/<session>), so chats never
 *                   share Ruflo memory, tasks or swarms.
 *
 * Nothing is initialized implicitly except the memory database, which is
 * created with `ruflo memory init` inside the chosen scope directory on the
 * first memory call (`.swarm/memory.db`, a few hundred KB).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Plugin row name in `cordis.patch.yml`. */
export const name = 'ruflo';
/** Host services this plugin uses. */
export const inject = ['tools', 'connection'];

/** Commands the raw escape hatch may run (init/cleanup/update/plugins/daemon/mcp are excluded). */
const RAW_COMMANDS = [
  'status', 'memory', 'task', 'swarm', 'agent', 'hooks', 'session', 'analyze', 'route',
  'doctor', 'config', 'progress', 'neural', 'workflow', 'security', 'guidance', 'embeddings',
];

/** Hooks subcommands exposed by the dedicated tool. */
const HOOK_ACTIONS = [
  'list', 'route', 'metrics', 'pretrain', 'statusline', 'session-end', 'session-restore',
  'pre-task', 'post-task', 'pre-edit', 'post-edit', 'worker',
];

/** @returns {string} DSH home. */
function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
}

/** @returns {string} profile directory holding node_modules. */
function profileDir() {
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') return process.env.DSH_PROFILE_DIR;
  return join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'desktop');
}

/** @returns {string} plain Node executable. */
function nodeExecutable() {
  const fromEnv = process.env.DSH_DESKTOP_NODE_EXECUTABLE;
  if (typeof fromEnv === 'string' && fromEnv !== '' && existsSync(fromEnv)) return fromEnv;
  if (typeof process.resourcesPath === 'string') {
    const candidate = join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
    if (existsSync(candidate)) return candidate;
  }
  return 'node';
}

/**
 * Resolve the Ruflo CLI entry script.
 * @param {object} config - plugin config.
 * @returns {{ node: string, script: string }} spawn pair.
 */
function resolveCli(config) {
  if (typeof config.cliPath === 'string' && config.cliPath !== '' && existsSync(config.cliPath)) {
    return { node: nodeExecutable(), script: config.cliPath };
  }
  const script = join(profileDir(), 'node_modules', 'ruflo', 'bin', 'ruflo.js');
  if (existsSync(script)) return { node: nodeExecutable(), script };
  throw new Error('Ruflo CLI не найден. Установите: dsh plugin --profile desktop add ruflo (ожидался ' + script + ')');
}

/**
 * Normalize config.
 * @param {Record<string, unknown>} [raw] - row config.
 * @returns {object} config.
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    cliPath: typeof source.cliPath === 'string' ? source.cliPath.trim() : '',
    projectRoot: typeof source.projectRoot === 'string' ? source.projectRoot.trim() : '',
    scopeRoot: typeof source.scopeRoot === 'string' && source.scopeRoot !== '' ? source.scopeRoot : join(dshHome(), 'cache', 'ruflo'),
    timeoutMs: Number.isSafeInteger(source.timeoutMs) && source.timeoutMs > 0 ? source.timeoutMs : 60000,
    initTimeoutMs: Number.isSafeInteger(source.initTimeoutMs) && source.initTimeoutMs > 0 ? source.initTimeoutMs : 180000,
    allowRaw: source.allowRaw !== false,
    // Executor bridge: Ruflo has no DeepSeek runtime of its own, so tasks are
    // executed by a DSH subagent (DeepSeek model) spawned through ctx.subagents.
    subagentProvider: typeof source.subagentProvider === 'string' && source.subagentProvider !== '' ? source.subagentProvider : 'spawn',
    executeMaxDepth: Number.isSafeInteger(source.executeMaxDepth) && source.executeMaxDepth >= 0 ? source.executeMaxDepth : 1,
    executeTimeoutMs: Number.isSafeInteger(source.executeTimeoutMs) && source.executeTimeoutMs > 0 ? source.executeTimeoutMs : 600000,
    executeMaxTokens: Number.isSafeInteger(source.executeMaxTokens) && source.executeMaxTokens > 0 ? source.executeMaxTokens : 4000,
    executeCorePath: typeof source.executeCorePath === 'string' ? source.executeCorePath.trim() : '',
  };
}

/** @param {string | undefined} value @returns {string} path-safe id. */
function safeId(value) {
  const cleaned = typeof value === 'string' ? value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '';
  return cleaned === '' ? 'anonymous' : cleaned;
}

/**
 * Resolve the directory a scope runs in.
 * @param {object} config - plugin config.
 * @param {'project'|'chat'} scope - scope.
 * @param {object} exec - tool execution (carries the agent/session).
 * @returns {{ dir: string, scope: string }} scope directory.
 */
function scopeDirectory(config, scope, exec) {
  if (scope === 'chat') {
    const session = exec?.agent?.session;
    return { dir: join(config.scopeRoot, 'chats', safeId(session?.id)), scope: 'chat' };
  }
  const session = exec?.agent?.session;
  const dir = config.projectRoot !== ''
    ? config.projectRoot
    : (typeof session?.header?.cwd === 'string' && session.header.cwd !== '' ? session.header.cwd : process.cwd());
  return { dir, scope: 'project' };
}

/** Strip ANSI escapes. */
function clean(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '').trim();
}

/**
 * Extract the largest complete JSON object from CLI output. Ruflo prints a
 * single envelope per command, but commands may log nested objects around it
 * (status prints update notices, task/hooks print arrays), so the widest parsed
 * object is the envelope and the smaller ones are its fields.
 * @param {string} text - stdout.
 * @returns {object | undefined} parsed JSON.
 */
function extractJson(text) {
  const source = clean(text);
  let best;
  let bestLength = -1;
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = start; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const span = cursor - start + 1;
          if (span > bestLength) {
            try {
              const value = JSON.parse(source.slice(start, cursor + 1));
              if (value !== null && typeof value === 'object') {
                best = value;
                bestLength = span;
              }
            } catch {
              // Not a complete object: keep scanning.
            }
          }
          start = cursor;
          break;
        }
      }
    }
  }
  return best;
}

/** Resolve Ruflo's real LLM execution core (agent-execute-core.js). */
function executeCorePath(config) {
  if (typeof config.executeCorePath === 'string' && config.executeCorePath !== '' && existsSync(config.executeCorePath)) return config.executeCorePath;
  const candidate = join(profileDir(), 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agent-execute-core.js');
  if (existsSync(candidate)) return candidate;
  throw new Error(`ruflo: не найден agent-execute-core (${candidate})`);
}

/**
 * Execute one prompt through Ruflo's LLM core with the saved DeepSeek settings.
 * The worker strips Anthropic/Ollama credentials and enforces api.deepseek.com.
 */
async function runExecutionWorker(config, settings, payload, signal) {
  const node = nodeExecutable();
  const worker = fileURLToPath(new URL('./agent-execute.mjs', import.meta.url));
  const timeoutMs = config.executeTimeoutMs + 60000;
  const stdout = await new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let settled = false;
    const child = spawn(node, [worker], { env: { ...process.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = (failure, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (failure !== undefined) reject(failure);
      else resolve(value);
    };
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error('ruflo: исполнение отменено'));
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error('ruflo: превышен таймаут исполнения'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', (error) => finish(new Error(`ruflo: worker не запустился: ${error.message}`)));
    child.on('close', () => finish(undefined, out));
    child.stdin.end(JSON.stringify({ ...payload, settingsPath: settingsPath() }), 'utf8');
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  const json = extractJson(stdout);
  if (json === undefined) throw new Error('ruflo: worker вернул не JSON');
  return json;
}

/** DeepSeek-only executor settings, entered through the plugin UI. */
function settingsPath() {
  return join(dshHome(), 'ruflo', 'settings.json');
}

/** Default settings: DeepSeek official endpoint only. */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'];

/** @param {object} config - plugin config. @returns {Promise<object>} settings. */
async function loadSettings(config) {
  const fallback = { baseUrl: DEEPSEEK_BASE_URL, model: 'deepseek-chat', apiKey: '', verifiedAt: null, lastError: null };
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8'));
    return {
      ...fallback,
      ...parsed,
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl !== '' ? parsed.baseUrl : fallback.baseUrl,
      model: typeof parsed.model === 'string' && parsed.model !== '' ? parsed.model : fallback.model,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return fallback;
  }
}

/**
 * Save a settings patch. The key is only written when supplied; `clearKey`
 * removes it. The file lives outside the project (DSH_HOME/ruflo/settings.json)
 * and never enters the repository.
 */
async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current };
  if (typeof patch.baseUrl === 'string' && patch.baseUrl !== '') next.baseUrl = patch.baseUrl.replace(/\/+$/, '');
  if (typeof patch.model === 'string' && patch.model !== '') next.model = patch.model;
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '') next.apiKey = patch.apiKey.trim();
  if (patch.clearKey === true) next.apiKey = '';
  if (typeof patch.lastError === 'string') next.lastError = patch.lastError;
  next.verifiedAt = patch.verified === true ? new Date().toISOString() : null;
  await mkdir(dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** @param {object} settings @returns {object} settings without the secret. */
function publicSettings(settings) {
  return {
    baseUrl: settings.baseUrl,
    models: DEEPSEEK_MODELS,
    model: settings.model,
    hasKey: typeof settings.apiKey === 'string' && settings.apiKey !== '',
    verifiedAt: settings.verifiedAt ?? null,
    lastError: settings.lastError ?? null,
    settingsPath: settingsPath(),
  };
}

/**
 * Enforce the DeepSeek-only policy: only https://api.deepseek.com is allowed.
 * @param {string} baseUrl - candidate endpoint.
 * @returns {string} normalized origin.
 */
function assertDeepSeekEndpoint(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('ruflo: некорректный baseUrl');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'api.deepseek.com') {
    throw new Error('ruflo: разрешён только https://api.deepseek.com — другие AI-endpoint-ы запрещены');
  }
  return url.origin;
}

/** Environment that makes Ruflo's OpenRouter-compat client speak to DeepSeek. */
async function deepseekEnv() {
  const settings = await loadSettings();
  if (typeof settings.apiKey !== 'string' || settings.apiKey === '') return {};
  return {
    RUFLO_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: settings.apiKey,
    OPENROUTER_BASE_URL: assertDeepSeekEndpoint(settings.baseUrl),
    OPENROUTER_DEFAULT_MODEL: settings.model,
  };
}

/** Remove credentials for every other provider so no non-DeepSeek model can answer. */
function onlyDeepSeekEnv(env) {
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  delete env.OLLAMA_API_KEY;
  delete env.OLLAMA_BASE_URL;
  return env;
}

/**
 * Run the Ruflo CLI in a directory.
 * @param {object} config - plugin config.
 * @param {{ dir: string, args: string[], timeoutMs?: number, signal?: AbortSignal }} call - invocation.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} result.
 */
async function runCli(config, call) {
  const { node, script } = resolveCli(config);
  const timeoutMs = Number.isSafeInteger(call.timeoutMs) && call.timeoutMs > 0 ? call.timeoutMs : config.timeoutMs;
  const aiEnv = await deepseekEnv();
  await mkdir(call.dir, { recursive: true });
  return await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(node, [script, ...call.args], {
      cwd: call.dir,
      env: onlyDeepSeekEnv({ ...process.env, CI: '1', ...aiEnv }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      call.signal?.removeEventListener('abort', onAbort);
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error('ruflo: вызов отменён'));
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error(`ruflo: превышен таймаут ${timeoutMs} мс (${call.args[0]} ${call.args[1] ?? ''})`.trim()));
    }, Math.min(2147483647, timeoutMs));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(new Error(`ruflo: не удалось запустить CLI: ${error.message}`)));
    child.on('close', (code) => finish(undefined, { code: code ?? 1, stdout, stderr }));
    if (call.signal !== undefined) {
      if (call.signal.aborted) onAbort();
      else call.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Render a CLI result for the model.
 * @param {{ scope: string, dir: string }} where - scope description.
 * @param {{ code: number, stdout: string, stderr: string }} result - CLI result.
 * @param {{ tolerateError?: boolean }} [options] - formatting options.
 * @returns {string} tool text.
 */
function render(where, result, options = {}) {
  const header = `scope: ${where.scope}\ncwd: ${where.dir}\n\n`;
  const json = extractJson(result.stdout);
  if (json !== undefined && result.code === 0) {
    const text = JSON.stringify(json, null, 2);
    return header + (text.length > 60000 ? `${text.slice(0, 60000)}\n… truncated` : text);
  }
  const text = clean(`${result.stdout}\n${result.stderr}`);
  const failed = result.code !== 0 || /\[ERROR\]|Error:/.test(text);
  if (failed && options.tolerateError !== true) {
    const message = text === '' ? `ruflo CLI exited with code ${result.code}` : text;
    throw new Error(message.length > 4000 ? `${message.slice(0, 4000)}…` : message);
  }
  return header + (text.length > 60000 ? `${text.slice(0, 60000)}\n… truncated` : text);
}

/**
 * Ensure the memory database exists in a scope directory.
 * @param {object} config - plugin config.
 * @param {string} dir - scope directory.
 * @param {AbortSignal | undefined} signal - cancellation.
 */
async function ensureMemory(config, dir, signal) {
  if (existsSync(join(dir, '.swarm', 'memory.db')) || existsSync(join(dir, '.claude', 'memory.db'))) return;
  try {
    await runCli(config, { dir, args: ['memory', 'init'], timeoutMs: config.initTimeoutMs, signal });
  } catch {
    // The command itself reports a useful error when init really fails.
  }
}

/** Format/parse helper for optional numeric args. */
function numeric(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Register the Ruflo tools.
 * @param {object} ctx - host plugin context.
 * @param {Record<string, unknown>} rawConfig - row config.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);

  // Settings UI endpoint (the key is entered in the plugin page, never in a
  // repository file). One path serves GET and POST: DSH allows exactly one
  // Fetch route per path. The verify route talks only to api.deepseek.com.
  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/ruflo/settings',
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method === 'GET') {
          return Response.json({ ok: true, settings: publicSettings(await loadSettings(config)) });
        }
        try {
          const body = await request.json();
          if (body === null || typeof body !== 'object') return Response.json({ ok: false, error: 'invalid body' }, { status: 400 });
          if (typeof body.baseUrl === 'string' && body.baseUrl !== '') assertDeepSeekEndpoint(body.baseUrl);
          const saved = await saveSettings({
            ...(typeof body.baseUrl === 'string' ? { baseUrl: body.baseUrl } : {}),
            ...(typeof body.model === 'string' ? { model: body.model } : {}),
            ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
            ...(body.clearKey === true ? { clearKey: true } : {}),
          });
          return Response.json({ ok: true, settings: publicSettings(saved) });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
        }
      },
    }),
    'ruflo: settings route',
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/ruflo/verify',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await request.json().catch(() => ({}));
          const settings = await loadSettings(config);
          const key = typeof body?.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : settings.apiKey;
          if (key === '') return Response.json({ ok: false, error: 'Ключ DeepSeek не введён' }, { status: 400 });
          const baseUrl = assertDeepSeekEndpoint(typeof body?.baseUrl === 'string' && body.baseUrl !== '' ? body.baseUrl : settings.baseUrl);
          const response = await fetch(`${baseUrl}/models`, {
            headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
            signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) {
            const message = `DeepSeek ответил ${response.status}`;
            await saveSettings({ lastError: message }).catch(() => {});
            return Response.json({ ok: false, status: response.status, error: message }, { status: 200 });
          }
          const payload = await response.json();
          const models = Array.isArray(payload?.data) ? payload.data.map((item) => String(item?.id ?? '')).filter((id) => id !== '').slice(0, 20) : [];
          if (typeof body?.apiKey === 'string' && body.apiKey.trim() !== '') await saveSettings({ apiKey: body.apiKey, verified: true });
          else await saveSettings({ verified: true });
          return Response.json({ ok: true, status: response.status, models, platform: 'deepseek', endpoint: baseUrl });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await saveSettings({ lastError: message }).catch(() => {});
          return Response.json({ ok: false, error: message }, { status: 200 });
        }
      },
    }),
    'ruflo: deepseek key verify',
  );

  /** Register one tool. */
  const tool = (toolName, description, parameters, execute) => {
    ctx.effect(() =>
      ctx.tools.register({
        name: toolName,
        description,
        parameters,
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        async execute(args, exec) {
          return await execute(args ?? {}, exec);
        },
      }),
      `ruflo: ${toolName}`,
    );
  };

  /** Shared scope parameter. */
  const scopeSchema = {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['project', 'chat'], description: 'project — рабочая папка проекта; chat — изолированная папка текущего чата.' },
    },
    required: ['scope'],
    additionalProperties: false,
  };

  tool(
    'ruflo_status',
    'Статус Ruflo в выбранной области (проект/чат): агенты, задачи, память, производительность. Возвращает JSON.',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
        detail: { type: 'string', enum: ['agents', 'tasks', 'memory'], description: 'Детализация по подсистеме.' },
      },
      required: ['scope'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      const cliArgs = ['status', ...(args.detail === undefined ? [] : [args.detail]), '--format', 'json'];
      const result = await runCli(config, { dir: where.dir, args: cliArgs, signal: exec.signal });
      let text = render(where, result, { tolerateError: true });
      if (/not initialized/i.test(text)) text += '\n\nПодсказка: вызовите ruflo_init с тем же scope, чтобы инициализировать Ruflo в этой папке.';
      return text;
    },
  );

  tool(
    'ruflo_init',
    'Инициализировать Ruflo в выбранной области (проект или чат) под DeepSeek Harness: создаёт AGENTS.md, .agents/ (skills), .claude-flow/ и локальную память — без Claude Code-файлов (.claude). После init в AGENTS.md добавляется секция «Ruflo in DeepSeek Harness» с описанием инструментов ruflo_*. В проект пишет служебные файлы — вызывайте осознанно.',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
        force: { type: 'boolean', description: 'Переинициализировать поверх существующей конфигурации (--force); данные памяти/swarm сохраняются.' },
      },
      required: ['scope'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      const result = await runCli(config, {
        dir: where.dir,
        // DeepSeek Harness reads AGENTS.md; `--codex --skip-claude` writes
        // AGENTS.md + .agents/ and never creates Claude Code's `.claude/`.
        args: ['init', '--codex', '--no-codex-detect', '--skip-claude', '--no-mods', '--no-plugin-install', '--no-signup', '--no-global', '--no-skills-sh', ...(args.force === true ? ['--force'] : [])],
        timeoutMs: config.initTimeoutMs,
        signal: exec.signal,
      });
      let note = '';
      try {
        const agentsPath = join(where.dir, 'AGENTS.md');
        const existing = await readFile(agentsPath, 'utf8').catch(() => '');
        const marker = '## Ruflo in DeepSeek Harness';
        if (!existing.includes(marker)) {
          const block = [
            '',
            '',
            marker,
            '',
            'This project uses Ruflo through the `dsh-ruflo` plugin. Prefer the DSH tools over Claude Code slash commands:',
            '',
            '- `ruflo_memory` — store/search project memory (`scope: "project"`) or private chat memory (`scope: "chat"`).',
            '- `ruflo_task` — create/list Ruflo tasks in the project or chat scope.',
            '- `ruflo_swarm` / `ruflo_agent` — Ruflo swarm and agents (separate from DSH Agent Teams; they do not execute DSH tools).',
            '- `ruflo_status` — agents/tasks/memory state for the scope.',
            '',
            'Project scope writes `.claude-flow/`, `.agents/` and `.swarm/` into the project; chat scope keeps everything under `%USERPROFILE%\\.dsh\\cache\\ruflo\\chats\\<session>`. Do not store secrets in Ruflo memory.',
            '',
          ].join('\n');
          await writeFile(agentsPath, existing === '' ? block : `${existing.replace(/\s+$/, '')}\n${block}`, 'utf8');
          note = `\nAGENTS.md: добавлена секция «Ruflo in DeepSeek Harness» (${agentsPath})`;
        } else {
          note = `\nAGENTS.md: секция «Ruflo in DeepSeek Harness» уже есть.`;
        }
      } catch (error) {
        note = `\nAGENTS.md: не удалось обновить (${error instanceof Error ? error.message : String(error)}).`;
      }
      return `${render(where, result)}${note}`;
    },
  );

  tool(
    'ruflo_memory',
    'Память Ruflo в области проект/чат: store (ключ+значение), search (семантический/ключевой поиск), list, stats, retrieve (по ключу). Первый вызов сам создаёт локальную базу памяти в папке области.',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
        action: { type: 'string', enum: ['store', 'search', 'list', 'stats', 'retrieve'], description: 'Действие с памятью.' },
        key: { type: 'string', description: 'Ключ для store/retrieve.' },
        value: { type: 'string', description: 'Значение для store.' },
        query: { type: 'string', description: 'Запрос для search.' },
        namespace: { type: 'string', description: 'Namespace памяти.' },
        limit: { type: 'number', description: 'Максимум результатов поиска.' },
        type: { type: 'string', enum: ['semantic', 'keyword', 'hybrid'], description: 'Тип поиска.' },
        tags: { type: 'string', description: 'Теги через запятую (store).' },
        provenance: { type: 'string', enum: ['user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'], description: 'Происхождение записи.' },
      },
      required: ['scope', 'action'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      const action = ['store', 'search', 'list', 'stats', 'retrieve'].includes(args.action) ? args.action : 'list';
      await ensureMemory(config, where.dir, exec.signal);
      const common = ['--format', 'json'];
      let cliArgs;
      if (action === 'store') {
        if (typeof args.key !== 'string' || args.key === '') throw new Error('ruflo_memory store: параметр key обязателен');
        if (typeof args.value !== 'string') throw new Error('ruflo_memory store: параметр value обязателен');
        cliArgs = ['memory', 'store', '-k', args.key, '--value', args.value,
          ...(typeof args.namespace === 'string' && args.namespace !== '' ? ['-n', args.namespace] : []),
          ...(typeof args.tags === 'string' && args.tags !== '' ? ['--tags', args.tags] : []),
          ...(typeof args.provenance === 'string' && args.provenance !== '' ? ['--provenance', args.provenance] : []),
          ...common];
      } else if (action === 'search') {
        if (typeof args.query !== 'string' || args.query === '') throw new Error('ruflo_memory search: параметр query обязателен');
        cliArgs = ['memory', 'search', '-q', args.query,
          ...(numeric(args.limit) === undefined ? [] : ['-l', String(args.limit)]),
          ...(typeof args.type === 'string' && args.type !== '' ? ['-t', args.type] : []),
          ...(typeof args.namespace === 'string' && args.namespace !== '' ? ['-n', args.namespace] : []),
          ...common];
      } else if (action === 'retrieve') {
        if (typeof args.key !== 'string' || args.key === '') throw new Error('ruflo_memory retrieve: параметр key обязателен');
        cliArgs = ['memory', 'retrieve', args.key, ...common];
      } else {
        cliArgs = ['memory', action, ...(typeof args.namespace === 'string' && args.namespace !== '' ? ['-n', args.namespace] : []), ...common];
      }
      const result = await runCli(config, { dir: where.dir, args: cliArgs, signal: exec.signal });
      return render(where, result);
    },
  );

  tool(
    'ruflo_task',
    'Задачи Ruflo в области проект/чат: create (тип+описание), list (все или активные), status (по id), cancel (по id).',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
        action: { type: 'string', enum: ['create', 'list', 'status', 'cancel'], description: 'Действие с задачей.' },
        type: { type: 'string', description: 'Тип задачи: implementation|research|testing|review|…' },
        description: { type: 'string', description: 'Описание задачи (create).' },
        id: { type: 'string', description: 'ID задачи (status/cancel).' },
        all: { type: 'boolean', description: 'list: включить все статусы (--all).' },
      },
      required: ['scope', 'action'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      const action = ['create', 'list', 'status', 'cancel'].includes(args.action) ? args.action : 'list';
      let cliArgs;
      if (action === 'create') {
        if (typeof args.description !== 'string' || args.description === '') throw new Error('ruflo_task create: параметр description обязателен');
        cliArgs = ['task', 'create', '-t', typeof args.type === 'string' && args.type !== '' ? args.type : 'implementation', '-d', args.description, '--format', 'json'];
      } else if (action === 'list') {
        cliArgs = ['task', 'list', ...(args.all === true ? ['--all'] : []), '--format', 'json'];
      } else {
        if (typeof args.id !== 'string' || args.id === '') throw new Error(`ruflo_task ${action}: параметр id обязателен`);
        cliArgs = ['task', action, args.id, '--format', 'json'];
      }
      const result = await runCli(config, { dir: where.dir, args: cliArgs, signal: exec.signal });
      return render(where, result);
    },
  );

  tool(
    'ruflo_execute',
    'Запустить DeepSeek-исполнителя для задачи Ruflo: берёт pending-задачу (или taskId/description), поднимает DSH-субагента (модель DeepSeek через Agent Teams), даёт ему задачу и просит сохранить итог в память Ruflo. Ruflo остаётся координатором и памятью; исполняет задачу DSH, а не Anthropic/Claude Code.',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
        taskId: { type: 'string', description: 'ID задачи Ruflo (status/list).' },
        description: { type: 'string', description: 'Описание задачи, если taskId не нужен (создастся новая задача Ruflo).' },
        provider: { type: 'string', description: 'Провайдер субагентов DSH (по умолчанию spawn).' },
      },
      required: ['scope'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      let taskId = typeof args.taskId === 'string' && args.taskId !== '' ? args.taskId : undefined;
      let description = typeof args.description === 'string' && args.description !== '' ? args.description : undefined;

      if (taskId === undefined && description === undefined) {
        const listed = await runCli(config, { dir: where.dir, args: ['task', 'list', '--all', '--format', 'json'], signal: exec.signal });
        const json = extractJson(listed.stdout);
        const tasks = Array.isArray(json?.tasks) ? json.tasks : [];
        const pending = tasks.find((task) => ['pending', 'in_progress', 'running'].includes(String(task.status ?? '').toLowerCase()));
        if (pending === undefined) throw new Error('ruflo_execute: нет pending-задач Ruflo; передайте taskId или description');
        taskId = typeof pending.taskId === 'string' ? pending.taskId : undefined;
        description = typeof pending.description === 'string' ? pending.description : undefined;
      } else if (taskId !== undefined && description === undefined) {
        const detail = await runCli(config, { dir: where.dir, args: ['task', 'status', taskId, '--format', 'json'], signal: exec.signal });
        const json = extractJson(detail.stdout);
        const task = json?.task ?? json;
        description = typeof task?.description === 'string' ? task.description : undefined;
        if (description === undefined) throw new Error(`ruflo_execute: не удалось прочитать описание задачи ${taskId}`);
      } else if (taskId === undefined && description !== undefined) {
        const created = await runCli(config, {
          dir: where.dir,
          args: ['task', 'create', '-t', typeof args.type === 'string' && args.type !== '' ? args.type : 'implementation', '-d', description, '--format', 'json'],
          signal: exec.signal,
        });
        const json = extractJson(created.stdout);
        taskId = typeof json?.taskId === 'string' ? json.taskId : undefined;
      }

      const taskLabel = taskId === undefined ? 'adhoc' : taskId;
      const settings = await loadSettings(config);
      if (settings.apiKey !== '' && settings.apiKey !== undefined) {
        // DeepSeek API executor: Ruflo's own LLM core (agent-execute-core.js)
        // called with the saved settings; the worker forces api.deepseek.com
        // and strips every other provider credential.
        try {
          const baseUrl = assertDeepSeekEndpoint(settings.baseUrl);
          const result = await runExecutionWorker(config, settings, {
            corePath: executeCorePath(config),
            model: settings.model,
            systemPrompt: 'Ты — исполнитель задач, которые координирует Ruflo. Работай по существу задачи, не добавляй лишнего. Если задача требует действий с файлами, опиши точный план и результат как сможешь без инструментов.',
            prompt: description,
            maxTokens: config.executeMaxTokens,
            timeoutMs: config.executeTimeoutMs,
          }, exec.signal);
          if (result.success !== true) throw new Error(`DeepSeek API: ${String(result.error ?? 'unknown error')}`);
          const output = String(result.output ?? '').trim();
          await runCli(config, {
            dir: where.dir,
            args: ['memory', 'store', '-k', `task/${taskLabel}/result`, '--value', output.slice(0, 8000), '--provenance', 'agent_output', '--format', 'json'],
            signal: exec.signal,
          }).catch(() => {});
          await runCli(config, {
            dir: where.dir,
            args: ['memory', 'store', '-k', `task/${taskLabel}/executor`, '--value', `deepseek-api:${String(result.model ?? settings.model)}`, '--provenance', 'agent_output', '--format', 'json'],
            signal: exec.signal,
          }).catch(() => {});
          return JSON.stringify({
            scope: where.scope,
            cwd: where.dir,
            taskId: taskId ?? null,
            description,
            executor: 'deepseek-api',
            endpoint: baseUrl,
            model: result.model ?? settings.model,
            usage: result.usage ?? null,
            output,
            note: 'Исполнено Ruflo LLM-core через api.deepseek.com (DeepSeek). Anthropic/Ollama-ключи вычищены из окружения. Итог сохранён в память Ruflo (task/<id>/result).',
          }, null, 2);
        } catch (error) {
          // Fall through to the DSH subagent (also DeepSeek) with the reason.
          var apiFailure = error instanceof Error ? error.message : String(error);
        }
      }

      const subagents = ctx.get('subagents');
      if (subagents === undefined || typeof subagents.startActivation !== 'function') {
        throw new Error('ruflo_execute: сервис subagents недоступен — включите Agent Teams (dsh-experimental-agent-team-profile)');
      }
      const parent = exec.agent;
      if (parent === undefined) throw new Error('ruflo_execute: нужен живой агент-родитель (вызовите инструмент из чата)');
      const provider = typeof args.provider === 'string' && args.provider !== '' ? args.provider : config.subagentProvider;
      const prompt = [
        `Ты — DeepSeek-исполнитель задачи, которую координирует Ruflo (плагин dsh-ruflo). Рабочая папка: ${where.dir}.`,
        `Область Ruflo: ${where.scope}.`,
        taskId === undefined ? 'Задача (ad-hoc):' : `Задача ${taskId}:`,
        description,
        '',
        'Выполни задачу инструментами DSH: прочитай нужные файлы, внеси изменения, проверь результат. Не коммить и не пушить, если это не требуется задачей.',
        'В конце сохрани краткий итог в память Ruflo: вызов ruflo_memory с scope "' + where.scope + '", action "store", key "task/' + taskLabel + '/result", value "<= 2000 символов: что сделано и как проверено>", provenance "agent_output".',
        'Верни отчёт: что изменено, как проверено, что осталось.',
      ].join('\n');
      const activation = await subagents.startActivation({
        provider,
        label: `ruflo:${taskLabel}`,
        // DSH subagent requests take content blocks, not a raw string: a string
        // is spread into single-character parts and the adapter rejects it with
        // UNSUPPORTED_CONTENT ("content undefined").
        request: { parent, prompt: [{ type: 'text', text: prompt }], cwd: where.dir, maxDepth: config.executeMaxDepth },
        signal: exec.signal,
        delivery: 'parent',
      });
      try {
        await runCli(config, {
          dir: where.dir,
          args: ['memory', 'store', '-k', `task/${taskLabel}/executor`, '--value', `dsh-subagent:${activation.childId}`, '--provenance', 'agent_output', '--format', 'json'],
          signal: exec.signal,
        });
      } catch {
        // The mapping is best-effort; the child still runs.
      }
      return JSON.stringify({
        scope: where.scope,
        cwd: where.dir,
        taskId: taskId ?? null,
        description,
        executor: 'dsh-subagent',
        provider,
        childId: activation.childId,
        messageId: activation.messageId ?? null,
        ...(typeof apiFailure === 'string' ? { deepseekApiError: apiFailure } : {}),
        note: 'DSH-субагент (модель DeepSeek) запущен; итог придёт уведомлением в этот чат и будет сохранён в память Ruflo. Ruflo — координатор/память, исполнитель — DSH.',
      }, null, 2);
    },
  );

  tool(
    'ruflo_swarm',
    'Swarm-координация Ruflo в области проект/чат: init (топология/maxAgents/v3-mode), status, stop. Это состояние Ruflo, а не DSH Agent Teams.',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
        action: { type: 'string', enum: ['init', 'status', 'stop'], description: 'Действие.' },
        topology: { type: 'string', description: 'Топология: hierarchical|mesh|hierarchical-mesh|ring|star.' },
        maxAgents: { type: 'number', description: 'Максимум агентов (по умолчанию 15).' },
        v3Mode: { type: 'boolean', description: 'Включить V3 15-agent mesh (--v3-mode).' },
      },
      required: ['scope', 'action'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      const action = ['init', 'status', 'stop'].includes(args.action) ? args.action : 'status';
      const cliArgs = ['swarm', action,
        ...(action === 'init' && args.v3Mode === true ? ['--v3-mode'] : []),
        ...(action === 'init' && typeof args.topology === 'string' && args.topology !== '' ? ['-t', args.topology] : []),
        ...(action === 'init' && numeric(args.maxAgents) !== undefined ? ['-m', String(args.maxAgents)] : []),
        '--format', 'json'];
      const result = await runCli(config, { dir: where.dir, args: cliArgs, signal: exec.signal });
      return render(where, result);
    },
  );

  tool(
    'ruflo_agent',
    'Агенты Ruflo в области проект/чат: spawn (тип), list, status (id), stop (id), metrics. Агенты живут в состоянии Ruflo, а не в DSH.',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
        action: { type: 'string', enum: ['spawn', 'list', 'status', 'stop', 'metrics'], description: 'Действие.' },
        type: { type: 'string', description: 'Тип агента (spawn): coder|tester|reviewer|researcher|…' },
        id: { type: 'string', description: 'ID агента (status/stop).' },
      },
      required: ['scope', 'action'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      const action = ['spawn', 'list', 'status', 'stop', 'metrics'].includes(args.action) ? args.action : 'list';
      let cliArgs;
      if (action === 'spawn') {
        cliArgs = ['agent', 'spawn', '-t', typeof args.type === 'string' && args.type !== '' ? args.type : 'coder', '--format', 'json'];
      } else if (action === 'list' || action === 'metrics') {
        cliArgs = ['agent', action, '--format', 'json'];
      } else {
        if (typeof args.id !== 'string' || args.id === '') throw new Error(`ruflo_agent ${action}: параметр id обязателен`);
        cliArgs = ['agent', action, args.id, '--format', 'json'];
      }
      const result = await runCli(config, { dir: where.dir, args: cliArgs, signal: exec.signal });
      return render(where, result);
    },
  );

  tool(
    'ruflo_hooks',
    'Хуки самообучения Ruflo в области проект/чат: list, route (маршрутизация задачи), metrics, pretrain, statusline, session-restore/session-end, pre-task/post-task, pre-edit/post-edit, worker.',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
        action: { type: 'string', enum: HOOK_ACTIONS, description: 'Хук.' },
        task: { type: 'string', description: 'Описание задачи для route/pre-task/post-task.' },
        file: { type: 'string', description: 'Путь файла для pre-edit/post-edit.' },
      },
      required: ['scope', 'action'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      const action = HOOK_ACTIONS.includes(args.action) ? args.action : 'list';
      const cliArgs = ['hooks', action,
        ...(typeof args.task === 'string' && args.task !== '' ? ['-t', args.task] : []),
        ...(typeof args.file === 'string' && args.file !== '' ? ['-f', args.file] : []),
        '--format', 'json'];
      const result = await runCli(config, { dir: where.dir, args: cliArgs, signal: exec.signal, timeoutMs: config.timeoutMs });
      return render(where, result);
    },
  );

  if (config.allowRaw) {
    tool(
      'ruflo_raw',
      `Прямой вызов Ruflo CLI в выбранной области: команда + массив аргументов. Разрешены: ${RAW_COMMANDS.join(', ')}. Для команд с JSON авто-добавляется --format json, если не указан явно.`,
      {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
          command: { type: 'string', description: 'Команда Ruflo (status/memory/task/swarm/agent/hooks/…).' },
          args: { type: 'array', items: { type: 'string' }, description: 'Дополнительные аргументы CLI.' },
          timeoutMs: { type: 'number', description: 'Таймаут вызова.' },
        },
        required: ['scope', 'command'],
        additionalProperties: false,
      },
      async (args, exec) => {
        const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
        const command = String(args.command ?? '');
        if (!RAW_COMMANDS.includes(command)) throw new Error(`ruflo_raw: команда "${command}" недоступна; разрешены: ${RAW_COMMANDS.join(', ')}`);
        const extra = Array.isArray(args.args) ? args.args.map(String) : [];
        const hasFormat = extra.some((item) => item === '--format' || item === '--json');
        const cliArgs = [command, ...extra, ...(hasFormat ? [] : ['--format', 'json'])];
        const result = await runCli(config, { dir: where.dir, args: cliArgs, signal: exec.signal, timeoutMs: args.timeoutMs });
        return render(where, result, { tolerateError: true });
      },
    );
  }
}
