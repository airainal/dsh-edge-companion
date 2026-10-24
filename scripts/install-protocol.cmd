@echo off
rem One-time setup: register the dshedge:// protocol so the Edge sidebar can start the bridge.
rem Double-click this file. No admin rights needed, nothing is added to startup.
rem Keep this file ASCII-only.
setlocal
set "DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%install-protocol.ps1"
echo.
pause
