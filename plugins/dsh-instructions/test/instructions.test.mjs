/**
 * Self-check for the instructions panel: Host file operations and client wiring.
 *
 * Run: node test/instructions.test.mjs
 */
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __internals } from '../index.js';

const { settingsOf, readInstructions, saveInstructions, removeInstructions } = __internals;

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

const previousHome = process.env.DSH_HOME;
const root = await mkdtemp(join(tmpdir(), 'dsh-instructions-test-'));

try {
  process.env.DSH_HOME = root;

  // 1. Default destination and limits.
  const settings = settingsOf({});
  check('default target', settings.target, join(root, 'AGENTS.md'));
  check('default byte limit matches the DSH instruction cap', settings.maxBytes, 64 * 1024);
  check('relative target resolves inside DSH_HOME', settingsOf({ target: 'rules/rules.md' }).target, join(root, 'rules', 'rules.md'));

  // 2. Missing file is reported without an error.
  const missing = await readInstructions(settings);
  check('missing file reported', [missing.exists, missing.content], [false, '']);

  // 3. Saving writes the file and reports its state.
  const saved = await saveInstructions(settings, '# rules\n\nBe brief.\n');
  check('save reports existence', saved.exists, true);
  check('save reports the content', saved.content, '# rules\n\nBe brief.\n');
  check('save reports the byte size', saved.size, Buffer.byteLength('# rules\n\nBe brief.\n', 'utf8'));
  check('file is on disk', await readFile(settings.target, 'utf8'), '# rules\n\nBe brief.\n');
  check('no temporary files left', (await readdir(root)).filter((name) => name.includes('.tmp-')).length, 0);

  // 4. Replacing the file keeps a single destination file.
  await saveInstructions(settings, '# rules v2\n');
  check('replacement is written', (await readInstructions(settings)).content, '# rules v2\n');

  // 5. Validation: empty content and oversized content are refused.
  let emptyError = '';
  try {
    await saveInstructions(settings, '   \n\t ');
  } catch (error) {
    emptyError = error instanceof Error ? error.message : String(error);
  }
  check('empty content is refused', emptyError.includes('cannot be empty'), true);
  const small = settingsOf({ target: join(root, 'small.md'), maxBytes: 12 });
  let largeError = '';
  try {
    await saveInstructions(small, 'x'.repeat(20));
  } catch (error) {
    largeError = error instanceof Error ? error.message : String(error);
  }
  check('oversized content is refused', largeError.includes('too large'), true);

  // 6. Delete removes the file and reports it.
  check('delete reports removal', await removeInstructions(settings), { path: settings.target, removed: true });
  check('delete again reports nothing to remove', (await removeInstructions(settings)).removed, false);
  check('file is gone', (await readInstructions(settings)).exists, false);
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
}

// 7. The client bundle registers its panel and sidebar entry.
const { readFileSync } = await import('node:fs');
const vm = await import('node:vm');
const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
let registration;
const sandbox = { window: { __ModuleLoader__: { load: (value) => { registration = value; } } }, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
check('client bundle id', registration?.id, 'dsh-instructions');
const React = {
  createElement: () => ({}),
  useState: (initial) => [initial, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
};
const plugin = registration.factory((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require: ${name}`);
});
check('client plugin exposes apply', typeof plugin.apply, 'function');
const registered = [];
plugin.apply({
  effect: (fn) => fn(),
  get: () => ({ register: () => () => {}, bind: () => (key) => key }),
  slots: {
    inject: (name, callback) => callback(),
    register: (slot) => { registered.push(slot.name); },
  },
});
check('client registers main and sidebar slots', registered.sort(), ['main', 'sidebar.panellist']);

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
