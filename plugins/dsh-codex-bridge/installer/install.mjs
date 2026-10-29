/**
 * Codex Bridge installer.
 *
 * Installs dsh-codex-bridge into a DeepSeek Harness profile the same way
 * the Plugin Manager does for a local bundle:
 *   1. copy the plugin payload into  <profile>/plugins/dsh-codex-bridge
 *   2. register the bundle + a link dependency in <profile>/package.json
 *   3. let pnpm materialize <profile>/node_modules/dsh-codex-bridge
 *      (a directory junction is used when pnpm is unavailable)
 * Optional overrides (-target-root / -codex-home) are written to the profile's
 * cordis.patch.yml so the user layer survives plugin updates.
 *
 * Usage (from install.ps1 / install.cmd, or directly with Node):
 *   node install.mjs [--profile <name|dir>] [--source <dir>] [--target-root <path>]
 *                    [--codex-home <path>] [--dry-run] [--uninstall] [--keep-files]
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package name this installer maintains. */
const PLUGIN_NAME = 'dsh-codex-bridge';
/** Directory name inside the profile. */
const PLUGIN_DIR_NAME = 'dsh-codex-bridge';
/** Marker around the optional user-layer config override. */
const PATCH_MARKER = '# Codex Bridge: локальные пути (добавлено установщиком)';
/** Payload entries never copied. */
const COPY_EXCLUDE = new Set(['node_modules', '.git', 'research', 'installer']);

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Parse `--flag value`, `--flag=value` and boolean flags.
 * @param {string[]} argv - process arguments after the script name.
 * @returns {Record<string, string | true>} parsed options.
 */
