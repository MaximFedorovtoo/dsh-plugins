#!/usr/bin/env node
/**
 * Bundled `desktop` MCP server for dsh-superuser.
 *
 * A dependency-free stdio MCP server (JSON-RPC 2.0, newline-delimited) that
 * exposes desktop automation through the already-installed `agent-desktop`
 * npm CLI. The CLI reads and operates desktop applications through the OS
 * accessibility tree, so every tool here is a thin, well-described wrapper
 * around one CLI command:
 *
 *   apps / windows / snapshot / click / type / press / screenshot / scroll
 *   plus find, wait and set_value for the common observe→act loop.
 *
 * The CLI is resolved exactly like `dsh-agent-desktop` does on Windows: an
 * explicit `AGENT_DESKTOP_BINARY`, then the native platform binary inside the
 * profile's `node_modules/agent-desktop/bin`, then the JS launcher run through
 * a plain Node executable. Read-only tools (apps, windows, snapshot, screenshot,
 * find) never focus a window and never move the pointer: the CLI runs headless
 * unless an action tool asks otherwise.
 *
 * No UAC or OS-permission handling is invented here; the CLI reports its own
 * permission failures and they are surfaced verbatim.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/** MCP server identity. */
const SERVER_NAME = 'dsh-superuser-desktop';
const SERVER_VERSION = '1.0.0';

/** Supported MCP protocol revisions, newest first. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Default wall-clock budget for one CLI call. */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Application this server creates itself for. When the hub is asked to make an
 * MCP server "for a selected application", it passes the application name in
 * `DSH_MCP_TARGET_APP`; every app-scoped tool then uses that application when
 * the caller omits `app`, and the server refuses to act when it is not running.
 * Without the variable the server is a generic desktop server (unchanged).
 */
const TARGET_APP = (() => {
  const raw = process.env.DSH_MCP_TARGET_APP;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : '';
})();
const BOUND = TARGET_APP !== '';
const BOUND_SENTENCE = BOUND ? ` Bound to the application "${TARGET_APP}".` : '';

/** Clear user-facing error for a closed bound application. */
function boundAppError() {
  return new Error(`приложение "${TARGET_APP}" не запущено — запустите его и повторите`);
}

/**
 * Whether the bound application currently appears in `list-apps`. Checked on
 * every app-scoped call (the CLI inventory is cheap), so the app may be started
 * (or closed) later without reconnecting the server. Matching is
 * case-insensitive, with or without the `.exe` suffix.
 * @returns {Promise<void>} resolves while the bound application is running.
 */
async function ensureBoundAppRunning() {
  const envelope = await runCli('list-apps', [], 15000);
  const apps = envelope.ok === true && Array.isArray(envelope.data?.apps) ? envelope.data.apps : [];
  const normalize = (value) => String(value).trim().toLowerCase().replace(/\.exe$/u, '');
  const wanted = normalize(TARGET_APP);
  const running = apps.some((app) => normalize(app?.name) === wanted);
  if (!running) throw boundAppError();
}

/**
 * Resolve the application one tool call should act on.
 * An explicit `app` from the caller always wins (`"*"` means "no filter");
 * otherwise the bound application applies when the server has one.
 * @param {object} args - tool arguments.
 * @returns {{ app: string | undefined, explicit: boolean }} resolved target.
 */
function appDefault(args) {
  const raw = args !== null && typeof args === 'object' && typeof args.app === 'string' ? args.app.trim() : '';
  if (raw === '*') return { app: undefined, explicit: true };
  if (raw !== '') return { app: raw, explicit: true };
  return { app: BOUND ? TARGET_APP : undefined, explicit: false };
}

/**
 * Refuse ref-based tools when the bound application was closed.
 * @param {{ app: string | undefined, explicit: boolean }} target - resolved application.
 * @returns {Promise<void>}
 */
async function guardBound(target) {
  if (BOUND && !target.explicit) await ensureBoundAppRunning();
}

