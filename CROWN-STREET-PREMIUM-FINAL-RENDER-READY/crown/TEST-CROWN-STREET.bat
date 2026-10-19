@echo off
cd /d "%~dp0"
title CROWN STREET API Tests
echo The CROWN STREET server must already be running on http://localhost:3000.
node test.js
pause
