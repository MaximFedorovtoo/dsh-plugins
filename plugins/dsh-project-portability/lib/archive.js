/**
 * `.dshpack` archive layout and streaming pack/unpack.
 *
 * Layout (tar entries, gzip framed):
 *
 *   manifest.json                 project + chat descriptors
 *   project/...                   full project tree
 *   sessions/<nnnn>/meta.json     chat metadata
 *   sessions/<nnnn>/events.jsonl  complete v4 event log, one JSON per line
 *   attachments/<...>             attachment / spill blobs referenced by chats
 *
 * The manifest comes first so an import can validate the archive before it
 * touches the destination directory. Project files are written before chats, so
 * a failure while rebuilding chats never leaves a chat pointing at a project
 * tree that was not extracted.
 *
 * @module dsh-project-portability/lib/archive
 */
import { createReadStream, createWriteStream, readdirSync, statSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TarWriter, TarReader, toArchivePath, joinArchivePath } from './tar.js';
import { buildManifest, validateManifest } from './manifest.js';

/** Archive entry holding the manifest. */
export const MANIFEST_ENTRY = 'manifest.json';
/** Prefix of the packed project tree. */
export const PROJECT_PREFIX = 'project/';
/** Prefix of packed chats. */
export const SESSION_PREFIX = 'sessions/';
/** Prefix of packed attachment blobs. */
export const ATTACHMENT_PREFIX = 'attachments/';

/**
 * Recursively list a project tree in a stable order.
 * @param {string} root - project directory.
 * @param {object} [options] - walk options.
 * @param {string[]} [options.excludeNames] - names skipped at any depth.
 * @param {(warning: string) => void} [options.onWarning] - skipped-entry sink.
 * @returns {{ files: Array<{ relPath: string, absPath: string, size: number, mtime: number }>, directories: string[], bytes: number }}
 */
export function walkProject(root, options = {}) {
  const excludes = new Set((options.excludeNames ?? []).map((name) => String(name)));
  /** @type {Array<{ relPath: string, absPath: string, size: number, mtime: number }>} */
  const files = [];
  /** @type {string[]} */
  const directories = [];
  let bytes = 0;
  const warn = (message) => { if (typeof options.onWarning === 'function') options.onWarning(message); };
  /** @param {string} dir @param {string} rel */
  const visit = (dir, rel) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    if (entries.length === 0 && rel.length > 0) directories.push(rel);
    for (const entry of entries) {
      if (excludes.has(entry.name)) continue;
      const absPath = join(dir, entry.name);
      const relPath = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        warn(`symlink skipped: ${relPath}`);
        continue;
      }
      if (entry.isDirectory()) {
        visit(absPath, relPath);
      } else if (entry.isFile()) {
        const stats = statSync(absPath);
        files.push({ relPath, absPath, size: stats.size, mtime: Math.floor(stats.mtimeMs / 1000) });
        bytes += stats.size;
      } else {
        warn(`unsupported entry skipped (not a regular file or directory): ${relPath}`);
      }
    }
  };
  visit(root, '');
  return { files, directories, bytes };
}

/**
 * Write a complete archive.
 * @param {object} input - packing request.
 * @param {string} input.archivePath - destination `.dshpack`.
 * @param {object} input.manifest - manifest built by {@link buildManifest}.
 * @param {string} input.projectDir - project root on this machine.
 * @param {string[]} [input.excludeNames] - names skipped while packing.
 * @param {Array<{ meta: object, events?: Array<object>, load?: () => Promise<{ events: Array<object>, meta?: object }> }>} [input.sessions] - chats to pack; `load` defers reading one chat's log until it is written, so a project with many chats never holds them all in memory.
 * @param {Array<{ archivePath: string, buffer?: Buffer, absPath?: string }>} [input.attachments] - blobs to pack.
 * @param {(message: string) => void} [input.onWarning] - skipped-entry sink.
 * @returns {Promise<{ manifest: object, files: number, bytes: number, sessions: number, attachments: number, archivePath: string }>}
 */
