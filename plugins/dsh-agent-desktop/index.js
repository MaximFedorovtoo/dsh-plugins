/**
 * dsh-agent-desktop — computer use for DSH agents.
 *
 * Wraps the `agent-desktop` CLI (vercel-labs/agent-desktop, Apache-2.0) into
 * host tools. The CLI reads and operates desktop apps through the OS
 * accessibility tree: `snapshot` returns stable `@<snapshot>:eN` refs, ref
 * actions report a delivery disposition, and macOS/Windows/Linux are supported.
 *
 * The plugin is host-only and expects the `agent-desktop` npm package in the
 * profile (native binary for this platform); the model never gets a raw shell.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/** Plugin row name in `cordis.patch.yml`. */
export const name = 'agent-desktop';
/** Host services this plugin uses. */
export const inject = ['tools'];

/** CLI commands that can be dispatched through the raw escape hatch. */
const COMMANDS = [
  'snapshot', 'find', 'get', 'is', 'screenshot', 'list-surfaces',
  'click', 'double-click', 'triple-click', 'right-click', 'type', 'set-value', 'clear', 'focus', 'select', 'toggle', 'check', 'uncheck', 'expand', 'collapse', 'scroll', 'scroll-to',
  'press', 'hover', 'drag', 'mouse-move', 'mouse-click', 'mouse-wheel',
  'launch', 'close-app', 'list-apps', 'list-windows', 'list-displays', 'focus-window', 'resize-window', 'move-window', 'minimize', 'maximize', 'restore', 'open-system-surface',
  'list-notifications', 'dismiss-notification', 'dismiss-all-notifications', 'notification-action',
  'clipboard-get', 'clipboard-set', 'clipboard-clear',
  'wait', 'session', 'trace', 'cursor-overlay', 'status', 'permissions', 'version', 'batch', 'skills',
];
/** Commands that need a daemon for held keys/buttons and refuse to run. */
const REFUSED = new Set(['key-down', 'key-up', 'mouse-down', 'mouse-up']);

/** @returns {string} DSH home. */
function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
}

/** @returns {string} profile directory that holds node_modules. */
function profileDir() {
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') return process.env.DSH_PROFILE_DIR;
  return join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'desktop');
}

/** @returns {string} plain Node executable for the JS launcher fallback. */
function nodeExecutable() {
  const fromEnv = process.env.DSH_DESKTOP_NODE_EXECUTABLE;
  if (typeof fromEnv === 'string' && fromEnv !== '' && existsSync(fromEnv)) return fromEnv;
  if (typeof process.resourcesPath === 'string') {
    const candidate = join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
    if (existsSync(candidate)) return candidate;
  }
  return 'node';
}

/** @returns {string | undefined} native binary file name for this platform. */
function platformBinaryName() {
  const map = {
    win32: { x64: 'agent-desktop-win32-x64.exe', arm64: 'agent-desktop-win32-arm64.exe' },
    darwin: { x64: 'agent-desktop-darwin-x64', arm64: 'agent-desktop-darwin-arm64' },
    linux: { x64: 'agent-desktop-linux-x64', arm64: 'agent-desktop-linux-arm64' },
  };
  return map[process.platform]?.[process.arch];
}

/**
 * Resolve the CLI executable.
 * @param {{ binary?: string }} config - plugin config.
 * @returns {{ exe: string, prefix: string[] }} spawn target.
 */
function resolveCli(config) {
  if (typeof config.binary === 'string' && config.binary !== '' && existsSync(config.binary)) return { exe: config.binary, prefix: [] };
  const packageDir = join(profileDir(), 'node_modules', 'agent-desktop');
  const binaryName = platformBinaryName();
  if (binaryName !== undefined) {
    const native = join(packageDir, 'bin', binaryName);
    if (existsSync(native)) return { exe: native, prefix: [] };
  }
  const launcher = join(packageDir, 'bin', 'agent-desktop');
  if (existsSync(launcher)) return { exe: nodeExecutable(), prefix: [launcher] };
  throw new Error(
    'agent-desktop CLI не найден. Установите зависимость: dsh plugin --profile desktop add agent-desktop ' +
    `(ожидался ${join(packageDir, 'bin')})`,
  );
}

