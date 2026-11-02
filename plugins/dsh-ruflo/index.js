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
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Plugin row name in `cordis.patch.yml`. */
export const name = 'ruflo';
/** Host services this plugin uses. */
export const inject = ['tools'];

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

/**
 * Run the Ruflo CLI in a directory.
 * @param {object} config - plugin config.
 * @param {{ dir: string, args: string[], timeoutMs?: number, signal?: AbortSignal }} call - invocation.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} result.
 */
async function runCli(config, call) {
  const { node, script } = resolveCli(config);
  const timeoutMs = Number.isSafeInteger(call.timeoutMs) && call.timeoutMs > 0 ? call.timeoutMs : config.timeoutMs;
  await mkdir(call.dir, { recursive: true });
  return await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(node, [script, ...call.args], {
      cwd: call.dir,
      env: { ...process.env, CI: '1' },
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
    'Инициализировать Ruflo в выбранной области (проект или чат): создаёт .claude-flow/, .claude/settings.json, .gitignore-записи и локальную память. В проект пишет служебные файлы — вызывайте осознанно. С flags --no-mods/--no-plugin-install/--no-global/--no-signup.',
    {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'chat'], description: 'Область: project или chat.' },
      },
      required: ['scope'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const where = scopeDirectory(config, args.scope === 'chat' ? 'chat' : 'project', exec);
      const result = await runCli(config, {
        dir: where.dir,
        args: ['init', '--minimal', '--skip-claude', '--no-mods', '--no-plugin-install', '--no-signup', '--no-global', '--no-skills-sh'],
        timeoutMs: config.initTimeoutMs,
        signal: exec.signal,
      });
      return render(where, result);
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
