@echo off
rem Codex Bridge uninstaller (Windows wrapper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall %*
exit /b %ERRORLEVEL%
