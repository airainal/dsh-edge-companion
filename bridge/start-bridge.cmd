@echo off
rem DSH Edge Bridge launcher: probes a JS runtime and starts the bridge.
rem Usage: start-bridge.cmd [--port=8766] [--token=XXX] [--mode=dsh|queue]
rem NOTE: keep this file ASCII-only; cmd.exe decodes batch files in the OEM code page.
setlocal EnableExtensions
set "DIR=%~dp0"
set "SCRIPT=%DIR%bridge.mjs"
set "NODE_EXE="

if defined DSH_NODE if exist "%DSH_NODE%" set "NODE_EXE=%DSH_NODE%"

if not defined NODE_EXE if exist "%DIR%node-path.txt" for /f "usebackq delims=" %%L in ("%DIR%node-path.txt") do if exist "%%L" set "NODE_EXE=%%L"

if not defined NODE_EXE for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE_EXE=%%~$PATH:I"

if not defined NODE_EXE call :probe "%LOCALAPPDATA%\Programs\DeepSeek Harness"
if not defined NODE_EXE call :probe "%ProgramW6432%\DeepSeek Harness"
if not defined NODE_EXE call :probe "%ProgramFiles%\DeepSeek Harness"
if not defined NODE_EXE call :probe "C:\Program Files (x86)\DeepSeek Harness"
if not defined NODE_EXE call :probe "C:\DeepSeek Harness"
if not defined NODE_EXE call :probe "D:\DeepSeek Harness"
if not defined NODE_EXE call :probe "E:\DeepSeek Harness"

if not defined NODE_EXE goto :nonode

chcp 65001 >nul 2>nul
echo [dsh-edge] bridge: %NODE_EXE% "%SCRIPT%" %*
"%NODE_EXE%" "%SCRIPT%" %*
set "CODE=%errorlevel%"
echo.
echo [dsh-edge] bridge exited (code %CODE%). See bridge\bridge.log
pause
exit /b %CODE%

:probe
if not defined NODE_EXE if exist "%~1\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%~1\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
exit /b 0

:nonode
echo [dsh-edge] No Node.js runtime found.
echo [dsh-edge] Install Node.js:  winget install OpenJS.NodeJS.LTS
echo [dsh-edge] Or set DSH_NODE to node.exe.
pause
exit /b 1
