@echo off
setlocal EnableExtensions
title DSH Russian language pack - uninstall
echo ===============================================
echo   DeepSeek Harness - remove Russian language pack
echo ===============================================
echo.

set "DSH_HOME_DIR=%DSH_HOME%"
if not defined DSH_HOME_DIR set "DSH_HOME_DIR=%USERPROFILE%\.dsh"
set "PROFILE_DIR=%DSH_HOME_DIR%\profiles\desktop"
if not exist "%PROFILE_DIR%" goto :no_profile

set "TARGET=%PROFILE_DIR%\plugins\dsh-locale-ru"
if not exist "%TARGET%" goto :no_folder
rmdir /s /q "%TARGET%"
echo [OK] Removed:
echo      %TARGET%
goto :patch

:no_folder
echo [OK] Language pack folder is already absent.

:patch
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path $env:PROFILE_DIR 'cordis.patch.yml'; if (Test-Path -LiteralPath $p) { $t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8); $n = [regex]::Replace($t, '(?s)\r?\n?# Russian language pack.*?name: \./plugins/dsh-locale-ru/lib/index\.js[ \t]*\r?\n', ''); if ($n -ne $t) { Copy-Item -LiteralPath $p -Destination ($p + '.bak-ru-uninstall-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force; [IO.File]::WriteAllText($p, $n, (New-Object Text.UTF8Encoding($false))); Write-Host '[OK] Removed the locale-ru patch row.' } else { Write-Host '[OK] No locale-ru patch row found.' } } else { Write-Host '[OK] Patch file is absent.' }"
if errorlevel 1 goto :manual

echo.
echo Done. The interface returns to English/Chinese as soon as the profile reloads.
echo If needed, press Ctrl+R in DeepSeek Harness or restart the app.
echo.
pause
exit /b 0

:manual
echo.
echo [WARN] Could not clean cordis.patch.yml automatically.
echo Open the file and remove these lines by hand:
echo      # Russian language pack ...
echo      - insert:
echo          - id: locale-ru
echo            name: ./plugins/dsh-locale-ru/lib/index.js
echo.
pause
exit /b 0

:no_profile
echo [ERROR] Desktop profile not found: "%PROFILE_DIR%"
echo.
pause
exit /b 1
