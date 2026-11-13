/**
 * dsh-superuser — Host half.
 *
 * Two capabilities in one bundle:
 *
 * A. Per-session superuser mode. For the calling chat it switches the public
 *    permission-preset service (`ctx.permissionPresets`, the same service the
 *    `/permission` command and the permission UI use) to the configured
 *    `danger-full-access` preset: sandbox `danger-full-access` plus approval
 *    policy `never`, i.e. full file access with no approval prompts. The mode is
 *    recorded in the session log through the preset service itself, so it
 *    survives a reload and applies to every later turn of that session.
 *    `config.autoEnable` (default true) applies it to newly created agents and
 *    to the agents that are already live when the plugin activates.
 *
 * B. A universal MCP hub. Servers are managed at runtime and persisted in
 *    `<DSH_HOME>/superuser/mcp-servers.json`. Both stdio and streamable-HTTP
 *    transports are supported; every server owns one client, calls run in
 *    parallel without a global lock, and a dropped server reconnects with
 *    exponential backoff while its tools stay registered. The model gets two
 *    meta tools (`superuser_mode`, `mcp_manage`) and one tool per remote tool
 *    (`mcp__<server>__<tool>`) while that server is connected.
 *
 * The Host also serves the JSON API consumed by the Web panel (contract fixed
 * in the bundle README): the state, the permission switch, the server CRUD and
 * the tool call routes under `/api/superuser/...`.
 *
 * Only public Cordis/DSH extension points are used: `ctx.tools`,
 * `ctx.permissionPresets`, `ctx.approval`, `ctx.sandboxPolicy`, `ctx.agents`,
 * `ctx.sessionTitle` and `ctx.connection.fetch` (the authenticated browser
 * carrier used by every route below).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Plugin row name in `cordis.patch.yml`. */
export const name = 'superuser';

/** Host services this plugin cannot work without. */
export const inject = [
  'tools',
  'agents',
  'permissionPresets',
  'approval',
  'sandboxPolicy',
  'connection',
  'systemPrompt',
];

/** Knob bundles the two modes map to. */
const SUPERUSER_MODE = { sandbox: 'danger-full-access', approval: 'never' };
const NORMAL_MODE = { sandbox: 'workspace-write', approval: 'ask' };

/** Where the bundled stdio MCP server lives (next to this file). */
const DESKTOP_SERVER_PATH = fileURLToPath(new URL('./desktop-mcp.js', import.meta.url));

/** Identity of the bundled desktop MCP server. */
const DESKTOP_ID = 'desktop';

/** MCP protocol revision this hub speaks. */
const MCP_PROTOCOL_VERSION = '2025-06-18';

/** Reconnect policy for a server whose transport died. */
const RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/** Output cap for one tool result rendered into the model context. */
const MAX_TOOL_TEXT = 60000;

/** Prompt-section placement: right after the shipped reading sections. */
const PROMPT_SECTION_ORDER = 3060;

/**
 * Model guidance for the whole feature. Appended to every request, so it stays
 * short: it names the two tools and the one call that sets an application up.
 */
const SUPERUSER_PROMPT_SECTION = `## Superuser mode and desktop applications

Superuser mode is a per-chat permission state: full file access with no approval prompts. Read it or switch it with \`superuser_mode\` (\`{"action":"get"|"on"|"off"}\`); do not describe it as a system-wide setting.

When the user names a desktop application, or the task needs one ("do all of it in Chrome", "open it in Notepad", "сделай всё в хроме"), set it up yourself — never ask for confirmation, a command, a path or extra parameters. Call \`mcp_manage\` with \`{"action":"app","app":"<the name the user used>"}\`. The hub resolves the name against the running applications (case-insensitive; local-language names like "хром" are understood), creates a desktop MCP server bound to that application, connects it, and returns \`{server, tools, message}\`. Then call those tools as \`mcp__<server>__<tool>\` (snapshot, windows, click, type, press, scroll, screenshot, find, wait, set_value; each app-scoped tool uses the bound application when you omit \`app\`).

The binding is sticky for this chat: call \`{"action":"app","app":"<name>"}\` again whenever needed — it reuses the same server instead of duplicating it. If the application is not running yet, the server still starts and its tools answer with a short "not running" message; once the application is started the tools work without reconnecting.

Use the generic \`mcp__desktop__*\` tools for one-off actions across any application; they are not bound to one app. The permission mode and these application servers are independent: enabling superuser mode does not choose an application, and creating an app server does not change permissions.`;

/** Prompt-section placement for the Windows paragraph. */
const WINDOWS_PROMPT_SECTION_ORDER = 3061;

/**
 * One paragraph about OS-level confirmations: they are removed only by the
 * user's own one-time setup, never by the model. Appended to every request.
 */
const WINDOWS_PROMPT_SECTION = `## OS-level confirmations (Windows)

Windows UAC prompts, SmartScreen and similar OS dialogs are removed only by the user's own one-time setup in the Superuser panel (its "Windows" block): the plugin prepares one elevated script and the user starts it with a single Windows consent dialog. You cannot bypass UAC silently and must not claim that you can; never try to enable, disable or elevate anything yourself, and do not ask the user to disable UAC in Windows settings. The \`windowsAdmin\` tool reports the current OS state only (read-only); superuser mode changes DSH approvals and file access, not OS prompts.`;

/** Scheduled task registered by the one-time Windows setup. */
const WINDOWS_TASK_NAME = 'DSH Superuser Elevated';

/** UAC policy key the setup reads and writes. */
const UAC_KEY = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';

/** Windows PowerShell 5.1 executable (present on every supported Windows). */
const WINDOWS_POWERSHELL = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

/** Pending user-initiated setup: `{ action, requestedAt }` until the state lands. */
let pendingWindowsSetup;

/** `'…'` PowerShell literal; embedded quotes are doubled. */
function windowsQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

/**
 * Setup file paths under an ASCII-only directory: the elevated PowerShell is
 * started through ShellExecute, and a Cyrillic path (for example a localized
 * user profile such as C:\Users\ПК) is mangled on the elevated command line.
 * C:\Users\Public is writable for the interactive user and ASCII on every
 * Windows locale.
 */
function windowsSetupPaths() {
  const userProfile =
    typeof process.env.USERPROFILE === 'string' && process.env.USERPROFILE !== ''
      ? process.env.USERPROFILE
      : homedir();
  const publicRoot =
    typeof process.env.PUBLIC === 'string' && process.env.PUBLIC !== ''
      ? process.env.PUBLIC
      : join(userProfile, '..', 'Public');
  const dir = join(publicRoot, 'dsh-superuser');
  return { dir, script: join(dir, 'windows-setup.ps1'), log: join(dir, 'windows-setup.log') };
}

/** Render the read-only Windows status query. */
function windowsStatusScript() {
  return `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
# Read the token's group list by SID: a UAC-filtered administrator token carries
# BUILTIN\\Administrators (S-1-5-32-544) as "deny only", which IsInRole reports
# as false. Elevated processes carry a high mandatory level SID (S-1-16-12288)
# or the system mandatory level (S-1-16-16384).
$whoamiGroups = (whoami.exe /groups 2>$null | Out-String)
$isAdminUser = $whoamiGroups -match 'S-1-5-32-544'
$elevated = ($whoamiGroups -match 'S-1-16-12288') -or ($whoamiGroups -match 'S-1-16-16384')
$key = ${windowsQuote(UAC_KEY)}
$props = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
$enableLua = if ($null -ne $props) { $props.EnableLUA } else { $null }
$consent = if ($null -ne $props) { $props.ConsentPromptBehaviorAdmin } else { $null }
$secure = if ($null -ne $props) { $props.PromptOnSecureDesktop } else { $null }
$task = Get-ScheduledTask -TaskName ${windowsQuote(WINDOWS_TASK_NAME)} -ErrorAction SilentlyContinue
$taskExists = $null -ne $task
$runLevel = ''
$taskCommand = ''
if ($taskExists) {
  $runLevel = [string]$task.Principal.RunLevel
  try { $taskCommand = [string]($task.Actions | Select-Object -First 1 -ExpandProperty Execute) } catch { }
}
@{ elevated = $elevated; isAdminUser = $isAdminUser; enableLua = $enableLua; consentPromptBehaviorAdmin = $consent; promptOnSecureDesktop = $secure; taskExists = $taskExists; taskRunLevel = $runLevel; taskCommand = $taskCommand } | ConvertTo-Json -Compress
} catch {
@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
}

/**
 * Run one PowerShell snippet and return its trimmed stdout.
 * @param {string} script - PowerShell source.
 * @param {number} [timeoutMs] - budget.
 * @returns {Promise<string>} stdout.
 */
function runWindowsPowerShell(script, timeoutMs = 30000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(
      WINDOWS_POWERSHELL,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) rejectPromise(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // gone
      }
      finish(new Error(`Windows PowerShell timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(new Error(`cannot start Windows PowerShell: ${compact(messageOf(error))}`)));
    child.on('close', () => {
      if (stdout.trim() !== '') {
        finish(undefined, stdout.trim());
        return;
      }
      finish(new Error(`Windows PowerShell returned no output: ${compact(stderr.trim() || 'empty')}`));
    });
  });
}

/**
 * Resolve the executable the logon task should start: the Desktop GUI app
 * (so an elevated DSH starts), never a bare runtime binary when the Host runs
 * under a plain Node runtime.
 * @returns {Promise<{ exePath: string, source: 'electron'|'desktop-process'|'fallback', warning?: string }>} resolved executable.
 */
