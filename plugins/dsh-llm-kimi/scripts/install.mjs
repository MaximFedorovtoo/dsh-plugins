/**
 * Install (or remove) the Kimi provider plugin in a DeepSeek Harness profile.
 *
 * Two profiles can be served by the same plugin package:
 *
 * - `--profile desktop` (default) copies it to
 *   `$DSH_HOME/profiles/desktop/plugins/dsh-llm-kimi` and appends one insert
 *   entry to that profile's `cordis.patch.yml`, the same way the other
 *   profile-local plugins from this repository are mounted. The Desktop
 *   application manages this profile's package list, so no `pnpm` step and no
 *   `package.json` edit are needed.
 * - any other profile can instead install the package through the plugin
 *   manager (`dsh plugin --profile <name> add <path>`); this script still works
 *   as a manual fallback.
 *
 * Usage:
 *   node scripts/install.mjs [--profile desktop] [--dsh-home PATH] [--dry-run]
 *   node scripts/install.mjs --uninstall
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const ENTRY_ID = 'llm-kimi'
const PLUGIN_DIR_NAME = 'dsh-llm-kimi'
const PAYLOAD = [
  'index.js',
  'client.js',
  'adapter.js',
  'auth.js',
  'catalog.js',
  'config.js',
  'wire.js',
  'package.json',
  'cordis.patch.yml',
  'icon.svg',
  'README.md',
  'README.ru.md',
]
const PAYLOAD_DIRS = ['locale']

const args = process.argv.slice(2)
const spec = { profile: 'desktop', dshHome: process.env.DSH_HOME, uninstall: false, dryRun: false }
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--profile') spec.profile = args[++index]
  else if (arg === '--dsh-home') spec.dshHome = args[++index]
  else if (arg === '--uninstall') spec.uninstall = true
  else if (arg === '--dry-run') spec.dryRun = true
  else if (arg === '--help' || arg === '-h') {
    console.log('usage: node scripts/install.mjs [--profile desktop] [--dsh-home PATH] [--uninstall] [--dry-run]')
    process.exit(0)
  } else {
    console.error(`unknown argument: ${arg}`)
    process.exit(2)
  }
}
if (typeof spec.profile !== 'string' || spec.profile.length === 0) {
  console.error('--profile needs a value')
  process.exit(2)
}

const dshHome = resolve(spec.dshHome ?? join(homedir(), '.dsh'))
const profileDir = join(dshHome, 'profiles', spec.profile)
const pluginDir = join(profileDir, 'plugins', PLUGIN_DIR_NAME)
const patchPath = join(profileDir, 'cordis.patch.yml')

function fail(message) {
  console.error(`install: ${message}`)
  process.exit(1)
}

function log(message) {
  console.log(`${spec.dryRun ? '[dry-run] ' : ''}${message}`)
}

function backup(file) {
  if (!existsSync(file)) return
  const stamp = new Date().toISOString().replace(/[-:T]/gu, '').slice(0, 14)
  const target = `${file}.bak-kimi-${stamp}`
  if (spec.dryRun) {
    log(`would back up ${file} -> ${target}`)
    return
  }
  cpSync(file, target)
  log(`backup: ${target}`)
}

/**
 * Append one insert block, dropping the shipped template's empty top-level
 * `[]` placeholder when the file has no real entries yet.
 * @param text - current patch file contents.
 * @returns contents with the mount entry, or undefined when it is present.
 */
function withEntry(text) {
  const lines = text.split('\n')
  if (lines.some((line) => /^\s*-\s+id:\s*llm-kimi\s*$/u.test(line))) return undefined
  const block = [
    '',
    '# Kimi provider routes (kimi-code subscription plan + moonshot pay-per-token).',
    '- insert:',
    `    - id: ${ENTRY_ID}`,
    '      name: ./plugins/dsh-llm-kimi/index.js',
    '',
  ].join('\n')
  const kept = lines.filter((line) => line.trim() !== '[]')
  const body = kept.join('\n').replace(/\s+$/u, '')
  return `${body === '' ? '' : `${body}\n`}${block}`
}