/**
 * Normalize config.
 * @param {Record<string, unknown>} [raw] - row config.
 * @returns {object} config.
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    binary: typeof source.binary === 'string' ? source.binary.trim() : '',
    timeoutMs: Number.isSafeInteger(source.timeoutMs) && source.timeoutMs > 0 ? source.timeoutMs : 30000,
    maxOutputChars: Number.isSafeInteger(source.maxOutputChars) && source.maxOutputChars > 0 ? source.maxOutputChars : 20000,
    sessionScope: source.sessionScope !== false,
    allowRaw: source.allowRaw !== false,
    headed: source.headed === true,
  };
}

/** @param {string | undefined} sessionId @returns {string | undefined} CLI-safe namespace. */
function sessionName(sessionId) {
  if (typeof sessionId !== 'string') return undefined;
  const cleaned = sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned === '' ? undefined : cleaned;
}

/**
 * Build CLI arguments from flag pairs.
 * @param {Array<[string, unknown]>} pairs - flag name (without --) and value.
 * @returns {string[]} arguments.
 */
function flagArgs(pairs) {
  const args = [];
  for (const [flag, value] of pairs) {
    if (value === undefined || value === null || value === '') continue;
    if (value === false) continue;
    if (value === true) {
      args.push(`--${flag}`);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) args.push(`--${flag}`, String(item));
      continue;
    }
    args.push(`--${flag}`, String(value));
  }
  return args;
}

/**
 * Run one CLI command and return its JSON envelope.
 * @param {object} config - plugin config.
 * @param {string} command - CLI command.
 * @param {string[]} args - CLI arguments.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @param {number | undefined} timeoutOverride - per-call budget.
 * @returns {Promise<object>} parsed envelope.
 */
async function runCli(config, command, args, signal, timeoutOverride) {
  const { exe, prefix } = resolveCli(config);
  const timeoutMs = Number.isSafeInteger(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : config.timeoutMs;
  const argv = [...prefix, command, ...args];
  const envelope = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(exe, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      for (const stream of [child.stdout, child.stderr]) if (stream !== null) stream.destroy();
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error('agent-desktop: вызов отменён'));
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error(`agent-desktop: превышен таймаут ${timeoutMs} мс (${command})`));
    }, Math.min(2147483647, timeoutMs + 5000));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(new Error(`agent-desktop: не удалось запустить CLI (${exe}): ${error.message}`)));
    child.on('close', () => {
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
      let parsed;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line.startsWith('{')) continue;
        try {
          parsed = JSON.parse(line);
          break;
        } catch {
          // keep looking for the envelope
        }
      }
      if (parsed === undefined) {
        const detail = (stderr.trim() || stdout.trim()).slice(0, 800);
        finish(new Error(`agent-desktop: CLI не вернул JSON (${command}); ${detail === '' ? 'пустой вывод' : detail}`));
        return;
      }
      finish(undefined, parsed);
    });
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  if (envelope.ok !== true) {
    const error = envelope.error ?? {};
    const code = typeof error.code === 'string' ? error.code : 'ERROR';
    const message = typeof error.message === 'string' ? error.message : 'команда не выполнена';
    const suggestion = typeof error.suggestion === 'string' && error.suggestion !== '' ? ` — ${error.suggestion}` : '';
    const retry = error.disposition?.retry === 'safe' ? ' (повтор безопасен)' : '';
    throw new Error(`${code}: ${message}${suggestion}${retry}`);
  }
  return envelope;
}

/**
 * Serialize an envelope for the model, truncating huge trees.
 * @param {object} envelope - CLI envelope.
 * @param {object} config - plugin config.
 * @param {Record<string, unknown>} [extra] - fields to add to `data`.
 * @returns {string} text.
 */
