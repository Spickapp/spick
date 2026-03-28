@echo off
:: ============================================
:: Spick Agent – Windows Install Script
:: ============================================
:: Double-click this file to set up everything.

echo.
echo  ====================================
echo   Spick Agent – Installation
echo  ====================================
echo.

:: Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Download from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%

:: Install dependencies
echo.
echo  Installing npm packages...
call npm install
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] npm install failed
    pause
    exit /b 1
)
echo  [OK] Packages installed

:: Install Edge for Playwright
echo.
echo  Installing Microsoft Edge for Playwright...
call npx playwright install msedge
echo  [OK] Edge installed

:: Run setup wizard
echo.
echo  Starting setup wizard...
call node scripts/setup-wizard.js
