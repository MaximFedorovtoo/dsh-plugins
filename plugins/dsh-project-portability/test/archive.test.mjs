/**
 * Self-check for manifest validation, archive pack/unpack and destination
 * selection.
 *
 * Run: node test/archive.test.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { packArchive, unpackArchive, readManifest, pickDestination } from '../lib/archive.js';
import { buildManifest, validateManifest, summarizeManifest } from '../lib/manifest.js';

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

/** SHA-256 of a file. */
function sha(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const projectDir = mkdtempSync(join(tmpdir(), 'dshpack-project-'));
const extractDir = mkdtempSync(join(tmpdir(), 'dshpack-extract-'));
const archivePath = join(tmpdir(), `dshpack-archive-${process.pid}.dshpack`);

mkdirSync(join(projectDir, 'src'), { recursive: true });
mkdirSync(join(projectDir, 'empty'), { recursive: true });
writeFileSync(join(projectDir, 'README.md'), '# demo\n');
writeFileSync(join(projectDir, 'src', 'index.js'), 'export const answer = 42;\n');
writeFileSync(join(projectDir, 'src', 'данные.json'), '{"тест":true}\n');
writeFileSync(join(projectDir, 'empty', 'placeholder.txt'), 'x');

const sessions = [
  {
    meta: { id: 'session-11111111-1111-4111-8111-111111111111', title: 'Первая сессия', cwd: projectDir, createdAt: 1, updatedAt: 2, eventCount: 3 },
    events: [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 2, data: { role: 'user', content: [{ type: 'text', text: 'привет' }] }, surfaceOp: 'append' },
      { type: 'assistant/message', seq: 2, time: 3, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'готово' }] } }, surfaceOp: 'append' },
    ],
  },
  {
    meta: { id: 'session-22222222-2222-4222-8222-222222222222', title: 'Second', cwd: projectDir, createdAt: 4, updatedAt: 5, eventCount: 1 },
    events: [{ type: 'session/title', seq: 0, time: 6, data: { title: 'Second', messageSeqs: [], source: { kind: 'user' } } }],
  },
];

const packed = await packArchive({
  archivePath,
  manifest: {
    pluginVersion: '0.1.0',
    dshVersion: '0.2.1-rc.3',
    project: { name: 'demo', originalPath: projectDir },
    excluded: [],
  },
  projectDir,
  sessions,
  attachments: [],
});
check('packed file count', packed.files, 4);
check('packed session count', packed.sessions, 2);
check('archive exists', existsSync(archivePath), true);
check('archive non-empty', statSync(archivePath).size > 0, true);

const manifest = await readManifest(archivePath);
check('manifest format', manifest.format, 'dsh-project-portability');
check('manifest project files', manifest.project.files, 4);
check('manifest session count', manifest.sessions.length, 2);
check('manifest session paths', manifest.sessions.map((session) => session.archivePath), [
  'sessions/0000/events.jsonl',
  'sessions/0001/events.jsonl',
]);
check('manifest summary sessions', summarizeManifest(manifest).sessions, 2);
check('manifest summary events', summarizeManifest(manifest).eventCount, 4);

check('validate accepts own manifest', validateManifest(manifest).format, 'dsh-project-portability');
let rejected = '';
try {
  validateManifest({ format: 'other' });
} catch (error) {
  rejected = error.message;
}
check('validate rejects foreign archive', rejected.includes('not a dsh-project-portability archive'), true);
let newer = '';
try {
  validateManifest({ ...manifest, formatVersion: 99 });
} catch (error) {
  newer = error.message;
}
check('validate rejects newer format', newer.includes('newer plugin'), true);

/** @type {Array<{ meta: any, events: any[], index: number }>} */
const restored = [];
const unpacked = await unpackArchive({
  archivePath,
  projectDir: join(extractDir, 'demo'),
  onSession: (session) => restored.push(session),
});
check('unpacked file count', unpacked.files, 4);
check('unpacked bytes match', unpacked.bytes, packed.bytes);
check('unpacked sessions', restored.length, 2);
check('unpacked session order', restored.map((session) => session.index), [0, 1]);
check('session events survive', restored[0].events, sessions[0].events);
check('session meta survives', restored[0].meta.id, sessions[0].meta.id);
check('second session survives', restored[1].events, sessions[1].events);
check('no import errors', unpacked.errors, []);
check('no import warnings', unpacked.warnings, []);
check('files byte-identical', sha(join(extractDir, 'demo', 'src', 'index.js')), sha(join(projectDir, 'src', 'index.js')));
check('unicode file byte-identical', sha(join(extractDir, 'demo', 'src', 'данные.json')), sha(join(projectDir, 'src', 'данные.json')));
check('empty directory placeholder extracted', existsSync(join(extractDir, 'demo', 'empty', 'placeholder.txt')), true);

const free = join(tmpdir(), `dshpack-free-${process.pid}`);
check('pickDestination keeps a free path', pickDestination(free, () => false), free);
const taken = pickDestination(free, (candidate) => candidate === free);
check('pickDestination adds a suffix', taken.endsWith('-2') || taken.endsWith('\\-2') || taken.endsWith('/-2'), true);

// A failing session must not abort the rest.
const partial = await unpackArchive({
  archivePath,
  projectDir: join(extractDir, 'demo2'),
  onSession: () => {
    throw new Error('boom');
  },
});
check('session failure collected', partial.errors.length, 2);
check('session failure keeps files', partial.files, 4);

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
