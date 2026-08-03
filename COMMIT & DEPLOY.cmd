@echo off
title STC Dashboard - Commit and Deploy
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\commit-and-deploy.ps1"
echo.
pause
