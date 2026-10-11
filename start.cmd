@echo off
rem JayDocs launcher.
rem   Drag a document folder onto this file, or run:  start.cmd "D:\SagaDocs"
rem   With no argument the current folder is used.
setlocal
set "ROOT=%~1"
if "%ROOT%"=="" set "ROOT=%CD%"
if not exist "%~dp0dist\index.html" (
  echo [JayDocs] dist\index.html not found. Run "npm install" and "npm run build" in %~dp0 first.
  pause
  exit /b 1
)
node "%~dp0server.mjs" --root "%ROOT%" --open
