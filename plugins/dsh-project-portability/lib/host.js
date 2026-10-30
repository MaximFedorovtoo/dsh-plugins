/**
 * Host orchestration of portable project archives.
 *
 * Export reads the Workspace registry, the durable Session logs (through
 * `sessionQuery`/`sessionPersistence`), the attachment store and the project
 * tree, then writes one `.dshpack` file.
 *
 * Import extracts the tree, recreates every chat as a *new* durable session
 * whose stored `cwd` and event paths point at the extracted project, attaches
 * those chats to a Workspace registered at the target path, and restores the
 * content-addressed attachment blobs. Chats are written through the same
 * persistence seam the agent loop uses, so the Web UI lists and resumes them
 * exactly like locally created ones.
 *
 * @module dsh-project-portability/lib/host
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { packArchive, unpackArchive, readManifest, pickDestination, deriveSessionTitle } from './archive.js';
import { summarizeManifest } from './manifest.js';
import { remapEvents } from './remap.js';
import { readService, resolveDshHome, collectAttachmentsForExport, restoreAttachment } from './attachments.js';

/** Default sub-directory of DSH_HOME where archives are written. */
export const DEFAULT_ARCHIVE_DIR = 'exports';
/** Archive file extension written by this plugin. */
export const ARCHIVE_EXTENSION = '.dshpack';

/**
 * Normalize row config into explicit options.
 * @param {Record<string, unknown>} [raw] - plugin row config.
 * @returns {{ archiveDir: string, excludeNames: string[], includeSessions: boolean, includeAttachments: boolean }} options.
 */
export function normalizeConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  return {
    archiveDir: typeof config.archiveDir === 'string' ? config.archiveDir.trim() : '',
    excludeNames: Array.isArray(config.excludeNames) ? config.excludeNames.filter((name) => typeof name === 'string' && name.length > 0) : [],
    includeSessions: config.includeSessions !== false,
    includeAttachments: config.includeAttachments !== false,
  };
}

/**
 * Default directory for new archives.
 * @param {ReturnType<typeof normalizeConfig>} config - resolved config.
 * @returns {string} absolute directory.
 */
export function defaultArchiveDir(config) {
  return config.archiveDir.length > 0 ? resolve(config.archiveDir) : join(resolveDshHome(), DEFAULT_ARCHIVE_DIR);
}

/**
 * Resolve a required Cordis host service.
 * @param {object} ctx - plugin context.
 * @param {string} name - service name.
 * @returns {any} mounted service.
 */
function requiredService(ctx, name) {
  const service = readService(ctx, name);
  if (service === undefined) throw new Error(`dsh-project-portability requires the "${name}" service`);
  return service;
}

/**
 * List registered Workspaces with their chat counts.
 * @param {object} ctx - plugin context.
 * @returns {Array<{ id: string, path: string, title: string, sessionCount: number }>} projects.
 */
export function listProjects(ctx) {
  const registry = readService(ctx, 'workspaceRegistry');
  if (registry === undefined) return [];
  return registry.list().map((workspace) => ({
    id: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionCount: workspace.sessionIds.length,
  }));
}

/**
 * Resolve a Workspace by id, absolute path, title or a unique title substring.
 * @param {object} ctx - plugin context.
 * @param {string} selector - user/model supplied project selector.
 * @returns {any} Workspace entity.
 */
export function resolveProject(ctx, selector) {
  const registry = requiredService(ctx, 'workspaceRegistry');
  const projects = listProjects(ctx);
  if (projects.length === 0) throw new Error('no DSH projects (Workspaces) exist yet');
  if (typeof selector !== 'string' || selector.trim().length === 0) {
    throw new Error(`project is required; available projects: ${projects.map((project) => `${project.title} (${project.path})`).join('; ')}`);
  }
  const value = selector.trim();
  const normalize = (path) => resolve(String(path)).replace(/[\\/]+$/, '').toLowerCase();
  const exact =
    projects.find((project) => project.id === value) ??
    projects.find((project) => normalize(project.path) === normalize(value)) ??
    projects.find((project) => project.title.toLowerCase() === value.toLowerCase());
  const fuzzy =
    exact ??
    projects.find((project) => project.title.toLowerCase().includes(value.toLowerCase()) || normalize(project.path).includes(normalize(value)));
  if (fuzzy === undefined) throw new Error(`project not found: ${JSON.stringify(value)}; available: ${projects.map((project) => project.title).join(', ')}`);
  const entity = registry.get(fuzzy.id);
  if (entity === undefined) throw new Error(`project registry lost entity ${fuzzy.id}`);
  return entity;
}

