@echo off
rem Double-click to run the environment check (read-only). Keep this file ASCII-only.
setlocal
set "DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%verify-install.ps1"
echo.
pause