async function resolveDesktopExecutable() {
  if (isElectron()) return { exePath: process.execPath, source: 'electron' };
  const script = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
foreach ($name in @('DeepSeek Harness','DeepSeek Harness.exe')) {
  $process = Get-Process -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $process -and -not [string]::IsNullOrWhiteSpace($process.Path)) { $process.Path; break }
}`;
  try {
    const stdout = await runWindowsPowerShell(script, 15000);
    const candidate = stdout
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .find((entry) => existsSync(entry));
    if (candidate !== undefined) return { exePath: candidate, source: 'desktop-process' };
  } catch {
    // fall through to the runtime binary
  }
  return {
    exePath: process.execPath,
    source: 'fallback',
    warning:
      'could not find the DeepSeek Harness desktop executable (process list empty); the logon task would start the current runtime binary and may not start DSH',
  };
}

/**
 * Read the current Windows confirmation state (read-only).
 * @returns {Promise<object>} status payload for the tool and the HTTP API.
 */
async function readWindowsStatus() {
  let record;
  try {
    const stdout = await runWindowsPowerShell(windowsStatusScript());
    const line = stdout
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith('{'))
      .pop();
    if (line === undefined) throw new Error('status query produced no JSON');
    record = JSON.parse(line);
  } catch (error) {
    return {
      elevated: false,
      isAdminUser: false,
      uac: { enableLua: null, consentPromptBehaviorAdmin: null, promptOnSecureDesktop: null },
      uacValues: { EnableLUA: null, ConsentPromptBehaviorAdmin: null, PromptOnSecureDesktop: null },
      uacEnabled: true,
      task: { name: WINDOWS_TASK_NAME, exists: false, runLevel: '', command: '' },
      autostart: { taskExists: false, runLevel: '' },
      pendingConsent: pendingWindowsSetup !== undefined,
      log: '',
      notes: [/* status unavailable */],
      error: compact(messageOf(error)),
    };
  }
  if (typeof record.error === 'string') {
    return {
      elevated: false,
      isAdminUser: false,
      uac: { enableLua: null, consentPromptBehaviorAdmin: null, promptOnSecureDesktop: null },
      uacValues: { EnableLUA: null, ConsentPromptBehaviorAdmin: null, PromptOnSecureDesktop: null },
      uacEnabled: true,
      task: { name: WINDOWS_TASK_NAME, exists: false, runLevel: '', command: '' },
      autostart: { taskExists: false, runLevel: '' },
      pendingConsent: pendingWindowsSetup !== undefined,
      log: '',
      notes: ['Windows status is unavailable on this host'],
      error: compact(record.error),
    };
  }
  const elevated = record.elevated === true;
  const isAdminUser = record.isAdminUser === true;
  const uac = {
    enableLua: record.enableLua ?? null,
    consentPromptBehaviorAdmin: record.consentPromptBehaviorAdmin ?? null,
    promptOnSecureDesktop: record.promptOnSecureDesktop ?? null,
  };
  const task = {
    name: WINDOWS_TASK_NAME,
    exists: record.taskExists === true,
    runLevel: typeof record.taskRunLevel === 'string' ? record.taskRunLevel : '',
    command: typeof record.taskCommand === 'string' ? record.taskCommand : '',
  };
  const uacSilent = Number(uac.consentPromptBehaviorAdmin) === 0 && Number(uac.promptOnSecureDesktop) === 0;
  const uacEnabled = Number(uac.enableLua ?? 1) !== 0 && !uacSilent;
  // A user-initiated setup is pending until its expected end state appears.
  if (pendingWindowsSetup !== undefined) {
    const age = Date.now() - pendingWindowsSetup.requestedAt;
    const applied =
      (pendingWindowsSetup.action === 'enable' && Number(uac.enableLua) !== 0 && uacSilent) ||
      (pendingWindowsSetup.action === 'disable' && !uacSilent && !task.exists) ||
      (pendingWindowsSetup.action === 'restart' && age > 15000);
    if (applied || age > 180000) pendingWindowsSetup = undefined;
  }
  const notes = [];
  if (elevated) notes.push('This Harness process is running elevated; keep that only intentionally.');
  else if (isAdminUser) notes.push('The account can elevate through UAC, but this Harness process is not elevated: windows owned by elevated apps are not operable from it.');
  else notes.push('The account has no administrator rights: the one-time Windows setup cannot be enabled with it, and elevated windows are not operable.');
  if (task.exists) notes.push(`The logon task "${WINDOWS_TASK_NAME}" is registered (RunLevel ${task.runLevel || 'unknown'}).`);
  else notes.push(`No "${WINDOWS_TASK_NAME}" logon task: the one-time setup has not been enabled.`);
  if (uacSilent && Number(uac.enableLua) !== 0) notes.push('UAC prompts are configured silent for administrators (setup applied).');
  if (Number(uac.enableLua) === 0) notes.push('UAC is disabled system-wide (EnableLUA=0); this is broader than the plugin setup.');
  const paths = windowsSetupPaths();
  // The logon task must start the Desktop app, not the bare runtime binary the
  // Host may be running on (plain-Node Harness). The resolved path is reported
  // so the panel can show exactly what the task would launch.
  const resolvedExe = await resolveDesktopExecutable();
  if (resolvedExe.warning !== undefined) notes.push(resolvedExe.warning);
  let log = '';
  try {
    const content = await readFile(paths.log, 'utf8');
    log = content
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(-5)
      .join('\n');
  } catch {
    log = '';
  }
  return {
    elevated,
    isAdminUser,
    uac,
    uacValues: {
      EnableLUA: uac.enableLua,
      ConsentPromptBehaviorAdmin: uac.consentPromptBehaviorAdmin,
      PromptOnSecureDesktop: uac.promptOnSecureDesktop,
    },
    uacEnabled,
    task,
    autostart: { taskExists: task.exists, runLevel: task.runLevel },
    pendingConsent: pendingWindowsSetup !== undefined,
    setupLog: log,
    log,
    setupScriptPath: paths.script,
    exePath: resolvedExe.exePath,
    exePathSource: resolvedExe.source,
    ...(resolvedExe.warning === undefined ? {} : { exePathWarning: resolvedExe.warning }),
    taskName: WINDOWS_TASK_NAME,
    notes,
  };
}

/**
 * Render the one-time Windows setup script. `-DryRun` prints the exact
 * registry and task commands and changes nothing.
 * @param {{ action: 'enable'|'disable', exePath: string, scriptPath: string, logPath: string }} options - script facts.
 * @returns {string} PowerShell source.
 */
export function renderWindowsSetupScript(options) {
  const action = options.action === 'disable' ? 'disable' : 'enable';
  const exePath = String(options.exePath ?? '');
  const scriptPath = String(options.scriptPath ?? '');
  const logPath = String(options.logPath ?? '');
  return `# DSH Superuser - Windows confirmation setup (generated, user-initiated).
