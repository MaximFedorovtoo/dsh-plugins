/**
 * dsh-unslop — de-AI writing for DSH agents.
 *
 * Vendors the theclaymethod/unslop skill (MIT): deterministic scanners for
 * AI-writing tells (phrase / structure / silhouette), fact-preservation gates,
 * suggestion checks, and an LLM rewrite that must pass the preservation gate.
 *
 * All Python scripts are standard-library only and run with DSH's bundled
 * Python; the plugin itself has no npm dependencies.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Plugin row name in `cordis.patch.yml`. */
export const name = 'unslop';
/** Host services this plugin uses. */
export const inject = ['tools', 'llm'];

/** Plugin directory. */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
/** Default scripts directory shipped with the plugin. */
const DEFAULT_SCRIPTS = join(PLUGIN_DIR, 'python', 'scripts');

/** @returns {string} DSH home. */
function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
}

/** @returns {string} bundled Python executable. */
function resolvePython(config) {
  if (typeof config.pythonPath === 'string' && config.pythonPath !== '' && existsSync(config.pythonPath)) return config.pythonPath;
  if (typeof process.resourcesPath === 'string') {
    const exe = join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
    if (existsSync(exe)) return exe;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Normalize config.
 * @param {Record<string, unknown>} [raw] - row config.
 * @returns {object} config.
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    pythonPath: typeof source.pythonPath === 'string' ? source.pythonPath.trim() : '',
    scriptsRoot: typeof source.scriptsRoot === 'string' && source.scriptsRoot !== '' ? source.scriptsRoot : DEFAULT_SCRIPTS,
    timeoutMs: Number.isSafeInteger(source.timeoutMs) && source.timeoutMs > 0 ? source.timeoutMs : 60000,
    maxInputChars: Number.isSafeInteger(source.maxInputChars) && source.maxInputChars > 0 ? source.maxInputChars : 40000,
    maxOutputChars: Number.isSafeInteger(source.maxOutputChars) && source.maxOutputChars > 0 ? source.maxOutputChars : 40000,
    llmProvider: typeof source.llmProvider === 'string' && source.llmProvider !== '' ? source.llmProvider : 'deepseek-account',
    llmModel: typeof source.llmModel === 'string' && source.llmModel !== '' ? source.llmModel : 'deepseek-flash',
    maxTokens: Number.isSafeInteger(source.maxTokens) && source.maxTokens > 0 ? source.maxTokens : 4000,
  };
}

/** Strip ANSI escapes. */
function clean(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '').trim();
}

/**
 * Run one vendored Python script.
 * @param {object} config - plugin config.
 * @param {string} script - script file name.
 * @param {string[]} args - CLI arguments.
 * @param {string | undefined} stdin - text to pipe to stdin.
 * @param {AbortSignal | undefined} signal - cancellation.
 * @param {number} [timeoutOverride] - per-call timeout.
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} result.
 */
async function runScript(config, script, args, stdin, signal, timeoutOverride) {
  const python = resolvePython(config);
  const file = join(config.scriptsRoot, script);
  if (!existsSync(file)) throw new Error(`unslop: скрипт не найден: ${file}`);
  const timeoutMs = Number.isSafeInteger(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : config.timeoutMs;
  return await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(python, [file, ...args], {
      cwd: config.scriptsRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error('unslop: вызов отменён'));
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(new Error(`unslop: превышен таймаут ${timeoutMs} мс (${script})`));
    }, Math.min(2147483647, timeoutMs));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(new Error(`unslop: не удалось запустить Python (${python}): ${error.message}`)));
    child.on('close', (code) => finish(undefined, { code: code ?? 1, stdout, stderr }));
    if (stdin !== undefined) child.stdin.end(stdin, 'utf8');
    else child.stdin.end();
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Extract the largest JSON object from script output.
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
              // Not complete: keep scanning.
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

/** Read the input text from args.text or args.path. */
async function readInput(args, config) {
  if (typeof args.text === 'string' && args.text.trim() !== '') return { text: args.text, source: 'text' };
  if (typeof args.path === 'string' && args.path !== '') {
    const text = await readFile(args.path, 'utf8');
    return { text, source: args.path };
  }
  throw new Error('unslop: нужен параметр text или path');
}

/** Cap the input text and report truncation. */
function capInput(text, config) {
  if (text.length <= config.maxInputChars) return { text, truncated: false };
  return { text: text.slice(0, config.maxInputChars), truncated: true };
}

