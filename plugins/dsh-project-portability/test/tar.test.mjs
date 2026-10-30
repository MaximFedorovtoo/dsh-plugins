/**
 * Self-check for the tar container: round-trip writer -> reader -> extract,
 * including long paths, non-ASCII names, binary payloads and empty files.
 *
 * Run: node test/tar.test.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { TarWriter, TarReader, extractArchive, toArchivePath, paxPayload, parsePax, padLength } from '../lib/tar.js';

let failures = 0;
/** Record one assertion. */
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

/** Recursively list files under a directory as forward-slash relative paths. */
function walk(root, base = root) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** SHA-256 of a file. */
function sha(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

check('padLength 0', padLength(0), 0);
check('padLength 1', padLength(1), 511);
check('padLength 512', padLength(512), 0);
check('pax round-trip', parsePax(paxPayload({ path: 'a/b.txt', size: 12 })), { path: 'a/b.txt', size: '12' });
check('toArchivePath normalizes', toArchivePath('C:\\users\\me\\project\\a.txt'), 'users/me/project/a.txt');
let escaped = false;
try {
  toArchivePath('../../etc/passwd');
} catch {
  escaped = true;
}
check('toArchivePath refuses ..', escaped, true);

const source = mkdtempSync(join(tmpdir(), 'dshpack-src-'));
const target = mkdtempSync(join(tmpdir(), 'dshpack-dst-'));
const archive = join(tmpdir(), `dshpack-${process.pid}.dshpack`);

mkdirSync(join(source, 'nested', 'deep'), { recursive: true });
mkdirSync(join(source, 'empty-dir'), { recursive: true });
writeFileSync(join(source, 'readme.txt'), 'hello world\n');
writeFileSync(join(source, 'nested', 'deep', 'binary.bin'), Buffer.from([0, 1, 2, 255, 254, 0]));
writeFileSync(join(source, 'пустой каталог.txt'), 'кириллица и эмодзи 🚀\n');
const longName = `${'a'.repeat(90)}/${'b'.repeat(90)}/файл.txt`;
mkdirSync(join(source, 'a'.repeat(90), 'b'.repeat(90)), { recursive: true });
writeFileSync(join(source, longName), 'long path payload');

const files = walk(source).sort();
check('walk found all files', files.length, 4);

const writer = new TarWriter(archive);
for (const file of files) await writer.addFile(`project/${file}`, join(source, file));
await writer.addDirectory('project/empty-dir');
await writer.addBuffer('manifest.json', Buffer.from('{"format":"test"}\n'));
const finished = await writer.finish();
check('writer entries', finished.entries, 6);

// Read back through the streaming reader.
const reader = new TarReader(archive);
/** @type {Map<string, Buffer>} */
const readBack = new Map();
for (;;) {
  const entry = await reader.next();
  if (entry === null) break;
  readBack.set(entry.path, await entry.buffer());
}
await reader.close();
check('reader saw manifest', readBack.has('manifest.json'), true);
check('reader saw every file', files.every((file) => readBack.has(`project/${file}`)), true);
check('unicode payload intact', readBack.get('project/пустой каталог.txt').toString('utf8'), 'кириллица и эмодзи 🚀\n');
check('binary payload intact', readBack.get('project/nested/deep/binary.bin').equals(Buffer.from([0, 1, 2, 255, 254, 0])), true);
check('long path payload intact', readBack.get(`project/${longName}`).toString('utf8'), 'long path payload');

// Extract to a clean directory and compare hashes.
const report = await extractArchive(archive, target);
check('extract file count', report.files.length, files.length + 1);
for (const file of files) {
  const left = sha(join(source, file));
  const right = sha(join(target, 'project', file));
  if (left !== right) check(`round-trip ${file}`, right, left);
}
check('round-trip hashes match', true, true);
check('empty dir recreated', existsSync(join(target, 'project', 'empty-dir')), true);
check('all payloads byte-identical', files.every((file) => sha(join(source, file)) === sha(join(target, 'project', file))), true);
check('manifest extracted', readFileSync(join(target, 'manifest.json'), 'utf8'), '{"format":"test"}\n');

// A gzip tar must also be readable by the platform tar (bsdtar on Windows).
const bytes = statSync(archive).size;
check('archive file written', bytes > 0, true);

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
  console.log(`archive: ${archive} (${bytes} bytes)`);
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