/**
 * Remove our list item from the patch file, leaving every other override
 * untouched. The item is the `- insert:` line before the identifying
 * `id: llm-kimi` row and everything up to the next top-level list item.
 * @param text - current patch file contents.
 * @returns contents without the mount entry, or undefined when it is absent.
 */
function withoutEntry(text) {
  const lines = text.split('\n')
  const idIndex = lines.findIndex((line) => /^\s*-\s+id:\s*llm-kimi\s*$/u.test(line))
  if (idIndex === -1) return undefined
  let start = idIndex
  while (start > 0 && !/^-\s/u.test(lines[start])) start -= 1
  if (!/^-\s/u.test(lines[start])) start = idIndex
  // Drop the comment line this installer writes above the block as well.
  if (start > 0 && /^# Kimi provider routes/u.test(lines[start - 1])) {
    start -= 1
    if (start > 0 && lines[start - 1].trim() === '') start -= 1
  }
  let end = start + 1
  while (end < lines.length && !/^-\s/u.test(lines[end])) end += 1
  lines.splice(start, end - start)
  let result = lines.join('\n')
  if (result.trim() === '') result = '[]\n'
  return result
}

function install() {
  if (!existsSync(profileDir)) fail(`profile directory not found: ${profileDir}`)
  log(`profile: ${profileDir}`)
  if (spec.dryRun) {
    log(`would copy ${PAYLOAD.length} files to ${pluginDir}`)
  } else {
    rmSync(pluginDir, { recursive: true, force: true })
    mkdirSync(pluginDir, { recursive: true })
    for (const file of PAYLOAD) {
      const source = join(root, file)
      if (!existsSync(source)) fail(`missing plugin file: ${source}`)
      cpSync(source, join(pluginDir, file))
    }
    for (const dir of PAYLOAD_DIRS) {
      const source = join(root, dir)
      if (existsSync(source)) cpSync(source, join(pluginDir, dir), { recursive: true })
    }
    const scripts = join(root, 'scripts')
    if (existsSync(scripts)) cpSync(scripts, join(pluginDir, 'scripts'), { recursive: true })
    log(`installed ${PAYLOAD.length} files into ${pluginDir}`)
  }
  const current = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n'
  const next = withEntry(current)
  if (next === undefined) {
    log('profile already mounts llm-kimi; patch left unchanged')
  } else if (spec.dryRun) {
    log(`would append the llm-kimi insert to ${patchPath}`)
  } else {
    backup(patchPath)
    writeFileSync(patchPath, next)
    log(`updated ${patchPath}`)
  }
  console.log('')
  console.log('Next steps:')
  console.log('  1. Restart DeepSeek Harness (the profile patch is read at boot).')
  console.log('  2. In the Web/Desktop GUI open the new Kimi entry in the left sidebar,')
  console.log('     or open Settings -> Models: rows "Kimi Code (подписка)" and "Kimi API (оплата по токенам)" appear.')
  console.log('  3. Paste the API key for the route you use:')
  console.log('     - Kimi Code subscription (recommended for a subscription): https://www.kimi.ai/code/console')
  console.log('     - Kimi API platform (pay per token): https://platform.kimi.ai/console/api-keys')
  console.log('  4. Pick a Kimi Code model in the composer model picker.')
}

function uninstall() {
  if (existsSync(pluginDir)) {
    if (spec.dryRun) log(`would remove ${pluginDir}`)
    else {
      rmSync(pluginDir, { recursive: true, force: true })
      log(`removed ${pluginDir}`)
    }
  }
  if (!existsSync(patchPath)) {
    log(`no patch file at ${patchPath}; nothing else to remove`)
    return
  }
  const current = readFileSync(patchPath, 'utf8')
  const next = withoutEntry(current)
  if (next === undefined) {
    log('profile does not mount llm-kimi; patch left unchanged')
    return
  }
  if (spec.dryRun) log(`would remove the llm-kimi insert from ${patchPath}`)
  else {
    backup(patchPath)
    writeFileSync(patchPath, next)
    log(`updated ${patchPath}`)
  }
  console.log('\nRestart DeepSeek Harness to drop the Kimi routes. Stored API keys stay in the credential store.')
}

if (spec.uninstall) uninstall()
else install()