# Run elevated; -DryRun prints the planned changes and touches nothing.
param(
  [ValidateSet('enable','disable')] [string]$Action = ${windowsQuote(action)},
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$log = ${windowsQuote(logPath)}
$key = ${windowsQuote(UAC_KEY)}
$task = ${windowsQuote(WINDOWS_TASK_NAME)}
$dsh = ${windowsQuote(exePath)}
function Write-Log([string]$line) {
  try {
    $dir = Split-Path -Parent $log
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -LiteralPath $log -Value "$([DateTime]::UtcNow.ToString('o')) $line" -Encoding UTF8
  } catch { }
}
$isElevated = ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$plan = if ($Action -eq 'enable') {
  @(
    "Set-ItemProperty -LiteralPath '$key' -Name EnableLUA -Value 1 -Type DWord",
    "Set-ItemProperty -LiteralPath '$key' -Name ConsentPromptBehaviorAdmin -Value 0 -Type DWord",
    "Set-ItemProperty -LiteralPath '$key' -Name PromptOnSecureDesktop -Value 0 -Type DWord",
    ("schtasks.exe /Create /TN '" + $task + "' /TR '" + $dsh + "' /SC ONLOGON /RL HIGHEST /IT /F")
  )
} else {
  @(
    "Set-ItemProperty -LiteralPath '$key' -Name EnableLUA -Value 1 -Type DWord",
    "Set-ItemProperty -LiteralPath '$key' -Name ConsentPromptBehaviorAdmin -Value 5 -Type DWord",
    "Set-ItemProperty -LiteralPath '$key' -Name PromptOnSecureDesktop -Value 1 -Type DWord",
    "schtasks.exe /Delete /TN '$task' /F"
  )
}
if ($DryRun) {
  Write-Output "DRY RUN: $Action - no registry or scheduled-task changes"
  Write-Output "DSH executable: $dsh"
  foreach ($step in $plan) { Write-Output "WOULD: $step" }
  Write-Log "dry-run $Action (elevated=$isElevated, exe=$dsh)"
  exit 0
}
Write-Log "start $Action setup (elevated=$isElevated, exe=$dsh, script=$scriptPath)"
if (-not $isElevated) {
  Write-Output 'ERROR: this setup must run elevated. Launch it from the Superuser panel (one Windows consent dialog).'
  Write-Log "error: not elevated, $Action aborted"
  exit 5
}
try {
  if ($Action -eq 'enable') {
    Set-ItemProperty -LiteralPath $key -Name EnableLUA -Value 1 -Type DWord
    Set-ItemProperty -LiteralPath $key -Name ConsentPromptBehaviorAdmin -Value 0 -Type DWord
    Set-ItemProperty -LiteralPath $key -Name PromptOnSecureDesktop -Value 0 -Type DWord
    $scheduled = & schtasks.exe /Create /TN $task /TR ('"' + $dsh + '"') /SC ONLOGON /RL HIGHEST /IT /F 2>&1
    if ($LASTEXITCODE -ne 0) { throw "schtasks /Create failed ($LASTEXITCODE): $($scheduled -join ' ')" }
    Write-Log 'enabled: UAC prompts silent for administrators; logon task registered'
  } else {
    Set-ItemProperty -LiteralPath $key -Name EnableLUA -Value 1 -Type DWord
    Set-ItemProperty -LiteralPath $key -Name ConsentPromptBehaviorAdmin -Value 5 -Type DWord
    Set-ItemProperty -LiteralPath $key -Name PromptOnSecureDesktop -Value 1 -Type DWord
    $scheduled = & schtasks.exe /Delete /TN $task /F 2>&1
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) { throw "schtasks /Delete failed ($LASTEXITCODE): $($scheduled -join ' ')" }
    Write-Log 'disabled: UAC prompts restored (5/1); logon task removed'
  }
  Write-Output "OK: $Action finished"
} catch {
  Write-Log "error: $($_.Exception.Message)"
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 1
}`;
}

/** Append one line to the setup log. */
async function appendSetupLog(line) {
  const paths = windowsSetupPaths();
  await mkdir(paths.dir, { recursive: true });
  await appendFile(paths.log, `${new Date().toISOString()} ${line}\n`, 'utf8');
}

/**
 * Start one PowerShell process elevated through exactly one UAC consent, and
 * return immediately (the child is detached and never awaited).
 * @param {string[]} argumentList - arguments for the elevated PowerShell.
 */
function launchElevatedPowerShell(argumentList) {
  const gate = `Start-Process -FilePath ${windowsQuote(WINDOWS_POWERSHELL)} -Verb RunAs -WindowStyle Hidden -ArgumentList @(${argumentList
    .map((argument) => windowsQuote(argument))
    .join(', ')})`;
  const child = spawn(
    WINDOWS_POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', gate],
    { windowsHide: true, detached: true, stdio: 'ignore' },
  );
  child.unref();
}

/**
 * Generate and launch (or dry-run) the user-initiated Windows setup.
 * @param {'enable'|'disable'|'restart'} action - requested change.
 * @param {{ dryRun?: boolean }} [options] - dry-run writes the script but launches nothing.
 * @returns {Promise<object>} API payload.
 */
async function performWindowsSetup(action, options = {}) {
  const dryRun = options.dryRun === true;
  const paths = windowsSetupPaths();
  const resolvedExe = await resolveDesktopExecutable();
  const exePath = resolvedExe.exePath;
  const exeFields = definedFields({
    exePath,
    exePathSource: resolvedExe.source,
    exePathWarning: resolvedExe.warning,
  });
  if (resolvedExe.warning !== undefined) await appendSetupLog(`warning: ${resolvedExe.warning}`);
  if (action === 'restart') {
    const command = `schtasks.exe /Run /TN "${WINDOWS_TASK_NAME}"`;
    if (dryRun) {
      return {
        action,
        pendingConsent: false,
        dryRun: true,
        command,
        log: paths.log,
        ...exeFields,
        status: await readWindowsStatus(),
      };
    }
    launchElevatedPowerShell([
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `& schtasks.exe /Run /TN ${windowsQuote(WINDOWS_TASK_NAME)}`,
    ]);
    pendingWindowsSetup = { action, requestedAt: Date.now() };
    await appendSetupLog('restart requested through one elevated schtasks /Run');
    return { action, pendingConsent: true, command, log: paths.log, ...exeFields, status: await readWindowsStatus() };
  }
  const content = renderWindowsSetupScript({
    action,
    exePath,
    scriptPath: paths.script,
    logPath: paths.log,
  });
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.script, content, 'utf8');
  if (dryRun) {
    await appendSetupLog(`dry-run: wrote setup script for ${action}; nothing launched`);
    return {
      action,
      pendingConsent: false,
      dryRun: true,
      script: paths.script,
      log: paths.log,
      ...exeFields,
      status: await readWindowsStatus(),
    };
  }
  launchElevatedPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', paths.script, '-Action', action]);
  pendingWindowsSetup = { action, requestedAt: Date.now() };
  await appendSetupLog(`elevated setup requested for ${action} (one Windows consent expected)`);
  return {
    action,
    pendingConsent: true,
    script: paths.script,
    log: paths.log,
    ...exeFields,
    status: await readWindowsStatus(),
  };
}


/** @returns {string} DSH home directory. */
function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
}

/** Whether the Host process runs inside Electron (so `process.execPath` needs the Node flag). */
function isElectron() {
  return typeof process.versions.electron === 'string';
}

/**
 * Resolve a plain Node interpreter for spawning the bundled stdio server.
 * @returns {{ exe: string, env: Record<string, string> }} interpreter and extra environment.
 */
function nodeInterpreter() {
  if (isElectron()) return { exe: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  if (typeof process.execPath === 'string' && existsSync(process.execPath)) return { exe: process.execPath, env: {} };
  if (typeof process.resourcesPath === 'string') {
    const candidate = join(
      process.resourcesPath,
      'runtime',
      'primary-runtime',
      'dependencies',
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node',
    );
    if (existsSync(candidate)) return { exe: candidate, env: {} };
  }
  return { exe: process.platform === 'win32' ? 'node.exe' : 'node', env: {} };
}

/** Positive integer from config, or the fallback. */
function positiveInt(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Normalize the row configuration.
 * @param {Record<string, unknown> | undefined} raw - raw row config.
 * @returns {{ autoEnable: boolean, storePath: string, connectTimeoutMs: number, callTimeoutMs: number }} resolved settings.
 */
export function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const home = dshHome();
  const configured = typeof source.mcpStorePath === 'string' ? source.mcpStorePath.trim() : '';
  const storePath =
    configured === ''
      ? join(home, 'superuser', 'mcp-servers.json')
      : isAbsolute(configured)
        ? configured
        : join(home, configured);
  return {
    autoEnable: source.autoEnable !== false,
    storePath,
    connectTimeoutMs: positiveInt(source.connectTimeoutMs, 20000),
    callTimeoutMs: positiveInt(source.callTimeoutMs, 90000),
  };
}

/** One-line compact text for logs and tool errors. */
function compact(value, limit = 400) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Error text of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Structured error carrying the HTTP status and API code. */
class HttpError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} code - stable API error code.
   * @param {string} message - human readable message.
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Build a structured error. */
function httpError(status, code, message) {
  return new HttpError(status, code, message);
}

/** Remove undefined values from one object (keeps the JSON contract compact). */
function definedFields(source) {
  const result = {};
  for (const [key, value] of Object.entries(source)) if (value !== undefined) result[key] = value;
  return result;
}

/**
 * Repair a stored stdio record whose `command` accidentally carries the script
 * path that also lives in `args` (an older panel copied the built-in server's
 * display command, where the executable and the script were shown together).
 * Spawning needs the executable alone.
 * @param {{ transport?: string, command?: string, args?: string[] }} record - normalized record.
 * @returns {boolean} true when the record was repaired.
 */
function repairStoredCommand(record) {
  if (record.transport !== 'stdio') return false;
  const args = Array.isArray(record.args) ? record.args : [];
  if (args.length !== 1 || args[0] !== DESKTOP_SERVER_PATH) return false;
  const command = typeof record.command === 'string' ? record.command : '';
  if (!command.endsWith(DESKTOP_SERVER_PATH) || command.length <= DESKTOP_SERVER_PATH.length) return false;
  record.command = command.slice(0, command.length - DESKTOP_SERVER_PATH.length).trim();
  return true;
}

/* ------------------------------------------------------------------------- *
 * Superuser mode (permission presets)
 * ------------------------------------------------------------------------- */

/**
 * Read the effective permission state of one live agent.
 * @param {object} ctx - Host plugin context.
 * @param {object} agent - live Agent.
 * @returns {{ preset: string, sandbox: string, approval: string, enabled: boolean }} state.
 */
function permissionStateOf(ctx, agent) {
  const session = agent.session;
  const preset = ctx.permissionPresets.current(session);
  const sandbox = ctx.sandboxPolicy.overrideOf(session) ?? ctx.sandboxPolicy.defaultMode;
  const approval = ctx.approval.overrideOf(session) ?? (ctx.approval.config?.policy ?? 'ask');
  return {
    preset,
    sandbox,
    approval,
    enabled: sandbox === SUPERUSER_MODE.sandbox && approval === SUPERUSER_MODE.approval,
  };
}

/**
 * Find the configured preset whose knob bundle matches one target pair.
 * @param {object} ctx - Host plugin context.
 * @param {{ sandbox: string, approval: string }} target - desired knobs.
 * @returns {string | undefined} preset name.
 */
function presetMatching(ctx, target) {
  let options;
  try {
    options = ctx.permissionPresets.catalog().options;
  } catch {
    options = [];
  }
  for (const option of options) {
    if (option.value === 'auto' || option.value === 'custom') continue;
    let spec;
    try {
      spec = ctx.permissionPresets.resolve(option.value);
    } catch {
      continue;
    }
    if (spec.sandbox === target.sandbox && spec.approval === target.approval) return option.value;
  }
  return undefined;
}

/**
 * Resolve the preset name for one mode, throwing a readable error when the
 * deployment configures no matching preset.
 * @param {object} ctx - Host plugin context.
 * @param {{ sandbox: string, approval: string }} target - desired knobs.
 * @returns {{ name: string, spec: { sandbox: string, approval: string } }} preset.
 */
function requirePreset(ctx, target) {
  const preset = presetMatching(ctx, target);
  if (preset === undefined) {
    throw httpError(
      409,
      'preset-unavailable',
      `no configured permission preset matches sandbox "${target.sandbox}" with approval policy "${target.approval}"`,
    );
  }
  return { name: preset, spec: ctx.permissionPresets.resolve(preset) };
}

/**
 * Switch one live agent to the requested mode through the public preset path
 * (the same service write path the `/permission` command uses). The preset
 * service records the durable preset identity and updates each changed knob
 * (sandbox mode + approval policy) through its own canonical setters, so the
 * session log — and therefore the effective policy of later turns — follows.
 * @param {object} ctx - Host plugin context.
 * @param {object} agent - live Agent.
 * @param {{ sandbox: string, approval: string }} target - desired mode.
 * @returns {{ preset: string, sandbox: string, approval: string, enabled: boolean }} new state.
 */
function setMode(ctx, agent, target) {
  const { name: preset } = requirePreset(ctx, target);
  ctx.permissionPresets.set(agent.session, preset);
  return permissionStateOf(ctx, agent);
}

/**
 * Durably record one mode for an agent that is still being created (no live
 * inbox yet, so no approval notice is injected).
 * @param {object} ctx - Host plugin context.
 * @param {object} agent - the agent announced by `agent/created`.
 * @param {{ sandbox: string, approval: string }} target - desired mode.
 * @returns {string} the preset name that was recorded.
 */
function seedMode(ctx, agent, target) {
  const { name: preset } = requirePreset(ctx, target);
  ctx.permissionPresets.set(agent.session, preset);
  return preset;
}

/* ------------------------------------------------------------------------- *
 * MCP transports
 * ------------------------------------------------------------------------- */

/** Timeout signal combined with an optional caller cancellation. */
function callSignal(timeoutMs, signal) {
  let timeout;
  try {
    timeout = AbortSignal.timeout(timeoutMs);
  } catch {
    timeout = new AbortController().signal;
  }
  if (signal === undefined || signal === null) return timeout;
  try {
    return AbortSignal.any([signal, timeout]);
  } catch {
    return signal;
  }
}

/** JSON-RPC error text from one response message. */
function rpcFailure(message) {
  const error = message.error ?? {};
  const code = error.code === undefined ? 'error' : String(error.code);
  return new Error(`mcp error ${code}: ${compact(error.message ?? 'the server rejected the request')}`);
}

/** Input schema normalization for tool registration. */
function normalizeInputSchema(schema) {
  if (schema === null || typeof schema !== 'object') return { type: 'object', properties: {}, additionalProperties: false };
  const result = { ...schema };
  if (typeof result.type !== 'string') result.type = 'object';
  if (result.type === 'object' && (result.properties === null || typeof result.properties !== 'object')) result.properties = {};
  return result;
}

/**
 * stdio MCP client: one child process per server, newline-delimited JSON-RPC.
 */
class StdioClient {
  /**
   * @param {object} server - persisted server record.
   * @param {{ connectTimeoutMs: number, callTimeoutMs: number }} options - timeouts.
   * @param {{ onDead: (error: Error) => void }} hooks - lifecycle callback.
   */
  constructor(server, options, hooks) {
    this.server = server;
    this.options = options;
    this.hooks = hooks;
    this.child = undefined;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.stderr = '';
    this.closed = false;
  }

  /** Spawn the server process (no protocol handshake here). */
  start() {
    const target = this.spawnTarget();
    this.child = spawn(target.exe, target.args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...target.env, ...(this.server.env ?? {}) },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.onData(String(chunk));
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000);
    });
    this.child.on('error', (error) => {
      this.onDead(new Error(`cannot start the stdio server (${target.exe}): ${compact(error.message)}`));
    });
    this.child.on('close', (code, signal) => {
      const detail = this.stderr.trim() === '' ? '' : `: ${compact(this.stderr.split(/\r?\n/u).filter(Boolean).slice(-2).join(' | '))}`;
      this.onDead(new Error(`stdio server exited (${code === null ? String(signal) : String(code)})${detail}`));
    });
  }

  /** Resolve the executable and arguments for this server. */
  spawnTarget() {
    if (this.server.builtin === true) {
      const node = nodeInterpreter();
      return { exe: node.exe, args: [DESKTOP_SERVER_PATH], env: node.env };
    }
    const exe = String(this.server.command ?? '');
    const env = {};
    // A panel-created server may point at the Desktop executable itself (for
    // example a clone of the built-in desktop server). Electron only behaves as
    // plain Node when asked to, so supply the flag the built-in server gets.
    if (isElectron() && exe.toLowerCase() === String(process.execPath).toLowerCase()) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }
    return { exe, args: Array.isArray(this.server.args) ? this.server.args.map(String) : [], env };
  }

  /** Consume one stdout chunk and dispatch complete lines. */
  onData(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line !== '') {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          message = undefined;
        }
        if (message !== null && typeof message === 'object') this.onMessage(message);
      }
      index = this.buffer.indexOf('\n');
    }
  }

  /** Route one parsed message to a pending request or drop a notification. */
  onMessage(message) {
    if (message.method === undefined && message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(rpcFailure(message));
      else pending.resolve(message.result);
    }
    // Server-initiated notifications (tools/list_changed, progress…) need no action here.
  }

  /**
   * Send one request and await its response.
   * @param {string} method - JSON-RPC method.
   * @param {object | undefined} params - request params.
   * @param {number} timeoutMs - per-request budget.
   * @returns {Promise<unknown>} the result value.
   */
  request(method, params, timeoutMs) {
    if (this.closed || this.child === undefined) return Promise.reject(new Error('the server is not connected'));
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`mcp request "${method}" timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(new Error(`cannot write to the stdio server: ${compact(messageOf(error))}`));
      }
    });
  }

  /** Send one notification (no response expected). */
  notify(method, params) {
    if (this.closed || this.child === undefined) return;
    try {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    } catch {
      // A dead pipe is reported by the close handler.
    }
  }

  /** Mark the client dead, reject pending requests and notify the hub. */
  onDead(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    try {
      this.child?.kill();
    } catch {
      // already gone
    }
    this.hooks.onDead(error);
  }

  /** Close the client without triggering the reconnect callback. */
  async close() {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('the server was disconnected'));
    }
    this.pending.clear();
    try {
      this.child?.stdin.end();
    } catch {
      // ignore
    }
    try {
      this.child?.kill();
    } catch {
      // ignore
    }
  }
}

