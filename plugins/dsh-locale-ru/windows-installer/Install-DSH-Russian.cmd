@echo off
setlocal EnableExtensions
title DSH Russian language pack
echo ===============================================
echo   DeepSeek Harness - Russian language pack
echo ===============================================
echo.

set "DSH_HOME_DIR=%DSH_HOME%"
if not defined DSH_HOME_DIR set "DSH_HOME_DIR=%USERPROFILE%\.dsh"

if not exist "%DSH_HOME_DIR%" goto :no_home
set "PROFILE_DIR=%DSH_HOME_DIR%\profiles\desktop"
if not exist "%PROFILE_DIR%" goto :no_profile

set "SRC=%~dp0.."
if not exist "%SRC%\lib\client.js" goto :no_plugin
set "SNIPPET=%~dp0patch-snippet.yml"
if not exist "%SNIPPET%" goto :no_plugin

echo DSH home: %DSH_HOME_DIR%
echo Profile:  %PROFILE_DIR%
echo.

set "PLUGINS_DIR=%PROFILE_DIR%\plugins"
set "TARGET=%PLUGINS_DIR%\dsh-locale-ru"
if not exist "%PLUGINS_DIR%" mkdir "%PLUGINS_DIR%" >nul 2>&1
if exist "%TARGET%" rmdir /s /q "%TARGET%"
mkdir "%TARGET%" >nul 2>&1
xcopy "%SRC%\lib" "%TARGET%\lib" /E /I /Y /Q >nul
copy /y "%SRC%\package.json" "%TARGET%\" >nul
copy /y "%SRC%\cordis.patch.yml" "%TARGET%\" >nul
if errorlevel 1 goto :copy_failed
echo [OK] Language pack copied to:
echo      %TARGET%
echo.

set "PATCH=%PROFILE_DIR%\cordis.patch.yml"
if not exist "%PATCH%" type nul > "%PATCH%"
findstr /c:"id: locale-ru" "%PATCH%" >nul 2>&1
if not errorlevel 1 goto :already

copy /y "%PATCH%" "%PATCH%.bak-ru-%RANDOM%" >nul
type "%SNIPPET%" >> "%PATCH%"
if errorlevel 1 goto :patch_failed
echo [OK] Insert row added to:
echo      %PATCH%
echo      A backup of the previous patch file was created next to it.
goto :done

:already
echo [OK] The profile already references the language pack - nothing to add.
goto :done

:done
echo.
echo Done.
echo.
echo Next steps:
echo   1. DeepSeek Harness Desktop may switch to Russian by itself in a few seconds.
echo   2. If it is still English, press Ctrl+R in the app, or restart the app.
echo   3. Open Settings - General - Language and choose Russian if needed.
echo.
pause
exit /b 0

:no_home
echo [ERROR] DSH home not found: "%DSH_HOME_DIR%"
echo.
echo Start DeepSeek Harness Desktop at least once, then run this installer again.
goto :fail

:no_profile
echo [ERROR] Desktop profile not found: "%PROFILE_DIR%"
echo.
echo Start DeepSeek Harness Desktop at least once, then run this installer again.
goto :fail

:no_plugin
echo [ERROR] The package files or patch-snippet.yml are missing in the repository root.
echo Extract the WHOLE repository archive first, then run Install-DSH-Russian.cmd.
goto :fail

:copy_failed
echo [ERROR] Could not copy the language pack into the profile.
echo Check access permissions and try again.
goto :fail

:patch_failed
echo [ERROR] Could not append the patch row to cordis.patch.yml.
echo Add these lines to the end of that file by hand:
echo      - insert:
echo          - id: locale-ru
echo            name: ./plugins/dsh-locale-ru/lib/index.js
goto :fail

:fail
echo.
pause
exit /b 1
