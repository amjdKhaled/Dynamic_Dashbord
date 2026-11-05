@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Standalone.ps1" %*
if errorlevel 1 (
  echo.
  echo Standalone startup failed. Check the PowerShell error above.
  pause
)