/**
 * Streamable-HTTP MCP client: one URL per server, POSTed JSON-RPC with an
 * optional `mcp-session-id` header and a single-response SSE fallback.
 */
class HttpClient {
  /**
   * @param {object} server - persisted server record.
   * @param {{ connectTimeoutMs: number, callTimeoutMs: number }} options - timeouts.
   * @param {{ onDead: (error: Error) => void }} hooks - lifecycle callback.
   */
  constructor(server, options, hooks) {
    this.server = server;
    this.options = options;
    this.hooks = hooks;
    this.sessionId = undefined;
    this.nextId = 1;
    this.closed = false;
  }

  /** Nothing to spawn for an HTTP server. */
  start() {}

  /** Request headers for one POST. */
  headers() {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    };
    if (this.sessionId !== undefined) headers['mcp-session-id'] = this.sessionId;
    return headers;
  }

  /**
   * POST one JSON-RPC message and return the server message (or undefined for
   * an accepted notification).
   * @param {object} payload - JSON-RPC message.
   * @param {number} timeoutMs - budget.
   * @param {AbortSignal | undefined} signal - caller cancellation.
   * @returns {Promise<object | undefined>} the response message.
   */
  async post(payload, timeoutMs, signal) {
    let response;
    try {
      response = await fetch(String(this.server.url), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: callSignal(timeoutMs, signal),
      });
    } catch (error) {
      this.hooks.onDead(new Error(`http server unreachable: ${compact(messageOf(error))}`));
      throw new Error(`http server unreachable: ${compact(messageOf(error))}`);
    }
    const sessionHeader = response.headers.get('mcp-session-id');
    if (sessionHeader !== null && sessionHeader !== '') this.sessionId = sessionHeader;
    if (response.status === 202 || response.status === 204) return undefined;
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`http ${response.status}${body.trim() !== '' ? `: ${compact(body.slice(0, 300))}` : ''}`);
    }
    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/event-stream')) return await this.readSse(response, payload.id);
    let message;
    try {
      message = await response.json();
    } catch (error) {
      throw new Error(`http server returned malformed JSON: ${compact(messageOf(error))}`);
    }
    return message;
  }

  /**
   * Read the first SSE message that answers `id`.
   * @param {Response} response - streaming response.
   * @param {number | undefined} id - the request id.
   * @returns {Promise<object>} the matching JSON-RPC message.
   */
  async readSse(response, id) {
    const body = response.body;
    if (body === null) throw new Error('http server returned an empty event stream');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = frame
            .split(/\r?\n/u)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .filter((line) => line !== '')
            .join('\n');
          if (data !== '') {
            let message;
            try {
              message = JSON.parse(data);
            } catch {
              message = undefined;
            }
            if (message !== null && typeof message === 'object' && (message.id === id || message.id === undefined)) {
              if (message.result !== undefined || message.error !== undefined) return message;
            }
          }
          index = buffer.indexOf('\n\n');
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
    throw new Error('the event stream ended without a response');
  }

  /**
   * Send one request and await its response.
   * @param {string} method - JSON-RPC method.
   * @param {object | undefined} params - request params.
   * @param {number} timeoutMs - per-request budget.
   * @param {AbortSignal | undefined} [signal] - caller cancellation.
   * @returns {Promise<unknown>} the result value.
   */
  async request(method, params, timeoutMs, signal) {
    if (this.closed) throw new Error('the server is not connected');
    const id = this.nextId++;
    const message = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs, signal);
    if (message === undefined) throw new Error(`the http server accepted "${method}" without a response`);
    if (message.error !== undefined) throw rpcFailure(message);
    return message.result;
  }

  /** Send one notification (no response expected). */
  async notify(method, params) {
    if (this.closed) return;
    try {
      await this.post({ jsonrpc: '2.0', method, params }, this.options.connectTimeoutMs, undefined);
    } catch {
      // A dead HTTP server is reported by the next request.
    }
  }

  /** Close the HTTP session (best effort). */
  async close() {
    this.closed = true;
    if (this.sessionId === undefined) return;
    try {
      await fetch(String(this.server.url), {
        method: 'DELETE',
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // best effort
    }
  }
}

/**
 * Run the MCP initialize handshake on one client.
 * @param {StdioClient | HttpClient} client - transport client.
 * @param {{ connectTimeoutMs: number }} options - timeouts.
 * @returns {Promise<void>}
 */
async function initializeClient(client, options) {
  await client.request(
    'initialize',
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dsh-superuser', version: '1.0.0' },
    },
    options.connectTimeoutMs,
  );
  await client.notify('notifications/initialized', {});
}

/**
 * Read every page of `tools/list`.
 * @param {StdioClient | HttpClient} client - transport client.
 * @param {{ connectTimeoutMs: number }} options - timeouts.
 * @returns {Promise<Array<{ name: string, title?: string, description?: string, inputSchema?: object }>>} tools.
 */
async function listAllTools(client, options) {
  const tools = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = await client.request('tools/list', cursor === undefined ? {} : { cursor }, options.connectTimeoutMs);
    const entries = result !== null && typeof result === 'object' && Array.isArray(result.tools) ? result.tools : [];
    for (const tool of entries) {
      if (tool !== null && typeof tool === 'object' && typeof tool.name === 'string') tools.push(tool);
    }
    const next = result !== null && typeof result === 'object' ? result.nextCursor : undefined;
    if (typeof next !== 'string' || next === '') break;
    cursor = next;
  }
  return tools;
}

/**
 * Render one MCP `tools/call` result as model text.
 * @param {object} result - MCP call result.
 * @returns {string} text.
 */
function resultText(result) {
  if (result === null || typeof result !== 'object') return JSON.stringify(result ?? null, null, 2);
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
  let text;
  if (texts.length > 0) text = texts.join('\n\n');
  else if (result.structuredContent !== undefined) text = JSON.stringify(result.structuredContent, null, 2);
  else text = JSON.stringify(result, null, 2);
  return text.length > MAX_TOOL_TEXT ? `${text.slice(0, MAX_TOOL_TEXT)}\n… output truncated (${text.length} characters)` : text;
}

/** Server id -> safe tool-name segment. */
function toolSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 40);
}

/**
 * Build the model-facing name of one remote tool.
 * @param {string} serverId - server id.
 * @param {string} toolName - remote tool name.
 * @returns {string} tool name.
 */
function dynamicToolName(serverId, toolName) {
  const combined = `mcp__${toolSegment(serverId)}__${toolSegment(toolName)}`;
  return combined.length <= 64 ? combined : combined.slice(0, 64);
}

/* ------------------------------------------------------------------------- *
 * MCP hub (store + lifecycle + tools)
 * ------------------------------------------------------------------------- */

/**
 * Create the runtime MCP hub.
 * @param {object} ctx - Host plugin context.
 * @param {ReturnType<typeof resolveConfig>} config - resolved settings.
 * @returns {object} hub facade.
 */
