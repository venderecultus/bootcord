@echo off
title bootcord starting...
echo [bootcord] Compiling TypeScript...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build failed! Check your code.
    pause
    exit /b %ERRORLEVEL%
)
echo [bootcord] Starting Electron...
npx electron .
pause