/**
 * Read one chat's complete validated event log, preferring the Session query
 * service (live snapshot, replay-validated) and falling back to persistence.
 * @param {object} ctx - plugin context.
 * @param {string} sessionId - chat to read.
 * @returns {Promise<{ header: object, events: Array<object> }>} stored log.
 */
export async function readSessionLog(ctx, sessionId) {
  const query = readService(ctx, 'sessionQuery');
  if (query !== undefined && typeof query.readSession === 'function') {
    try {
      const result = await query.readSession(sessionId);
      return { header: result.session, events: result.events };
    } catch {
      // Fall through to the persistence seam; an archived chat may contain
      // events the replay projection refuses even though the raw log is intact.
    }
  }
  const persistence = requiredService(ctx, 'sessionPersistence');
  const handle = await persistence.open(sessionId, 'read');
  try {
    const chunk = await handle.read(0, Number.MAX_SAFE_INTEGER);
    return { header: handle.header, events: chunk.events };
  } finally {
    await handle.close();
  }
}

/**
 * Latest event timestamp in a log.
 * @param {Array<{ time?: number }>} events - session events.
 * @returns {number | null} epoch milliseconds or null.
 */
function lastEventTime(events) {
  let latest = null;
  for (const event of events) if (Number.isSafeInteger(event?.time) && (latest === null || event.time > latest)) latest = event.time;
  return latest;
}

/**
 * Build lazy chat descriptors for one Workspace, so export never holds more
 * than one chat log in memory.
 * @param {object} ctx - plugin context.
 * @param {any} workspace - Workspace entity.
 * @param {ReturnType<typeof normalizeConfig>} config - resolved config.
 * @returns {Promise<{ descriptors: Array<object>, warnings: string[] }>} descriptors.
 */