function createHub(ctx, config) {
  /** @type {Map<string, object>} id -> runtime entry. */
  const entries = new Map();
  let store = { version: 1, servers: [] };
  let saveChain = Promise.resolve();
  let disposed = false;

  const log = (message) => {
    try {
      ctx.logger?.warn?.(`superuser: ${message}`);
    } catch {
      // logging must never break the hub
    }
  };

  /** Default built-in desktop server record. */
  const desktopRecord = () => ({
    id: DESKTOP_ID,
    name: DESKTOP_ID,
    label: 'Desktop',
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    url: '',
    autoConnect: true,
    builtin: true,
  });

  /** Normalize one persisted server record (drops unknown fields, fills defaults). */
  const normalizeStored = (value) => {
    if (value === null || typeof value !== 'object' || typeof value.name !== 'string') return undefined;
    const transport = value.transport === 'http' ? 'http' : 'stdio';
    return {
      id: typeof value.id === 'string' && value.id !== '' ? value.id : toolSegment(value.name),
      name: value.name,
      label: typeof value.label === 'string' && value.label !== '' ? value.label : value.name,
      transport,
      command: typeof value.command === 'string' ? value.command : '',
      args: Array.isArray(value.args) ? value.args.map(String) : [],
      env: value.env !== null && typeof value.env === 'object' ? Object.fromEntries(Object.entries(value.env).map(([k, v]) => [k, String(v)])) : {},
      url: typeof value.url === 'string' ? value.url : '',
      autoConnect: value.autoConnect !== false,
      ...(value.builtin === true ? { builtin: true } : {}),
    };
  };

  /** Persist the store atomically; writes are serialized. */
  const persist = () => {
    const snapshot = { version: 1, servers: store.servers.map((server) => ({ ...server })) };
    saveChain = saveChain
      .then(async () => {
        await mkdir(dirname(config.storePath), { recursive: true });
        const temporary = `${config.storePath}.tmp-${process.pid}-${Date.now()}`;
        await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
        await rm(config.storePath, { force: true }).catch(() => undefined);
        await rename(temporary, config.storePath);
      })
      .catch((error) => log(`cannot save ${config.storePath}: ${messageOf(error)}`));
    return saveChain;
  };

  /** Read the persisted store, creating it with the built-in desktop server. */
  const loadStore = async () => {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(config.storePath, 'utf8'));
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.code === 'ENOENT') parsed = undefined;
      else log(`cannot read ${config.storePath}: ${messageOf(error)}`);
    }
    const servers = [];
    const seen = new Set();
    let repaired = false;
    if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.servers)) {
      for (const raw of parsed.servers) {
        const record = normalizeStored(raw);
        if (record === undefined || seen.has(record.id)) continue;
        if (repairStoredCommand(record)) repaired = true;
        seen.add(record.id);
        servers.push(record);
      }
    }
    if (!seen.has(DESKTOP_ID)) servers.unshift(desktopRecord());
    store = { version: 1, servers };
    const needsSave = parsed === undefined || !seen.has(DESKTOP_ID) || repaired;
    /** Install an entry for every persisted server. */
    const install = (record) => {
      const existing = entries.get(record.id);
      const entry = existing ?? {
        server: record,
        status: 'disconnected',
        tools: [],
        lastError: undefined,
        client: undefined,
        disposers: [],
        attempts: 0,
        retryTimer: undefined,
        connecting: undefined,
      };
      entry.server = record;
      entries.set(record.id, entry);
    };
    servers.forEach(install);
    if (needsSave) void persist();
  };

  /** Clear and dispose every dynamically registered tool of one entry. */
  const disposeEntryTools = (entry) => {
    for (const dispose of entry.disposers.splice(0, entry.disposers.length)) {
      try {
        dispose();
      } catch {
        // a tool that already went away
      }
    }
  };

  /** Schedule one exponential-backoff reconnect attempt for a dead server. */
  const scheduleReconnect = (entry) => {
    if (disposed || entry.server.autoConnect === false) return;
    if (entry.retryTimer !== undefined) return;
    if (entry.attempts >= RECONNECT_ATTEMPTS) {
      entry.status = 'error';
      entry.lastError = `${entry.lastError ?? 'connection failed'}; reconnect stopped after ${RECONNECT_ATTEMPTS} attempts`;
      return;
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** entry.attempts);
    entry.attempts += 1;
    const timer = setTimeout(() => {
      entry.retryTimer = undefined;
      void connect(entry.server.id).catch(() => undefined);
    }, delay);
    timer.unref?.();
    entry.retryTimer = timer;
  };

  /** Register one tool per remote tool of a connected server. */
  const registerDynamicTools = (entry) => {
    disposeEntryTools(entry);
    const label = entry.server.label ?? entry.server.name;
    for (const tool of entry.tools) {
      const toolName = dynamicToolName(entry.server.id, tool.name);
      try {
        const dispose = ctx.tools.register({
          name: toolName,
          description: `[MCP ${label}] ${tool.description ?? tool.title ?? tool.name}`,
          parameters: normalizeInputSchema(tool.inputSchema),
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
          },
          isConcurrencySafe: () => true,
          async execute(args) {
            const result = await callTool(entry.server.id, tool.name, args !== null && typeof args === 'object' ? args : {});
            if (result !== null && typeof result === 'object' && result.isError === true) {
              throw new Error(resultText(result));
            }
            return resultText(result);
          },
        });
        entry.disposers.push(dispose);
      } catch (error) {
        log(`cannot register tool ${toolName}: ${messageOf(error)}`);
      }
    }
  };

  /** The transport-independent connect routine shared by manual and automatic paths. */
  const connect = (id) => {
    const entry = entries.get(id);
    if (entry === undefined) return Promise.reject(httpError(404, 'server-not-found', `no MCP server "${id}"`));
    if (entry.connecting !== undefined) return entry.connecting;
    if (entry.status === 'connected' && entry.client !== undefined) return Promise.resolve(entry);
    entry.connecting = (async () => {
      entry.status = 'starting';
      entry.lastError = undefined;
      const server = entry.server;
      /** @type {StdioClient | HttpClient | undefined} */
      let client;
      const hooks = {
        onDead: (error) => {
          if (entry.client !== client) return;
          entry.client = undefined;
          entry.status = 'error';
          entry.lastError = compact(messageOf(error));
          entry.tools = [];
          disposeEntryTools(entry);
          scheduleReconnect(entry);
        },
      };
      const clientImplementation =
        server.transport === 'http' ? new HttpClient(server, config, hooks) : new StdioClient(server, config, hooks);
      client = clientImplementation;
      try {
        await clientImplementation.start();
        entry.client = client;
        await initializeClient(client, config);
        const tools = await listAllTools(client, config);
        if (entry.client !== client || disposed) {
          await client.close().catch(() => undefined);
          return entry;
        }
        entry.tools = tools.map((tool) => ({
          name: tool.name,
          title: typeof tool.title === 'string' ? tool.title : undefined,
          description: typeof tool.description === 'string' ? tool.description : undefined,
          inputSchema: normalizeInputSchema(tool.inputSchema),
        }));
        entry.status = 'connected';
        entry.attempts = 0;
        entry.lastError = undefined;
        registerDynamicTools(entry);
        log(`connected MCP server "${server.name}" (${entry.tools.length} tools)`);
      } catch (error) {
        entry.status = 'error';
        entry.lastError = compact(messageOf(error));
        entry.tools = [];
        disposeEntryTools(entry);
        try {
          await client.close();
        } catch {
          // ignore
        }
        entry.client = undefined;
        scheduleReconnect(entry);
        log(`MCP server "${server.name}" failed: ${entry.lastError}`);
      } finally {
        entry.connecting = undefined;
      }
      return entry;
    })();
    return entry.connecting;
  };

  /** Disconnect one server and cancel its reconnect timer. */
  const disconnect = async (id) => {
    const entry = entries.get(id);
    if (entry === undefined) throw httpError(404, 'server-not-found', `no MCP server "${id}"`);
    if (entry.retryTimer !== undefined) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = undefined;
    }
    entry.attempts = 0;
    const client = entry.client;
    entry.client = undefined;
    entry.tools = [];
    disposeEntryTools(entry);
    entry.status = 'disconnected';
    if (client !== undefined) await client.close().catch(() => undefined);
    return entry;
  };

  /** Call one remote tool through its server (lazy connect). */
  const callTool = async (key, toolName, args, signal) => {
    const entry = entries.get(key);
    if (entry === undefined) throw httpError(404, 'server-not-found', `no MCP server "${key}"`);
    if (entry.status !== 'connected' || entry.client === undefined) {
      await connect(entry.server.id);
      if (entry.status !== 'connected' || entry.client === undefined) {
        throw httpError(502, 'not-connected', `MCP server "${entry.server.name}" is not connected: ${entry.lastError ?? 'unknown error'}`);
      }
    }
    const client = entry.client;
    try {
      return await client.request('tools/call', { name: toolName, arguments: args ?? {} }, config.callTimeoutMs, signal);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw httpError(502, 'mcp-call-failed', `MCP tool "${toolName}" on "${entry.server.name}" failed: ${compact(messageOf(error))}`);
    }
  };

  /** Public view of one entry. */
  const view = (entry) => {
    const server = entry.server;
    // `command` is always the executable the hub would spawn and `args` the
    // arguments it would pass, so a panel that copies both fields reproduces a
    // working server without any repair (the built-in desktop server included).
    // `displayCommand` keeps the human-readable one-line form for the UI.
    const command =
      server.transport === 'stdio' ? (server.builtin === true ? nodeInterpreter().exe : server.command) : undefined;
    const args =
      server.transport === 'stdio' ? (server.builtin === true ? [DESKTOP_SERVER_PATH] : server.args) : undefined;
    const displayCommand =
      server.transport === 'stdio' && typeof command === 'string'
        ? [command, ...(Array.isArray(args) ? args : [])].join(' ').trim()
        : undefined;
    return definedFields({
      id: server.id,
      name: server.name,
      label: server.label ?? server.name,
      transport: server.transport,
      command,
      args,
      displayCommand,
      url: server.transport === 'http' ? server.url : undefined,
      autoConnect: server.autoConnect !== false,
      status: entry.status,
      tools: Array.isArray(entry.tools)
        ? entry.tools.map((tool) =>
            definedFields({
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
            }),
          )
        : [],
      lastError: entry.lastError,
    });
  };

  /** Public views of every server, in stored order. */
  const views = () => store.servers.map((server) => view(entries.get(server.id))).filter(Boolean);

  /** Look one entry up by id or by (case-insensitive) name. */
  const findEntry = (key) => {
    if (typeof key !== 'string' || key === '') return undefined;
    const direct = entries.get(key);
    if (direct !== undefined) return direct;
    const lower = key.toLowerCase();
    return [...entries.values()].find(
      (entry) => entry.server.name.toLowerCase() === lower || entry.server.id.toLowerCase() === lower,
    );
  };

  /** Validate and normalize one incoming server payload. */
  const normalizeIncoming = (payload, existing, requireName) => {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw httpError(400, 'bad-request', 'server must be a JSON object');
    }
    const name = typeof payload.name === 'string' ? payload.name.trim() : (existing?.name ?? '');
    if (requireName && name === '') throw httpError(400, 'bad-request', 'server.name is required');
    if (name !== '' && !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/u.test(name)) {
      throw httpError(400, 'bad-request', 'server.name may contain letters, digits, spaces, dots, dashes and underscores');
    }
    const transport = payload.transport === 'http' ? 'http' : payload.transport === 'stdio' ? 'stdio' : (existing?.transport ?? 'stdio');
    const id =
      typeof payload.id === 'string' && payload.id !== ''
        ? toolSegment(payload.id)
        : (existing?.id ?? toolSegment(name.toLowerCase().replace(/\s+/gu, '-')));
    const command = payload.command === undefined ? (existing?.command ?? '') : String(payload.command);
    const args = payload.args === undefined ? (existing?.args ?? []) : Array.isArray(payload.args) ? payload.args.map(String) : null;
    if (args === null) throw httpError(400, 'bad-request', 'server.args must be an array of strings');
    const url = payload.url === undefined ? (existing?.url ?? '') : String(payload.url);
    const env =
      payload.env === undefined
        ? (existing?.env ?? {})
        : payload.env !== null && typeof payload.env === 'object'
          ? Object.fromEntries(Object.entries(payload.env).map(([key, value]) => [key, String(value)]))
          : null;
    if (env === null) throw httpError(400, 'bad-request', 'server.env must be an object of string values');
    if (transport === 'stdio' && command.trim() === '' && existing?.builtin !== true) {
      throw httpError(400, 'bad-request', 'a stdio server requires server.command');
    }
    if (transport === 'http' && !/^https?:\/\/\S+$/u.test(url.trim())) {
      throw httpError(400, 'bad-request', 'an http server requires server.url with an http:// or https:// address');
    }
    return {
      id,
      name: name === '' ? id : name,
      label: typeof payload.label === 'string' && payload.label !== '' ? payload.label : (existing?.label ?? name),
      transport,
      command: transport === 'stdio' ? command : '',
      args: transport === 'stdio' ? args : [],
      env: transport === 'stdio' ? env : {},
      url: transport === 'http' ? url.trim() : '',
      autoConnect: payload.autoConnect === undefined ? (existing?.autoConnect ?? true) : payload.autoConnect !== false,
      ...(existing?.builtin === true ? { builtin: true } : {}),
    };
  };

  /** Persist one record and install its entry. */
  const upsertRecord = (record) => {
    const index = store.servers.findIndex((server) => server.id === record.id);
    if (index >= 0) store.servers[index] = record;
    else store.servers.push(record);
    const entry = entries.get(record.id);
    if (entry === undefined) {
      entries.set(record.id, {
        server: record,
        status: 'disconnected',
        tools: [],
        lastError: undefined,
        client: undefined,
        disposers: [],
        attempts: 0,
        retryTimer: undefined,
        connecting: undefined,
      });
    } else {
      entry.server = record;
    }
    return entries.get(record.id);
  };

  /** Add one server from a payload. */
  const addServer = async (payload) => {
    const record = normalizeIncoming(payload, undefined, true);
    if (entries.has(record.id) || store.servers.some((server) => server.id === record.id)) {
      throw httpError(409, 'server-exists', `an MCP server with id "${record.id}" already exists`);
    }
    const entry = upsertRecord(record);
    await persist();
    if (record.autoConnect) void connect(record.id).catch(() => undefined);
    return entry;
  };

  /** Update one server from a payload. */
  const updateServer = async (key, payload) => {
    const entry = findEntry(key);
    if (entry === undefined) throw httpError(404, 'server-not-found', `no MCP server "${String(key)}"`);
    const record = normalizeIncoming(payload, entry.server, false);
    if (record.id !== entry.server.id) {
      if (entries.has(record.id)) throw httpError(409, 'server-exists', `an MCP server with id "${record.id}" already exists`);
      await disconnect(entry.server.id).catch(() => undefined);
      store.servers = store.servers.filter((server) => server.id !== entry.server.id);
      entries.delete(entry.server.id);
    } else if (entry.status === 'connected') {
      await disconnect(entry.server.id).catch(() => undefined);
    }
    const updated = upsertRecord({ ...record, builtin: entry.server.builtin === true || record.builtin === true });
    await persist();
    if (updated.server.autoConnect) void connect(updated.server.id).catch(() => undefined);
    return updated;
  };

  /** Remove one server and dispose its tools. */
  const removeServer = async (key) => {
    const entry = findEntry(key);
    if (entry === undefined) throw httpError(404, 'server-not-found', `no MCP server "${String(key)}"`);
    if (entry.server.builtin === true) {
      throw httpError(409, 'builtin-server', `the built-in "${entry.server.name}" server cannot be removed; disconnect it instead`);
    }
    const before = view(entry);
    await disconnect(entry.server.id).catch(() => undefined);
    entries.delete(entry.server.id);
    store.servers = store.servers.filter((server) => server.id !== entry.server.id);
    await persist();
    return before;
  };

  /** Stop every server and cancel timers (plugin unload). */
  const shutdown = async () => {
    disposed = true;
    for (const entry of entries.values()) {
      if (entry.retryTimer !== undefined) {
        clearTimeout(entry.retryTimer);
        entry.retryTimer = undefined;
      }
      disposeEntryTools(entry);
      const client = entry.client;
      entry.client = undefined;
      if (client !== undefined) await client.close().catch(() => undefined);
    }
  };

  /** The id a desktop-bound server for one application uses. */
  const boundServerId = (app) => {
    const slug =
      String(app)
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 40) || 'app';
    const wanted = String(app).trim().toLowerCase();
    let id = `desktop-${slug}`;
    let counter = 2;
    const taken = (candidate) =>
      [...entries.values()].some(
        (entry) =>
          entry.server.id === candidate &&
          String(entry.server.env?.DSH_MCP_TARGET_APP ?? '').trim().toLowerCase() !== wanted,
      );
    while (taken(id)) {
      id = `desktop-${slug}-${counter}`;
      counter += 1;
    }
    return id;
  };

  /** Case/extension-insensitive application-name form. */
  const normalizeAppName = (value) => String(value ?? '').trim().toLowerCase().replace(/\.exe$/u, '');

  /** Small local-language/alias map: the user's wording -> fragments to match. */
  const APP_ALIASES = {
    chrome: ['chrome', 'google chrome'],
    хром: ['chrome', 'google chrome'],
    гугл: ['chrome'],
    браузер: ['chrome', 'firefox', 'msedge', 'edge', 'browser'],
    блокнот: ['notepad'],
    notepad: ['notepad'],
    проводник: ['explorer'],
    эксплорер: ['explorer'],
    explorer: ['explorer'],
    ворд: ['winword', 'word'],
    word: ['winword', 'word'],
    эксель: ['excel'],
    excel: ['excel'],
    терминал: ['windowsterminal', 'terminal', 'powershell', 'cmd', 'консоль'],
    консоль: ['windowsterminal', 'powershell', 'cmd'],
    харнесс: ['deepseek harness'],
    harness: ['deepseek harness'],
    код: ['code'],
    vscode: ['code'],
    'vs code': ['code'],
    калькулятор: ['calculator', 'calc'],
    edge: ['msedge', 'edge'],
    эдж: ['msedge', 'edge'],
    firefox: ['firefox'],
    файрфокс: ['firefox'],
    telegram: ['telegram'],
    телеграм: ['telegram'],
    дискорд: ['discord'],
    discord: ['discord'],
    спотифай: ['spotify'],
    spotify: ['spotify'],
    проводнике: ['explorer'],
  };

  /** Parse a JSON list out of one MCP tool result. */
  const parseListResult = (result) => {
    try {
      const parsed = JSON.parse(resultText(result));
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.apps)) return parsed.apps;
      if (Array.isArray(parsed?.windows)) return parsed.windows;
      return [];
    } catch {
      return [];
    }
  };

  /** Ask the built-in desktop server for the current application/window lists. */
  const desktopInventory = async () => {
    if (entries.get(DESKTOP_ID) === undefined) return { apps: [], windows: [] };
    try {
      const apps = parseListResult(await callTool(DESKTOP_ID, 'apps', {}));
      const windows = parseListResult(await callTool(DESKTOP_ID, 'windows', {}));
      return { apps, windows };
    } catch {
      return { apps: [], windows: [] };
    }
  };

  /**
   * Resolve the user's wording to a running application: case-insensitive
   * exact match, then a local-language alias, then a contains match, then a
   * window-title fragment. Falls back to the typed name so a bound server is
   * still created for an application that has not been started yet.
   * @param {string} raw - the application name the user used.
   * @returns {Promise<{ app: string, matched: 'exact'|'contains'|'window'|'unresolved' }>} canonical name.
   */
  const resolveApplication = async (raw) => {
    const text = String(raw ?? '').trim();
    const normalized = normalizeAppName(text);
    const candidates = [normalized, ...(APP_ALIASES[normalized] ?? [])].filter((value) => value !== '');
    const inventory = await desktopInventory();
    for (const candidate of candidates) {
      const exact = inventory.apps.find((app) => normalizeAppName(app?.name) === candidate);
      if (exact !== undefined) return { app: String(exact.name), matched: 'exact' };
    }
    for (const candidate of candidates) {
      const partial = inventory.apps.find((app) => {
        const name = normalizeAppName(app?.name);
        return name !== '' && (name.includes(candidate) || candidate.includes(name));
      });
      if (partial !== undefined) return { app: String(partial.name), matched: 'contains' };
    }
    for (const candidate of candidates) {
      const hit = inventory.windows.find((window) => {
        const title = String(window?.title ?? '').toLowerCase();
        const appName = normalizeAppName(window?.app_name);
        return title.includes(candidate) || (appName !== '' && (appName.includes(candidate) || candidate.includes(appName)));
      });
      if (hit !== undefined && typeof hit.app_name === 'string' && hit.app_name !== '') {
        return { app: hit.app_name, matched: 'window' };
      }
    }
    return { app: text, matched: 'unresolved' };
  };

  /**
   * Ensure a desktop-bound server exists for one application, connecting it
   * unless `connect: false`. One argument is enough for the whole flow: the
   * name may be fuzzy ("chrome", "Chrome", "хром"), the canonical running
   * process name is stored when it resolves, and the command/args are cloned
   * from the bundled desktop server with only `DSH_MCP_TARGET_APP` added.
   * @param {string} app - application name as the user said it.
   * @param {{ connect?: boolean }} [options] - set `connect: false` to only register it.
   * @returns {Promise<{ entry: object, app: string, requested: string, matched: string, tools: string[], message: string }>} server, tool names and a model-facing message.
   */
  const ensureAppServer = async (app, options = {}) => {
    const typed = typeof app === 'string' ? app.trim() : '';
    if (typed === '') throw httpError(400, 'bad-request', 'app is required');
    const resolved = await resolveApplication(typed);
    const canonical = resolved.app === '' ? typed : resolved.app;
    const wanted = normalizeAppName(canonical);
    let entry = [...entries.values()].find(
      (candidate) => normalizeAppName(candidate.server.env?.DSH_MCP_TARGET_APP) === wanted,
    );
    if (entry === undefined) {
      const node = nodeInterpreter();
      const id = boundServerId(canonical);
      entry = upsertRecord({
        id,
        name: id,
        label: `${canonical} — MCP`,
        transport: 'stdio',
        command: node.exe,
        args: [DESKTOP_SERVER_PATH],
        env: { DSH_MCP_TARGET_APP: canonical },
        url: '',
        autoConnect: true,
      });
      await persist();
    }
    if (options.connect !== false) {
      await connect(entry.server.id);
      if (entry.status !== 'connected') {
        throw httpError(
          502,
          'connect-failed',
          `desktop MCP server "${entry.server.name}" did not connect: ${entry.lastError ?? 'unknown error'}`,
        );
      }
    }
    const bound = String(entry.server.env?.DSH_MCP_TARGET_APP ?? canonical);
    const tools = entry.tools.map((tool) => tool.name);
    const message =
      resolved.matched === 'unresolved'
        ? `MCP для ${bound} создан; приложение не найдено среди запущенных — запустите его, и инструменты заработают без переподключения (${tools.length} инструментов)`
        : `MCP для ${bound} готов: ${tools.length} инструментов`;
    return { entry, app: bound, requested: typed, matched: resolved.matched, tools, message };
  };

  return {
    loadStore,
    persist,
    views,
    findEntry,
    view,
    addServer,
    updateServer,
    removeServer,
    ensureAppServer,
    connect,
    disconnect,
    callTool,
    shutdown,
  };
}

