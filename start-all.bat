@echo off
setlocal
cd /d "%~dp0"

echo Starting Guangfa tender agent...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all-dev.ps1"

echo.
echo Startup command finished. You can close this window after checking the status above.
pause
