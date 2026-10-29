<#
.SYNOPSIS
  Установщик плагина Codex Bridge (dsh-codex-bridge) в профиль DeepSeek Harness.

.DESCRIPTION
  Копирует файлы плагина в <профиль>\plugins\dsh-codex-bridge, регистрирует bundle
  в package.json профиля, ставит link-зависимость и запускает pnpm install встроенным
  Node/pnpm. Есть удаление (-Uninstall), план без изменений (-DryRun) и настройка путей.

.EXAMPLE
  .\install.ps1
  .\install.ps1 -Profile desktop
  .\install.ps1 -Profile desktop -TargetRoot "D:\Codex-projects"
  .\install.ps1 -Uninstall
#>
param(
  [string]$Profile,
  [string]$Source,
  [string]$TargetRoot,
  [string]$CodexHome,
  [ValidateSet('in-place', 'copy')]
  [string]$ImportMode,
  [switch]$DryRun,
  [switch]$Uninstall,
  [switch]$KeepFiles,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

function Find-Node {
  if ($env:DSH_NODE -and (Test-Path -LiteralPath $env:DSH_NODE)) { return $env:DSH_NODE }
  $candidates = @()
  $runtimes = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes'
  if (Test-Path -LiteralPath $runtimes) {
    foreach ($directory in Get-ChildItem -LiteralPath $runtimes -Directory -ErrorAction SilentlyContinue) {
      $candidate = Join-Path $directory.FullName 'dependencies\node\bin\node.exe'
      if (Test-Path -LiteralPath $candidate) { $candidates += $candidate }
    }
  }
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath -and $onPath.Source) { $candidates += $onPath.Source }
  if ($candidates.Count -eq 0) { return $null }
  return $candidates[0]
}

$node = Find-Node
if (-not $node) {
  Write-Error 'Node.js не найден. Поставьте DeepSeek Harness (встроенный Node) или node в PATH и повторите запуск.'
  exit 1
}

$cliArgs = @((Join-Path $PSScriptRoot 'install.mjs'))
if ($Profile) { $cliArgs += @('--profile', $Profile) }
if ($Source) { $cliArgs += @('--source', $Source) }
if ($TargetRoot) { $cliArgs += @('--target-root', $TargetRoot) }
if ($CodexHome) { $cliArgs += @('--codex-home', $CodexHome) }
if ($ImportMode) { $cliArgs += @('--import-mode', $ImportMode) }
if ($DryRun) { $cliArgs += '--dry-run' }
if ($Uninstall) { $cliArgs += '--uninstall' }
if ($KeepFiles) { $cliArgs += '--keep-files' }
if ($Help) { $cliArgs += '--help' }

& $node @cliArgs
exit $LASTEXITCODE