function toText(envelope, config, extra) {
  const value = extra === undefined || Object.keys(extra).length === 0
    ? envelope
    : { ...envelope, data: { ...(envelope.data ?? {}), ...extra } };
  let text = JSON.stringify(value, null, 2);
  if (text.length > config.maxOutputChars) {
    text = `${text.slice(0, config.maxOutputChars)}\n… вывод обрезан (${text.length} символов, лимит ${config.maxOutputChars}); используйте --root/--skeleton/--compact или desktop_raw, чтобы смотреть частями`;
  }
  return text;
}

/**
 * Register the desktop tools.
 * @param {object} ctx - host plugin context.
 * @param {Record<string, unknown>} rawConfig - row config.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);

  /**
   * Register one host tool.
   * @param {string} toolName - tool name.
   * @param {string} description - model-facing description.
   * @param {object} parameters - JSON schema.
   * @param {(args: object, exec: object) => Promise<string>} execute - implementation.
   */
  const tool = (toolName, description, parameters, execute) => {
    ctx.effect(() =>
      ctx.tools.register({
        name: toolName,
        description,
        parameters,
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        async execute(args, exec) {
          try {
            return await execute(args ?? {}, exec);
          } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
          }
        },
      }),
      `agent-desktop: ${toolName}`,
    );
  };

  /** Common per-call CLI arguments that also select the snapshot namespace. */
  const common = (args, exec, options) => {
    const extra = [];
    if (config.headed) extra.push('--headed');
    if (config.sessionScope) {
      const session = sessionName(exec.agent?.session?.id);
      if (session !== undefined) extra.push('--session', session);
    }
    if (options?.timeoutMs !== undefined) extra.push('--timeout-ms', String(options.timeoutMs));
    if (options?.waitFor !== undefined && options.waitFor !== '') extra.push('--wait-for', String(options.waitFor));
    return [...args, ...extra];
  };

  tool(
    'desktop_status',
    'Показать состояние agent-desktop: версия, платформа, разрешения accessibility/automation/screen и поддерживаемые поверхности. Запустите первым, если компьютерные действия недоступны.',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => toText(await runCli(config, 'status', [], undefined), config),
  );

  tool(
    'desktop_apps',
    'Список запущенных GUI-приложений (windows=false) или видимых окон (windows=true), с фильтром по имени приложения. Начните с этого, чтобы выбрать app для desktop_snapshot.',
    {
      type: 'object',
      properties: {
        windows: { type: 'boolean', description: 'true — list-windows (видимые окна), false — list-apps (приложения).' },
        app: { type: 'string', description: 'Фильтр по имени приложения.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const command = args.windows === true ? 'list-windows' : 'list-apps';
      const cliArgs = flagArgs([['app', args.app]]);
      return toText(await runCli(config, command, cliArgs, undefined), config);
    },
  );

  tool(
    'desktop_snapshot',
    'Снимок accessibility-дерева приложения: каждый элемент получает ref вида @<snapshot>:eN для действий. Возвращает JSON с data.tree, snapshot_id, complete. Рефы валидны только для своего снапшота: после изменения UI делайте новый снимок. Для больших приложений используйте skeleton+compact или root для углубления.',
    {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Имя приложения (из desktop_apps).' },
        windowId: { type: 'string', description: 'Конкретное окно из desktop_apps windows=true, если у приложения несколько окон.' },
        interactiveOnly: { type: 'boolean', description: 'Только интерактивные элементы (−i).' },
        compact: { type: 'boolean', description: 'Схлопывать одиночные безымянные узлы.' },
        skeleton: { type: 'boolean', description: 'Краткий обзор с children_count вместо полного дерева.' },
        root: { type: 'string', description: 'Начать с этого ref вместо корня окна.' },
        maxDepth: { type: 'number', description: 'Максимальная глубина дерева.' },
        surface: { type: 'string', description: 'Поверхность: window|focused|menu|taskbar|start-menu|system-tray|action-center и т.п.' },
        waitFor: { type: 'string', description: 'Селектор role:text, дождаться появления элемента перед снимком.' },
        timeoutMs: { type: 'number', description: 'Дедлайн наблюдения для этого вызова.' },
      },
      additionalProperties: false,
    },
    async (args, exec) => {
      const cliArgs = common(flagArgs([
        ['app', args.app],
        ['window-id', args.windowId],
        ['interactive-only', args.interactiveOnly === true],
        ['compact', args.compact === true],
        ['skeleton', args.skeleton === true],
        ['root', args.root],
        ['max-depth', args.maxDepth],
        ['surface', args.surface],
      ]), exec, { timeoutMs: args.timeoutMs, waitFor: args.waitFor });
      return toText(await runCli(config, 'snapshot', cliArgs, exec.signal, args.timeoutMs), config);
    },
  );

  tool(
    'desktop_find',
    'Найти элементы по role/name/value/text/description/nativeId (с опциональным app/windowId/root) и получить их refs. Быстрее полного snapshot, когда известно имя кнопки или поля.',
    {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Роль: button, textfield, checkbox, treeitem…' },
        name: { type: 'string', description: 'Accessible name или label.' },
        value: { type: 'string', description: 'Текущее значение элемента.' },
        text: { type: 'string', description: 'Текст в name/value/title/description.' },
        description: { type: 'string', description: 'Accessible description.' },
        nativeId: { type: 'string', description: 'Нативный automation id (AXIdentifier).' },
        app: { type: 'string', description: 'Фильтр по приложению.' },
        windowId: { type: 'string', description: 'Конкретное окно.' },
        root: { type: 'string', description: 'Искать только внутри поддерева этого ref.' },
        exact: { type: 'boolean', description: 'Точное совпадение name/description/value.' },
      },
      additionalProperties: false,
    },
    async (args, exec) => {
      const cliArgs = common(flagArgs([
        ['role', args.role],
        ['name', args.name],
        ['value', args.value],
        ['text', args.text],
        ['description', args.description],
        ['native-id', args.nativeId],
        ['app', args.app],
        ['window-id', args.windowId],
        ['root', args.root],
        ['exact', args.exact === true],
      ]), exec);
      return toText(await runCli(config, 'find', cliArgs, exec.signal), config);
    },
  );

  tool(
    'desktop_click',
    'Действовать на элемент по ref из свежего snapshot: клик, двойной/тройной/правый клик. Возвращает disposition (delivery/retry); после действия сделайте новый snapshot для проверки. STALE_REF/AMBIGUOUS_TARGET — повторите snapshot и возьмите новый ref.',
    {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Квалифицированный ref вида @s8f3k2p9:e8 из snapshot.' },
        kind: { type: 'string', enum: ['click', 'double-click', 'triple-click', 'right-click'], description: 'Тип клика.' },
        waitFor: { type: 'string', description: 'Селектор role:text, дождаться появления.' },
        timeoutMs: { type: 'number', description: 'Дедлайн этого вызова.' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const kind = ['click', 'double-click', 'triple-click', 'right-click'].includes(args.kind) ? args.kind : 'click';
      const cliArgs = common(flagArgs([]), exec, { timeoutMs: args.timeoutMs, waitFor: args.waitFor });
      return toText(await runCli(config, kind, [String(args.ref), ...cliArgs], exec.signal, args.timeoutMs), config);
    },
  );

  tool(
    'desktop_type',
    'Ввести текст в элемент по ref (snapshotный ref, текстовое поле). Для замены значения целиком используйте desktop_set_value.',
    {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref текстового поля из snapshot.' },
        text: { type: 'string', description: 'Текст для ввода.' },
        timeoutMs: { type: 'number', description: 'Дедлайн этого вызова.' },
      },
      required: ['ref', 'text'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const cliArgs = common(flagArgs([]), exec, { timeoutMs: args.timeoutMs });
      return toText(await runCli(config, 'type', [String(args.ref), String(args.text), ...cliArgs], exec.signal, args.timeoutMs), config);
    },
  );

  tool(
    'desktop_set_value',
    'Установить значение элемента напрямую через accessibility-атрибут (поля, слайдеры). Не имитирует клавиатуру; проверяйте новый snapshot после.',
    {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref элемента из snapshot.' },
        value: { type: 'string', description: 'Новое значение.' },
      },
      required: ['ref', 'value'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const cliArgs = common(flagArgs([]), exec);
      return toText(await runCli(config, 'set-value', [String(args.ref), String(args.value), ...cliArgs], exec.signal), config);
    },
  );

  tool(
    'desktop_press',
    'Отправить клавиатурную комбинацию: return, escape, cmd+c, shift+tab и т.п. Можно направить в приложение по имени без фокуса (app/windowId). Опасные комбинации требуют force=true.',
    {
      type: 'object',
      properties: {
        combo: { type: 'string', description: 'Комбинация: return|escape|ctrl+c|shift+tab…' },
        app: { type: 'string', description: 'Целевое приложение (без фокуса).' },
        windowId: { type: 'string', description: 'Окно приложения, если инстансов несколько.' },
        force: { type: 'boolean', description: 'Разрешить потенциально опасную комбинацию.' },
      },
      required: ['combo'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const cliArgs = common(flagArgs([
        ['app', args.app],
        ['window-id', args.windowId],
        ['force', args.force === true],
      ]), exec);
      return toText(await runCli(config, 'press', [String(args.combo), ...cliArgs], exec.signal), config);
    },
  );

  tool(
    'desktop_screenshot',
    'PNG-скриншот окна приложения или экрана. Без path сохраняет во временный файл и возвращает путь (base64 в контекст не льётся). Скриншоты могут содержать приватные данные.',
    {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Приложение.' },
        windowId: { type: 'string', description: 'Окно.' },
        screen: { type: 'number', description: 'Индекс экрана (0 — основной).' },
        path: { type: 'string', description: 'Куда сохранить PNG (по умолчанию временный файл).' },
      },
      additionalProperties: false,
    },
    async (args, exec) => {
      const target = typeof args.path === 'string' && args.path !== '' ? args.path : join(tmpdir(), `dsh-agent-desktop-${Date.now()}.png`);
      const cliArgs = common(flagArgs([
        ['app', args.app],
        ['window-id', args.windowId],
        ['screen', args.screen],
      ]), exec);
      const envelope = await runCli(config, 'screenshot', [target, ...cliArgs], exec.signal);
      return toText(envelope, config, { savedPath: target });
    },
  );

  tool(
    'desktop_clipboard',
    'Клипборд: get (text|auto|image|file-urls), set текст или PNG, либо clear. Путь к изображению при get возвращается в data.',
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'clear'], description: 'Действие.' },
        text: { type: 'string', description: 'Текст для set.' },
        format: { type: 'string', description: 'Формат для get: text|auto|image|file-urls.' },
        out: { type: 'string', description: 'Куда сохранить изображение при get image.' },
        image: { type: 'string', description: 'PNG-файл для set (вместо text).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async (args, exec) => {
      if (args.action === 'get') {
        const cliArgs = flagArgs([['format', args.format], ['out', args.out]]);
        return toText(await runCli(config, 'clipboard-get', cliArgs, exec.signal), config);
      }
      if (args.action === 'clear') return toText(await runCli(config, 'clipboard-clear', [], exec.signal), config);
      const cliArgs = flagArgs([['image', args.image]]);
      const argv = typeof args.text === 'string' && args.text !== '' ? [args.text, ...cliArgs] : cliArgs;
      return toText(await runCli(config, 'clipboard-set', argv, exec.signal), config);
    },
  );

  tool(
    'desktop_wait',
    'Подождать: миллисекунды, появление элемента по ref, окна с заголовком, текста в дереве приложения или открытого меню.',
    {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Пауза в миллисекундах.' },
        element: { type: 'string', description: 'Ref, появление которого ждать.' },
        window: { type: 'string', description: 'Заголовок окна.' },
        text: { type: 'string', description: 'Текст в accessibility-дереве.' },
        menu: { type: 'boolean', description: 'Ждать открытия меню.' },
      },
      additionalProperties: false,
    },
    async (args, exec) => {
      const positionals = Number.isSafeInteger(args.ms) && args.ms > 0 ? [String(args.ms)] : [];
      const cliArgs = common(flagArgs([
        ['element', args.element],
        ['window', args.window],
        ['text', args.text],
        ['menu', args.menu === true],
      ]), exec);
      return toText(await runCli(config, 'wait', [...positionals, ...cliArgs], exec.signal, Number.isSafeInteger(args.ms) ? args.ms + 5000 : undefined), config);
    },
  );

  tool(
    'desktop_batch',
    'Выполнить последовательный пакет CLI-команд одним вызовом: [{command,args},…]. Не атомарно; с stopOnError=true останавливается на первой ошибке. Полезно для цепочки observe→act без лишних раундов.',
    {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          description: 'Массив {command: string, args: string[]}.',
          items: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              args: { type: 'array', items: { type: 'string' } },
            },
            required: ['command'],
            additionalProperties: false,
          },
        },
        stopOnError: { type: 'boolean', description: 'Остановиться на первой ошибке.' },
        timeoutMs: { type: 'number', description: 'Общий бюджет пакета.' },
      },
      required: ['commands'],
      additionalProperties: false,
    },
    async (args, exec) => {
      const commands = Array.isArray(args.commands) ? args.commands : [];
      const payload = commands.map((item) => ({ command: String(item.command), args: Array.isArray(item.args) ? item.args.map(String) : [] }));
      const cliArgs = common(flagArgs([['stop-on-error', args.stopOnError === true]]), exec);
      return toText(await runCli(config, 'batch', [JSON.stringify(payload), ...cliArgs], exec.signal, args.timeoutMs), config);
    },
  );

  tool(
    'desktop_skills',
    'Встроенная документация CLI (desktop — цикл observe/act/verify, platform — отличия ОС, ffi — C API). Прочитайте desktop и platform перед первой серией действий.',
    {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: ['desktop', 'platform', 'ffi'], description: 'Раздел справки.' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
    async (args) => {
      const topic = ['desktop', 'platform', 'ffi'].includes(args.topic) ? args.topic : 'desktop';
      return toText(await runCli(config, 'skills', ['get', topic], undefined), config);
    },
  );

  if (config.allowRaw) {
    tool(
      'desktop_raw',
      `Прямой вызов CLI agent-desktop для команд без отдельной обёртки (всего ${COMMANDS.length} команд: scroll, drag, hover, launch, окна, уведомления и т.п.). command — имя команды, args — массив строковых аргументов (как в CLI), например command:"scroll", args:["@s:e3","--dy","-400"].`,
      {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Имя CLI-команды.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Аргументы CLI строкой.' },
          timeoutMs: { type: 'number', description: 'Дедлайн вызова.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
      async (args, exec) => {
        const command = String(args.command ?? '');
        if (!COMMANDS.includes(command)) throw new Error(`agent-desktop: команда "${command}" недоступна; разрешены: ${COMMANDS.join(', ')}`);
        if (REFUSED.has(command)) throw new Error(`agent-desktop: ${command} требует daemon для удержания клавиши/кнопки и не поддерживается`);
        const cliArgs = Array.isArray(args.args) ? args.args.map(String) : [];
        return toText(await runCli(config, command, cliArgs, exec.signal, args.timeoutMs), config);
      },
    );
  }
}