export async function packArchive(input) {
  const writer = new TarWriter(input.archivePath);
  const walk = walkProject(input.projectDir, { excludeNames: input.excludeNames, onWarning: input.onWarning });
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const sessionPath = (index) => `sessions/${String(index).padStart(4, '0')}`;
  /** Attachments discovered while streaming chats; written after the chats they belong to. */
  const lazyAttachments = new Map();
  const manifest = buildManifest({
    ...input.manifest,
    project: {
      ...input.manifest.project,
      files: walk.files.length,
      bytes: walk.bytes,
    },
    sessions: sessions.map((session, index) => ({
      ...session.meta,
      index,
      archivePath: `${sessionPath(index)}/events.jsonl`,
    })),
    attachments: attachments.map((attachment) => ({ archivePath: attachment.archivePath })),
  });
  try {
    await writer.addBuffer(MANIFEST_ENTRY, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
    for (const directory of walk.directories) await writer.addDirectory(joinArchivePath(PROJECT_PREFIX, directory));
    for (const file of walk.files) await writer.addFile(joinArchivePath(PROJECT_PREFIX, file.relPath), file.absPath);
    for (const [index, session] of sessions.entries()) {
      const loaded = typeof session.load === 'function' ? await session.load() : { events: session.events ?? [], meta: {} };
      const events = Array.isArray(loaded.events) ? loaded.events : [];
      for (const attachment of loaded.attachments ?? []) {
        if (!lazyAttachments.has(attachment.archivePath)) lazyAttachments.set(attachment.archivePath, attachment);
      }
      const meta = {
        ...session.meta,
        ...(loaded.meta ?? {}),
        index,
        eventCount: Number.isSafeInteger(loaded.meta?.eventCount) ? loaded.meta.eventCount : events.length,
        archivePath: `${sessionPath(index)}/events.jsonl`,
      };
      if (typeof meta.title !== 'string' || meta.title.length === 0) meta.title = deriveSessionTitle(events);
      await writer.addBuffer(`${sessionPath(index)}/meta.json`, Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, 'utf8'));
      const lines = events.map((event) => JSON.stringify(event)).join('\n');
      await writer.addBuffer(`${sessionPath(index)}/events.jsonl`, Buffer.from(lines.length > 0 ? `${lines}\n` : '', 'utf8'));
    }
    for (const attachment of attachments) lazyAttachments.set(attachment.archivePath, attachment);
    for (const attachment of lazyAttachments.values()) {
      if (Buffer.isBuffer(attachment.buffer)) await writer.addBuffer(attachment.archivePath, attachment.buffer);
      else if (typeof attachment.absPath === 'string' && existsSync(attachment.absPath)) await writer.addFile(attachment.archivePath, attachment.absPath);
    }
    const finished = await writer.finish();
    return {
      manifest,
      files: walk.files.length,
      bytes: walk.bytes,
      sessions: sessions.length,
      attachments: lazyAttachments.size,
      archivePath: input.archivePath,
      entries: finished.entries,
    };
  } catch (error) {
    await writer.finish().catch(() => {});
    throw error;
  }
}

/**
 * Fold the latest stored title out of an event log.
 * @param {Array<object>} events - session events.
 * @returns {string} title or an empty string.
 */
export function deriveSessionTitle(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim().length > 0) {
      return event.data.title.trim();
    }
  }
  return '';
}

/**
 * Read just the manifest of an archive without extracting it.
 * @param {string} archivePath - `.dshpack` path.
 * @returns {Promise<object>} validated manifest.
 */
export async function readManifest(archivePath) {
  const reader = new TarReader(archivePath);
  try {
    for (;;) {
      const entry = await reader.next();
      if (entry === null) throw new Error(`archive has no ${MANIFEST_ENTRY}`);
      if (toArchivePath(entry.path) === MANIFEST_ENTRY) {
        const buffer = await entry.buffer();
        return validateManifest(JSON.parse(buffer.toString('utf8')));
      }
      // Drain and keep looking; malformed archives are rejected by the caller.
      // eslint-disable-next-line no-await-in-loop
      for await (const _chunk of entry.stream()) { /* drain */ }
    }
  } finally {
    await reader.close();
  }
}

/**
 * Extract an archive.
 *
 * `onSession` runs after the project tree is on disk and receives the chat
 * metadata plus the decoded event list; it is where the caller recreates a DSH
 * session. A throwing `onSession` is collected as a per-session error and does
 * not abort the remaining chats.
 *
 * @param {object} input - extraction request.
 * @param {string} input.archivePath - `.dshpack` path.
 * @param {string} input.projectDir - destination directory for the project tree.
 * @param {(file: { relativePath: string, absolutePath: string, size: number }) => void} [input.onProjectFile] - per-file hook.
 * @param {(session: { meta: object, events: Array<object>, index: number }) => Promise<void>|void} [input.onSession] - chat restoration hook.
 * @param {(attachment: { archivePath: string, buffer: Buffer }) => Promise<void>|void} [input.onAttachment] - blob hook.
 * @returns {Promise<{ manifest: object, files: number, bytes: number, sessions: Array<{ meta: object, events: Array<object>, index: number }>, attachments: Array<{ archivePath: string, bytes: number }>, errors: string[], warnings: string[] }>}
 */
