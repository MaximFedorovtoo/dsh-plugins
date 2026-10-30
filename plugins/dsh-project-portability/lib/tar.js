/**
 * Minimal, dependency-free tar (ustar + PAX) writer/reader with gzip framing.
 *
 * Why not ZIP: a project archive may legally exceed the 4 GiB ZIP32 limit, and
 * ZIP64 support would add a large amount of format code. POSIX tar has no such
 * practical limit, streams naturally, and a `.dshpack` file is a plain gzipped
 * tar that any archiver (7-Zip, bsdtar, tar) can inspect.
 *
 * Long/non-ASCII paths are always emitted through a PAX (`x`) extended header,
 * so archives stay valid for project trees on any platform.
 *
 * This module is pure I/O over Node built-ins; it knows nothing about DSH.
 *
 * @module dsh-project-portability/lib/tar
 */
import { createReadStream, createWriteStream, openSync, readSync, closeSync, statSync } from 'node:fs';
import { createGzip, createGunzip } from 'node:zlib';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { posix } from 'node:path';

/** Tar block size in bytes. */
export const BLOCK = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK);
const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * Pad to the next tar block boundary.
 * @param {number} length - payload length in bytes.
 * @returns {number} padding byte count (0..511).
 */
export function padLength(length) {
  return (BLOCK - (length % BLOCK)) % BLOCK;
}

/**
 * Normalize a path for storage inside the archive: forward slashes, no leading
 * slash, no `.`/`..` segments, no drive letters.
 * @param {string} value - platform path or archive path.
 * @returns {string} normalized relative archive path ('' for the root).
 */
export function toArchivePath(value) {
  const slashed = String(value).replace(/\\/g, '/');
  const parts = slashed.split('/');
  /** @type {string[]} */
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new Error(`archive path escapes the root: ${JSON.stringify(value)}`);
    if (/^[A-Za-z]:$/.test(part)) continue;
    out.push(part);
  }
  return out.join('/');
}

/**
 * Join archive paths with forward slashes.
 * @param {...string} parts - path fragments.
 * @returns {string} joined archive path.
 */
export function joinArchivePath(...parts) {
  const joined = parts
    .filter((part) => typeof part === 'string' && part.length > 0)
    .map((part) => toArchivePath(part))
    .filter((part) => part.length > 0)
    .join('/');
  return joined;
}

/**
 * Whether a name must travel in a PAX extended header.
 * ustar's name field is 100 bytes and PAX is the portable way to carry
 * non-ASCII or longer names.
 * @param {string} name - archive path.
 * @returns {boolean} true when a PAX record is required.
 */
function needsPax(name) {
  // eslint-disable-next-line no-control-regex
  return Buffer.byteLength(name, 'utf8') > 100 || /[^\x20-\x7e]/.test(name);
}

/**
 * Write an octal field with the conventional trailing NUL (or space for the
 * checksum), falling back to GNU base-256 for values that do not fit.
 * @param {Buffer} buffer - header buffer.
 * @param {number} offset - field offset.
 * @param {number} width - field width including terminator.
 * @param {number} value - non-negative integer.
 * @param {string} [terminator] - '\0' or ' '.
 */
