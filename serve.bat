@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM serve.bat — restart the local dev server and open the page
REM Run from anywhere; it always cd's into its own folder.
REM ============================================================

cd /d "%~dp0"

set "PORT=8765"
set "URL=http://localhost:%PORT%/"

echo.
echo === Pingusama site mockup - local server ===
echo Project: %cd%
echo Port  : %PORT%
echo.

REM --- 1. Kill any leftover python http.server on this port -----
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [cleanup] killing stale server ^(pid %%P^) on port %PORT%...
    taskkill /PID %%P /F >nul 2>&1
)

REM --- 2. Start a fresh server in a new window ---------------
echo [start]  launching: python -m http.server %PORT%
start "Pingusama server" cmd /k "python -m http.server %PORT%"

REM --- 3. Wait for the port to actually accept connections -----
echo [wait]   polling %URL% ...
set TRIES=0
:wait_loop
set /a TRIES+=1
powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri '%URL%'; exit $r.StatusCode" >nul 2>&1
if not errorlevel 1 goto :ready
if %TRIES% GEQ 20 (
    echo [error]  server didn't come up after 10s
    pause
    exit /b 1
)
timeout /t 0.5 /nobreak >nul
goto :wait_loop

:ready
echo [ready]  server is up

REM --- 4. Open the page in the default browser ----------------
echo [open]   %URL%
start "" "%URL%"

echo.
echo Done. Close the "Pingusama server" window to stop serving.
endlocal
