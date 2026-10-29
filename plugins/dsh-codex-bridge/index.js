/**
 * Codex Bridge — import projects and chat context from OpenAI Codex into DSH.
 *
 * Host half:
 *  - Tool `codex_import` (catalog | import) for the model.
 *  - Two authenticated fetch routes used by the Web panel:
 *      GET  /api/codex-import/catalog
 *      POST /api/codex-import/import
 *  - One import implementation shared by both callers. It is idempotent per
 *    Codex project: the first import clones files + creates the chat, a later
 *    import of the same project updates that copy and appends new transcript
 *    messages to the same Session instead of creating `-2`, `-3`, … duplicates.
 *    A `.codex-import.json` manifest inside the project directory remembers the
 *    ownership (project id, workspace, per-thread session ids).
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readCodexCatalog, readThreadTranscript, resolveCodexHome } from './src/codex-source.js';
import { createImportedSession } from './src/session-import.js';
import { appendImportedMessages } from './src/session-append.js';

/** Loader identity for this plugin row. */
export const name = 'codex-import';
/** Services this plugin cannot work without. */
export const inject = ['tools', 'connection', 'workspaceRegistry'];

/** Default target root for cloned projects. */
const DEFAULT_TARGET_ROOT = join(homedir(), 'Documents', 'deepseek-harness', 'Codex');
/** Names never copied from a source project (reinstallable or transient data). */
const DEFAULT_EXCLUDE = ['node_modules', '.next', '.nuxt', '.turbo', '.cache'];
/** Ownership marker kept inside every imported project directory. */
const MANIFEST_NAME = '.codex-import.json';
/** Manifest identity marker. */
const MANIFEST_PLUGIN = 'dsh-codex-bridge';

/**
 * Read the plugin config with defaults applied.
 * @param {Record<string, unknown> | undefined} config - raw row config from cordis.patch.yml.
 * @returns {{ codexHome: string, targetRoot: string, maxTranscriptChars: number, excludeNames: string[] }}
 */
function resolveConfig(config) {
  const raw = config ?? {};
  return {
    codexHome: typeof raw.codexHome === 'string' && raw.codexHome.length > 0 ? raw.codexHome : resolveCodexHome(),
    targetRoot:
      typeof raw.targetRoot === 'string' && raw.targetRoot.length > 0 ? resolve(raw.targetRoot) : DEFAULT_TARGET_ROOT,
    maxTranscriptChars:
      typeof raw.maxTranscriptChars === 'number' && Number.isFinite(raw.maxTranscriptChars) && raw.maxTranscriptChars > 0
        ? Math.floor(raw.maxTranscriptChars)
        : 1_500_000,
    importMode: raw.importMode === 'copy' ? 'copy' : 'in-place',
    excludeNames: Array.isArray(raw.excludeNames)
      ? raw.excludeNames.filter((value) => typeof value === 'string' && value.length > 0)
      : DEFAULT_EXCLUDE,
  };
}

/**
 * Turn a project or thread title into a safe single path segment.
 * @param {string} value - user/project supplied name.
 * @param {string} fallback - value used when nothing safe remains.
 * @returns {string} one Windows-safe path segment.
 */