function writeNumeric(buffer, offset, width, value, terminator = '\0') {
  const digits = width - 1;
  const limit = 8 ** digits;
  if (value >= 0 && value < limit) {
    const text = Math.trunc(value).toString(8).padStart(digits, '0');
    buffer.write(text, offset, digits, 'ascii');
    buffer.write(terminator, offset + digits, 1, 'ascii');
    return;
  }
  // GNU base-256: high bit of the first byte set, remaining bytes big-endian.
  buffer[offset] = 0x80;
  let rest = BigInt(Math.trunc(value));
  for (let index = width - 1; index > 0; index -= 1) {
    buffer[offset + index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest > 0n) throw new Error(`tar numeric field overflow: ${value}`);
}

/**
 * Read an octal or GNU base-256 numeric field.
 * @param {Buffer} buffer - header buffer.
 * @param {number} offset - field offset.
 * @param {number} width - field width.
 * @returns {number} parsed value.
 */
function readNumeric(buffer, offset, width) {
  const first = buffer[offset];
  if ((first & 0x80) !== 0) {
    let value = 0n;
    for (let index = 0; index < width; index += 1) value = (value << 8n) | BigInt(buffer[offset + index]);
    // Clear the base-256 marker bit.
    return Number(value & ((1n << BigInt(width * 8 - 1)) - 1n));
  }
  const text = buffer.toString('ascii', offset, offset + width).replace(/\0.*$/, '').trim();
  if (text.length === 0) return 0;
  const parsed = Number.parseInt(text, 8);
  if (!Number.isFinite(parsed)) throw new Error(`invalid tar octal field: ${JSON.stringify(text)}`);
  return parsed;
}

/**
 * Build one PAX extended-header payload from records.
 * @param {Record<string, string | number>} records - PAX keys to values.
 * @returns {Buffer} payload bytes.
 */
export function paxPayload(records) {
  /** @type {string[]} */
  const lines = [];
  for (const [key, value] of Object.entries(records)) {
    const body = `${key}=${value}\n`;
    // The length prefix includes its own decimal digits and the following space.
    let length = Buffer.byteLength(body, 'utf8');
    let total = length + 1 + String(length).length;
    while (String(total).length + 1 + Buffer.byteLength(body, 'utf8') !== total) {
      total = String(total).length + 1 + Buffer.byteLength(body, 'utf8');
    }
    lines.push(`${total} ${body}`);
  }
  return Buffer.from(lines.join(''), 'utf8');
}

/**
 * Parse a PAX payload into key/value records.
 * @param {Buffer} payload - PAX payload bytes.
 * @returns {Record<string, string>} parsed records.
 */
export function parsePax(payload) {
  /** @type {Record<string, string>} */
  const records = {};
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(payload.toString('ascii', offset, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = payload.subarray(space + 1, offset + length);
    const text = record.toString('utf8').replace(/\n$/, '');
    const equals = text.indexOf('=');
    if (equals > 0) records[text.slice(0, equals)] = text.slice(equals + 1);
    offset += length;
  }
  return records;
}

/**
 * Build a ustar header block.
 * @param {string} name - archive path (must fit the name field).
 * @param {object} options - entry facts.
 * @returns {Buffer} 512-byte header.
 */
function buildHeader(name, { size = 0, mode = 0o644, mtime = Math.floor(Date.now() / 1000), type = '0', linkname = '' } = {}) {
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100, 'utf8');
  writeNumeric(header, 100, 8, mode);
  writeNumeric(header, 108, 8, 0);
  writeNumeric(header, 116, 8, 0);
  writeNumeric(header, 124, 12, size);
  writeNumeric(header, 136, 12, mtime);
  header.fill(0x20, 148, 156); // checksum placeholder
  header.write(type, 156, 1, 'ascii');
  if (linkname.length > 0) header.write(linkname, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('root', 265, 32, 'ascii');
  header.write('root', 297, 32, 'ascii');
  writeNumeric(header, 329, 8, 0);
  writeNumeric(header, 337, 8, 0);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

/**
 * Streaming tar writer.
 */
export class TarWriter {
  /**
   * @param {string} filePath - destination `.dshpack` path.
   * @param {{ level?: number }} [options] - gzip options.
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this._gzip = createGzip({ level: options.level ?? 6 });
    this._sink = createWriteStream(filePath);
    this._gzip.pipe(this._sink);
    this._failure = null;
    this._sink.on('error', (error) => { this._failure = error; });
    this._gzip.on('error', (error) => { this._failure = error; });
    this._finished = false;
    this.entryCount = 0;
    this.bytesIn = 0;
  }

  /**
   * Push bytes into the gzip stream with backpressure.
   * @param {Buffer} buffer - bytes.
   */
  async _write(buffer) {
    if (this._failure) throw this._failure;
    if (this._gzip.write(buffer) === false) await once(this._gzip, 'drain');
    if (this._failure) throw this._failure;
  }

  /**
   * Emit one header plus an optional PAX record for long/unicode names.
   * @param {string} archivePath - normalized archive path.
   * @param {object} facts - size, mode, mtime, type.
   */
  async _emitHeader(archivePath, facts) {
    if (needsPax(archivePath)) {
      const payload = paxPayload({ path: archivePath });
      await this._write(buildHeader(`PaxHeader/${posix.basename(archivePath).slice(0, 80)}`, { size: payload.length, type: 'x', mtime: facts.mtime }));
      await this._write(payload);
      const pad = padLength(payload.length);
      if (pad > 0) await this._write(Buffer.alloc(pad));
    }
    const name = Buffer.byteLength(archivePath, 'utf8') > 100 ? archivePath.slice(0, 80) : archivePath;
    await this._write(buildHeader(name, facts));
    this.entryCount += 1;
  }

  /**
   * Add a directory entry.
   * @param {string} archivePath - archive path.
   * @param {{ mtime?: number, mode?: number }} [options] - entry facts.
   */
  async addDirectory(archivePath, options = {}) {
    const path = joinArchivePath(archivePath);
    if (path.length === 0) return;
    await this._emitHeader(`${path}/`, {
      mode: options.mode ?? 0o755,
      mtime: options.mtime ?? Math.floor(Date.now() / 1000),
      type: '5',
    });
  }

  /**
   * Add an in-memory buffer.
   * @param {string} archivePath - archive path.
   * @param {Buffer} buffer - file bytes.
   * @param {{ mtime?: number, mode?: number }} [options] - entry facts.
   */
  async addBuffer(archivePath, buffer, options = {}) {
    const path = joinArchivePath(archivePath);
    if (path.length === 0) throw new Error('archive path must not be empty');
    const mtime = options.mtime ?? Math.floor(Date.now() / 1000);
    await this._emitHeader(path, { size: buffer.length, mode: options.mode ?? 0o644, mtime, type: '0' });
    if (buffer.length > 0) await this._write(buffer);
    const pad = padLength(buffer.length);
    if (pad > 0) await this._write(Buffer.alloc(pad));
    this.bytesIn += buffer.length;
  }

  /**
   * Add a file from disk by streaming it.
   * @param {string} archivePath - archive path.
   * @param {string} sourcePath - absolute source path.
   */
  async addFile(archivePath, sourcePath) {
    const stats = statSync(sourcePath);
    const path = joinArchivePath(archivePath);
    const mtime = Math.floor(stats.mtimeMs / 1000);
    await this._emitHeader(path, { size: stats.size, mode: stats.mode & 0o777, mtime, type: '0' });
    if (stats.size > 0) {
      for await (const chunk of createReadStream(sourcePath)) await this._write(chunk);
    }
    const pad = padLength(stats.size);
    if (pad > 0) await this._write(Buffer.alloc(pad));
    this.bytesIn += stats.size;
  }

  /**
   * Finish the archive: two zero blocks, gzip trailer, flushed file.
   * @returns {Promise<{ entries: number, bytes: number, path: string }>} archive facts.
   */
  async finish() {
    if (this._finished) throw new Error('tar writer already finished');
    this._finished = true;
    await this._write(ZERO_BLOCK);
    await this._write(ZERO_BLOCK);
    this._gzip.end();
    await once(this._sink, 'finish');
    if (this._failure) throw this._failure;
    return { entries: this.entryCount, bytes: this.bytesIn, path: this.filePath };
  }
}

/**
 * Pull-based byte reader over an async stream, buffering short reads.
 */
class ByteReader {
  /** @param {import('node:stream').Readable} stream - source stream. */
  constructor(stream) {
    /** @type {Buffer[]} */
    this._chunks = [];
    this._length = 0;
    this._ended = false;
    /** @type {Error | null} */
    this._error = null;
    /** @type {(() => void) | null} */
    this._wake = null;
    stream.on('data', (chunk) => {
      this._chunks.push(chunk);
      this._length += chunk.length;
      this._notify();
    });
    stream.on('end', () => { this._ended = true; this._notify(); });
    stream.on('error', (error) => { this._error = error; this._notify(); });
  }

  /** Wake a pending reader. */
  _notify() {
    if (this._wake !== null) {
      const wake = this._wake;
      this._wake = null;
      wake();
    }
  }

  /**
   * Read exactly `size` bytes, or fewer only at EOF.
   * @param {number} size - requested bytes.
   * @returns {Promise<Buffer | null>} bytes, or null at a clean EOF.
   */
  async read(size) {
    while (this._length < size && !this._ended && this._error === null) {
      await new Promise((resolve) => { this._wake = resolve; });
    }
    if (this._error !== null) throw this._error;
    if (this._length === 0) return size === 0 ? Buffer.alloc(0) : null;
    return this._take(Math.min(size, this._length));
  }

  /**
   * Consume `size` bytes from the internal buffers.
   * @param {number} size - byte count.
   * @returns {Buffer} consumed bytes.
   */
  _take(size) {
    if (size === 0) return Buffer.alloc(0);
    const out = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const head = this._chunks[0];
      const need = size - offset;
      if (head.length <= need) {
        head.copy(out, offset);
        offset += head.length;
        this._chunks.shift();
      } else {
        head.copy(out, offset, 0, need);
        this._chunks[0] = head.subarray(need);
        offset += need;
      }
    }
    this._length -= size;
    return out;
  }
}

/**
 * Streaming tar reader. Entries must have their data consumed (or the reader
 * drains it) before requesting the next entry.
 */
export class TarReader {
  /**
   * @param {string} filePath - source `.dshpack` path (gzip or plain tar).
   */
  constructor(filePath) {
    this.filePath = filePath;
    this._source = createReadStream(filePath);
    const compressed = isGzipFile(filePath);
    /** @type {import('node:stream').Readable} */
    const plain = compressed ? this._source.pipe(createGunzip()) : this._source;
    this._reader = new ByteReader(plain);
    this._plain = plain;
    this._current = { remaining: 0, padding: 0 };
    this._done = false;
    this._warnings = [];
    this._open = false;
    this._closed = false;
  }

  /**
   * Non-fatal problems met while reading (checksum mismatches, unknown types).
   * @returns {string[]} warnings.
   */
  get warnings() {
    return this._warnings;
  }

  /**
   * Read the next entry. The returned entry owns the stream until the next call.
   * @returns {Promise<{ path: string, type: string, size: number, mode: number, mtime: number, stream: () => AsyncGenerator<Buffer>, buffer: () => Promise<Buffer> } | null>}
   */
  async next() {
    if (this._done) return null;
    await this._drainCurrent();
    /** @type {Record<string, string>} */
    let overrides = {};
    for (;;) {
      const block = await this._reader.read(BLOCK);
      if (block === null) { this._done = true; return null; }
      if (isZeroBlock(block)) {
        // One zero block ends a well-formed tar; consume the second if present.
        this._done = true;
        return null;
      }
      let header;
      try {
        header = parseHeader(block);
      } catch (error) {
        this._warnings.push(String(error));
        this._done = true;
        throw error;
      }
      const type = header.type;
      if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
        const payload = header.size > 0 ? await this._reader.read(header.size) : Buffer.alloc(0);
        if (payload === null) throw new Error('truncated tar: missing extended header payload');
        await this._skip(padLength(header.size));
        if (type === 'x' || type === 'g') overrides = { ...overrides, ...parsePax(payload) };
        else if (type === 'L') overrides.path = payload.toString('utf8').replace(/\0.*$/, '');
        else if (type === 'K') overrides.linkpath = payload.toString('utf8').replace(/\0.*$/, '');
        continue;
      }
      const path = overrides.path ?? header.path;
      const size = overrides.size !== undefined ? Number.parseInt(overrides.size, 10) : header.size;
      this._current = { remaining: size, padding: padLength(size), size };
      const self = this;
      return {
        path,
        type,
        size,
        mode: header.mode,
        mtime: header.mtime,
        realSize: header.size,
        async *stream() {
          let left = size;
          while (left > 0) {
            const chunk = await self._reader.read(Math.min(left, 256 * 1024));
            if (chunk === null) throw new Error(`truncated tar: entry "${path}" ends early`);
            left -= chunk.length;
            yield chunk;
          }
          self._current.remaining = 0;
          await self._skip(padLength(size));
          self._current.padding = 0;
        },
        async buffer() {
          const parts = [];
          for await (const chunk of this.stream()) parts.push(chunk);
          return Buffer.concat(parts);
        },
      };
    }
  }

  /**
   * Skip padding and any unconsumed payload of the current entry.
   */
  async _drainCurrent() {
    if (this._current.remaining > 0) {
      const chunk = await this._reader.read(this._current.remaining);
      if (chunk !== null) this._current.remaining -= chunk.length;
    }
    if (this._current.padding > 0) {
      await this._skip(this._current.padding);
      this._current.padding = 0;
    }
  }

  /**
   * Skip exactly `size` bytes.
   * @param {number} size - bytes to skip.
   */
  async _skip(size) {
    let left = size;
    while (left > 0) {
      const chunk = await this._reader.read(Math.min(left, 256 * 1024));
      if (chunk === null) throw new Error('truncated tar: unexpected EOF while skipping');
      left -= chunk.length;
    }
  }

  /** Release the underlying stream. */
  async close() {
    if (this._closed) return;
    this._closed = true;
    this._plain.destroy();
    this._source.destroy();
  }
}

/**
 * Check whether a file begins with the gzip magic bytes.
 * @param {string} filePath - file to inspect.
 * @returns {boolean} true for gzip.
 */
export function isGzipFile(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(2);
    readSync(fd, head, 0, 2, 0);
    return head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
  } finally {
    closeSync(fd);
  }
}

