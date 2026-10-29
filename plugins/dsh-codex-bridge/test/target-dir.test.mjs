/**
 * Self-check for the import target resolution that keeps a project in the same
 * folder instead of creating `-2`, `-3` copies.
 *
 * Run: node test/target-dir.test.mjs
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __internals } from '../index.js';

const { pickTargetDir, resolveCopyTarget, findImportedProject, readManifest, safeSegment } = __internals;

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

const root = await mkdtemp(join(tmpdir(), 'codex-import-test-'));
const manifest = (projectId) => ({ plugin: 'dsh-codex-bridge', version: 1, projectId, sessions: {} });

try {
  // 1. Nothing exists yet: the plain name is used.
  check('fresh root uses the plain name', (await resolveCopyTarget(root, 'alpha', 'p1')).dir, join(root, 'alpha'));

  // 2. An existing empty folder is a target, not an obstacle.
  await mkdir(join(root, 'empty'), { recursive: true });
  check('empty folder is reused', await resolveCopyTarget(root, 'empty', 'p1'), {
    dir: join(root, 'empty'),
    adopted: false,
  });

  // 3. A previous copy of the same project (with .git but no manifest) is adopted:
  //    this is the case that used to produce `alpha-2`.
  await mkdir(join(root, 'alpha', '.git'), { recursive: true });
  check('existing project copy is adopted', await resolveCopyTarget(root, 'alpha', 'p1'), {
    dir: join(root, 'alpha'),
    adopted: true,
  });

  // 4. Same project with a manifest: found by id, never suffixed.
  await writeFile(join(root, 'alpha', '.codex-import.json'), JSON.stringify(manifest('p1')));
  const found = await findImportedProject(root, 'p1');
  check('manifest is found by project id', found?.dir, join(root, 'alpha'));
  check('manifest content is read back', (await readManifest(join(root, 'alpha')))?.projectId, 'p1');

  // 5. A folder owned by another Codex project is not overwritten.
  await mkdir(join(root, 'beta'), { recursive: true });
  await writeFile(join(root, 'beta', '.codex-import.json'), JSON.stringify(manifest('other')));
  check('another project keeps its folder', (await resolveCopyTarget(root, 'beta', 'p1')).dir, join(root, 'beta-2'));

  // 6. An unrelated non-empty folder without git history is left alone.
  await mkdir(join(root, 'gamma'), { recursive: true });
  await writeFile(join(root, 'gamma', 'notes.txt'), 'user data');
  check('unrelated folder is not clobbered', (await resolveCopyTarget(root, 'gamma', 'p1')).dir, join(root, 'gamma-2'));

  // 7. The suffix picker still works when its base and the next name are taken.
  await mkdir(join(root, 'beta-2'), { recursive: true });
  await writeFile(join(root, 'beta-2', 'old.txt'), 'old copy');
  check('suffix picker walks past occupied names', await pickTargetDir(root, 'beta'), join(root, 'beta-3'));

  // 8. Path segments stay usable as one directory name.
  check('unsafe characters are replaced', safeSegment('a/b:c*?', 'x'), 'a-b-c--');
  check('empty name falls back', safeSegment('   ', 'fallback'), 'fallback');
} finally {
  await rm(root, { recursive: true, force: true });
}

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