function safeSegment(value, fallback) {
  const cleaned = String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Pick the first non-existing directory name, adding -2, -3, … when needed.
 * @param {string} root - target root directory.
 * @param {string} base - preferred directory name.
 * @returns {Promise<string>} free absolute directory path.
 */
async function pickTargetDir(root, base) {
  for (let index = 1; index <= 99; index += 1) {
    const candidate = join(root, index === 1 ? base : `${base}-${index}`);
    try {
      const info = await stat(candidate);
      if (!info.isDirectory()) throw new Error(`target path exists and is not a directory: ${candidate}`);
      const entries = await readdir(candidate);
      if (entries.length === 0) return candidate;
    } catch (error) {
      if (error && error.code === 'ENOENT') return candidate;
      throw error;
    }
  }
  throw new Error(`cannot find a free target directory for ${base}`);
}

/**
 * Choose the directory a copy-mode import writes into without inventing new
 * names for a project that already lives in the target root: an existing empty
 * folder is reused, a folder that already holds a project copy (.git) or our
 * manifest is adopted and refreshed in place, and only a folder owned by a
 * different Codex project (or an unrelated non-empty folder) gets a -2, -3
 * suffix.
 * @param {string} root - target root directory.
 * @param {string} base - preferred directory name.
 * @param {string} projectId - Codex project id.
 * @returns {Promise<{ dir: string, adopted: boolean }>} chosen directory.
 */
async function resolveCopyTarget(root, base, projectId) {
  const preferred = join(root, base);
  let info;
  try {
    info = await stat(preferred);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { dir: preferred, adopted: false };
    throw error;
  }
  if (!info.isDirectory()) return { dir: await pickTargetDir(root, base), adopted: false };
  const manifest = await readManifest(preferred);
  const foreign = manifest !== undefined && manifest.plugin === MANIFEST_PLUGIN && manifest.projectId !== projectId;
  if (foreign) return { dir: await pickTargetDir(root, base), adopted: false };
  const entries = await readdir(preferred);
  if (entries.length === 0) return { dir: preferred, adopted: false };
  let looksLikeProject = manifest !== undefined;
  if (!looksLikeProject) {
    try {
      looksLikeProject = (await stat(join(preferred, '.git'))).isDirectory();
    } catch {
      looksLikeProject = false;
    }
  }
  if (looksLikeProject) return { dir: preferred, adopted: true };
  return { dir: await pickTargetDir(root, base), adopted: false };
}

/**
 * Read one import manifest.
 * @param {string} dir - project directory.
 * @returns {Promise<Record<string, any> | undefined>} manifest or undefined.
 */
async function readManifest(dir) {
  try {
    const parsed = JSON.parse(await readFile(join(dir, MANIFEST_NAME), 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Write the import manifest atomically enough for a single writer.
 * @param {string} dir - project directory.
 * @param {Record<string, any>} manifest - manifest payload.
 * @returns {Promise<void>}
 */
async function writeManifest(dir, manifest) {
  const target = join(dir, MANIFEST_NAME);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  let info;
  try {
    info = await stat(target);
  } catch {
    info = undefined;
  }
  if (info !== undefined) {
    const { rm } = await import('node:fs/promises');
    await rm(target, { force: true });
  }
  const { rename } = await import('node:fs/promises');
  await rename(temporary, target);
}

/**
 * Find the directory that already owns a Codex project.
 * @param {string} root - target root directory.
 * @param {string} projectId - Codex project id.
 * @returns {Promise<{ dir: string, manifest: Record<string, any> } | undefined>} existing import.
 */
async function findImportedProject(root, projectId) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const manifest = await readManifest(dir);
    if (manifest !== undefined && manifest.plugin === MANIFEST_PLUGIN && manifest.projectId === projectId) {
      return { dir, manifest };
    }
  }
  return undefined;
}

/**
 * List every import manifest under the target root (for catalog annotations).
 * @param {string} root - target root directory.
 * @returns {Promise<Map<string, { dir: string, manifest: Record<string, any> }>>} by project id.
 */
async function listManifests(root) {
  const byProject = new Map();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return byProject;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const manifest = await readManifest(dir);
    if (manifest !== undefined && manifest.plugin === MANIFEST_PLUGIN && typeof manifest.projectId === 'string') {
      byProject.set(manifest.projectId, { dir, manifest });
    }
  }
  return byProject;
}

/**
 * Copy (or refresh) a project tree into the target directory.
 * @param {string} source - absolute source project directory.
 * @param {string} target - absolute destination directory.
 * @param {Set<string>} excludeNames - base names skipped at any depth.
 * @param {boolean} overwrite - true updates an existing import in place.
 * @returns {Promise<number>} number of files in the target tree.
 */
async function copyProject(source, target, excludeNames, overwrite) {
  const sourceRoot = resolve(source);
  const targetRoot = resolve(target);
  if (targetRoot === sourceRoot || targetRoot.startsWith(sourceRoot + sep)) {
    throw new Error(`refusing to copy a project into itself: ${targetRoot}`);
  }
  await mkdir(targetRoot, { recursive: true });
  await cp(sourceRoot, targetRoot, {
    recursive: true,
    force: overwrite,
    errorOnExist: false,
    dereference: false,
    filter: (entry) => {
      const base = entry.split(/[\\/]/).pop() ?? entry;
      if (excludeNames.has(base)) return false;
      return true;
    },
  }).catch((error) => {
    if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) return;
    throw error;
  });
  let copied = 0;
  /** @param {string} dir @returns {Promise<void>} */
  const count = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) await count(join(dir, entry.name));
      else copied += 1;
    }
  };
  await count(targetRoot);
  return copied;
}

