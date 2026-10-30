/**
 * Self-check for the host half: plugin registration (tools + Web routes),
 * config normalization, project resolution and attachment carry-over.
 *
 * Run: node test/host.test.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { apply, listArchives } from '../index.js';
import { normalizeConfig, listProjects, resolveProject, resolveArchivePath, defaultArchiveDir } from '../lib/host.js';
import { collectAttachmentRefs, collectAttachmentsForExport, restoreAttachment } from '../lib/attachments.js';

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

const project = {
  id: 'workspace-1',
  path: 'C:\\work\\demo',
  title: 'Demo project',
  sessionIds: ['session-a', 'session-b'],
};
const other = { id: 'workspace-2', path: 'D:\\other\\second', title: 'Second', sessionIds: [] };
const registry = {
  list: () => [project, other],
  get: (id) => [project, other].find((entry) => entry.id === id),
  resolveByPath: () => undefined,
  create: async () => project,
};
const services = { workspaceRegistry: registry };
const ctx = {
  effect: (fn) => fn(),
  tools: {
    register(config) {
      tools.push(config);
      return () => {};
    },
  },
  connection: {
    fetch: {
      register(config) {
        routes.push(config);
        return () => {};
      },
    },
  },
  get: (name) => services[name],
};
const tools = [];
const routes = [];
apply(ctx, { archiveDir: '' });
check('registers three model tools', tools.map((tool) => tool.name).sort(), ['project_export', 'project_import', 'project_list']);
check('registers web routes', routes.map((route) => route.path).sort(), [
  '/api/portability/export',
  '/api/portability/import',
  '/api/portability/projects',
  '/api/portability/summary',
  '/api/portability/version',
]);
check('export route is POST', routes.find((route) => route.path === '/api/portability/export').methods, ['POST']);
check('tool schemas require their key argument', tools.find((tool) => tool.name === 'project_export').parameters.required, ['project']);

const config = normalizeConfig({ excludeNames: ['node_modules', ''], fileChecksums: true });
check('config includeSessions default', config.includeSessions, true);
check('config filters empty excludes', config.excludeNames, ['node_modules']);
check('config archiveDir default is under DSH_HOME', defaultArchiveDir(config).endsWith(join('', 'exports')), true);
check('listProjects maps sessions', listProjects(ctx), [
  { id: 'workspace-1', path: 'C:\\work\\demo', title: 'Demo project', sessionCount: 2 },
  { id: 'workspace-2', path: 'D:\\other\\second', title: 'Second', sessionCount: 0 },
]);
check('resolveProject by id', resolveProject(ctx, 'workspace-1').id, 'workspace-1');
check('resolveProject by path', resolveProject(ctx, 'D:\\OTHER\\second').id, 'workspace-2');
check('resolveProject by title substring', resolveProject(ctx, 'demo').id, 'workspace-1');
let missing = '';
try {
  resolveProject(ctx, 'nope');
} catch (error) {
  missing = error.message;
}
check('resolveProject rejects unknown', missing.includes('project not found'), true);

const archivePath = resolveArchivePath(undefined, normalizeConfig({}), project);
check('default archive name ends with extension', archivePath.endsWith('.dshpack'), true);
check('default archive name carries project title', archivePath.includes('Demo project'), true);
const explicit = resolveArchivePath('D:\\backup\\demo', normalizeConfig({}), project);
check('explicit path gains extension', explicit, 'D:\\backup\\demo.dshpack');
const dirPath = resolveArchivePath(join(tmpdir(), 'dshpack-dir'), normalizeConfig({}), project);
check('existing directory is a directory target', dirPath.endsWith('.dshpack'), true);

// --- attachments -----------------------------------------------------------
const sha256 = createHash('sha256').update('image-bytes').digest('hex');
const dshHome = mkdtempSync(join(tmpdir(), 'dsh-home-a-'));
const objectDir = join(dshHome, 'attachments', 'v1', 'objects', sha256.slice(0, 2));
mkdirSync(objectDir, { recursive: true });
writeFileSync(join(objectDir, sha256), 'image-bytes');
const events = [
  { type: 'user/message', seq: 0, data: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${sha256}`, mediaType: 'image/png' } }] } },
  { type: 'user/message', seq: 1, data: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${sha256}` } }] } },
];
check('collectAttachmentRefs dedupes', collectAttachmentRefs(events).length, 1);
check('collectAttachmentRefs nested', collectAttachmentRefs(events)[0].attachmentId, `sha256:${sha256}`);
const collected = collectAttachmentsForExport({ get: () => undefined }, events, { dshHome });
check('attachment collected', collected.entries.length, 1);
check('attachment archive path', collected.entries[0].archivePath, `attachments/objects/${sha256.slice(0, 2)}/${sha256}`);
check('attachment bytes', collected.entries[0].bytes, 11);
const dshHomeB = mkdtempSync(join(tmpdir(), 'dsh-home-b-'));
const restoredPath = await restoreAttachment(dshHomeB, collected.entries[0].archivePath, Buffer.from(readFileSync(collected.entries[0].absPath)));
check('attachment restored', existsSync(restoredPath), true);
check('attachment restored bytes', readFileSync(restoredPath, 'utf8'), 'image-bytes');
check('restored under objects layout', restoredPath.includes(join('attachments', 'v1', 'objects', sha256.slice(0, 2), sha256)), true);

// --- archive listing -------------------------------------------------------
const archivesDir = mkdtempSync(join(tmpdir(), 'dshpack-archives-'));
writeFileSync(join(archivesDir, 'a.dshpack'), 'x');
writeFileSync(join(archivesDir, 'b.txt'), 'x');
const listed = await listArchives(archivesDir);
check('listArchives filters extension', listed.map((entry) => entry.name), ['a.dshpack']);

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
