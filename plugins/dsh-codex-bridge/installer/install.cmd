@echo off
rem Codex Bridge installer (Windows wrapper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