/** Write a UTF-8 temp file inside a private directory. */
async function writeTemp(dir, name, content) {
  const file = join(dir, name);
  await writeFile(file, content, 'utf8');
  return file;
}

/** Summarize scanner findings for the model. */
function summarizeScan(layers) {
  const summary = {};
  for (const [layer, result] of Object.entries(layers)) {
    if (result === undefined) continue;
    const json = result.json;
    if (json === undefined) {
      summary[layer] = { error: result.stderr || 'no JSON output', exit: result.code };
      continue;
    }
    if (layer === 'phrase') {
      summary[layer] = {
        total: json.total_violations ?? (Array.isArray(json.violations) ? json.violations.length : undefined),
        hard: json.hard_count ?? undefined,
        soft: json.soft_count ?? undefined,
        nonEnglish: json.non_english === true,
        violations: Array.isArray(json.violations) ? json.violations.slice(0, 40) : undefined,
      };
    } else if (layer === 'structure') {
      summary[layer] = {
        total: json.total_violations ?? undefined,
        flagged: Array.isArray(json.violations) ? json.violations.slice(0, 40) : undefined,
        metrics: json.metrics ?? undefined,
        genre: json.genre ?? undefined,
      };
    } else {
      summary[layer] = json;
    }
  }
  return summary;
}

/**
 * Scan text with the requested layers.
 * @returns {Promise<object>} layer results keyed by name.
 */
async function scanText(config, input, options, signal) {
  const layers = {};
  const want = Array.isArray(options.layers) && options.layers.length > 0 ? options.layers : ['phrase', 'structure', 'silhouette'];
  for (const layer of want) {
    if (layer === 'phrase') {
      const args = [...(options.genre ? ['--genre', options.genre] : []), ...(options.includeQuoted ? ['--include-quoted'] : [])];
      const result = await runScript(config, 'banned_phrase_scan.py', args, input.text, signal);
      layers.phrase = { code: result.code, json: extractJson(result.stdout), stdout: clean(result.stdout).slice(0, 4000), stderr: clean(result.stderr) };
    } else if (layer === 'structure') {
      const args = options.genre ? ['--genre', options.genre] : [];
      const result = await runScript(config, 'structure_scan.py', args, input.text, signal);
      layers.structure = { code: result.code, json: extractJson(result.stdout), stdout: clean(result.stdout).slice(0, 4000), stderr: clean(result.stderr) };
    } else if (layer === 'silhouette') {
      const args = options.genre ? ['--genre', options.genre] : [];
      const result = await runScript(config, 'silhouette_scan.py', args, input.text, signal);
      layers.silhouette = { code: result.code, json: extractJson(result.stdout), stdout: clean(result.stdout).slice(0, 4000), stderr: clean(result.stderr) };
    }
  }
  return layers;
}

/**
 * Call the LLM for the rewrite.
 * @returns {Promise<string>} rewritten text.
 */
async function rewriteWithLlm(ctx, config, payload, signal) {
  const llm = ctx.get('llm');
  if (llm === undefined || typeof llm.stream !== 'function') throw new Error('unslop: сервис llm недоступен');
  const system = [
    'You are UNSLOP, an editor that removes formulaic AI writing while preserving meaning and voice.',
    'Return ONLY the rewritten text — no commentary, no headings, no code fences.',
    'Rules:',
    '- Cut throat-clearing openers, emphasis crutches, significance inflation, negative parallelism, wh-question self-answers, chatbot residue, emoji headers, reasoning-chain leaks, business jargon.',
    '- Keep every number, name, date, unit, quote, negation and scope word exactly as in the original. Never change magnitude ($47.3M must not become $47.3 billion).',
    '- Do not touch register hedges, legal/medical/security/scientific qualifiers, literal domain vocabulary, quoted examples or code fences.',
    '- Do not add new facts, examples, statistics or claims. Do not add personality.',
    '- Prefer direct prose over bullet lists unless the genre genuinely calls for lists (docs).',
    '- If the text is already clean, return it unchanged (byte for byte where possible).',
    '- English only. If the input is not English, return it unchanged.',
    '',
    'The original scan findings and the extracted factual constraints follow. Use the findings to decide what to fix; use the constraints to know what must survive.',
  ].join('\n');
  const user = [
    `Scan findings: ${JSON.stringify(payload.summary)}`,
    `Protected constraints: ${JSON.stringify(payload.constraints)}`,
    '',
    '--- ORIGINAL TEXT ---',
    payload.text,
  ].join('\n');
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
  let output = '';
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text;
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') throw new Error(chunk.reason.failure?.message ?? 'unslop: LLM упал');
  }
  return output.trim();
}

