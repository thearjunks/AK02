@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\automated-refresh-deploy.ps1"
echo.
pause
exit /b %errorlevel%