/** @param {Buffer} block - tar block. @returns {boolean} true when all zero. */
function isZeroBlock(block) {
  for (const byte of block) if (byte !== 0) return false;
  return true;
}

/**
 * Parse a 512-byte tar header.
 * @param {Buffer} block - header block.
 * @returns {{ path: string, mode: number, size: number, mtime: number, type: string, linkname: string }}
 */
function parseHeader(block) {
  const name = block.toString('utf8', 0, 100).replace(/\0.*$/, '');
  const prefix = block.toString('utf8', 345, 500).replace(/\0.*$/, '');
  const magic = block.toString('ascii', 257, 263);
  if (magic !== 'ustar\0') throw new Error(`unsupported tar flavour (magic ${JSON.stringify(magic)})`);
  const storedChecksum = readNumeric(block, 148, 8);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : block[index];
  }
  if (storedChecksum !== 0 && storedChecksum !== sum) {
    throw new Error(`tar header checksum mismatch (stored ${storedChecksum}, computed ${sum})`);
  }
  const type = String.fromCharCode(block[156] || 0x30);
  return {
    path: prefix.length > 0 ? `${prefix}/${name}` : name,
    mode: readNumeric(block, 100, 8),
    size: readNumeric(block, 124, 12),
    mtime: readNumeric(block, 136, 12),
    type,
    linkname: block.toString('utf8', 157, 257).replace(/\0.*$/, ''),
  };
}

/**
 * Extract every entry of an archive to a destination directory.
 * Only regular files and directories are written; symlinks/others are reported.
 * @param {string} archivePath - `.dshpack` path.
 * @param {string} destination - target directory.
 * @returns {Promise<{ files: string[], directories: string[], skipped: string[] }>} extraction report.
 */
export async function extractArchive(archivePath, destination) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const reader = new TarReader(archivePath);
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const directories = [];
  /** @type {string[]} */
  const skipped = [];
  try {
    for (;;) {
      const entry = await reader.next();
      if (entry === null) break;
      const relative = toArchivePath(entry.path);
      if (relative.length === 0) continue;
      const target = join(destination, relative);
      if (entry.type === '5' || entry.type === 'd') {
        await mkdir(target, { recursive: true });
        directories.push(relative);
        continue;
      }
      if (entry.type !== '0' && entry.type !== '\0') {
        skipped.push(`${entry.path} (type ${entry.type})`);
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      const chunks = [];
      for await (const chunk of entry.stream()) chunks.push(chunk);
      await writeFile(target, Buffer.concat(chunks));
      files.push(relative);
    }
  } finally {
    await reader.close();
  }
  return { files, directories, skipped };
}
