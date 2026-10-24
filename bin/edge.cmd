@echo off
rem DSH Edge Bridge command-line entry: edge.cmd <command> [args]
rem Node discovery order: DSH_NODE -> bridge\node-path.txt (written by the bridge)
rem -> node on PATH -> the Node bundled with DeepSeek Harness.
rem NOTE: keep this file ASCII-only; cmd.exe decodes batch files in the OEM code page.
setlocal EnableExtensions
set "DIR=%~dp0"
set "CLI=%DIR%edge-cli.mjs"
set "NODE_EXE="

if defined DSH_NODE if exist "%DSH_NODE%" set "NODE_EXE=%DSH_NODE%"

if not defined NODE_EXE if exist "%DIR%..\bridge\node-path.txt" for /f "usebackq delims=" %%L in ("%DIR%..\bridge\node-path.txt") do if exist "%%L" set "NODE_EXE=%%L"

if not defined NODE_EXE for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE_EXE=%%~$PATH:I"

if not defined NODE_EXE call :probe "%LOCALAPPDATA%\Programs\DeepSeek Harness"
if not defined NODE_EXE call :probe "%ProgramW6432%\DeepSeek Harness"
if not defined NODE_EXE call :probe "%ProgramFiles%\DeepSeek Harness"
if not defined NODE_EXE call :probe "C:\Program Files (x86)\DeepSeek Harness"
if not defined NODE_EXE call :probe "C:\DeepSeek Harness"
if not defined NODE_EXE call :probe "D:\DeepSeek Harness"
if not defined NODE_EXE call :probe "E:\DeepSeek Harness"

if not defined NODE_EXE goto :nonode
if not exist "%CLI%" goto :nocli

chcp 65001 >nul 2>nul
"%NODE_EXE%" "%CLI%" %*
exit /b %errorlevel%

:probe
if not defined NODE_EXE if exist "%~1\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%~1\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
exit /b 0

:nonode
echo {"error":"no node runtime found: start bridge\\start-bridge.cmd first (it writes bridge\\node-path.txt), or set DSH_NODE to node.exe"}
exit /b 1

:nocli
echo {"error":"edge-cli.mjs not found next to edge.cmd (%DIR%)"}
exit /b 1
