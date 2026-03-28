@echo off
:: ============================================
:: Spick Agent – Install as Windows Service
:: ============================================
:: Registers as a Windows Task Scheduler job 
:: that starts automatically on login.
::
:: Run as Administrator for best results.

echo.
echo  ====================================
echo   Spick Agent – Service Install
echo  ====================================
echo.

set AGENT_DIR=%~dp0
set NODE_PATH=node

:: Check for node
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js not found in PATH
    pause
    exit /b 1
)

:: Get full node path
for /f "tokens=*" %%i in ('where node') do set NODE_PATH=%%i
echo  Node: %NODE_PATH%
echo  Agent: %AGENT_DIR%

:: Create Task Scheduler entry
echo.
echo  Creating scheduled task "SpickAgent"...

schtasks /create /tn "SpickAgent" ^
  /tr "\"%NODE_PATH%\" \"%AGENT_DIR%server.js\"" ^
  /sc onlogon ^
  /rl highest ^
  /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo  [OK] Service installed!
    echo.
    echo  The agent will start automatically when you log in.
    echo.
    echo  Manage the service:
    echo    schtasks /run /tn "SpickAgent"      Start now
    echo    schtasks /end /tn "SpickAgent"      Stop
    echo    schtasks /delete /tn "SpickAgent"   Uninstall
    echo.
    echo  Starting now...
    schtasks /run /tn "SpickAgent"
) else (
    echo.
    echo  [ERROR] Could not create service.
    echo  Try running this script as Administrator.
)

pause
