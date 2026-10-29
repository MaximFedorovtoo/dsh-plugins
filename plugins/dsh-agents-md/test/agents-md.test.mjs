/**
 * Self-check for the AGENTS.md installer.
 *
 * Run: node test/agents-md.test.mjs
 */
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __internals } from '../index.js';

const { installInstructions, resolveTarget } = __internals;

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

const bundled = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
const root = await mkdtemp(join(tmpdir(), 'agents-md-test-'));
const previousHome = process.env.DSH_HOME;

try {
  process.env.DSH_HOME = root;

  // 1. Default destination is <DSH_HOME>/AGENTS.md.
  check('default target', resolveTarget({}), join(root, 'AGENTS.md'));
  check('relative target resolves inside DSH_HOME', resolveTarget({ target: 'instructions/rules.md' }), join(root, 'instructions', 'rules.md'));

  // 2. A missing file is installed with the bundled content.
  const first = await installInstructions({});
  check('installs when absent', first.status, 'installed');
  check('installed content matches the package', await readFile(first.target, 'utf8'), bundled);

  // 3. The same content is a no-op.
  check('second run is unchanged', (await installInstructions({})).status, 'unchanged');

  // 4. A different existing file is user data: kept unless overwrite is on.
  const customPath = join(root, 'custom.md');
  await writeFile(customPath, '# my own rules\n', 'utf8');
  check('keeps a different file by default', (await installInstructions({ target: customPath })).status, 'kept');
  check('kept file is untouched', await readFile(customPath, 'utf8'), '# my own rules\n');

  // 5. overwrite: true replaces it.
  check('overwrite replaces the file', (await installInstructions({ target: customPath, overwrite: true })).status, 'updated');
  check('replaced content matches the package', await readFile(customPath, 'utf8'), bundled);

  // 6. A relative target lands inside DSH_HOME.
  const relative = await installInstructions({ target: 'nested/rules.md' });
  check('relative target installed', relative.status, 'installed');
  check('relative target path', relative.target, join(root, 'nested', 'rules.md'));
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
}

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
