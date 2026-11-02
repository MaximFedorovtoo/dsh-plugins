/**
 * Integration smoke test for the dsh-unslop voice tools.
 *
 * Run: node test/voice.test.mjs
 *
 * Uses the vendored silhouette corpus for samples and the vendored impostor
 * pool for scoring. A mock LLM supplies a short draft, so no network call is
 * made. The test verifies the two safety contracts: teach writes only after
 * apply+confirm, and mimic never writes before apply+confirm.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, __internals } from '../index.js';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const SAMPLES = join(PLUGIN, 'python', 'evals', 'fixtures', 'silhouette', 'corpus', 'human');
const CANDIDATE = join(SAMPLES, '01_linkedin.txt');

let failures = 0;
/** Record one assertion. */
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-unslop-voice-test-'));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = root;

const registered = new Map();
const llmRequests = [];
const llm = {
  stream(request) {
    llmRequests.push(request);
    return (async function* stream() {
      yield {
        type: 'text-delta',
        text: 'The bakery on Ninth Street opens at six. I buy rye there on Tuesdays and eat it on the walk home. The owner keeps a list of regulars in a notebook.',
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
    })();
  },
};
const ctx = {
  effect(fn) {
    const dispose = fn();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  tools: {
    register(tool) {
      registered.set(tool.name, tool);
      return () => {};
    },
  },
  get(service) {
    return service === 'llm' ? llm : undefined;
  },
};

try {
  apply(ctx, { chatRoot: join(root, 'chats'), voiceSeed: 7 });
  check('tools registered', registered.size >= 10, `got ${registered.size}`);

  const project = join(root, 'project');
  const session = { id: 'test-session', header: { cwd: project } };
  const exec = { agent: { session }, signal: undefined };
  const call = async (name, args) => {
    const tool = registered.get(name);
    if (tool === undefined) throw new Error(`missing tool ${name}`);
    return await tool.execute(args, exec);
  };

  // 1. Pure scope and name guards.
  const config = __internals.resolveConfig({ chatRoot: join(root, 'chats') });
  const projectScope = __internals.scopeDirectory(config, 'project', exec);
  check('project scope path', projectScope.dir === join(project, '.unslop', 'voice'), projectScope.dir);
  const chatScope = __internals.scopeDirectory(config, 'chat', exec);
  check('chat scope path', chatScope.dir === join(root, 'chats', 'test-session', '.unslop', 'voice'), chatScope.dir);

  for (const bad of ['../escape', 'CON', 'name.', '', 'a/b']) {
    let threw = false;
    try {
      __internals.assertVoiceName(bad);
    } catch {
      threw = true;
    }
    check(`rejects voice name ${JSON.stringify(bad)}`, threw);
  }
  let accepted = false;
  try {
    accepted = __internals.assertVoiceName('demo-1') === 'demo-1';
  } catch {
    accepted = false;
  }
  check('accepts demo-1', accepted);

  // 2. Teach dry-run writes nothing.
  const plan = JSON.parse(await call('unslop_voice_teach', { name: 'demo', samplesDir: SAMPLES }));
  check('teach dry-run', plan.dry_run === true && plan.applied === false);
  check('teach dry-run docs', plan.docs === 8, String(plan.docs));
  check('teach dry-run low confidence', plan.low_confidence === true);
  check('teach dry-run uncovered praise', Array.isArray(plan.uncovered) && plan.uncovered.includes('praise'));
  check('teach dry-run wrote nothing', !existsSync(join(project, '.unslop', 'voice', 'demo')));

  // 3. Teach apply without confirmation is refused before any write.
  let guardError;
  try {
    await call('unslop_voice_teach', { name: 'demo', samplesDir: SAMPLES, apply: true });
  } catch (error) {
    guardError = error;
  }
  check('teach apply guard throws', guardError instanceof Error);
  check('teach apply guard wrote nothing', !existsSync(join(project, '.unslop', 'voice', 'demo')));

  // 4. Teach with apply+confirm writes profile, card and provenance.
  const applied = JSON.parse(await call('unslop_voice_teach', {
    name: 'demo', samplesDir: SAMPLES, apply: true, confirm: true,
  }));
  const voiceDir = join(project, '.unslop', 'voice', 'demo');
  check('teach applied', applied.applied === true, JSON.stringify(applied.error ?? ''));
  check('profile written', existsSync(join(voiceDir, 'profile.json')));
  check('card written', existsSync(join(voiceDir, 'card.md')));
  check('provenance written', existsSync(join(voiceDir, 'provenance.json')));
  check('samples copied', existsSync(join(voiceDir, 'samples', '01_linkedin.txt')));
  check('no temp stages', !existsSync(join(project, '.unslop', 'voice', '.demo.tmp')));

  // 5. List sees the voice.
  const listed = JSON.parse(await call('unslop_voice_list', {}));
  check('list finds demo', listed.voices.some((voice) => voice.name === 'demo' && voice.hasProfile && voice.hasCard));

  // 6. Score-only path returns a composite and the copy gate.
  const scored = JSON.parse(await call('unslop_voice_score', { name: 'demo', path: CANDIDATE }));
  check('score composite is a number', typeof scored.score.composite === 'number', String(scored.score.composite));
  check('score GI in range', typeof scored.score.gi === 'number' && scored.score.gi >= 0 && scored.score.gi <= 1);
  check('copy gate flags a sample', scored.copy_gate.violation === true);

  // 7. Mimic dry-run returns the assembled prompt without calling the LLM.
  const dry = JSON.parse(await call('unslop_voice_mimic', {
    name: 'demo', instruction: 'Write a short note about a bakery.', dryRun: true,
  }));
  check('mimic dry-run returns prompt', dry.dryRun === true && dry.prepared.system.includes('VOICE CARD'));
  check('mimic dry-run did not call LLM', llmRequests.length === 0);

  // 8. Mimic apply without confirmation is refused before generation.
  const output = join(root, 'out', 'bakery.md');
  let mimicGuard;
  try {
    await call('unslop_voice_mimic', {
      name: 'demo', instruction: 'Write a short note about a bakery.',
      apply: true, outputPath: output,
    });
  } catch (error) {
    mimicGuard = error;
  }
  check('mimic apply guard throws', mimicGuard instanceof Error);
  check('mimic apply guard wrote nothing', !existsSync(output));
  check('mimic apply guard did not call LLM', llmRequests.length === 0);

  // 9. Mimic with apply+confirm generates and writes only then.
  const mimicked = JSON.parse(await call('unslop_voice_mimic', {
    name: 'demo', instruction: 'Write a short note about a bakery.',
    apply: true, confirm: true, outputPath: output,
  }));
  check('mimic generated text', typeof mimicked.draft === 'string' && mimicked.draft.length > 0);
  check('mimic called LLM once', llmRequests.length === 1);
  check('mimic wrote output', mimicked.applied?.path === output, JSON.stringify(mimicked.blocked ?? ''));
  check('output file exists', existsSync(output));
  check('voice score present', typeof mimicked.score.composite === 'number');
  if (mimicked.applied?.path === output) {
    check('output content matches draft', (await readFile(output, 'utf8')) === mimicked.draft);
  }

  // 10. A rewrite that loses facts is blocked without force, and force writes.
  const blockedOutput = join(root, 'out', 'rewrite.md');
  const factful = 'In Q2 2024 the migration took 2,500 users offline for 11 minutes at https://status.example.com/incident/42.';
  const blocked = JSON.parse(await call('unslop_voice_mimic', {
    name: 'demo', text: factful,
    apply: true, confirm: true, outputPath: blockedOutput,
  }));
  check('rewrite preservation gate runs', blocked.gates.preservation?.passed === false);
  check('rewrite is blocked by preservation', typeof blocked.blocked === 'string' && blocked.blocked.includes('preservation'));
  check('blocked rewrite wrote nothing', !existsSync(blockedOutput));
  const forced = JSON.parse(await call('unslop_voice_mimic', {
    name: 'demo', text: factful,
    apply: true, confirm: true, outputPath: blockedOutput, force: true,
  }));
  check('forced rewrite writes', forced.applied?.path === blockedOutput && existsSync(blockedOutput));

  // 11. Chat scope stays in the per-session cache and writes nothing on dry-run.
  const chatPlan = JSON.parse(await call('unslop_voice_teach', {
    name: 'chatvoice', samplesDir: SAMPLES, scope: 'chat',
  }));
  check('chat scope root',
    chatPlan.root.toLowerCase().endsWith(join('chats', 'test-session', '.unslop', 'voice').toLowerCase()),
    chatPlan.root);
  check('chat dry-run wrote nothing', !existsSync(join(root, 'chats', 'test-session', '.unslop', 'voice', 'chatvoice')));
  const chatApplied = JSON.parse(await call('unslop_voice_teach', {
    name: 'chatvoice', samplesDir: SAMPLES, scope: 'chat', apply: true, confirm: true,
  }));
  check('chat apply writes', chatApplied.applied === true);
  const chatVoices = JSON.parse(await call('unslop_voice_list', { scope: 'chat' }));
  check('chat list finds chatvoice', chatVoices.voices.some((voice) => voice.name === 'chatvoice'));
  const projectVoices = JSON.parse(await call('unslop_voice_list', {}));
  check('project list does not leak chatvoice', !projectVoices.voices.some((voice) => voice.name === 'chatvoice'));
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