/* ------------------------------------------------------------------------- *
 * HTTP API
 * ------------------------------------------------------------------------- */

/**
 * One JSON response for the authenticated browser carrier.
 * @param {object} payload - envelope.
 * @param {number} [status] - HTTP status (200 when omitted).
 * @returns {Response} response.
 */
function jsonResponse(payload, status) {
  return Response.json(payload, status === undefined ? undefined : { status });
}

/**
 * Error envelope for one thrown value.
 * @param {unknown} error - thrown value.
 * @returns {Response} response.
 */
function errorResponse(error) {
  if (error instanceof HttpError) {
    return jsonResponse({ ok: false, error: { message: error.message, code: error.code } }, error.status);
  }
  return jsonResponse({ ok: false, error: { message: compact(messageOf(error)), code: 'internal' } }, 500);
}

/**
 * Parse one JSON object request body; malformed input becomes a 400.
 * @param {Request} request - incoming request.
 * @returns {Promise<Record<string, unknown>>} parsed body.
 */
async function requestObject(request) {
  let value;
  try {
    value = await request.json();
  } catch {
    throw httpError(400, 'bad-request', 'malformed JSON request body');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'bad-request', 'request body must be a JSON object');
  }
  return value;
}

/**
 * Read one query-string parameter from an incoming request.
 * @param {Request} request - incoming request.
 * @param {string} key - parameter name.
 * @returns {string | undefined} the value.
 */