function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const eq = token.indexOf('=');
    if (eq !== -1) {
      options[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

/** Print one progress line. */
const log = (message) => console.log(message);
/** Print one warning. */
const warn = (message) => console.warn(`WARN ${message}`);

/**
 * Resolve the target profile directory.
 * @param {string | true | undefined} requested - `--profile` value (name or path).
 * @returns {Promise<string>} absolute profile directory.
 */
async function resolveProfile(requested) {
  const candidates = [];
  if (typeof requested === 'string' && requested.length > 0) {
    candidates.push(requested);
    candidates.push(join(homedir(), '.dsh', 'profiles', requested));
  }
  if (process.env.DSH_PROFILE_DIR) candidates.push(process.env.DSH_PROFILE_DIR);
  if (process.env.DSH_PROFILE) candidates.push(join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE));
  candidates.push(join(homedir(), '.dsh', 'profiles', 'desktop'));
  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    if (existsSync(join(absolute, 'package.json'))) return absolute;
  }
  const profilesRoot = join(homedir(), '.dsh', 'profiles');
  const available = existsSync(profilesRoot)
    ? (await readdir(profilesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  throw new Error(
    `profile not found. Pass --profile <name|dir>. Available profiles: ${available.length === 0 ? '(none)' : available.join(', ')}`,
  );
}

/**
 * Drop a UTF-8 BOM left by some Windows editors.
 * @param {string} text - file content.
 * @returns {string} content without a leading BOM.
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read a JSON file.
 * @param {string} path - file path.
 * @returns {Promise<any>} parsed JSON.
 */
async function readJson(path) {
  return JSON.parse(stripBom(await readFile(path, 'utf8')));
}

/**
 * Write pretty JSON with a trailing newline.
 * @param {string} path - file path.
 * @param {unknown} value - JSON value.
 * @returns {Promise<void>}
 */
async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * Locate the pnpm entry bundled with the DSH runtime.
 * @returns {Promise<string | undefined>} absolute path to pnpm.mjs.
 */
async function findPnpm() {
  if (process.env.DSH_PNPM && existsSync(process.env.DSH_PNPM)) return process.env.DSH_PNPM;
  const runtimes = join(homedir(), '.dsh', 'dsh-runtimes');
  if (!existsSync(runtimes)) return undefined;
  const entries = await readdir(runtimes, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(runtimes, entry.name, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Locate the Node executable for this installer (used to run pnpm).
 * @returns {string} executable path.
 */
function findNode() {
  if (process.env.DSH_NODE && existsSync(process.env.DSH_NODE)) return process.env.DSH_NODE;
  return process.execPath;
}

/**
 * Copy the payload into the profile, skipping transient directories.
 * @param {string} source - plugin package directory.
 * @param {string} target - destination directory.
 * @returns {Promise<number>} copied file count.
 */
async function copyPayload(source, target) {
  const root = resolve(source);
  if (!existsSync(join(root, 'package.json'))) throw new Error(`payload has no package.json: ${root}`);
  const manifest = await readJson(join(root, 'package.json'));
  if (manifest.name !== PLUGIN_NAME) throw new Error(`payload is not ${PLUGIN_NAME} (found ${String(manifest.name)})`);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(root, target, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (entry) => {
      const base = entry.split(/[\\/]/).pop() ?? entry;
      return !COPY_EXCLUDE.has(base);
    },
  });
  let count = 0;
  /** @param {string} dir @returns {Promise<void>} */
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else count += 1;
    }
  };
  await walk(target);
  return count;
}

/**
 * Register (or refresh) the bundle + link dependency in the profile manifest.
 * @param {any} pkg - parsed profile package.json.
 * @returns {{ changed: boolean, dependency: string }} outcome.
 */
function ensureBundleEntry(pkg) {
  const dependency = `link:./plugins/${PLUGIN_DIR_NAME}`;
  let changed = false;
  if (pkg.dependencies === undefined || pkg.dependencies === null || typeof pkg.dependencies !== 'object') {
    pkg.dependencies = {};
    changed = true;
  }
  if (pkg.dependencies[PLUGIN_NAME] !== dependency) {
    pkg.dependencies[PLUGIN_NAME] = dependency;
    changed = true;
  }
  if (pkg.dsh === undefined || pkg.dsh === null || typeof pkg.dsh !== 'object') {
    pkg.dsh = {};
    changed = true;
  }
  if (pkg.dsh.profile === undefined || pkg.dsh.profile === null || typeof pkg.dsh.profile !== 'object') {
    pkg.dsh.profile = {};
    changed = true;
  }
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  if (!bundles.includes(PLUGIN_NAME)) {
    bundles.push(PLUGIN_NAME);
    changed = true;
  }
  pkg.dsh.profile.bundles = bundles;
  return { changed, dependency };
}

/**
 * Remove the bundle + dependency registration.
 * @param {any} pkg - parsed profile package.json.
 * @returns {boolean} whether anything changed.
 */
function removeBundleEntry(pkg) {
  let changed = false;
  if (pkg.dependencies && typeof pkg.dependencies === 'object' && PLUGIN_NAME in pkg.dependencies) {
    delete pkg.dependencies[PLUGIN_NAME];
    changed = true;
  }
  const bundles = pkg.dsh?.profile?.bundles;
  if (Array.isArray(bundles)) {
    const filtered = bundles.filter((entry) => entry !== PLUGIN_NAME);
    if (filtered.length !== bundles.length) {
      pkg.dsh.profile.bundles = filtered;
      changed = true;
    }
  }
  return changed;
}

/**
 * Escape a Windows path for a double-quoted YAML scalar.
 * @param {string} value - raw path.
 * @returns {string} escaped path.
 */
function yamlPath(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Locate the installer's block inside a cordis.patch.yml line array: the marker
 * comment, the `- id: codex-import` row, and that row's indented lines.
 * @param {string[]} lines - source lines.
 * @returns {{ start: number, end: number } | undefined} half-open line range.
 */
function findPatchBlock(lines) {
  const start = lines.findIndex((line) => line.trim() === PATCH_MARKER);
  if (start === -1) return undefined;
  let end = start + 1;
  if (end < lines.length && /^- id:\s*codex-import\s*$/.test(lines[end])) end += 1;
  while (end < lines.length && /^[ \t]/.test(lines[end])) end += 1;
  return { start, end };
}

/**
 * Remove the installer's config override block from cordis.patch.yml.
 * @param {string} profileDir - profile directory.
 * @returns {Promise<'removed' | 'absent'>} outcome.
 */
async function removePatchOverride(profileDir) {
  const patchPath = join(profileDir, 'cordis.patch.yml');
  if (!existsSync(patchPath)) return 'absent';
  const text = stripBom(await readFile(patchPath, 'utf8'));
  const lines = text.split(/\r?\n/);
  const block = findPatchBlock(lines);
  if (block === undefined) return 'absent';
  lines.splice(block.start, block.end - block.start);
  const next = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '\n');
  await writeFile(patchPath, next, 'utf8');
  return 'removed';
}

/**
 * Upsert the optional user-layer config override in cordis.patch.yml.
 * @param {string} profileDir - profile directory.
 * @param {{ targetRoot?: string, codexHome?: string }} values - configured paths.
 * @returns {Promise<'created' | 'updated' | 'unchanged'>} outcome.
 */
async function upsertPatchOverride(profileDir, values) {
  if (values.targetRoot === undefined && values.codexHome === undefined && values.importMode === undefined) return 'unchanged';
  const patchPath = join(profileDir, 'cordis.patch.yml');
  const existing = existsSync(patchPath) ? stripBom(await readFile(patchPath, 'utf8')) : '';
  // Keep a previously written mode when this run does not pass one.
  const previousMode = /\n\s*importMode:\s*([A-Za-z-]+)/.exec(existing)?.[1];
  const mode = values.importMode ?? previousMode ?? 'in-place';
  const blockLines = [
    PATCH_MARKER,
    '- id: codex-import',
    '  config:',
    `    importMode: ${mode === 'copy' ? 'copy' : 'in-place'}`,
    `    codexHome: "${yamlPath(values.codexHome ?? '')}"`,
    `    targetRoot: "${yamlPath(values.targetRoot ?? '')}"`,
  ];
  const lines = existing.split(/\r?\n/);
  const found = findPatchBlock(lines);
  let next;
  if (found === undefined) {
    const body = existing.replace(/\s+$/, '');
    next = `${body}${body.length === 0 ? '' : '\n\n'}${blockLines.join('\n')}\n`;
  } else {
    next = [...lines.slice(0, found.start), ...blockLines, ...lines.slice(found.end)]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+/, '')
      .replace(/\s+$/, '\n');
  }
  if (next === existing) return 'unchanged';
  await writeFile(patchPath, next, 'utf8');
  return found === undefined ? 'created' : 'updated';
}

/**
 * Materialize the profile dependency with pnpm, or fall back to a junction.
 * @param {string} profileDir - profile directory.
 * @param {string} pluginDir - installed plugin directory.
 * @param {{ createLink?: boolean }} [options] - `createLink: false` only reconciles
 *   pnpm metadata (used by uninstall, where a junction would dangle).
 * @returns {Promise<{ method: 'pnpm' | 'junction' | 'none', ok: boolean, detail?: string }>} outcome.
 */
async function installDependency(profileDir, pluginDir, options = {}) {
  const createLink = options.createLink !== false;
  const pnpm = await findPnpm();
  if (pnpm !== undefined) {
    log(`→ pnpm install (${pnpm})`);
    const result = spawnSync(process.execPath, [pnpm, 'install', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'], {
      cwd: profileDir,
      stdio: 'inherit',
      env: { ...process.env, CI: '1' },
    });
    if (result.status === 0) return { method: 'pnpm', ok: true };
    warn(`pnpm install exited with code ${String(result.status ?? result.signal)}; falling back to a directory junction`);
  } else {
    warn('pnpm runtime not found; falling back to a directory junction');
  }
  if (!createLink) {
    return { method: 'none', ok: true, detail: 'node_modules обновится при следующем pnpm install' };
  }
  const linkPath = join(profileDir, 'node_modules', PLUGIN_DIR_NAME);
  await mkdir(dirname(linkPath), { recursive: true });
  await rm(linkPath, { recursive: true, force: true });
  await symlink(pluginDir, linkPath, 'junction');
  return { method: 'junction', ok: true, detail: linkPath };
}

/** Print usage text. */
function printUsage() {
  log(`Codex Bridge — установка плагина в профиль DeepSeek Harness

  install.ps1|install.cmd [-Profile <имя|папка>] [-Source <папка плагина>]
                          [-TargetRoot <папка>] [-CodexHome <папка>]
                          [-ImportMode in-place|copy]
                          [-DryRun] [-Uninstall] [-KeepFiles]

  -Profile      профиль DSH (по умолчанию: $env:DSH_PROFILE_DIR, затем desktop)
  -Source       откуда брать файлы плагина (по умолчанию: корень репозитория)
  -TargetRoot   куда клонировать проекты в режиме copy (пишется в cordis.patch.yml)
  -CodexHome    папка данных Codex (по умолчанию ~/.codex)
  -ImportMode   in-place (по умолчанию: исходная папка проекта) или copy (копия в TargetRoot)
  -DryRun       показать план без изменений
  -Uninstall    удалить плагин из профиля (файлы остаются с -KeepFiles)
`);
}

/**
 * Install or uninstall the plugin.
 * @returns {Promise<number>} process exit code.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help === true || options.h === true) {
    printUsage();
    return 0;
  }
  const dryRun = options['dry-run'] === true;
  const uninstall = options.uninstall === true;
  const keepFiles = options['keep-files'] === true;
  const profileDir = await resolveProfile(options.profile);
  const pluginDir = join(profileDir, 'plugins', PLUGIN_DIR_NAME);
  const pkgPath = join(profileDir, 'package.json');
  log(`profile: ${profileDir}`);
  log(`plugin : ${pluginDir}`);

  if (uninstall) {
    const pkg = await readJson(pkgPath);
    const changed = removeBundleEntry(pkg);
    log(changed ? '− регистрация bundle и зависимость будут удалены из package.json' : '• в package.json регистрации нет');
    if (!keepFiles) log(`− папка плагина будет удалена: ${pluginDir}`);
    if (dryRun) {
      log('DRY RUN: изменения не вносились');
      return 0;
    }
    if (changed) await writeJson(pkgPath, pkg);
    const patchOutcome = await removePatchOverride(profileDir);
    if (patchOutcome === 'removed') log('− cordis.patch.yml: удалён блок codex-import установщика');
    if (!keepFiles) await rm(pluginDir, { recursive: true, force: true });
    if (changed) {
      const cleanup = await installDependency(profileDir, pluginDir, { createLink: false });
      log(`node_modules: ${cleanup.method}${cleanup.ok ? '' : ' (ошибка)'}`);
    }
    log('');
    log('Готово. Перезапустите DeepSeek Harness, чтобы плагин перестал загружаться.');
    return 0;
  }

  const source = resolve(typeof options.source === 'string' ? options.source : join(here, '..'));
  log(`source : ${source}`);
  const pkg = await readJson(pkgPath);
  const registration = ensureBundleEntry(pkg);
  const patch = {
    targetRoot: options['target-root'],
    codexHome: options['codex-home'],
    importMode: options['import-mode'],
  };
  if (registration.changed) log(`+ package.json: ${PLUGIN_NAME} → ${registration.dependency}, добавлен в dsh.profile.bundles`);
  else log('• package.json уже содержит регистрацию плагина');
  if (patch.targetRoot !== undefined || patch.codexHome !== undefined || patch.importMode !== undefined) {
    log('+ cordis.patch.yml: локальные пути и/или режим импорта (codexHome/targetRoot/importMode)');
  }
  if (dryRun) {
    log(`DRY RUN: файлы плагина были бы скопированы в ${pluginDir}`);
    log('DRY RUN: изменения не вносились');
    return 0;
  }

  const copied = await copyPayload(source, pluginDir);
  log(`+ скопировано файлов: ${copied}`);
  if (registration.changed) {
    // Keep the previous manifest: a failed dependency step must not leave the
    // profile registered for a plugin whose files could not be materialized.
    await cp(pkgPath, `${pkgPath}.bak-codex-bridge-${Date.now()}`).catch(() => undefined);
    await writeJson(pkgPath, pkg);
  }

  const patchOutcome = await upsertPatchOverride(profileDir, patch);
  if (patchOutcome !== 'unchanged') log(`+ cordis.patch.yml: ${patchOutcome}`);

  const dependency = await installDependency(profileDir, pluginDir);
  log(`node_modules: ${dependency.method}${dependency.detail === undefined ? '' : ` → ${dependency.detail}`}`);

  log('');
  log('Готово. Перезапустите DeepSeek Harness: после старта в левой панели появится');
  log('иконка «Codex» (страница «Импорт из Codex»), плагин виден в Settings → Plugins.');
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`ОШИБКА: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