/**
 * Run one CLI call with a binding-aware error message.
 * @param {string} command - CLI command.
 * @param {string[]} args - CLI arguments.
 * @param {number | undefined} timeoutMs - budget.
 * @param {{ app: string | undefined, explicit: boolean }} target - resolved application.
 * @returns {Promise<object>} CLI envelope.
 */
async function runBound(command, args, timeoutMs, target) {
  try {
    return await runCli(command, args, timeoutMs);
  } catch (error) {
    if (BOUND && !target.explicit && target.app === TARGET_APP) {
      throw new Error(`${compact(error.message)} (bound application "${TARGET_APP}")`);
    }
    throw error;
  }
}

/**
 * Append the binding sentence to one tool description.
 * @param {string} description - base description.
 * @returns {string} description shown to the model.
 */
function withBinding(description) {
  return BOUND ? `${description}${BOUND_SENTENCE}` : description;
}


/** @returns {string} DSH home directory. */
function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
}

/** @returns {string} profile directory that holds node_modules. */
function profileDir() {
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    return process.env.DSH_PROFILE_DIR;
  }
  return join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'desktop');
}

/** @returns {string} plain Node executable for the JS launcher fallback. */
function nodeExecutable() {
  const fromEnv = process.env.DSH_DESKTOP_NODE_EXECUTABLE;
  if (typeof fromEnv === 'string' && fromEnv !== '' && existsSync(fromEnv)) return fromEnv;
  if (typeof process.resourcesPath === 'string') {
    const candidate = join(
      process.resourcesPath,
      'runtime',
      'primary-runtime',
      'dependencies',
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node',
    );
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
 * Resolve the agent-desktop CLI executable.
 * @returns {{ exe: string, prefix: string[] }} spawn target.
 */
function resolveCli() {
  const configured = process.env.AGENT_DESKTOP_BINARY;
  if (typeof configured === 'string' && configured !== '' && existsSync(configured)) {
    return { exe: configured, prefix: [] };
  }
  const packageDir = join(profileDir(), 'node_modules', 'agent-desktop');
  const binaryName = platformBinaryName();
  if (binaryName !== undefined) {
    const native = join(packageDir, 'bin', binaryName);
    if (existsSync(native)) return { exe: native, prefix: [] };
  }
  const launcher = join(packageDir, 'bin', 'agent-desktop');
  if (existsSync(launcher)) return { exe: nodeExecutable(), prefix: [launcher] };
  throw new Error(
    'agent-desktop CLI is not installed in this profile: expected ' +
      `${join(packageDir, 'bin')} (install agent-desktop in the profile, e.g. from the dsh-agent-desktop plugin)`,
  );
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

/** One-line compact error message. */
function compact(message) {
  const text = String(message ?? '').replace(/\s+/gu, ' ').trim();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/**
 * Run one CLI command and return its parsed JSON envelope.
 * @param {string} command - CLI command name.
 * @param {string[]} args - positional/flag arguments.
 * @param {number | undefined} timeoutMs - per-call budget.
 * @returns {Promise<object>} parsed envelope `{ ok, data?, error? }`.
 */
function runCli(command, args, timeoutMs) {
  const { exe, prefix } = resolveCli();
  const budget = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const argv = [...prefix, command, ...args];
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(exe, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const stream of [child.stdout, child.stderr]) if (stream !== null) stream.destroy();
      if (error !== undefined) rejectPromise(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error(`agent-desktop: ${command} timed out after ${budget} ms`));
    }, Math.min(2147483647, budget + 5000));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish(new Error(`agent-desktop: cannot start the CLI (${exe}): ${compact(error.message)}`));
    });
    child.on('close', () => {
      const lines = stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== '');
      let parsed;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (!lines[index].startsWith('{')) continue;
        try {
          parsed = JSON.parse(lines[index]);
          break;
        } catch {
          // keep looking for the envelope
        }
      }
      if (parsed === undefined) {
        const detail = compact(stderr.trim() || stdout.trim() || 'empty output');
        finish(new Error(`agent-desktop: the CLI returned no JSON for ${command}: ${detail}`));
        return;
      }
      finish(undefined, parsed);
    });
  });
}