/**
 * Build the catalog response body shared by the tool and the panel.
 * @param {ReturnType<typeof resolveConfig>} cfg - resolved plugin config.
 * @returns {Promise<object>} catalog JSON.
 */
async function buildCatalog(cfg) {
  const catalog = await readCodexCatalog({ codexHome: cfg.codexHome });
  const imports = await listManifests(cfg.targetRoot);
  return {
    ok: true,
    codexHome: cfg.codexHome,
    targetRoot: cfg.targetRoot,
    projects: catalog.projects.map((project) => {
      const imported = imports.get(project.id);
      const sessions = imported?.manifest.sessions && typeof imported.manifest.sessions === 'object' ? imported.manifest.sessions : {};
      return {
        id: project.id,
        name: project.name,
        rootPaths: project.rootPaths ?? [],
        exists: project.exists !== false,
        threadCount: (project.threads ?? []).length,
        imported: imported !== undefined,
        importedAt: imported?.manifest.importedAt ?? null,
        targetDir: imported?.dir ?? null,
        threads: (project.threads ?? []).map((thread) => ({
          id: thread.id,
          title: thread.title ?? '',
          updatedAt: thread.updatedAt ?? '',
          cwd: thread.cwd ?? '',
          messageCount: typeof thread.messageCount === 'number' ? thread.messageCount : null,
          importedSessionId: sessions[thread.id]?.sessionId ?? null,
          importedMessageCount:
            typeof sessions[thread.id]?.messageCount === 'number' ? sessions[thread.id].messageCount : null,
        })),
      };
    }),
  };
}

/**
 * Resolve a Host service by Cordis name.
 * @param {object} ctx - Host context.
 * @param {string} name - service name.
 * @returns {unknown} the service or undefined.
 */
function readService(ctx, name) {
  if (ctx === null || ctx === undefined) return undefined;
  if (typeof ctx.get === 'function') {
    try {
      const service = ctx.get(name);
      if (service !== undefined) return service;
    } catch {
      // Fall through to the direct property accessor.
    }
  }
  try {
    return ctx[name];
  } catch {
    return undefined;
  }
}

/**
 * Whether a stored Session still exists in persistence.
 * @param {object} ctx - Host context.
 * @param {string} sessionId - session id.
 * @returns {Promise<boolean>} true when the backend reports it.
 */
