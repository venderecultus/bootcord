@echo off
cd /d "%~dp0"
call npm run build
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
npx electron .
