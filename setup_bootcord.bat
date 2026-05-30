@echo off
setlocal enabledelayedexpansion
title bootcord Setup
chcp 65001 >nul

echo ====================================================
echo bootcord: Automatic Setup and Dependency Installer
echo ====================================================

:: 0. Help / Version
if "%~1"=="--help" (
    echo Usage: setup_bootcord.bat
    echo This script will check for and install all necessary dependencies.
    exit /b 0
)

:: 1. Check for Environment File
echo.
echo [1/5] Checking configuration...
if not exist .env (
    if exist env.example (
        copy env.example .env >nul
        echo [OK] Created .env from env.example.
        echo [!] IMPORTANT: Open .env and add your DISCORD_TOKEN.
    ) else (
        echo [WARNING] env.example not found. Please create a .env file manually.
    )
) else (
    echo [OK] .env file already exists.
)

:: 2. Check for Winget (Fallback assistant)
where winget >nul 2>&1
set HAS_WINGET=%ERRORLEVEL%

:: 3. Check for Node.js
echo.
echo [2/5] Checking Node.js...
where node >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    if !HAS_WINGET! EQU 0 (
        echo [!] Node.js NOT FOUND. Attempting automatic installation...
        winget install OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
        if !ERRORLEVEL! EQU 0 (
            echo [OK] Node.js installed. YOU MAY NEED TO RESTART THIS TERMINAL.
        ) else (
            echo [ERROR] Automatic installation failed. Please install from https://nodejs.org/
            goto :error_exit
        )
    ) else (
        echo [ERROR] Node.js NOT FOUND and winget is missing.
        echo Please install Node.js manually: https://nodejs.org/
        goto :error_exit
    )
) else (
    echo [OK] Node.js found. Version:
    node -v
)

:: 4. Check for Python
echo.
echo [3/5] Checking Python...
where python >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    if !HAS_WINGET! EQU 0 (
        echo [!] Python NOT FOUND. Attempting automatic installation...
        winget install Python.Python.3.11 --source winget --accept-source-agreements --accept-package-agreements
        if !ERRORLEVEL! EQU 0 (
            echo [OK] Python installed. YOU MAY NEED TO RESTART THIS TERMINAL.
        ) else (
            echo [ERROR] Automatic installation failed. Please install from https://python.org/
            goto :error_exit
        )
    ) else (
        echo [ERROR] Python NOT FOUND and winget is missing.
        echo Please install Python manually: https://python.org/
        goto :error_exit
    )
) else (
    echo [OK] Python found. Version:
    python --version
)

:: 5. Install Node.js Dependencies
echo.
echo [4/5] Installing Node.js packages...
call npm install
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo [ERROR] Failed to execute npm install.
    goto :error_exit
)
echo [OK] Node.js dependencies updated.

:: 6. Install Python Dependencies
echo.
echo [5/5] Installing Python packages...
if exist requirements.txt (
    python -m pip install -r requirements.txt
    if !ERRORLEVEL! NEQ 0 (
        echo [WARNING] Failed to install Python libraries via pip.
    ) else (
        echo [OK] Python dependencies updated from requirements.txt.
    )
) else (
    echo [!] requirements.txt not found. Installing defaults...
    python -m pip install numpy sounddevice
)

echo.
echo ====================================================
echo SETUP COMPLETED SUCCESSFULLY!
echo ====================================================
echo.
echo NEXT STEPS:
echo 1. Ensure your DISCORD_TOKEN is set in the .env file.
echo 2. Run the app using start_bootcord.bat
echo.
echo Note: If you just installed Node or Python, please 
echo CLOSE and REOPEN this terminal before starting.
echo.
pause
exit /b 0

:error_exit
echo.
echo ====================================================
echo CRITICAL ERROR. Setup aborted.
echo ====================================================
echo Please fix the errors above and run the script again.
echo.
pause
exit /b 1
