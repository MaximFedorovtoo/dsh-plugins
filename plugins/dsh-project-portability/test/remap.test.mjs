/**
 * Self-check for absolute-path rewriting when an archive lands on another
 * machine.
 *
 * Run: node test/remap.test.mjs
 */
import { replacePath, buildPathRemap, remapJson, remapEvents, pathVariants, withSessionId } from '../lib/remap.js';

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

check('replacePath basic', replacePath(String.raw`open C:\work\app\src\a.js`, String.raw`C:\work\app`, String.raw`D:\proj\app`), String.raw`open D:\proj\app\src\a.js`);
check(
  'replacePath respects segment boundaries',
  replacePath(String.raw`C:\work\application\x C:\work\app2 C:\work\app\x`, String.raw`C:\work\app`, String.raw`D:\p`),
  String.raw`C:\work\application\x C:\work\app2 D:\p\x`,
);
check('replacePath forward-slash form', replacePath('cd C:/work/app/src', 'C:/work/app', 'D:/p'), 'cd D:/p/src');
check(
  'lower-case spelling rewritten through a plan',
  remapJson({ value: String.raw`c:\work\app\x` }, buildPathRemap(String.raw`C:\work\app`, String.raw`D:\p`)).value,
  String.raw`D:\p\x`,
);
check('replacePath leaves unrelated roots', replacePath(String.raw`C:\other\project\x`, String.raw`C:\work\app`, String.raw`D:\p`), String.raw`C:\other\project\x`);

const variants = pathVariants(String.raw`C:\Work\App`);
check('pathVariants has both separators', variants.includes(String.raw`C:\Work\App`) && variants.includes('C:/Work/App'), true);
check('pathVariants has lower-case', variants.includes(String.raw`c:\work\app`), true);

const plan = buildPathRemap(String.raw`C:\work\app`, String.raw`D:\projects\app`);
check('plan is non-empty', plan.length > 0, true);
check('plan sorted longest first', plan.every((entry, index) => index === 0 || plan[index - 1].needle.length >= entry.needle.length), true);

const events = [
  {
    type: 'request/context',
    seq: 0,
    time: 1,
    data: {
      cwd: String.raw`C:\work\app`,
      system: `You are working in ${String.raw`C:\work\app`} (see C:/work/app/README.md); ignore C:\work\application`,
      sessionId: 'session-old',
    },
  },
  {
    type: 'tool/call',
    seq: 1,
    time: 2,
    data: { name: 'read', arguments: JSON.stringify({ path: String.raw`C:\work\app\src\a.js` }) },
  },
];
const remapped = remapEvents(events, {
  oldCwd: String.raw`C:\work\app`,
  newCwd: String.raw`D:\projects\app`,
  oldSessionId: 'session-old',
  newSessionId: 'session-new',
});
check('event cwd remapped', remapped[0].data.cwd, String.raw`D:\projects\app`);
check(
  'event system remapped with boundary safety',
  remapped[0].data.system,
  `You are working in ${String.raw`D:\projects\app`} (see D:/projects/app/README.md); ignore C:\work\application`,
);
check('event session id remapped', remapped[0].data.sessionId, 'session-new');
check('tool argument path remapped', JSON.parse(remapped[1].data.arguments).path, String.raw`D:\projects\app\src\a.js`);
check('original events untouched', events[0].data.cwd, String.raw`C:\work\app`);

check('remapJson clones arrays', remapJson(['a', 'b'], []), ['a', 'b']);
check('withSessionId keeps plan', withSessionId([], 'old', 'new').length, 1);
check('withSessionId ignores empty ids', withSessionId([], '', '').length, 0);

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
}
