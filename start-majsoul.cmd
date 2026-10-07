@echo off
setlocal
chcp 65001 >nul
echo Start Cortico first. Dependencies and the game protocol are prepared automatically.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\start-game.ps1" %*
if errorlevel 1 (
  pause
  exit /b 1
)