/**
 * Format one CLI envelope as tool text; a failed envelope throws so the MCP
 * layer reports `isError: true`.
 * @param {object} envelope - parsed CLI envelope.
 * @returns {string} text for the model.
 */
function envelopeText(envelope) {
  if (envelope.ok !== true) {
    const error = envelope.error ?? {};
    const code = typeof error.code === 'string' ? error.code : 'ERROR';
    const message = typeof error.message === 'string' ? error.message : 'the command failed';
    const suggestion = typeof error.suggestion === 'string' && error.suggestion !== '' ? ` — ${error.suggestion}` : '';
    throw new Error(`${code}: ${message}${suggestion}`);
  }
  const value = envelope.data ?? envelope;
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length > 60000) text = `${text.slice(0, 60000)}\n… output truncated (${text.length} characters)`;
  return text;
}

/** @returns {string} a fresh PNG path under the OS temporary directory. */
function screenshotPath() {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return join(tmpdir(), `dsh-superuser-${stamp}.png`);
}

/** Uniform MCP tool result. */
function ok(text) {
  return { content: [{ type: 'text', text }] };
}

/** Uniform MCP error result. */
function fail(message) {
  return { content: [{ type: 'text', text: compact(message) }], isError: true };
}

/**
 * Tool table. Every `run` receives the parsed arguments object and returns the
 * MCP tool result; read-only entries never focus a window.
 * @type {Array<{ name: string, title: string, description: string, inputSchema: object, readOnly: boolean, run: (args: object) => Promise<object> }>}
 */
