/**
 * Self-check for the client half (Web UI bundle) — mirrors the vm wiring used by
 * dsh-codex-bridge/test/bulk-import.test.mjs (window.__ModuleLoader__ stub,
 * fake React, fake ctx), then additionally renders the page component once.
 *
 * Run:
 *   node test/client.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILE = new URL('../client.js', import.meta.url);
const code = readFileSync(FILE, 'utf8');

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS ${name}`);
  }
}
function checkTrue(name, value, details) {
  if (!value) {
    failures += 1;
    console.log(`FAIL ${name}${details === undefined ? '' : ': ' + details}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

/* 1. Load the bundle exactly like the browser boot does. */
let registration;
const sandbox = {
  window: { __ModuleLoader__: { load: (value) => { registration = value; } } },
  console,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
check('bundle id', registration?.id, 'dsh-project-portability');
check('bundle exposes factory', typeof registration?.factory, 'function');

/* 2. Materialize the factory with a React stub; only `react` may be requested. */
const element = (type, props, ...children) => ({
  type,
  props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
});
const React = {
  createElement: element,
  useState: (initial) => {
    const value = typeof initial === 'function' ? initial() : initial;
    return [value, () => {}];
  },
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
};
const requested = [];
const plugin = registration.factory((name) => {
  requested.push(name);
  if (name === 'react') return React;
  throw new Error(`unexpected require: ${name}`);
});
check('factory requires only react', requested, ['react']);
check('plugin exposes apply', typeof plugin.apply, 'function');
check('plugin declares inject', plugin.inject, ['slots', 'locale', 'uiWorkspace']);

/* 3. Run apply against a ctx shaped like the codex-bridge test ctx. */
const registrations = [];
const dictionaries = [];
const services = {
  locale: {
    register: (ns, lang, dict) => {
      dictionaries.push({ ns, lang, dict });
      return () => {};
    },
    bind: (ns) => (key) => key, // force the bundle's own ru fallback
  },
  uiWorkspace: { openSession: () => {} },
};
const ctx = {
  effect: (fn) => fn(),
  get: (name) => services[name],
  slots: {
    inject: (slotName, callback) => callback(),
    register: (options, component) => {
      registrations.push({ options, component });
      return () => {};
    },
  },
};
plugin.apply(ctx);

check('registers two slots', registrations.map((entry) => entry.options.name).sort(), ['main', 'sidebar.panellist']);

const main = registrations.find((entry) => entry.options.name === 'main');
const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist');
check('main key', main?.options.key, 'project-portability');
check('main locale namespace', main?.options.locale, 'project-portability');
check('main component is a function', typeof main?.component, 'function');
check('sidebar id matches main key', sidebar?.options.id, main?.options.key);
check('sidebar order is numeric', typeof sidebar?.options.order, 'number');
check('sidebar locale namespace', sidebar?.options.locale, 'project-portability');
check('sidebar label resolves', typeof sidebar?.options.label === 'function' ? sidebar.options.label() : sidebar?.options.label, 'Перенос проектов');
check('sidebar icon is a component', typeof sidebar?.component, 'function');

check('locale dictionaries', dictionaries.map((entry) => entry.lang), ['ru', 'en']);
check('ru dictionary namespace', dictionaries[0]?.ns, 'project-portability');
checkTrue('ru dictionary has export copy', dictionaries[0]?.dict['project.export'] === 'Экспортировать');
checkTrue('ru dictionary has import copy', dictionaries[0]?.dict['import.action'] === 'Импортировать архив');
checkTrue('en dictionary covers every ru key', Object.keys(dictionaries[0].dict).every((key) => key in dictionaries[1].dict));

/* 4. Render the page once: it must not throw and must show localized copy. */
function collectText(node, out) {
  if (node === null || node === undefined || node === false) return;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out));
    return;
  }
  if (typeof node === 'object' && node.props !== undefined) collectText(node.props.children, out);
}
let tree;
try {
  tree = main.component({});
  checkTrue('page renders without throwing', true);
} catch (error) {
  checkTrue('page renders without throwing', false, error instanceof Error ? error.message : String(error));
}
const text = [];
collectText(tree, text);
const joined = text.join(' | ');
checkTrue('page shows its title', text.includes('Перенос проектов'), joined);
checkTrue('page shows the import action', text.includes('Импортировать архив'), joined);
checkTrue('page shows the loading state before data arrives', text.includes('Читаю список проектов…'), joined);

/* 5. Static contract check: host routes and registration shape. */
checkTrue('GET projects route', code.includes("'/api/portability/projects'"));
checkTrue('POST export route', code.includes("'/api/portability/export'"));
checkTrue('POST import route', code.includes("'/api/portability/import'"));
checkTrue('same-origin credentials', code.includes("credentials: 'same-origin'"));

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
