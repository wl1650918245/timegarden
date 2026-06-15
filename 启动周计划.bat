@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

set ELECTRON_RUN_AS_NODE=

echo [Kill] Closing previous instance...
taskkill /f /im electron.exe >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist "node_modules\electron\dist\electron.exe" (
    echo [Setup] Installing dependencies, first launch may take 2-3 min...
    echo.
    call npm install
    echo.
    echo [Setup] Done. Starting app...
)

start "" "node_modules\electron\dist\electron.exe" . --no-sandbox --user-data-dir="%~dp0user-data"