const TOOLS = [
  {
    name: 'apps',
    title: 'Applications',
    description:
      'List running GUI applications (windows=false) or visible windows (windows=true), optionally filtered by app name. Start here to choose the `app` for snapshot. Read-only: does not focus any window.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        windows: { type: 'boolean', description: 'true lists visible windows; false lists running applications (default).' },
        app: { type: 'string', description: 'Filter by application name.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      const command = args.windows === true ? 'list-windows' : 'list-apps';
      return ok(envelopeText(await runBound(command, flagArgs([['app', target.app]]), undefined, target)));
    },
  },
  {
    name: 'windows',
    title: 'Windows',
    description:
      'List visible windows of running applications (title, app, windowId), optionally filtered by app name. Read-only: does not focus any window.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string', description: 'Filter by application name.' } },
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      return ok(envelopeText(await runBound('list-windows', flagArgs([['app', target.app]]), undefined, target)));
    },
  },
  {
    name: 'snapshot',
    title: 'Snapshot',
    description:
      'Snapshot an application accessibility tree. Every element gets a stable ref like @<snapshot>:eN for click/type/press/scroll. Returns JSON with data.tree, snapshot_id and complete. Refs are valid only for their snapshot: take a fresh one after the UI changes. Read-only: does not focus any window or move the pointer.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Application name from apps.' },
        windowId: { type: 'string', description: 'Specific window id from apps with windows=true.' },
        interactiveOnly: { type: 'boolean', description: 'Only interactive elements.' },
        compact: { type: 'boolean', description: 'Collapse single unnamed wrapper nodes.' },
        skeleton: { type: 'boolean', description: 'Brief overview with children_count instead of the full tree.' },
        root: { type: 'string', description: 'Start from this ref instead of the window root.' },
        maxDepth: { type: 'number', description: 'Maximum tree depth.' },
        surface: {
          type: 'string',
          description: 'Surface to snapshot: window|focused|menu|taskbar|start-menu|system-tray|action-center, etc.',
        },
        waitFor: { type: 'string', description: 'role:text selector to wait for before snapshotting.' },
        timeoutMs: { type: 'number', description: 'Deadline for this call.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      const cliArgs = [
        ...flagArgs([
          ['app', target.app],
          ['window-id', args.windowId],
          ['interactive-only', args.interactiveOnly === true],
          ['compact', args.compact === true],
          ['skeleton', args.skeleton === true],
          ['root', args.root],
          ['max-depth', args.maxDepth],
          ['surface', args.surface],
          ['wait-for', args.waitFor],
        ]),
      ];
      if (Number.isSafeInteger(args.timeoutMs) && args.timeoutMs > 0) cliArgs.push('--timeout-ms', String(args.timeoutMs));
      return ok(envelopeText(await runBound('snapshot', cliArgs, args.timeoutMs, target)));
    },
  },
  {
    name: 'click',
    title: 'Click',
    description:
      'Act on an element by ref from a fresh snapshot: click, double-click, triple-click or right-click. Returns a delivery disposition; take a new snapshot afterwards to verify. STALE_REF/AMBIGUOUS_TARGET means: snapshot again and use the new ref.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Qualified ref like @s8f3k2p9:e8 from snapshot.' },
        kind: {
          type: 'string',
          enum: ['click', 'double-click', 'triple-click', 'right-click'],
          description: 'Click kind (default click).',
        },
        waitFor: { type: 'string', description: 'role:text selector to wait for first.' },
        timeoutMs: { type: 'number', description: 'Deadline for this call.' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      const kind = ['click', 'double-click', 'triple-click', 'right-click'].includes(args.kind) ? args.kind : 'click';
      const cliArgs = [];
      if (typeof args.waitFor === 'string' && args.waitFor !== '') cliArgs.push('--wait-for', args.waitFor);
      if (Number.isSafeInteger(args.timeoutMs) && args.timeoutMs > 0) cliArgs.push('--timeout-ms', String(args.timeoutMs));
      return ok(envelopeText(await runBound(kind, [String(args.ref), ...cliArgs], args.timeoutMs, target)));
    },
  },
  {
    name: 'type',
    title: 'Type',
    description:
      'Type text into an element by snapshot ref (usually a text field). Use set_value to replace a value directly through the accessibility attribute instead.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the text field from snapshot.' },
        text: { type: 'string', description: 'Text to type.' },
        timeoutMs: { type: 'number', description: 'Deadline for this call.' },
      },
      required: ['ref', 'text'],
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      const cliArgs = Number.isSafeInteger(args.timeoutMs) && args.timeoutMs > 0 ? ['--timeout-ms', String(args.timeoutMs)] : [];
      return ok(envelopeText(await runBound('type', [String(args.ref), String(args.text), ...cliArgs], args.timeoutMs, target)));
    },
  },
  {
    name: 'press',
    title: 'Press keys',
    description:
      'Send a keyboard combination: return, escape, ctrl+c, shift+tab, and so on. It can be directed at an application by name without focusing it (app/windowId). Potentially dangerous combinations require force=true.',
    inputSchema: {
      type: 'object',
      properties: {
        combo: { type: 'string', description: 'Combination: return|escape|ctrl+c|shift+tab…' },
        app: { type: 'string', description: 'Target application (without focusing it).' },
        windowId: { type: 'string', description: 'Target window when the app has several.' },
        force: { type: 'boolean', description: 'Allow a potentially dangerous combination.' },
      },
      required: ['combo'],
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      return ok(
        envelopeText(
          await runBound(
            'press',
            [
              String(args.combo),
              ...flagArgs([
                ['app', target.app],
                ['window-id', args.windowId],
                ['force', args.force === true],
              ]),
            ],
            undefined,
            target,
          ),
        ),
      );
    },
  },
  {
    name: 'screenshot',
    title: 'Screenshot',
    description:
      'PNG screenshot of an application window or a whole screen; returns the saved file path. Without `path` the image is written to the OS temporary directory (the base64 bytes never enter the model context). Read-only: does not focus the window.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Application name.' },
        windowId: { type: 'string', description: 'Window id.' },
        screen: { type: 'number', description: 'Screen index (0 is the primary screen).' },
        path: { type: 'string', description: 'Where to save the PNG (default: a temporary file).' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      const path = typeof args.path === 'string' && args.path !== '' ? args.path : screenshotPath();
      const envelope = await runBound(
        'screenshot',
        [
          path,
          ...flagArgs([
            ['app', target.app],
            ['window-id', args.windowId],
            ['screen', args.screen],
          ]),
        ],
        undefined,
        target,
      );
      const text = envelopeText(envelope);
      return ok(`${text}\n\nsavedPath: ${path}`);
    },
  },
  {
    name: 'scroll',
    title: 'Scroll',
    description:
      'Scroll inside an element by ref from a snapshot: direction up/down/left/right and amount of scroll units. Returns the delivery disposition; snapshot again to verify.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the scrollable element from snapshot.' },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction (default down).',
        },
        amount: { type: 'number', description: 'Number of scroll units (default 3).' },
        timeoutMs: { type: 'number', description: 'Deadline for this call.' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      const direction = ['up', 'down', 'left', 'right'].includes(args.direction) ? args.direction : 'down';
      const cliArgs = [
        String(args.ref),
        ...flagArgs([
          ['direction', direction],
          ['amount', args.amount],
        ]),
      ];
      if (Number.isSafeInteger(args.timeoutMs) && args.timeoutMs > 0) cliArgs.push('--timeout-ms', String(args.timeoutMs));
      return ok(envelopeText(await runBound('scroll', cliArgs, args.timeoutMs, target)));
    },
  },
  {
    name: 'find',
    title: 'Find',
    description:
      'Find elements by role/name/value/text/description/nativeId (optionally within app/windowId/root) and get their refs. Faster than a full snapshot when you know the button or field name. Read-only: does not focus any window.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role: button, textfield, checkbox, treeitem…' },
        name: { type: 'string', description: 'Accessible name or label.' },
        value: { type: 'string', description: 'Current value.' },
        text: { type: 'string', description: 'Text in name/value/title/description.' },
        description: { type: 'string', description: 'Accessible description.' },
        nativeId: { type: 'string', description: 'Native automation id.' },
        app: { type: 'string', description: 'Application filter.' },
        windowId: { type: 'string', description: 'Window filter.' },
        root: { type: 'string', description: 'Search only inside this ref subtree.' },
        exact: { type: 'boolean', description: 'Exact name/description/value match.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      return ok(
        envelopeText(
          await runBound(
            'find',
            flagArgs([
              ['role', args.role],
              ['name', args.name],
              ['value', args.value],
              ['text', args.text],
              ['description', args.description],
              ['native-id', args.nativeId],
              ['app', target.app],
              ['window-id', args.windowId],
              ['root', args.root],
              ['exact', args.exact === true],
            ]),
            undefined,
            target,
          ),
        ),
      );
    },
  },
  {
    name: 'wait',
    title: 'Wait',
    description:
      'Wait for milliseconds, for an element ref to appear, for a window title, for text in an application tree, or for a menu to open.',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Pause in milliseconds.' },
        element: { type: 'string', description: 'Ref to wait for.' },
        window: { type: 'string', description: 'Window title to wait for.' },
        text: { type: 'string', description: 'Text to appear in the accessibility tree.' },
        menu: { type: 'boolean', description: 'Wait for a menu to open.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      const positional = Number.isSafeInteger(args.ms) && args.ms > 0 ? [String(args.ms)] : [];
      const budget = Number.isSafeInteger(args.ms) && args.ms > 0 ? args.ms + 5000 : undefined;
      return ok(
        envelopeText(
          await runBound(
            'wait',
            [
              ...positional,
              ...flagArgs([
                ['element', args.element],
                ['window', args.window],
                ['text', args.text],
                ['menu', args.menu === true],
              ]),
            ],
            budget,
            target,
          ),
        ),
      );
    },
  },
  {
    name: 'set_value',
    title: 'Set value',
    description:
      'Set an element value directly through its accessibility attribute (fields, sliders). It does not emulate the keyboard; take a new snapshot to verify.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot.' },
        value: { type: 'string', description: 'New value.' },
      },
      required: ['ref', 'value'],
      additionalProperties: false,
    },
    async run(args) {
      const target = appDefault(args);
      await guardBound(target);
      return ok(envelopeText(await runBound('set-value', [String(args.ref), String(args.value)], undefined, target)));
    },
  },
];