function queryOf(request, key) {
  try {
    const value = new URL(request.url).searchParams.get(key);
    return value !== null && value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Register the browser JSON API on the proven authenticated carrier.
 *
 * Every route is a `ctx.connection.fetch.register` entry under `/api`, exactly
 * like the shipped `/api/file` route and the other user plugins in this
 * repository: the carrier authenticates the same-origin browser request, so
 * there is no CORS or token code here. Methods outside the declared list are
 * answered with 405 by the carrier.
 * @param {object} ctx - Host plugin context with `connection`.
 * @param {object} hub - MCP hub facade.
 * @param {{ sessionState: Function, switchPermission: Function }} api - permission accessors.
 */
function registerRoutes(ctx, hub, api) {
  /**
   * Register one route.
   * @param {string} path - exact `/api/...` path.
   * @param {string[]} methods - allowed HTTP methods.
   * @param {(request: Request) => Promise<Response>} handler - route body.
   */
  const register = (path, methods, handler) => {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path,
          methods,
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              return await handler(request);
            } catch (error) {
              return errorResponse(error);
            }
          },
        }),
      `superuser: route ${path}`,
    );
  };

  register('/api/superuser/state', ['GET'], async (request) => {
    const sessionId = queryOf(request, 'sessionId');
    if (sessionId === undefined) {
      return jsonResponse({
        ok: true,
        data: { sessionId: null, session: null, permission: null, servers: hub.views() },
      });
    }
    const state = await api.sessionState(sessionId);
    return jsonResponse({ ok: true, data: { sessionId, ...state, servers: hub.views() } });
  });

  register('/api/superuser/permission', ['POST'], async (request) => {
    const body = await requestObject(request);
    if (typeof body.sessionId !== 'string' || body.sessionId === '') {
      throw httpError(400, 'bad-request', 'sessionId is required');
    }
    if (typeof body.enabled !== 'boolean') {
      throw httpError(400, 'bad-request', 'enabled must be a boolean');
    }
    const state = await api.switchPermission(body.sessionId, body.enabled);
    return jsonResponse({ ok: true, data: { sessionId: body.sessionId, ...state, servers: hub.views() } });
  });

  register('/api/superuser/mcp/servers', ['GET', 'POST'], async (request) => {
    if (request.method === 'GET') {
      return jsonResponse({ ok: true, data: { servers: hub.views() } });
    }
    const body = await requestObject(request);
    const action = body.action;
    if (typeof action !== 'string') throw httpError(400, 'bad-request', 'action is required');
    if (action === 'add') {
      const entry = await hub.addServer(body.server);
      return jsonResponse({ ok: true, data: { server: hub.view(entry) } });
    }
    if (action === 'app') {
      const ensured = await hub.ensureAppServer(body.app, { connect: body.connect !== false });
      return jsonResponse({
        ok: true,
        data: {
          app: ensured.app,
          requested: ensured.requested,
          matched: ensured.matched,
          message: ensured.message,
          server: hub.view(ensured.entry),
          tools: ensured.tools,
        },
      });
    }
    const serverPayload =
      body.server !== null && typeof body.server === 'object' ? body.server : {};
    const key =
      typeof serverPayload.id === 'string' && serverPayload.id !== ''
        ? serverPayload.id
        : typeof serverPayload.name === 'string' && serverPayload.name !== ''
          ? serverPayload.name
          : typeof body.serverId === 'string' && body.serverId !== ''
            ? body.serverId
            : undefined;
    if (key === undefined) throw httpError(400, 'bad-request', 'server.id or server.name is required');
    if (action === 'update') {
      const entry = await hub.updateServer(key, body.server);
      return jsonResponse({ ok: true, data: { server: hub.view(entry) } });
    }
    if (action === 'remove') {
      const removed = await hub.removeServer(key);
      return jsonResponse({ ok: true, data: { server: removed } });
    }
    if (action === 'connect') {
      const entry = await hub.connect(key);
      if (entry.status !== 'connected') {
        throw httpError(
          502,
          'connect-failed',
          `MCP server "${entry.server.name}" did not connect: ${entry.lastError ?? 'unknown error'}`,
        );
      }
      return jsonResponse({ ok: true, data: { server: hub.view(entry) } });
    }
    if (action === 'disconnect') {
      const entry = await hub.disconnect(key);
      return jsonResponse({ ok: true, data: { server: hub.view(entry) } });
    }
    throw httpError(400, 'bad-request', `unknown action "${action}"`);
  });

  register('/api/superuser/mcp/call', ['POST'], async (request) => {
    const body = await requestObject(request);
    if (typeof body.server !== 'string' || body.server === '') {
      throw httpError(400, 'bad-request', 'server is required');
    }
    if (typeof body.tool !== 'string' || body.tool === '') {
      throw httpError(400, 'bad-request', 'tool is required');
    }
    const entry = hub.findEntry(body.server);
    if (entry === undefined) throw httpError(404, 'server-not-found', `no MCP server "${body.server}"`);
    const args = body.args !== null && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
    const result = await hub.callTool(entry.server.id, body.tool, args);
    return jsonResponse({ ok: true, data: { result } });
  });

  // One-argument flow: name an application, get a working desktop-bound MCP
  // server plus its tool list. Idempotent; `connect: false` only registers it.
  register('/api/superuser/mcp/app', ['POST'], async (request) => {
    const body = await requestObject(request);
    if (typeof body.app !== 'string' || body.app.trim() === '') {
      throw httpError(400, 'bad-request', 'app is required');
    }
    const ensured = await hub.ensureAppServer(body.app, { connect: body.connect !== false });
    return jsonResponse({
      ok: true,
      data: {
        app: ensured.app,
        requested: ensured.requested,
        matched: ensured.matched,
        message: ensured.message,
        server: hub.view(ensured.entry),
        tools: ensured.tools,
      },
    });
  });

  // Windows OS confirmations: GET is read-only status; POST only runs a
  // user-initiated setup (the panel button) — enable/disable write one script
  // and launch it elevated with a single Windows consent dialog.
  register('/api/superuser/windows', ['GET', 'POST'], async (request) => {
    if (request.method === 'GET') {
      return jsonResponse({ ok: true, data: await readWindowsStatus() });
    }
    const body = await requestObject(request);
    const action = body.action;
    if (action !== 'enable' && action !== 'disable' && action !== 'restart') {
      throw httpError(400, 'bad-request', 'action must be "enable", "disable" or "restart"');
    }
    const result = await performWindowsSetup(action, { dryRun: body.dryRun === true });
    const status = result.status ?? (await readWindowsStatus());
    const { status: _ignored, ...rest } = result;
    return jsonResponse({ ok: true, data: { ...status, ...rest, status } });
  });
}

