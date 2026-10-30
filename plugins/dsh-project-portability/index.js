/**
 * dsh-project-portability — host half.
 *
 * Registers three model-facing tools (`project_list`, `project_export`,
 * `project_import`) and the Web UI routes under `/api/portability/*`.
 *
 * @module dsh-project-portability
 */
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { exportProject, importArchive, listProjects, defaultArchiveDir, normalizeConfig } from './lib/host.js';
import { readManifest } from './lib/archive.js';
import { summarizeManifest } from './lib/manifest.js';

/** Plugin version recorded in every archive manifest. */
export const PLUGIN_VERSION = '0.1.0';
/** Cordis host services this plugin needs. */
export const inject = ['tools', 'connection', 'workspaceRegistry'];

/** Serialize long archive operations so two imports cannot interleave. */
let busy = null;

/**
 * Run one long archive operation, refusing a concurrent second one.
 * @template T
 * @param {string} label - operation label for the busy error.
 * @param {() => Promise<T>} run - operation body.
 * @returns {Promise<T>} operation result.
 */
async function exclusive(label, run) {
  if (busy !== null) throw new Error(`another ${busy} is still running; wait for it to finish`);
  busy = label;
  try {
    return await run();
  } finally {
    busy = null;
  }
}

/**
 * JSON responses for the plugin's routes.
 * @param {unknown} value - payload.
 * @param {number} [status] - HTTP status.
 * @returns {Response} JSON response.
 */
function json(value, status = 200) {
  return Response.json(value, { status });
}

/** @param {unknown} error - caught value. @returns {string} message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Register the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - owning plugin Context.
 * @param {Record<string, unknown>} config - raw row config.
 */
export function apply(ctx, config) {
  const cfg = normalizeConfig(config);

  ctx.effect(() =>
    ctx.tools.register({
      name: 'project_list',
      description:
        'List the DSH projects (workspaces) on this machine with their absolute paths, titles and chat counts. ' +
        'Call this before project_export when the user did not name the project exactly.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute() {
        return JSON.stringify(
          { ok: true, projects: listProjects(ctx), archiveDir: defaultArchiveDir(cfg) },
          null,
          2,
        );
      },
    }),
  );

  ctx.effect(() =>
    ctx.tools.register({
      name: 'project_export',
      description:
        'Export one DSH project into a single portable .dshpack archive: the full project folder (all files), ' +
        'every chat of the project with its complete event log and context, and the attachments those chats reference. ' +
        'The archive can be copied to an external drive and imported on another computer with project_import, where ' +
        'the chats open and continue normally. Use project_list first to see available projects.',
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description: 'Project id, absolute path, title, or a unique part of the title/path.',
          },
          output: {
            type: 'string',
            description: 'Optional archive file path or an existing directory. Omitted: <DSH_HOME>/exports/<project>-<date>.dshpack.',
          },
        },
        required: ['project'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        exec.signal?.throwIfAborted();
        const result = await exclusive('export', () =>
          exportProject(ctx, { pluginVersion: PLUGIN_VERSION, config: cfg, project: args.project, output: args.output }),
        );
        return JSON.stringify(result, null, 2);
      },
    }),
  );

  ctx.effect(() =>
    ctx.tools.register({
      name: 'project_import',
      description:
        'Import a portable .dshpack archive created by project_export: extract the project files, rebuild every chat ' +
        'with its full history so it opens and continues normally, and register the project as a DSH workspace. ' +
        'Use the archive path that exists on this machine (for example on the external drive).',
      parameters: {
        type: 'object',
        properties: {
          archive: {
            type: 'string',
            description: 'Absolute path to the .dshpack archive on this machine.',
          },
          targetDir: {
            type: 'string',
            description:
              'Optional destination directory for the project. Omitted: the original path when it is free, otherwise a "-2" neighbor.',
          },
        },
        required: ['archive'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        exec.signal?.throwIfAborted();
        const result = await exclusive('import', () =>
          importArchive(ctx, { archive: args.archive, targetDir: args.targetDir, config: cfg }),
        );
        return JSON.stringify(result, null, 2);
      },
    }),
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/portability/version',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () =>
        json({
          ok: true,
          version: PLUGIN_VERSION,
          features: { export: true, import: true, attachmentCarry: true, sessions: true },
        }),
    }),
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/portability/projects',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          const archives = await listArchives(defaultArchiveDir(cfg));
          return json({ ok: true, projects: listProjects(ctx), archiveDir: defaultArchiveDir(cfg), archives });
        } catch (error) {
          return json({ ok: false, error: messageOf(error) }, 500);
        }
      },
    }),
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/portability/export',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await request.json();
          if (body === null || typeof body !== 'object' || typeof body.project !== 'string' || body.project.length === 0) {
            return json({ ok: false, error: 'project is required' }, 400);
          }
          const result = await exclusive('export', () =>
            exportProject(ctx, {
              pluginVersion: PLUGIN_VERSION,
              config: cfg,
              project: body.project,
              output: typeof body.output === 'string' && body.output.length > 0 ? body.output : undefined,
            }),
          );
          return json(result);
        } catch (error) {
          return json({ ok: false, error: messageOf(error) }, 400);
        }
      },
    }),
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/portability/import',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await request.json();
          if (body === null || typeof body !== 'object' || typeof body.archive !== 'string' || body.archive.length === 0) {
            return json({ ok: false, error: 'archive is required' }, 400);
          }
          const result = await exclusive('import', () =>
            importArchive(ctx, {
              archive: body.archive,
              targetDir: typeof body.targetDir === 'string' && body.targetDir.length > 0 ? body.targetDir : undefined,
              config: cfg,
            }),
          );
          return json(result);
        } catch (error) {
          return json({ ok: false, error: messageOf(error) }, 400);
        }
      },
    }),
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/portability/summary',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await request.json();
          if (body === null || typeof body !== 'object' || typeof body.archive !== 'string' || body.archive.length === 0) {
            return json({ ok: false, error: 'archive is required' }, 400);
          }
          if (!existsSync(body.archive)) return json({ ok: false, error: `archive not found: ${body.archive}` }, 404);
          const manifest = await readManifest(body.archive);
          return json({ ok: true, manifest: summarizeManifest(manifest) });
        } catch (error) {
          return json({ ok: false, error: messageOf(error) }, 400);
        }
      },
    }),
  );
}

/**
 * List `.dshpack` files in a directory, newest first.
 * @param {string} directory - archive directory.
 * @returns {Promise<Array<{ name: string, path: string, bytes: number, modifiedAt: string }>>} archives.
 */
export async function listArchives(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const archives = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(dshpack|tar\.gz|tgz)$/i.test(entry.name)) continue;
    const path = join(directory, entry.name);
    const info = await stat(path);
    archives.push({ name: basename(path), path, bytes: info.size, modifiedAt: info.mtime.toISOString() });
  }
  return archives.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}