/** Lookup by tool name. */
const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Announce the tool catalog in MCP form. */
function toolCatalog() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: withBinding(tool.description),
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: tool.readOnly === true },
  }));
}

/** Write one JSON-RPC message to stdout as a single line. */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** One JSON-RPC success response. */
function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

/** One JSON-RPC error response. */
function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: compact(message) } });
}

/**
 * Dispatch one parsed JSON-RPC message.
 * @param {any} message - parsed request or notification.
 * @returns {Promise<void>}
 */
async function dispatch(message) {
  if (message === null || typeof message !== 'object') return;
  const hasId = message.id !== undefined && message.id !== null;
  const method = typeof message.method === 'string' ? message.method : undefined;
  if (method === undefined) return; // a response to a server-initiated request: ignore
  if (!hasId) {
    // Notifications (initialized, cancelled, progress…) need no answer.
    return;
  }
  try {
    if (method === 'initialize') {
      const requested = message.params?.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1];
      const instructions = BOUND
        ? `Desktop automation server created for the application "${TARGET_APP}". Every app-scoped tool uses "${TARGET_APP}" when the caller omits app (pass app:"*" to lift the filter where the tool supports it); ref-based tools expect refs from a snapshot of that application. Starting the application later needs no reconnect: each call detects whether it is running and returns a clear error while it is not. Read-only tools never focus windows.`
        : 'Desktop automation server for any running application. Prefer read-only tools (apps, windows, snapshot, screenshot, find) before acting: read-only tools never focus windows and never move the pointer.';
      respond(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: BOUND ? `${SERVER_NAME}:${TARGET_APP}` : SERVER_NAME,
          version: SERVER_VERSION,
        },
        instructions,
      });
      return;
    }
    if (method === 'ping') {
      respond(message.id, {});
      return;
    }
    if (method === 'tools/list') {
      respond(message.id, { tools: toolCatalog() });
      return;
    }
    if (method === 'tools/call') {
      const name = message.params?.name;
      const tool = TOOL_BY_NAME.get(name);
      if (tool === undefined) {
        respond(message.id, fail(`unknown tool "${String(name)}"; available: ${TOOLS.map((entry) => entry.name).join(', ')}`));
        return;
      }
      const args = message.params?.arguments !== null && typeof message.params?.arguments === 'object' ? message.params.arguments : {};
      try {
        respond(message.id, await tool.run(args));
      } catch (error) {
        respond(message.id, fail(error instanceof Error ? error.message : String(error)));
      }
      return;
    }
    if (method === 'resources/list') {
      respond(message.id, { resources: [] });
      return;
    }
    if (method === 'resources/templates/list') {
      respond(message.id, { resourceTemplates: [] });
      return;
    }
    if (method === 'prompts/list') {
      respond(message.id, { prompts: [] });
      return;
    }
    respondError(message.id, -32601, `method not found: ${method}`);
  } catch (error) {
    respondError(message.id, -32603, error instanceof Error ? error.message : String(error));
  }
}

/** Serve newline-delimited JSON-RPC on stdin/stdout until stdin closes. */
function serve() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== '') {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          // Ignore malformed lines: a broken frame must not kill the server.
          parsed = undefined;
        }
        if (parsed !== undefined) void dispatch(parsed);
      }
      index = buffer.indexOf('\n');
    }
  });
  process.stdin.on('end', () => {
    process.exit(0);
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

if (process.argv[2] === '--list-tools') {
  process.stdout.write(`${JSON.stringify(toolCatalog(), null, 2)}\n`);
} else {
  serve();
}
