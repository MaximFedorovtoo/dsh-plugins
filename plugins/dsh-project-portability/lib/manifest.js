/**
 * Manifest of a `.dshpack` archive: the portable, self-describing description
 * of the project, its chats and the payload layout. Kept deliberately small and
 * versioned so an archive written by an older plugin stays importable by a
 * newer one (and the other way round is refused with a clear message).
 *
 * @module dsh-project-portability/lib/manifest
 */

/** Archive format marker stored in every manifest. */
export const ARCHIVE_FORMAT = 'dsh-project-portability';
/** Format version this plugin writes and reads. */
export const ARCHIVE_FORMAT_VERSION = 1;

/**
 * Build a manifest object.
 * @param {object} input - manifest facts.
 * @param {string} input.pluginVersion - writer plugin version.
 * @param {string} [input.dshVersion] - DSH version that produced the archive.
 * @param {{ name: string, originalPath: string, files?: number, bytes?: number, checksums?: Record<string,string>|null }} input.project - project facts.
 * @param {Array<object>} [input.sessions] - per-chat descriptors.
 * @param {Array<object>} [input.attachments] - copied attachment/spill blobs.
 * @param {string[]} [input.excluded] - names skipped by configuration.
 * @param {string} [input.createdAt] - ISO timestamp; defaults to now.
 * @returns {object} manifest ready to serialize as `manifest.json`.
 */
export function buildManifest(input) {
  const project = input.project ?? {};
  return {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    pluginVersion: String(input.pluginVersion ?? '0.0.0'),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    dshVersion: typeof input.dshVersion === 'string' ? input.dshVersion : null,
    platform: { platform: process.platform, arch: process.arch },
    project: {
      name: String(project.name ?? ''),
      originalPath: String(project.originalPath ?? ''),
      archivePath: 'project/',
      files: Number(project.files ?? 0),
      bytes: Number(project.bytes ?? 0),
      checksums: project.checksums ?? null,
    },
    sessions: Array.isArray(input.sessions) ? input.sessions : [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    excluded: Array.isArray(input.excluded) ? input.excluded : [],
  };
}

/**
 * Validate and normalize a parsed manifest. Throws a descriptive Error when the
 * archive is not ours or uses a format this plugin cannot read.
 * @param {unknown} value - parsed `manifest.json`.
 * @returns {object} the same manifest, normalized.
 */
export function validateManifest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('manifest.json must be a JSON object');
  }
  const manifest = /** @type {Record<string, any>} */ (value);
  if (manifest.format !== ARCHIVE_FORMAT) {
    throw new Error(`not a ${ARCHIVE_FORMAT} archive (format ${JSON.stringify(manifest.format)})`);
  }
  if (!Number.isSafeInteger(manifest.formatVersion) || manifest.formatVersion < 1) {
    throw new Error(`archive formatVersion is invalid: ${JSON.stringify(manifest.formatVersion)}`);
  }
  if (manifest.formatVersion > ARCHIVE_FORMAT_VERSION) {
    throw new Error(
      `archive format v${manifest.formatVersion} was written by a newer plugin; this plugin reads up to v${ARCHIVE_FORMAT_VERSION} — update dsh-project-portability`,
    );
  }
  if (manifest.project === null || typeof manifest.project !== 'object') {
    throw new Error('manifest.project must be an object');
  }
  if (typeof manifest.project.name !== 'string' || manifest.project.name.trim().length === 0) {
    throw new Error('manifest.project.name must be a non-empty string');
  }
  if (!Array.isArray(manifest.sessions)) throw new Error('manifest.sessions must be an array');
  for (const [index, session] of manifest.sessions.entries()) {
    if (session === null || typeof session !== 'object') throw new Error(`manifest.sessions[${index}] must be an object`);
    if (typeof session.id !== 'string' || session.id.length === 0) throw new Error(`manifest.sessions[${index}].id must be a non-empty string`);
    if (typeof session.archivePath !== 'string' || session.archivePath.length === 0) {
      throw new Error(`manifest.sessions[${index}].archivePath must be a non-empty string`);
    }
  }
  if (manifest.attachments !== undefined && !Array.isArray(manifest.attachments)) {
    throw new Error('manifest.attachments must be an array when present');
  }
  return manifest;
}

/**
 * Human-readable archive summary for tool output and the UI.
 * @param {object} manifest - validated manifest.
 * @returns {object} summary facts.
 */
export function summarizeManifest(manifest) {
  const sessions = Array.isArray(manifest.sessions) ? manifest.sessions : [];
  const counted = sessions.filter((session) => Number.isSafeInteger(session.eventCount));
  return {
    format: manifest.format,
    formatVersion: manifest.formatVersion,
    createdAt: manifest.createdAt,
    dshVersion: manifest.dshVersion,
    projectName: manifest.project?.name ?? '',
    originalPath: manifest.project?.originalPath ?? '',
    files: manifest.project?.files ?? 0,
    bytes: manifest.project?.bytes ?? 0,
    sessions: sessions.length,
    eventCount: counted.length === sessions.length && counted.length > 0 ? counted.reduce((sum, session) => sum + session.eventCount, 0) : null,
    attachments: Array.isArray(manifest.attachments) ? manifest.attachments.length : 0,
  };
}
