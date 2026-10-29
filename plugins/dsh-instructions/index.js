/**
 * Host half of the instructions panel.
 *
 * The panel lets a user upload or edit the machine-wide instruction file that
 * DSH loads into every session: `$DSH_HOME/AGENTS.md`. The Host owns the file
 * access through one authenticated route group:
 *
 *   GET    /api/instructions   → { ok, path, exists, size, updatedAt, content, maxBytes }
 *   POST   /api/instructions   → { content } → same shape after a save
 *   DELETE /api/instructions   → removes the file
 *
 * Writes are atomic (temporary file + rename), so a failed save never leaves a
 * half-written instruction file behind.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

/** Plugin row name in `cordis.patch.yml`. */
export const name = 'instructions';
/** The browser route needs the authenticated fetch carrier. */
export const inject = ['connection'];

/** Route prefix shared by the panel. */
const ROUTE = '/api/instructions';
/** Default byte ceiling for the instruction file. */
export const DEFAULT_MAX_BYTES = 64 * 1024;

/**
 * Apply defaults to the row configuration.
 * @param {Record<string, unknown>} [config] - raw row config.
 * @returns {{ target: string, maxBytes: number }} resolved settings.
 */
export function settingsOf(config = {}) {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  const configured = typeof config.target === 'string' ? config.target.trim() : '';
  const target = configured === ''
    ? join(home, 'AGENTS.md')
    : isAbsolute(configured)
      ? configured
      : join(home, configured);
  const maxBytes = Number.isSafeInteger(config.maxBytes) && config.maxBytes > 0 ? config.maxBytes : DEFAULT_MAX_BYTES;
  return { target, maxBytes };
}

/**
 * Read the current instruction file.
 * @param {{ target: string, maxBytes: number }} settings - resolved settings.
 * @returns {Promise<{ path: string, exists: boolean, size: number, updatedAt: string|null, content: string, maxBytes: number }>}
 */
export async function readInstructions(settings) {
  try {
    const info = await stat(settings.target);
    if (!info.isFile()) throw new Error(`the instruction path is not a file: ${settings.target}`);
    const content = await readFile(settings.target, 'utf8');
    return {
      path: settings.target,
      exists: true,
      size: Buffer.byteLength(content, 'utf8'),
      updatedAt: new Date(info.mtimeMs).toISOString(),
      content,
      maxBytes: settings.maxBytes,
    };
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return {
        path: settings.target,
        exists: false,
        size: 0,
        updatedAt: null,
        content: '',
        maxBytes: settings.maxBytes,
      };
    }
    throw error;
  }
}

/**
 * Validate and write the instruction file atomically.
 * @param {{ target: string, maxBytes: number }} settings - resolved settings.
 * @param {string} content - new instructions.
 * @returns {Promise<{ path: string, exists: true, size: number, updatedAt: string, content: string, maxBytes: number }>}
 */
export async function saveInstructions(settings, content) {
  if (typeof content !== 'string') throw new Error('content must be a string');
  if (content.trim().length === 0) throw new Error('the instruction file cannot be empty');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > settings.maxBytes) {
    throw new Error(`the instruction file is too large: ${bytes} bytes, the limit is ${settings.maxBytes}`);
  }
  await mkdir(dirname(settings.target), { recursive: true });
  const temporary = `${settings.target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, 'utf8');
  try {
    const exists = await stat(settings.target).then(() => true, () => false);
    if (exists) await rm(settings.target, { force: true });
    await rename(temporary, settings.target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return readInstructions(settings);
}

/**
 * Delete the instruction file.
 * @param {{ target: string, maxBytes: number }} settings - resolved settings.
 * @returns {Promise<{ path: string, removed: boolean }>}
 */
export async function removeInstructions(settings) {
  const exists = await stat(settings.target).then(() => true, () => false);
  if (exists) await rm(settings.target, { force: true });
  return { path: settings.target, removed: exists };
}

/** JSON response without caching: the file changes under the user's hands. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Register the Host routes.
 * @param {object} ctx - Host plugin context with `connection`.
 * @param {{ target?: string, maxBytes?: number }} [config] - row configuration.
 */
export function apply(ctx, config = {}) {
  const settings = settingsOf(config);

  const reject = (body) => {
    const error = body !== null && typeof body === 'object' && typeof body.error === 'string' ? body.error : 'request failed';
    return { ok: false, error };
  };

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: ROUTE,
      methods: ['GET', 'POST', 'DELETE'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          if (request.method === 'GET') {
            return Response.json({ ok: true, ...(await readInstructions(settings)) });
          }
          if (request.method === 'DELETE') {
            const result = await removeInstructions(settings);
            return Response.json({ ok: true, ...(await readInstructions(settings)), removed: result.removed });
          }
          const body = await request.json();
          if (body === null || typeof body !== 'object') {
            return Response.json(reject({ error: 'request body must be a JSON object' }), { status: 400 });
          }
          const state = await saveInstructions(settings, body.content);
          return Response.json({ ok: true, ...state });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const status = /cannot be empty|too large|must be a string/i.test(message) ? 400 : 500;
          return Response.json({ ok: false, error: message }, { status });
        }
      },
    }),
  );

  ctx.logger?.info?.(`instructions: panel ready (file=${settings.target})`);
}

/** Pure helpers exported for the repository's self-check. */
export const __internals = { settingsOf, readInstructions, saveInstructions, removeInstructions };
