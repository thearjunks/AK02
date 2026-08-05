@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup-email-notifications.ps1"
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-scheduled-automation.ps1"
if errorlevel 1 goto failed
echo.
echo Automation setup completed successfully.
pause
exit /b 0
:failed
echo.
echo Automation setup failed. Read the error above.
pause
exit /b 1