async function sessionDescriptors(ctx, workspace, config) {
  const persistence = readService(ctx, 'sessionPersistence');
  /** @type {Array<object>} */
  const descriptors = [];
  /** @type {string[]} */
  const warnings = [];
  for (const sessionId of workspace.sessionIds) {
    let header = null;
    try {
      if (persistence !== undefined && typeof persistence.stat === 'function') header = (await persistence.stat(sessionId))?.header ?? null;
    } catch (error) {
      warnings.push(`session ${sessionId}: header unavailable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (header === null) {
      warnings.push(`session ${sessionId}: not found in persistence, skipped`);
      continue;
    }
    const cwd = typeof header.meta?.cwd === 'string' && header.meta.cwd.length > 0 ? header.meta.cwd : workspace.path;
    descriptors.push({
      meta: { id: sessionId, cwd, createdAt: header.createdAt },
      /** @returns {Promise<{ events: Array<object>, meta: object, attachments: Array<object> }>} */
      async load() {
        const loaded = await readSessionLog(ctx, sessionId);
        const events = loaded.events;
        let attachments = [];
        if (config.includeAttachments) {
          const collected = collectAttachmentsForExport(ctx, events);
          for (const missing of collected.missing) warnings.push(`attachment ${missing} is absent from the local store, skipped`);
          attachments = collected.entries;
        }
        return {
          events,
          attachments,
          meta: {
            title: deriveSessionTitle(events),
            eventCount: events.length,
            updatedAt: lastEventTime(events),
            cwd: typeof loaded.header?.meta?.cwd === 'string' ? loaded.header.meta.cwd : cwd,
            createdAt: loaded.header?.createdAt ?? header.createdAt,
          },
        };
      },
    });
  }
  return { descriptors, warnings };
}

/**
 * Pick the archive file path for an export request.
 * @param {string | undefined} output - caller supplied file or directory.
 * @param {ReturnType<typeof normalizeConfig>} config - resolved config.
 * @param {any} workspace - Workspace entity.
 * @returns {string} absolute archive path.
 */
export function resolveArchivePath(output, config, workspace) {
  const name = safeFileSegment(workspace.title || workspace.path.split(/[\\/]/).pop() || 'project');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const file = `${name}-${stamp}${ARCHIVE_EXTENSION}`;
  if (typeof output !== 'string' || output.trim().length === 0) return join(defaultArchiveDir(config), file);
  const candidate = resolve(output.trim());
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return join(candidate, file);
  if (/[\\/]$/.test(output.trim())) return join(candidate, file);
  if (!/\.(dshpack|tar\.gz|tgz)$/i.test(candidate)) return `${candidate}${ARCHIVE_EXTENSION}`;
  return candidate;
}

/** @param {string} value - raw file name. @returns {string} filesystem-safe segment. */
function safeFileSegment(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'project';
}

/**
 * Export one project into a portable archive.
 * @param {object} ctx - plugin context.
 * @param {object} options - export request.
 * @param {string} options.pluginVersion - plugin version recorded in the manifest.
 * @param {Record<string, unknown>} [options.config] - row config.
 * @param {string} options.project - project id/path/title.
 * @param {string} [options.output] - archive file or directory.
 * @returns {Promise<object>} export summary.
 */
export async function exportProject(ctx, options) {
  const config = normalizeConfig(options.config);
  const workspace = resolveProject(ctx, options.project);
  if (!existsSync(workspace.path)) throw new Error(`project directory is missing: ${workspace.path}`);
  const { descriptors, warnings } = await sessionDescriptors(ctx, workspace, config);
  const archivePath = resolveArchivePath(options.output, config, workspace);
  await mkdir(dirname(archivePath), { recursive: true });
  const packed = await packArchive({
    archivePath,
    manifest: {
      pluginVersion: options.pluginVersion,
      project: { name: workspace.title || safeFileSegment(workspace.path), originalPath: workspace.path },
      excluded: config.excludeNames,
    },
    projectDir: workspace.path,
    excludeNames: config.excludeNames,
    sessions: config.includeSessions ? descriptors : [],
    onWarning: (message) => warnings.push(message),
  });
  return {
    ok: true,
    archivePath,
    project: { id: workspace.id, path: workspace.path, title: workspace.title },
    files: packed.files,
    bytes: packed.bytes,
    sessions: packed.sessions,
    attachments: packed.attachments,
    warnings,
    manifest: summarizeManifest(packed.manifest),
  };
}

/**
 * Verify that a rebuilt session passes the backend's cold-read validation.
 * @param {object} ctx - plugin context.
 * @param {string} sessionId - freshly written session.
 */
async function verifyStoredSession(ctx, sessionId) {
  const persistence = readService(ctx, 'sessionPersistence');
  if (persistence === undefined) return;
  const handle = await persistence.open(sessionId, 'read');
  try {
    await handle.read(0, 1);
  } finally {
    await handle.close();
  }
}

/**
 * Warm the zero-I/O session list cache so the imported title is visible before
 * the chat is first opened.
 * @param {object} ctx - plugin context.
 * @param {object} header - stored header.
 * @param {Array<object>} events - restored log.
 */
function warmProjectionCache(ctx, header, events) {
  const cache = readService(ctx, 'sessionProjectionCache');
  if (cache === undefined || typeof cache.coldSnapshot !== 'function') return;
  try {
    cache.coldSnapshot(header, 0, events);
  } catch {
    // The projection registry refolds on open; this is only a listing hint.
  }
}

/**
 * Fail early on a log whose seq numbers do not start at 0 and increase by one.
 * @param {string} sessionId - restored chat.
 * @param {Array<object>} events - restored log.
 */
function assertContiguousEvents(sessionId, events) {
  for (const [index, event] of events.entries()) {
    if (event === null || typeof event !== 'object' || event.seq !== index) {
      throw new Error(`session ${sessionId}: archived log is not contiguous at index ${index} (seq ${String(event?.seq)})`);
    }
  }
}

/**
 * Recreate one archived chat as a new durable Session bound to the target path.
 * @param {object} ctx - plugin context.
 * @param {object} input - recreation request.
 * @param {object} input.meta - archived chat metadata.
 * @param {Array<object>} input.events - archived event log.
 * @param {string} input.newCwd - extracted project directory.
 * @returns {Promise<{ sessionId: string, oldSessionId: string|null, title: string, eventCount: number }>} created chat.
 */
export async function recreateSession(ctx, input) {
  const sessions = requiredService(ctx, 'sessions');
  const persistence = requiredService(ctx, 'sessionPersistence');
  const oldSessionId = typeof input.meta?.id === 'string' && input.meta.id.length > 0 ? input.meta.id : null;
  const newSessionId = `session-${randomUUID()}`;
  const createdAt = Number.isSafeInteger(input.meta?.createdAt) ? input.meta.createdAt : Date.now();
  const prepared = sessions.prepare(newSessionId, { meta: { cwd: input.newCwd, createdAt } });
  const header = prepared?.header;
  if (header === undefined) throw new Error('sessions.prepare() returned no header');
  const oldCwd = typeof input.meta?.cwd === 'string' && input.meta.cwd.length > 0 ? input.meta.cwd : input.newCwd;
  const events = remapEvents(input.events, { oldCwd, newCwd: input.newCwd, oldSessionId, newSessionId });
  assertContiguousEvents(newSessionId, events);
  const handle = await persistence.create(header);
  try {
    await handle.append(events);
    if (typeof handle.flush === 'function') await handle.flush();
  } finally {
    await handle.close();
  }
  await verifyStoredSession(ctx, newSessionId);
  warmProjectionCache(ctx, header, events);
  return {
    sessionId: newSessionId,
    oldSessionId,
    title: typeof input.meta?.title === 'string' && input.meta.title.length > 0 ? input.meta.title : deriveSessionTitle(events),
    eventCount: events.length,
  };
}

/**
 * Register (or reuse) the Workspace for an extracted project.
 * @param {object} ctx - plugin context.
 * @param {string} projectPath - extracted project directory.
 * @param {string} title - workspace title.
 * @returns {Promise<any>} Workspace entity.
 */
export async function ensureWorkspace(ctx, projectPath, title) {
  const registry = requiredService(ctx, 'workspaceRegistry');
  const existing = await registry.resolveByPath(projectPath);
  if (existing !== undefined && existing !== null) return existing;
  return registry.create(projectPath, title);
}

/**
 * Attach one restored chat to its Workspace, collecting a warning instead of
 * aborting the import.
 * @param {any} workspace - Workspace entity.
 * @param {string} sessionId - restored chat.
 * @param {string[]} warnings - sink.
 */
async function attachSessionSafe(workspace, sessionId, warnings) {
  try {
    await workspace.attachSession(sessionId);
  } catch (error) {
    warnings.push(`chat ${sessionId} was restored but not attached to the workspace: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Import an archive: extract the tree, rebuild chats, register the Workspace.
 * @param {object} ctx - plugin context.
 * @param {object} options - import request.
 * @param {string} options.archive - `.dshpack` path.
 * @param {Record<string, unknown>} [options.config] - row config.
 * @param {string} [options.targetDir] - explicit destination directory.
 * @returns {Promise<object>} import summary.
 */
export async function importArchive(ctx, options) {
  const config = normalizeConfig(options.config);
  const archivePath = resolve(options.archive);
  if (!existsSync(archivePath)) throw new Error(`archive not found: ${archivePath}`);
  const manifest = await readManifest(archivePath);
  const projectName = manifest.project.name;
  const originalPath = typeof manifest.project.originalPath === 'string' && manifest.project.originalPath.length > 0 ? manifest.project.originalPath : '';
  let targetDir;
  if (typeof options.targetDir === 'string' && options.targetDir.trim().length > 0) {
    targetDir = resolve(options.targetDir.trim());
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) throw new Error(`target directory is not empty: ${targetDir}`);
  } else {
    targetDir = pickDestination(originalPath.length > 0 ? originalPath : join(defaultDocumentsDir(), projectName));
  }
  const createdTarget = !existsSync(targetDir);
  /** @type {Array<object>} */
  const restored = [];
  /** @type {string[]} */
  const warnings = [];
  let workspace = null;
  /** @type {string | null} */
  let workspaceError = null;
  try {
    const unpacked = await unpackArchive({
      archivePath,
      projectDir: targetDir,
      onSession: async ({ meta, events }) => {
        if (workspace === null) workspace = await ensureWorkspace(ctx, targetDir, projectName);
        const created = await recreateSession(ctx, { meta, events, newCwd: targetDir });
        restored.push(created);
        await attachSessionSafe(workspace, created.sessionId, warnings);
      },
      onAttachment: async ({ archivePath: attachmentPath, buffer }) => {
        if (!config.includeAttachments) return;
        await restoreAttachment(resolveDshHome(), attachmentPath, buffer);
      },
    });
    if (workspace === null) {
      try {
        workspace = await ensureWorkspace(ctx, targetDir, projectName);
      } catch (error) {
        workspaceError = `project extracted but the workspace could not be registered: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const errors = [...unpacked.errors];
    if (workspaceError !== null) errors.push(workspaceError);
    return {
      ok: errors.length === 0,
      archivePath,
      targetDir,
      projectName,
      workspaceId: workspace?.id ?? null,
      files: unpacked.files,
      bytes: unpacked.bytes,
      sessions: restored,
      attachments: unpacked.attachments.length,
      errors,
      warnings: [...warnings, ...unpacked.warnings],
      manifest: summarizeManifest(manifest),
    };
  } catch (error) {
    if (createdTarget) await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Platform-appropriate default parent directory for a new project when the
 * archive carries no original path.
 * @returns {string} absolute directory.
 */
function defaultDocumentsDir() {
  const documents = join(homedir(), 'Documents');
  return existsSync(documents) ? documents : homedir();
}

/**
 * Canonical absolute path of an existing directory (used by tests and UI).
 * @param {string} path - directory.
 * @returns {Promise<string>} resolved path.
 */
export async function canonicalPath(path) {
  return realpath(path);
}
