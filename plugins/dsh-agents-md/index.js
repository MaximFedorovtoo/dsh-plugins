/**
 * Install the bundled `AGENTS.md` as the Harness-wide instruction file.
 *
 * DSH loads `$DSH_HOME/AGENTS.md` into every session, in every project. This
 * plugin ships the author's instruction file and copies it there once, on the
 * plugin's first activation after installation:
 *
 * - an existing different file is left untouched unless `overwrite: true`;
 *   user-local instructions must never be replaced silently;
 * - the write is atomic (temporary file + rename) and runs once per load;
 * - `target` may point at another absolute path (or a path relative to
 *   `$DSH_HOME`) for people who keep their own global instruction file;
 * - removing the bundle never removes the file: it belongs to the user.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Plugin row name in `cordis.patch.yml`. */
export const name = 'agents-md';

/** Path of the instruction file shipped inside this package. */
const SOURCE = fileURLToPath(new URL('./AGENTS.md', import.meta.url));

/**
 * Resolve the instruction file destination.
 * @param {{ target?: string }} [config] - row configuration.
 * @returns {string} absolute destination path.
 */
export function resolveTarget(config = {}) {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  const configured = typeof config.target === 'string' ? config.target.trim() : '';
  if (configured === '') return join(home, 'AGENTS.md');
  return isAbsolute(configured) ? configured : join(home, configured);
}

/**
 * Copy the bundled instructions to `target`.
 *
 * @param {{ target?: string, overwrite?: boolean }} [config] - row configuration.
 * @param {{ info?: (message: string) => void, warn?: (message: string) => void }} [logger] - optional logger.
 * @returns {Promise<{ status: 'installed'|'updated'|'unchanged'|'kept'|'failed', target: string, error?: string }>}
 */
export async function installInstructions(config = {}, logger) {
  const target = resolveTarget(config);
  const overwrite = config.overwrite === true;
  try {
    const source = await readFile(SOURCE, 'utf8');
    let existing;
    try {
      existing = await readFile(target, 'utf8');
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
      existing = undefined;
    }
    if (existing === source) {
      logger?.info?.(`agents-md: ${target} is already up to date`);
      return { status: 'unchanged', target };
    }
    if (existing !== undefined && !overwrite) {
      const message = `agents-md: ${target} already exists; left untouched (set overwrite: true to replace it)`;
      logger?.info?.(message);
      return { status: 'kept', target };
    }
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, source, 'utf8');
    if (existing !== undefined) await rm(target, { force: true });
    await rename(temporary, target);
    const status = existing === undefined ? 'installed' : 'updated';
    logger?.info?.(`agents-md: ${status} ${target}`);
    return { status, target };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn?.(`agents-md: could not install ${target}: ${message}`);
    return { status: 'failed', target, error: message };
  }
}

/**
 * Register the plugin: one activation effect that installs the instruction file.
 * @param {object} ctx - Host plugin context.
 * @param {{ target?: string, overwrite?: boolean }} [config] - row configuration.
 */
export function apply(ctx, config = {}) {
  ctx.effect(() => {
    void installInstructions(config, ctx.logger);
  }, 'agents-md: install AGENTS.md');
}

/** Pure helpers exported for the repository's self-check. */
export const __internals = { resolveTarget, installInstructions };