export async function unpackArchive(input) {
  const reader = new TarReader(input.archivePath);
  const projectRoot = resolve(input.projectDir);
  /** @type {object | null} */
  let manifest = null;
  /** Sessions still being assembled: one chat's log is held in memory at a time. */
  const sessions = new Map();
  /** Summaries of chats already handed to `onSession`. */
  const delivered = [];
  /** @type {Array<{ archivePath: string, bytes: number }>} */
  const attachments = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  /**
   * Hand one assembled chat to the import hook and release its event array.
   * @param {number} index - archive order index.
   * @param {{ meta?: any, events?: any[], delivered?: boolean }} record - assembled chat.
   */
  const deliverSession = async (index, record) => {
    if (record.delivered === true || record.events === undefined) return;
    record.delivered = true;
    const meta = record.meta ?? {};
    try {
      await input.onSession({ index, meta, events: record.events });
      delivered.push({ index, meta, eventCount: record.events.length });
    } catch (error) {
      const message = `session ${meta.id ?? meta.title ?? index}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(message);
      delivered.push({ index, meta, eventCount: record.events.length, error: message });
    }
    sessions.delete(index);
  };
  let files = 0;
  let bytes = 0;
  try {
    for (;;) {
      const entry = await reader.next();
      if (entry === null) break;
      const archivePath = toArchivePath(entry.path);
      if (archivePath === MANIFEST_ENTRY) {
        manifest = validateManifest(JSON.parse((await entry.buffer()).toString('utf8')));
        continue;
      }
      if (archivePath.startsWith(PROJECT_PREFIX)) {
        const relativePath = archivePath.slice(PROJECT_PREFIX.length);
        if (relativePath.length === 0) continue;
        const target = resolve(projectRoot, relativePath);
        if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
          throw new Error(`archive entry escapes the project directory: ${archivePath}`);
        }
        if (entry.type === '5') {
          await mkdir(target, { recursive: true });
          continue;
        }
        await mkdir(dirname(target), { recursive: true });
        await pipeline(Readable.from(entry.stream()), createWriteStream(target));
        const stats = statSync(target);
        files += 1;
        bytes += stats.size;
        if (typeof input.onProjectFile === 'function') {
          input.onProjectFile({ relativePath, absolutePath: target, size: stats.size });
        }
        continue;
      }
      if (archivePath.startsWith(SESSION_PREFIX)) {
        const parts = archivePath.slice(SESSION_PREFIX.length).split('/');
        const index = Number.parseInt(parts[0], 10);
        if (!Number.isSafeInteger(index) || parts[0].length === 0) {
          warnings.push(`session entry with unsupported layout skipped: ${archivePath}`);
          continue;
        }
        if (!sessions.has(index)) sessions.set(index, { meta: undefined, events: undefined });
        const record = sessions.get(index);
        if (parts[1] === 'meta.json') {
          record.meta = JSON.parse((await entry.buffer()).toString('utf8'));
        } else if (parts[1] === 'events.jsonl') {
          const text = (await entry.buffer()).toString('utf8');
          record.events = text
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line, lineIndex) => {
              try {
                return JSON.parse(line);
              } catch (error) {
                throw new Error(`session ${index}: invalid event JSON at line ${lineIndex + 1}: ${String(error)}`);
              }
            });
        }
        if (typeof input.onSession === 'function' && record.meta !== undefined && record.events !== undefined) {
          await deliverSession(index, record);
        }
        continue;
      }
      if (archivePath.startsWith(ATTACHMENT_PREFIX)) {
        const buffer = await entry.buffer();
        attachments.push({ archivePath, bytes: buffer.length });
        if (typeof input.onAttachment === 'function') await input.onAttachment({ archivePath, buffer });
        continue;
      }
      warnings.push(`unknown archive entry ignored: ${archivePath}`);
    }
  } finally {
    await reader.close();
  }
  if (manifest === null) throw new Error(`archive has no ${MANIFEST_ENTRY}`);
  for (const [index, record] of [...sessions.entries()].sort(([left], [right]) => left - right)) {
    if (typeof input.onSession === 'function') {
      if (record.events !== undefined) await deliverSession(index, record);
    } else if (record.events !== undefined) {
      delivered.push({ index, meta: record.meta ?? {}, eventCount: record.events.length, events: record.events });
    }
  }
  warnings.push(...reader.warnings);
  return { manifest, files, bytes, sessions: delivered, attachments, errors, warnings };
}

/**
 * Pick a destination directory that does not clobber unrelated data.
 * @param {string} preferred - preferred absolute path (usually the original).
 * @param {(path: string) => boolean} [exists] - existence probe.
 * @returns {string} the preferred path or a `-2`, `-3`… variant.
 */
export function pickDestination(preferred, exists = existsSync) {
  if (typeof preferred !== 'string' || preferred.length === 0) throw new Error('preferred destination must be a non-empty path');
  const resolved = resolve(preferred);
  if (!exists(resolved)) return resolved;
  const separator = resolved.includes('/') ? '/' : '\\';
  const parent = resolved.slice(0, resolved.lastIndexOf(separator));
  const base = resolved.slice(resolved.lastIndexOf(separator) + 1);
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${parent}${separator}${base}-${suffix}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`cannot pick a free destination next to ${resolved}`);
}

/**
 * Relative path of a file inside a project, using forward slashes.
 * @param {string} root - project root.
 * @param {string} file - absolute file path.
 * @returns {string} relative posix path.
 */
export function projectRelativePath(root, file) {
  return relative(root, file).split(sep).join('/');
}
