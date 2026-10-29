/**
 * Self-check for the bulk import helpers and the client bundle wiring.
 *
 * Run: node test/bulk-import.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { __internals } from '../index.js';

const { threadsToImport } = __internals;

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
  name: 'demo',
  threads: [
    { id: 't1', title: 'first' },
    { id: 't2', title: 'second' },
    { id: 't3', title: 'third' },
  ],
};

// 1. A plain request imports the most recent thread only.
check('default picks the first thread', threadsToImport(project, {}).map((thread) => thread.id), ['t1']);

// 2. allThreads imports every chat of the project.
check(
  'allThreads imports every chat',
  threadsToImport(project, { allThreads: true }).map((thread) => thread.id),
  ['t1', 't2', 't3'],
);

// 3. An explicit thread id or title substring still selects one chat.
check('thread id selects one', threadsToImport(project, { threadId: 't2' }).map((thread) => thread.id), ['t2']);
check('title substring selects one', threadsToImport(project, { threadId: 'thi' }).map((thread) => thread.id), ['t3']);

// 4. A project without threads still yields one (undefined) import slot.
check('project without threads yields one slot', threadsToImport({ name: 'empty', threads: [] }, { allThreads: true }), [undefined]);

// 5. Unknown thread id is a hard error, not a silent fallback.
let threw = false;
try {
  threadsToImport(project, { threadId: 'nope' });
} catch {
  threw = true;
}
check('unknown thread throws', threw, true);

// 6. The client bundle registers a panel component without throwing.
const code = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8');
let registration;
const sandbox = {
  window: { __ModuleLoader__: { load: (value) => { registration = value; } } },
  console,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
check('client registers a bundle', registration?.id, 'dsh-codex-bridge');
const React = {
  createElement: () => ({}),
  useState: (initial) => [initial, () => {}],
  useRef: () => ({ current: true }),
  useEffect: () => {},
};
const plugin = registration.factory((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require: ${name}`);
});
check('client plugin exposes apply', typeof plugin.apply, 'function');
const registered = [];
const ctx = {
  effect: (fn) => fn(),
  get: (name) => (name === 'locale' ? { register: () => () => {}, bind: () => (key) => key } : undefined),
  slots: {
    inject: (name, callback) => callback(),
    register: (slot) => { registered.push(slot.name); },
  },
};
plugin.apply(ctx);
check('client registers main and sidebar slots', registered.sort(), ['main', 'sidebar.panellist']);

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
