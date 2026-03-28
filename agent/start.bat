@echo off
:: Spick Agent – Quick Start
:: Double-click to start the automation agent.

title Spick Agent
cd /d "%~dp0"

echo.
echo  Starting Spick Agent...
echo  Dashboard: http://localhost:3500/dashboard
echo  Press Ctrl+C to stop.
echo.

node server.js

pause
