/**
 * Attachment carry-over: images and uploaded files referenced by session events
 * live in a content-addressed store below `<DSH_HOME>/attachments/v1`
 * (`objects/<xx>/<sha>`, `file-objects/<xx>/<sha>`, `files/<xx>/<sha>/<name>`).
 * Because the store is content-addressed, copying the objects with the same
 * bytes is enough to keep every historical reference valid on the target
 * machine — no event rewriting and no re-upload.
 *
 * @module dsh-project-portability/lib/attachments
 */
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';

/** Attachment reference id shape produced by @deepseek-ai/dsh-attachment. */
const ATTACHMENT_ID = /^sha256:([0-9a-f]{64})$/i;

/**
 * Resolve `DSH_HOME` the same way the host does.
 * @returns {string} absolute DSH home directory.
 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return join(homedir(), '.dsh');
}

/**
 * Absolute attachment store root.
 * @param {string} [dshHome] - DSH home override.
 * @returns {string} absolute `attachments/v1` root.
 */
export function attachmentRoot(dshHome = resolveDshHome()) {
  return join(dshHome, 'attachments', 'v1');
}

/**
 * Deep-walk a JSON value and collect every durable attachment reference.
 * @param {unknown} value - event log or any JSON fragment.
 * @returns {Array<object>} unique reference objects.
 */
export function collectAttachmentRefs(value) {
  /** @type {Map<string, object>} */
  const refs = new Map();
  /** @param {unknown} node */
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = /** @type {Record<string, unknown>} */ (node);
    const attachmentId = record.attachmentId;
    if (typeof attachmentId === 'string' && ATTACHMENT_ID.test(attachmentId) && !refs.has(attachmentId)) {
      refs.set(attachmentId, record);
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(value);
  return [...refs.values()];
}

/**
 * Candidate host paths for one content-addressed attachment.
 * @param {object} ref - attachment reference from a session event.
 * @param {string} root - attachment store root.
 * @param {object} [attachments] - mounted `ctx.attachments` service.
 * @returns {string[]} existing absolute paths (may be empty).
 */
export function attachmentHostPaths(ref, root, attachments) {
  /** @type {Set<string>} */
  const paths = new Set();
  for (const method of ['imageHostPath', 'fileHostPath']) {
    const candidate = attachments?.[method];
    if (typeof candidate !== 'function') continue;
    try {
      const resolved = candidate.call(attachments, ref);
      if (typeof resolved === 'string' && resolved.length > 0) paths.add(resolved);
    } catch {
      // A reference of the other kind is expected to throw; fall through to the
      // digest-derived candidates.
    }
  }
  const match = ATTACHMENT_ID.exec(String(ref.attachmentId));
  if (match !== null) {
    const sha256 = match[1].toLowerCase();
    const short = sha256.slice(0, 2);
    paths.add(join(root, 'objects', short, sha256));
    paths.add(join(root, 'file-objects', short, sha256));
    if (typeof ref.name === 'string' && ref.name.length > 0) {
      paths.add(join(root, 'files', short, sha256, ref.name));
    }
  }
  return [...paths].filter((path) => existsSync(path) && statSync(path).isFile());
}

/**
 * Archive-path spelling for one absolute attachment path.
 * @param {string} root - attachment store root.
 * @param {string} absolutePath - host path.
 * @returns {string} `attachments/<relative posix path>`.
 */
export function attachmentArchivePath(root, absolutePath) {
  const rel = relative(root, absolutePath).split(sep).join('/');
  return `attachments/${rel}`;
}

/**
 * Gather the blobs an export should carry.
 * @param {object} ctx - host plugin context.
 * @param {Array<object>} events - sessions' combined event logs.
 * @param {object} [options] - options.
 * @param {string} [options.dshHome] - DSH home override.
 * @returns {{ entries: Array<{ archivePath: string, absPath: string, attachmentId: string, bytes: number }>, missing: string[] }}
 */
export function collectAttachmentsForExport(ctx, events, options = {}) {
  const root = attachmentRoot(options.dshHome ?? resolveDshHome());
  const attachments = readService(ctx, 'attachments');
  /** @type {Map<string, { archivePath: string, absPath: string, attachmentId: string, bytes: number }>} */
  const entries = new Map();
  /** @type {string[]} */
  const missing = [];
  for (const ref of collectAttachmentRefs(events)) {
    const paths = attachmentHostPaths(ref, root, attachments);
    if (paths.length === 0) {
      missing.push(String(ref.attachmentId));
      continue;
    }
    for (const absPath of paths) {
      const archivePath = attachmentArchivePath(root, absPath);
      if (entries.has(archivePath)) continue;
      entries.set(archivePath, {
        archivePath,
        absPath,
        attachmentId: String(ref.attachmentId),
        bytes: statSync(absPath).size,
      });
    }
  }
  return { entries: [...entries.values()], missing };
}

/**
 * Restore archived blobs into the target attachment store.
 * @param {string} dshHome - target DSH home.
 * @param {string} archivePath - entry path (`attachments/...`).
 * @param {Buffer} buffer - blob bytes.
 * @returns {Promise<string>} absolute path written.
 */
export async function restoreAttachment(dshHome, archivePath, buffer) {
  const prefix = 'attachments/';
  if (!archivePath.startsWith(prefix)) throw new Error(`not an attachment entry: ${archivePath}`);
  const relativePath = archivePath.slice(prefix.length);
  const target = join(attachmentRoot(dshHome), relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return target;
}

/**
 * Read the mounted host service by Cordis name.
 * @param {object} ctx - plugin context.
 * @param {string} name - service name.
 * @returns {any} service or undefined.
 */
export function readService(ctx, name) {
  if (ctx === null || typeof ctx !== 'object') return undefined;
  if (typeof ctx.get === 'function') {
    try {
      const service = ctx.get(name);
      if (service !== undefined) return service;
    } catch {
      // Not every context exposes every service; fall through to the property.
    }
  }
  try {
    return ctx[name];
  } catch {
    return undefined;
  }
}

/**
 * List attachment object files present in a store (diagnostics/tests).
 * @param {string} dshHome - DSH home.
 * @returns {Promise<string[]>} relative posix paths.
 */
export async function listAttachmentObjects(dshHome) {
  const root = attachmentRoot(dshHome);
  if (!existsSync(root)) return [];
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  await visit(root);
  return out;
}