async function sessionExists(ctx, sessionId) {
  const persistence = readService(ctx, 'sessionPersistence');
  if (persistence === undefined || typeof persistence.stat !== 'function') return true;
  try {
    return (await persistence.stat(sessionId)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Import or update one Codex project (optionally one thread) in DSH.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin Context.
 * @param {ReturnType<typeof resolveConfig>} cfg - resolved plugin config.
 * @param {{ projectId?: string, threadId?: string | null, targetName?: string }} request - import selection.
 * @returns {Promise<object>} import result JSON.
 */
async function importProject(ctx, cfg, request) {
  const catalog = await buildCatalog(cfg);
  const project =
    catalog.projects.find((candidate) => candidate.id === request.projectId) ??
    catalog.projects.find((candidate) => candidate.name === request.projectId);
  if (!project) throw new Error(`project not found in Codex: ${String(request.projectId)}`);
  if (project.exists === false) throw new Error(`project directory is missing: ${project.rootPaths.join(', ')}`);

  /** @type {(typeof project.threads)[number] | undefined} */
  let thread;
  if (request.threadId) {
    thread = project.threads.find(
      (candidate) => candidate.id === request.threadId || candidate.title.includes(request.threadId),
    );
    if (!thread) throw new Error(`thread not found in project "${project.name}": ${request.threadId}`);
  } else {
    thread = project.threads[0];
  }

  const sourceDir = thread?.cwd && thread.cwd.length > 0 ? thread.cwd : project.rootPaths[0];
  if (!sourceDir) throw new Error(`project "${project.name}" has no source directory`);

  const found = await findImportedProject(cfg.targetRoot, project.id);
  // In-place mode (the default) keeps the project where Codex has it: the same
  // folder becomes the DSH workspace and no copy appears next to it. The
  // manifest then lives inside the project directory, so it is read from there.
  const sourceManifest = cfg.importMode === 'in-place' ? await readManifest(sourceDir) : undefined;
  const existing =
    sourceManifest !== undefined ? { dir: sourceDir, manifest: sourceManifest } : found;
  const updating = existing !== undefined;
  const base = safeSegment(request.targetName || project.name, safeSegment(project.id, 'codex-project'));
  /** @type {string} */
  let targetDir;
  let adopted = false;
  if (existing !== undefined) {
    targetDir = existing.dir;
  } else if (cfg.importMode === 'in-place') {
    targetDir = sourceDir;
  } else {
    const resolved = await resolveCopyTarget(cfg.targetRoot, base, project.id);
    targetDir = resolved.dir;
    adopted = resolved.adopted;
  }
  const copiedFiles =
    cfg.importMode === 'copy'
      ? await copyProject(sourceDir, targetDir, new Set(cfg.excludeNames), updating || adopted)
      : 0;

  // Register (or reuse) a DSH workspace so the cloned project joins the sidebar.
  const existingWorkspace = await ctx.workspaceRegistry.resolveByPath(targetDir);
  const workspace = existingWorkspace ?? (await ctx.workspaceRegistry.create(targetDir, project.name));
  const workspaceId = String(workspace.id ?? workspace.path ?? targetDir);

  /** @type {Array<{role: 'user' | 'assistant', text: string, time?: number}>} */
  let messages = [];
  let transcriptTitle = thread?.title ?? '';
  if (thread) {
    const transcript = await readThreadTranscript({ codexHome: cfg.codexHome, thread });
    messages = transcript.messages ?? [];
    transcriptTitle = transcript.title || transcriptTitle;
  }
  // Keep the first import bounded: the newest messages matter most for continuing work.
  const bounded = [];
  let usedChars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    usedChars += message.text.length;
    if (usedChars > cfg.maxTranscriptChars && bounded.length > 0) break;
    bounded.unshift(message);
  }

  const title = transcriptTitle ? `Codex · ${project.name} · ${transcriptTitle}` : `Codex · ${project.name}`;
  const manifest =
    existing?.manifest ??
    { plugin: MANIFEST_PLUGIN, version: 1, projectId: project.id, projectName: project.name, sessions: {} };
  if (manifest.sessions === null || typeof manifest.sessions !== 'object') manifest.sessions = {};
  const threadKey = thread?.id ?? null;
  const previous = threadKey !== null ? manifest.sessions[threadKey] : undefined;

  let sessionId = typeof previous?.sessionId === 'string' ? previous.sessionId : null;
  let storedTitle = typeof previous?.title === 'string' && previous.title.length > 0 ? previous.title : title;
  let sessionCreated = false;
  let appended = 0;
  let appendWarning = null;
  let attachWarning = null;
  let eventCount = 0;

  if (sessionId !== null && !(await sessionExists(ctx, sessionId))) {
    appendWarning = `previous chat ${sessionId} is gone; a new one was created`;
    sessionId = null;
  }
  if (sessionId !== null) {
    const previousCount = Number.isSafeInteger(previous?.messageCount) ? previous.messageCount : 0;
    const fresh = messages.slice(Math.max(0, previousCount));
    if (fresh.length > 0) {
      const result = await appendImportedMessages(ctx, {
        sessionId,
        messages: fresh,
        source: {
          kind: 'codex-import',
          provider: 'openai-codex',
          projectId: project.id,
          projectName: project.name,
          threadId: threadKey,
          importedAt: new Date().toISOString(),
        },
      });
      appended = result.appended ?? 0;
      eventCount = result.eventCount ?? 0;
      if (typeof result.skipped === 'string' && result.appended === 0) appendWarning = result.skipped;
    }
    // Keep the stored headline in the manifest for the panel's result card.
    if (typeof previous?.title === 'string' && previous.title.length > 0) storedTitle = previous.title;
  } else if (bounded.length > 0) {
    const created = await createImportedSession(ctx, {
      cwd: targetDir,
      title,
      messages: bounded,
      source: {
        kind: 'codex-import',
        provider: 'openai-codex',
        projectId: project.id,
        projectName: project.name,
        threadId: threadKey,
        threadTitle: transcriptTitle || null,
        importedAt: new Date().toISOString(),
      },
    });
    sessionId = created.sessionId;
    eventCount = created.eventCount ?? 0;
    sessionCreated = true;
    if (typeof created.title === 'string' && created.title.length > 0) storedTitle = created.title;
  }

  // Workspace membership is authoritative for the sidebar: a persisted session
  // whose id is not accounted to a workspace appears under "Ungrouped".
  if (sessionId !== null && typeof workspace.attachSession === 'function') {
    try {
      await workspace.attachSession(sessionId);
    } catch (error) {
      attachWarning = error instanceof Error ? error.message : String(error);
    }
  } else if (sessionId !== null) {
    attachWarning = 'workspace.attachSession is unavailable in this Harness build';
  }

  if (threadKey !== null && sessionId !== null) {
    manifest.sessions[threadKey] = {
      sessionId,
      title: storedTitle,
      messageCount: messages.length,
      importedAt: new Date().toISOString(),
    };
  }
  manifest.projectName = project.name;
  manifest.workspaceId = workspaceId;
  manifest.targetDir = targetDir;
  manifest.codexHome = cfg.codexHome;
  manifest.importedAt = new Date().toISOString();
  await writeManifest(targetDir, manifest);

  const warnings = [appendWarning, attachWarning].filter((value) => typeof value === 'string' && value.length > 0);
  return {
    ok: true,
    updated: updating,
    projectId: project.id,
    projectName: project.name,
    threadId: threadKey,
    threadTitle: transcriptTitle || null,
    targetDir,
    workspaceId,
    sessionId,
    sessionTitle: sessionId ? storedTitle : null,
    sessionCreated,
    appended,
    messages: messages.length,
    copiedFiles,
    importMode: cfg.importMode,
    eventCount,
    attached: attachWarning === null && sessionId !== null,
    ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {}),
  };
}

/**
 * Register the plugin: the model-facing tool plus the two panel routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - owning plugin Context.
 * @param {Record<string, unknown>} config - raw row config.
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config);

  ctx.effect(() =>
    ctx.tools.register({
      name: 'codex_import',
      description:
        'Import a project and its chat history from the OpenAI Codex app into DeepSeek Harness, or update a ' +
        'previous import. action "catalog" lists Codex projects and their threads (with imported markers); ' +
        'action "import" clones the selected project into the target directory as a full project (git history ' +
        'included) and creates a DSH chat containing the Codex conversation so work can continue here. ' +
        'Importing the same project again updates its copy and appends only new Codex messages to the same ' +
        'chat rather than duplicating it. Use "catalog" first when the user did not name a project exactly.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['catalog', 'import'],
            description: 'catalog lists Codex projects/threads; import clones or updates one project and its chat.',
          },
          project: {
            type: 'string',
            description: 'Codex project name or id (required for import).',
          },
          thread: {
            type: 'string',
            description: 'Thread id or a substring of its title; omitted means the most recent thread of the project.',
          },
          targetName: {
            type: 'string',
            description: 'Optional folder name for the first import instead of the project name.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        exec.signal?.throwIfAborted();
        if (args.action === 'catalog') {
          return JSON.stringify(await buildCatalog(cfg), null, 2);
        }
        const result = await importProject(ctx, cfg, {
          projectId: args.project,
          threadId: args.thread ?? null,
          targetName: args.targetName,
        });
        return JSON.stringify(result, null, 2);
      },
    }),
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/codex-import/catalog',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return Response.json(await buildCatalog(cfg));
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
        }
      },
    }),
  );

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/codex-import/import',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await request.json();
          if (!body || typeof body !== 'object' || typeof body.projectId !== 'string' || body.projectId.length === 0) {
            return Response.json({ ok: false, error: 'projectId is required' }, { status: 400 });
          }
          const result = await importProject(ctx, cfg, {
            projectId: body.projectId,
            threadId: typeof body.threadId === 'string' && body.threadId.length > 0 ? body.threadId : null,
            targetName: typeof body.targetName === 'string' && body.targetName.length > 0 ? body.targetName : undefined,
          });
          return Response.json(result);
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
        }
      },
    }),
  );

  ctx.logger?.info?.(`codex-import: ready (codexHome=${cfg.codexHome}, targetRoot=${cfg.targetRoot})`);
}

/** Pure helpers exported for the repository's self-check. */
export const __internals = { safeSegment, pickTargetDir, resolveCopyTarget, findImportedProject, readManifest };