/**
 * Register the unslop tools.
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
      `unslop: ${toolName}`,
    );
  };

  const textSchema = {
    text: { type: 'string', description: 'Текст для анализа (приоритетнее path).' },
    path: { type: 'string', description: 'Путь к UTF-8 файлу, если текст не передан.' },
    genre: { type: 'string', description: 'Жанр для carve-outs: prose|docs|social|academic.' },
  };

  tool(
    'unslop_scan',
    'Детерминированные сканеры AI-паттернов unslop: phrase (16 триггеров), structure (36 паттернов и метрики ритма), silhouette (расположение идей). Возвращает JSON по слоям: violations, severity, метрики, non_english. Это находки-кандидаты, а не приговор: агент проверяет каждое место в контексте.',
    {
      type: 'object',
      properties: {
        ...textSchema,
        layers: { type: 'array', items: { type: 'string', enum: ['phrase', 'structure', 'silhouette'] }, description: 'Слои (по умолчанию все три).' },
        includeQuoted: { type: 'boolean', description: 'phrase: аудировать также цитаты и код-фенсы.' },
      },
      additionalProperties: false,
    },
    async (args, exec) => {
      const input = await readInput(args, config);
      const capped = capInput(input.text, config);
      const layers = await scanText(config, capped, args, exec.signal);
      return JSON.stringify({ source: input.source, inputChars: capped.text.length, truncated: capped.truncated, layers: summarizeScan(layers) }, null, 2);
    },
  );

  tool(
    'unslop_constraints',
    'Извлечь охраняемые факты из текста (числа, имена, даты, единицы, ссылки, and/or) через extract_constraints.py. Это список того, что обязан сохранить rewrite.',
    {
      type: 'object',
      properties: { ...textSchema },
      additionalProperties: false,
    },
    async (args, exec) => {
      const input = await readInput(args, config);
      const capped = capInput(input.text, config);
      const result = await runScript(config, 'extract_constraints.py', [], capped.text, exec.signal);
      const json = extractJson(result.stdout);
      if (json === undefined) throw new Error(`unslop_constraints: ${clean(result.stderr) || 'нет JSON'}`);
      return JSON.stringify({ source: input.source, ...json }, null, 2);
    },
  );

  tool(
    'unslop_validate',
    'Проверить сохранение фактов между оригиналом и переписанным текстом (validate_preservation.py). strict — для юридических/медицинских/научных текстов: потеря даже мягкого ограничителя становится ошибкой.',
    {
      type: 'object',
      properties: {
        original: { type: 'string', description: 'Исходный текст.' },
        originalPath: { type: 'string', description: 'Путь к исходному тексту.' },
        transformed: { type: 'string', description: 'Переписанный текст.' },
        transformedPath: { type: 'string', description: 'Путь к переписанному тексту.' },
        strict: { type: 'boolean', description: 'Строгий режим.' },
      },
      additionalProperties: false,
    },
    async (args, exec) => {
      const original = typeof args.original === 'string' ? args.original : typeof args.originalPath === 'string' ? await readFile(args.originalPath, 'utf8') : undefined;
      const transformed = typeof args.transformed === 'string' ? args.transformed : typeof args.transformedPath === 'string' ? await readFile(args.transformedPath, 'utf8') : undefined;
      if (original === undefined || transformed === undefined) throw new Error('unslop_validate: нужны original/transformed (или пути)');
      const dir = await mkdtemp(join(tmpdir(), 'dsh-unslop-'));
      try {
        const a = await writeTemp(dir, 'original.txt', original);
        const b = await writeTemp(dir, 'transformed.txt', transformed);
        const result = await runScript(config, 'validate_preservation.py', [...(args.strict === true ? ['--strict'] : []), a, b], undefined, exec.signal);
        const json = extractJson(result.stdout);
        if (json === undefined) throw new Error(`unslop_validate: ${clean(result.stderr) || 'нет JSON'}`);
        return JSON.stringify(json, null, 2);
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  tool(
    'unslop_suggest',
    'Co-writer: suggest.py выдаёт структурированные предложения (span, severity, category, rationale, replacement) без изменения текста. check=true прогоняет четыре контрактных гейта check_suggestions.py (span-minimality, replacement-scanner, accept-all, span-overlap).',
    {
      type: 'object',
      properties: {
        ...textSchema,
        check: { type: 'boolean', description: 'Прогнать контрактные гейты.' },
      },
      additionalProperties: false,
    },
    async (args, exec) => {
      const input = await readInput(args, config);
      const capped = capInput(input.text, config);
      const dir = await mkdtemp(join(tmpdir(), 'dsh-unslop-'));
      try {
        const file = await writeTemp(dir, 'document.md', capped.text);
        const result = await runScript(config, 'suggest.py', [file], undefined, exec.signal);
        const suggestions = extractJson(result.stdout);
        if (suggestions === undefined) throw new Error(`unslop_suggest: ${clean(result.stderr) || 'нет JSON'}`);
        let gates;
        if (args.check === true) {
          const suggestionsFile = await writeTemp(dir, 'suggestions.json', JSON.stringify(suggestions));
          const checked = await runScript(config, 'check_suggestions.py', [suggestionsFile], undefined, exec.signal);
          gates = { exit: checked.code, json: extractJson(checked.stdout), stderr: clean(checked.stderr) };
        }
        return JSON.stringify({ source: input.source, suggestions, gates }, null, 2);
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  tool(
    'unslop_rewrite',
    'Переписать текст по доктрине unslop через LLM: убрать AI-паттерны, сохранить факты и голос. Pipeline: scan → constraints → LLM rewrite → validate_preservation → повторный scan. Возвращает rewritten, preservation и scans before/after; текст НЕ применяется автоматически.',
    {
      type: 'object',
      properties: {
        ...textSchema,
        strict: { type: 'boolean', description: 'Строгая проверка сохранения (regulated text).' },
      },
      additionalProperties: false,
    },
    async (args, exec) => {
      const input = await readInput(args, config);
      const capped = capInput(input.text, config);
      const before = await scanText(config, capped, { genre: args.genre }, exec.signal);
      const constraintsResult = await runScript(config, 'extract_constraints.py', [], capped.text, exec.signal);
      const constraints = extractJson(constraintsResult.stdout);
      const summary = summarizeScan(before);
      const rewritten = await rewriteWithLlm(ctx, config, { text: capped.text, summary, constraints }, exec.signal);
      if (rewritten === '') throw new Error('unslop_rewrite: LLM вернул пустой текст');
      const after = await scanText(config, { text: rewritten }, { genre: args.genre }, exec.signal);
      const dir = await mkdtemp(join(tmpdir(), 'dsh-unslop-'));
      let preservation;
      try {
        const a = await writeTemp(dir, 'original.txt', capped.text);
        const b = await writeTemp(dir, 'rewritten.txt', rewritten);
        const validated = await runScript(config, 'validate_preservation.py', [...(args.strict === true ? ['--strict'] : []), a, b], undefined, exec.signal);
        preservation = extractJson(validated.stdout) ?? { error: clean(validated.stderr) || 'no JSON' };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      return JSON.stringify({
        source: input.source,
        truncated: capped.truncated,
        rewritten,
        preservation,
        before: summary,
        after: summarizeScan(after),
        gates: {
          factsPreserved: preservation?.passed === true,
          note: 'Проверьте rewritten в контексте: сканеры дают кандидатов, не приговор. Числа/имена/цитаты должны совпасть с preservation.constraints.',
        },
      }, null, 2);
    },
  );

  tool(
    'unslop_guide',
    'Доктрина unslop (SKILL.md): четыре команды teach/cleanup/rewrite/mimic, три слоя детекции, что защищается, гейты и границы доказательности. Прочитайте перед серией переписываний.',
    {
      type: 'object',
      properties: { maxChars: { type: 'number', description: 'Лимит символов (по умолчанию 12000).' } },
      additionalProperties: false,
    },
    async (args) => {
      const file = join(PLUGIN_DIR, 'python', 'SKILL.md');
      const text = await readFile(file, 'utf8');
      const limit = Number.isSafeInteger(args.maxChars) && args.maxChars > 0 ? args.maxChars : 12000;
      return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length} chars, limit ${limit})` : text;
    },
  );
}