/**
 * Attach the Host half to the profile composition.
 * @param {object} ctx - plugin context.
 * @param {Record<string, unknown>} [rawConfig] - row configuration.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const hub = createHub(ctx, config);

  // Model guidance: names the two tools and the single `mcp_manage` call that
  // turns a user-named application into connected desktop tools, and states
  // that Windows OS confirmations are a user-only one-time setup.
  ctx.effect(
    () => {
      ctx.systemPrompt.section({
        name: 'superuser:applications',
        order: PROMPT_SECTION_ORDER,
        text: SUPERUSER_PROMPT_SECTION,
      });
      ctx.systemPrompt.section({
        name: 'superuser:os-confirmations',
        order: WINDOWS_PROMPT_SECTION_ORDER,
        text: WINDOWS_PROMPT_SECTION,
      });
    },
    'superuser: prompt section',
  );

  /** Resolve the live agent of one session id. */
  const liveAgent = (sessionId) => ctx.agents.get(sessionId);

  /** The session title from the public title service when it is mounted. */
  const titleOf = (session) => {
    let title;
    try {
      title = ctx.get('sessionTitle')?.get?.(session)?.title;
    } catch {
      title = undefined;
    }
    return typeof title === 'string' && title !== '' ? title : undefined;
  };

  /** Whether a stored session exists but has no live agent. */
  const storedSessionExists = async (sessionId) => {
    const persistence = ctx.get('sessionPersistence');
    if (persistence === undefined || typeof persistence.stat !== 'function') return false;
    try {
      return (await persistence.stat(sessionId)) !== undefined;
    } catch {
      return false;
    }
  };

  /** State payload of one live session, or a structured 404/409 error. */
  const sessionState = async (sessionId) => {
    const agent = liveAgent(sessionId);
    if (agent !== undefined) {
      return {
        session: definedFields({ title: titleOf(agent.session) }),
        permission: permissionStateOf(ctx, agent),
      };
    }
    if (await storedSessionExists(sessionId)) {
      throw httpError(
        409,
        'agent-not-live',
        `session "${sessionId}" is stored but has no live agent in this process; open the chat and try again`,
      );
    }
    throw httpError(404, 'session-not-found', `no session "${sessionId}"`);
  };

  /** Switch one live session and return its new state payload. */
  const switchPermission = async (sessionId, enabled) => {
    const agent = liveAgent(sessionId);
    if (agent === undefined) {
      if (await storedSessionExists(sessionId)) {
        throw httpError(409, 'agent-not-live', `session "${sessionId}" has no live agent in this process`);
      }
      throw httpError(404, 'session-not-found', `no session "${sessionId}"`);
    }
    const permission = setMode(ctx, agent, enabled ? SUPERUSER_MODE : NORMAL_MODE);
    return { session: definedFields({ title: titleOf(agent.session) }), permission };
  };

  ctx.effect(
    () => {
      const disposers = [];
      disposers.push(
        ctx.tools.register({
          name: 'windowsAdmin',
          description:
            'Report the Windows OS-confirmation state (READ-ONLY, action "status" only): whether this Harness process is ' +
            'elevated, the UAC policy values (EnableLUA, ConsentPromptBehaviorAdmin, PromptOnSecureDesktop), and whether ' +
            'the "DSH Superuser Elevated" logon task exists with its run level. It never changes anything: removing OS ' +
            'confirmations is a one-time user action in the Superuser panel (one Windows consent dialog). You cannot ' +
            'bypass UAC silently and must not claim to; never try to enable, disable or elevate anything yourself.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['status'],
                description: 'status reads the current Windows/UAC/task state; no other action exists.',
              },
            },
            required: ['action'],
            additionalProperties: false,
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
          },
          isConcurrencySafe: () => true,
          async execute() {
            return JSON.stringify({ ok: true, action: 'status', windows: await readWindowsStatus() }, null, 2);
          },
        }),
      );
      disposers.push(
        ctx.tools.register({
          name: 'superuser_mode',
          description:
            'Read or switch the superuser mode of the current chat. Superuser mode = full file access with no approval prompts ' +
            '(sandbox danger-full-access, approval policy never). action "get" reports the current preset/sandbox/approval and ' +
            'whether superuser mode is on; action "on" switches this chat to superuser mode; action "off" returns it to ' +
            'workspace-write with approval prompts. The switch applies to this chat only and is recorded in its session log.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['get', 'on', 'off'],
                description: 'get reads the state, on enables superuser mode, off disables it.',
              },
            },
            required: ['action'],
            additionalProperties: false,
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
          },
          isConcurrencySafe: () => true,
          async execute(args, exec) {
            const agent = exec.agent;
            if (agent === undefined) throw new Error('superuser_mode needs a live agent session');
            const action = args?.action;
            if (action === 'on') {
              const permission = setMode(ctx, agent, SUPERUSER_MODE);
              return JSON.stringify({ ok: true, action, permission }, null, 2);
            }
            if (action === 'off') {
              const permission = setMode(ctx, agent, NORMAL_MODE);
              return JSON.stringify({ ok: true, action, permission }, null, 2);
            }
            return JSON.stringify({ ok: true, action: 'get', permission: permissionStateOf(ctx, agent) }, null, 2);
          },
        }),
      );
      disposers.push(
        ctx.tools.register({
          name: 'mcp_manage',
          description:
            'Manage the superuser MCP hub at runtime: connect any MCP server and use its tools from this chat. ' +
            'Use action=app with only the application name to get tools for any desktop application; the server is ' +
            'created automatically (resolved against running applications, case-insensitive, local names like ' +
            '"хром" understood), connected, and returned as {server, tools, message} — no command, args or transport ' +
            'needed, and calling it again reuses the same server. ' +
            'action "list" lists configured servers with status and tools; "add" registers a custom server ' +
            '(transport stdio: command/args/env, or transport http: url) and connects it when autoConnect is true; ' +
            '"update" changes an existing server; "remove" deletes it; "connect"/"disconnect" control the live connection ' +
            '(a dropped server reconnects automatically with backoff); "call" invokes one remote tool with JSON arguments. ' +
            'While a server is connected, each of its tools is also available as mcp__<server>__<tool>.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['app', 'list', 'add', 'update', 'remove', 'connect', 'disconnect', 'call'],
                description:
                  'The hub operation to perform. "app" needs only the app name; "add"/"update" take a server definition; ' +
                  '"call" invokes a remote tool.',
              },
              app: {
                type: 'string',
                description:
                  'Application name for action "app", exactly as the user said it: "chrome", "Chrome", "хром", ' +
                  '"Notepad", or a window title fragment. It is resolved against running applications (case-insensitive) ' +
                  'and the canonical process name is stored; the bound server is created idempotently and connected.',
              },
              connect: {
                type: 'boolean',
                description: 'For action "app": connect right away (default true). Set false to only register it.',
              },
              server: {
                type: 'string',
                description: 'Existing server id or name (required for update/remove/connect/disconnect/call).',
              },
              name: { type: 'string', description: 'Server name for add (also its default id).' },
              label: { type: 'string', description: 'Human readable label shown in the UI.' },
              transport: {
                type: 'string',
                enum: ['stdio', 'http'],
                description: 'stdio spawns a local process; http talks to a streamable-HTTP MCP endpoint.',
              },
              command: { type: 'string', description: 'Executable for a stdio server.' },
              args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the stdio command.' },
              env: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Extra environment variables for a stdio server.',
              },
              url: { type: 'string', description: 'Endpoint URL for an http server.' },
              autoConnect: {
                type: 'boolean',
                description: 'Connect automatically on startup and reconnect after a drop (default true).',
              },
              tool: { type: 'string', description: 'Remote tool name for action "call".' },
              callArgs: {
                type: 'object',
                additionalProperties: true,
                description: 'JSON arguments object for action "call".',
              },
            },
            required: ['action'],
            additionalProperties: false,
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
          },
          isConcurrencySafe: () => true,
          async execute(args, exec) {
            const action = args?.action;
            if (action === 'app') {
              if (typeof args.app !== 'string' || args.app.trim() === '') {
                throw new Error('mcp_manage action "app" needs the "app" application name');
              }
              const ensured = await hub.ensureAppServer(args.app, { connect: args.connect !== false });
              return JSON.stringify(
                {
                  ok: true,
                  message: ensured.message,
                  app: ensured.app,
                  requested: ensured.requested,
                  matched: ensured.matched,
                  server: hub.view(ensured.entry),
                  tools: ensured.tools,
                  hint: 'Call any tool from this list via mcp_manage call or directly as mcp__<server>__<tool>.',
                },
                null,
                2,
              );
            }
            if (action === 'list') {
              return JSON.stringify({ ok: true, servers: hub.views() }, null, 2);
            }
            if (action === 'add') {
              const entry = await hub.addServer({
                name: args.name,
                label: args.label,
                transport: args.transport,
                command: args.command,
                args: args.args,
                env: args.env,
                url: args.url,
                autoConnect: args.autoConnect,
              });
              return JSON.stringify({ ok: true, server: hub.view(entry) }, null, 2);
            }
            if (action === 'update') {
              if (typeof args.server !== 'string' || args.server === '') {
                throw new Error('mcp_manage update needs the "server" id or name');
              }
              const entry = await hub.updateServer(args.server, {
                name: args.name,
                label: args.label,
                transport: args.transport,
                command: args.command,
                args: args.args,
                env: args.env,
                url: args.url,
                autoConnect: args.autoConnect,
              });
              return JSON.stringify({ ok: true, server: hub.view(entry) }, null, 2);
            }
            if (action === 'remove') {
              if (typeof args.server !== 'string' || args.server === '') {
                throw new Error('mcp_manage remove needs the "server" id or name');
              }
              const removed = await hub.removeServer(args.server);
              return JSON.stringify({ ok: true, removed }, null, 2);
            }
            if (action === 'connect') {
              const entry = await hub.connect(String(args.server ?? ''));
              if (entry.status !== 'connected') {
                throw new Error(`MCP server "${entry.server.name}" did not connect: ${entry.lastError ?? 'unknown error'}`);
              }
              return JSON.stringify({ ok: true, server: hub.view(entry) }, null, 2);
            }
            if (action === 'disconnect') {
              const entry = await hub.disconnect(String(args.server ?? ''));
              return JSON.stringify({ ok: true, server: hub.view(entry) }, null, 2);
            }
            if (action === 'call') {
              if (typeof args.server !== 'string' || args.server === '') {
                throw new Error('mcp_manage call needs the "server" id or name');
              }
              if (typeof args.tool !== 'string' || args.tool === '') {
                throw new Error('mcp_manage call needs the "tool" name');
              }
              const entry = hub.findEntry(args.server);
              if (entry === undefined) throw new Error(`no MCP server "${args.server}"`);
              const result = await hub.callTool(entry.server.id, args.tool, args.callArgs ?? {});
              return JSON.stringify(
                {
                  ok: true,
                  server: entry.server.id,
                  tool: args.tool,
                  isError: result !== null && typeof result === 'object' && result.isError === true,
                  result: resultText(result),
                },
                null,
                2,
              );
            }
            throw new Error(`unknown mcp_manage action "${String(action)}"`);
          },
        }),
      );
      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            // already disposed
          }
        }
      };
    },
    'superuser: meta tools',
  );

  // Auto-enable: every new agent gets the full-access preset recorded in its
  // session log before its first turn. Existing live agents are switched here
  // so the mode is already on when the plugin is installed mid-session.
  if (config.autoEnable) {
    ctx.on(
      'agent/created',
      ({ agent }) => {
        try {
          seedMode(ctx, agent, SUPERUSER_MODE);
        } catch (error) {
          try {
            ctx.logger?.warn?.(`superuser: auto-enable failed for session ${String(agent?.id)}: ${messageOf(error)}`);
          } catch {
            // logging must never break agent creation
          }
        }
      },
      { prepend: false },
    );
    for (const agent of ctx.agents.list()) {
      try {
        setMode(ctx, agent, SUPERUSER_MODE);
      } catch (error) {
        try {
          ctx.logger?.warn?.(`superuser: cannot enable existing session ${String(agent?.id)}: ${messageOf(error)}`);
        } catch {
          // ignore
        }
      }
    }
  }

  registerRoutes(ctx, hub, { sessionState, switchPermission });

  ctx.effect(() => {
    return () => {
      void hub.shutdown();
    };
  }, 'superuser: mcp hub shutdown');

  void (async () => {
    await hub.loadStore();
    const views = hub.views();
    for (const server of views) {
      if (server.autoConnect !== true) continue;
      void hub.connect(server.id).catch(() => undefined);
    }
    try {
      ctx.logger?.info?.(
        `superuser: ready (autoEnable=${config.autoEnable}, store=${config.storePath}, servers=${views.length})`,
      );
    } catch {
      // ignore
    }
  })();
}

/** Pure helpers exported for the repository's self-check. */
export const __internals = {
  resolveConfig,
  permissionStateOf,
  presetMatching,
  normalizeInputSchema,
  dynamicToolName,
  resultText,
  readWindowsStatus,
  performWindowsSetup,
  renderWindowsSetupScript,
  windowsSetupPaths,
};
