@echo off
cd /d "%~dp0"
title CROWN STREET Store Server
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer, then try again.
  pause
  exit /b 1
)
echo Starting CROWN STREET...
echo Keep this window open while using the store.
echo Store: http://localhost:3000
echo Admin: http://localhost:3000/admin.html
node server.js
pause
